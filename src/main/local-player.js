const { execFile, spawn } = require('child_process');

/**
 * Lokal modus: leser avspillingen direkte fra Spotify-appen på denne maskinen,
 * uten Spotify-konto eller utviklerapp. Svarer i samme format som SpotifyClient.
 *   - Mac: AppleScript (Spotify har eget AppleScript-støtte)
 *   - Windows: Windows sin medieøkt (GlobalSystemMediaTransportControls) via PowerShell
 */

const DEVICE = 'denne maskinen';
const LINE = '\u001f'; // skilletegn som aldri står i titler

function localError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------- Mac ----------

const MAC_STATE_SCRIPT = `
tell application "Spotify"
  set playerState to player state as string
  if playerState is "stopped" then return "stopped"
  set t to current track
  set art to ""
  try
    set art to artwork url of t
  end try
  set sep to (ASCII character 31)
  return playerState & sep & (id of t) & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & ((duration of t) as string) & sep & ((player position) as string) & sep & art
end tell`;

const MAC_COMMANDS = {
  play: 'play',
  pause: 'pause',
  next: 'next track',
  previous: 'previous track',
};

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else resolve(stdout.trim());
    });
  });
}

async function macIsRunning() {
  // Sjekk først - ellers ville AppleScript starte Spotify av seg selv
  try {
    await run('pgrep', ['-x', 'Spotify'], 2000);
    return true;
  } catch {
    return false;
  }
}

async function osascript(script) {
  try {
    return await run('osascript', ['-e', script]);
  } catch (e) {
    if (/-1743/.test(e.stderr || '')) {
      throw localError(
        'Lyric Player har ikke lov til å lese Spotify. Gi tilgang i Systeminnstillinger → Personvern og sikkerhet → Automatisering.',
        'not-authorized',
      );
    }
    throw localError(`Kunne ikke lese Spotify: ${(e.stderr || e.message).trim()}`, 'failed');
  }
}

// Norsk språkoppsett gir komma som desimaltegn i AppleScript
function parseNumber(text) {
  return Number(String(text).replace(',', '.')) || 0;
}

async function macPlayback() {
  if (!(await macIsRunning())) return { active: false, reason: 'not-running' };

  const started = Date.now();
  const out = await osascript(MAC_STATE_SCRIPT);
  // Posisjonen ble lest et sted midt i kallet - bruk midtpunktet som tidsstempel
  const fetchedAt = Math.round((started + Date.now()) / 2);
  if (out === 'stopped') return { active: false, reason: 'stopped' };

  const [state, id, name, artist, album, duration, position, artwork] = out.split(LINE);
  const base = {
    active: true,
    isPlaying: state === 'playing',
    progressMs: Math.round(parseNumber(position) * 1000),
    device: DEVICE,
    type: id.startsWith('spotify:episode') ? 'episode' : 'track',
    fetchedAt,
  };
  if (id.startsWith('spotify:ad')) return { ...base, track: null };
  return {
    ...base,
    track: {
      id,
      name,
      artists: artist ? [artist] : [],
      album,
      durationMs: Math.round(parseNumber(duration)),
      coverUrl: artwork || null,
      isEpisode: base.type === 'episode',
    },
  };
}

async function macControl(action, arg) {
  if (!(await macIsRunning())) throw localError('Spotify kjører ikke', 'not-running');
  const command = action === 'seek'
    ? `set player position to (${Math.max(0, Math.round(arg))} / 1000)`
    : MAC_COMMANDS[action];
  if (!command) throw new Error(`Ukjent handling: ${action}`);
  await osascript(`tell application "Spotify" to ${command}`);
}

// ---------- Windows ----------

// Kjører som én langlivet PowerShell-prosess som svarer på én kommando per linje,
// så vi slipper å starte PowerShell (tregt) for hver eneste spørring.
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Reply($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Get-SpotifySession {
  foreach ($s in $manager.GetSessions()) {
    if ($s.SourceAppUserModelId -like '*Spotify*') { return $s }
  }
  return $null
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  try {
    $s = Get-SpotifySession
    if ($null -eq $s) {
      Reply @{ ok = $true; running = $false }
      continue
    }
    switch ($parts[0]) {
      'state' {
        $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $tl = $s.GetTimelineProperties()
        $playing = $s.GetPlaybackInfo().PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
        $pos = $tl.Position.TotalMilliseconds
        # Posisjonen gjelder fra LastUpdatedTime - legg til tiden som har gått siden
        if ($playing) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds }
        Reply @{ ok = $true; running = $true; playing = $playing; title = $props.Title; artist = $props.Artist;
                 album = $props.AlbumTitle; durationMs = $tl.EndTime.TotalMilliseconds; positionMs = $pos }
      }
      'cover' {
        $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ($null -eq $props.Thumbnail) { Reply @{ ok = $true; running = $true; data = $null }; break }
        $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $size = [uint32]$stream.Size
        $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
        $null = Await ($reader.LoadAsync($size)) ([uint32])
        $bytes = New-Object byte[] $size
        $reader.ReadBytes($bytes)
        Reply @{ ok = $true; running = $true; type = $stream.ContentType; data = [Convert]::ToBase64String($bytes) }
      }
      'play' { $null = Await ($s.TryPlayAsync()) ([bool]); Reply @{ ok = $true; running = $true } }
      'pause' { $null = Await ($s.TryPauseAsync()) ([bool]); Reply @{ ok = $true; running = $true } }
      'next' { $null = Await ($s.TrySkipNextAsync()) ([bool]); Reply @{ ok = $true; running = $true } }
      'previous' { $null = Await ($s.TrySkipPreviousAsync()) ([bool]); Reply @{ ok = $true; running = $true } }
      'seek' {
        $null = Await ($s.TryChangePlaybackPositionAsync([int64]$parts[1] * 10000)) ([bool])
        Reply @{ ok = $true; running = $true }
      }
      default { Reply @{ ok = $false; error = "Ukjent kommando: $($parts[0])" } }
    }
  } catch {
    Reply @{ ok = $false; error = $_.Exception.Message }
  }
}
`;

class WindowsMedia {
  constructor() {
    this.proc = null;
    this.queue = [];
    this.buffer = '';
  }

  start() {
    // -EncodedCommand slipper oss unna å lagre skriptet som fil (det ligger inne i app.asar)
    const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        const pending = this.queue.shift();
        if (pending) pending.resolve(JSON.parse(line));
      }
    });
    const fail = (err) => {
      this.proc = null;
      for (const p of this.queue.splice(0)) p.reject(err);
    };
    this.proc.on('exit', () => fail(localError('Medieøkt-hjelperen stoppet', 'failed')));
    this.proc.on('error', (e) => fail(localError(`Kunne ikke starte PowerShell: ${e.message}`, 'failed')));
  }

  send(command) {
    if (!this.proc) this.start();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      this.queue.push(entry);
      this.proc.stdin.write(`${command}\n`);
      // Første kall tar litt tid fordi PowerShell må starte
      setTimeout(() => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) {
          this.queue.splice(i, 1);
          reject(localError('Medieøkten svarte ikke', 'failed'));
        }
      }, 8000);
    }).then((res) => {
      if (!res.ok) throw localError(res.error || 'Ukjent feil', 'failed');
      if (!res.running) throw localError('Spotify kjører ikke', 'not-running');
      return res;
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
    this.proc = null;
  }
}

let windowsMedia = null;

async function windowsPlayback() {
  windowsMedia = windowsMedia || new WindowsMedia();
  let res;
  try {
    res = await windowsMedia.send('state');
  } catch (e) {
    if (e.code === 'not-running') return { active: false, reason: 'not-running' };
    throw e;
  }
  if (!res.title) return { active: false, reason: 'stopped' };

  // Medieøkten gir ingen Spotify-ID - lag en stabil ID av artist og tittel
  const id = `local:${res.artist}|${res.title}`;
  return {
    active: true,
    isPlaying: Boolean(res.playing),
    progressMs: Math.max(0, Math.round(res.positionMs || 0)),
    device: DEVICE,
    type: 'track',
    fetchedAt: Date.now(),
    track: {
      id,
      name: res.title,
      artists: res.artist ? [res.artist] : [],
      album: res.album || '',
      durationMs: Math.round(res.durationMs || 0),
      coverUrl: 'local:thumbnail',
      isEpisode: false,
    },
  };
}

async function windowsThumbnail() {
  windowsMedia = windowsMedia || new WindowsMedia();
  const res = await windowsMedia.send('cover');
  if (!res.data) throw localError('Ingen albumcover', 'failed');
  return `data:${res.type || 'image/jpeg'};base64,${res.data}`;
}

async function windowsControl(action, arg) {
  windowsMedia = windowsMedia || new WindowsMedia();
  if (!['play', 'pause', 'next', 'previous', 'seek'].includes(action)) throw new Error(`Ukjent handling: ${action}`);
  await windowsMedia.send(action === 'seek' ? `seek ${Math.max(0, Math.round(arg))}` : action);
}

// ---------- Felles ----------

const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

module.exports = {
  supported: IS_MAC || IS_WINDOWS,

  async playback() {
    if (IS_MAC) return macPlayback();
    if (IS_WINDOWS) return windowsPlayback();
    return { active: false, reason: 'unsupported' };
  },

  async control(action, arg) {
    if (IS_MAC) return macControl(action, arg);
    if (IS_WINDOWS) return windowsControl(action, arg);
    throw localError('Lokal modus støttes ikke på dette systemet', 'unsupported');
  },

  thumbnail() {
    return windowsThumbnail();
  },

  stop() {
    if (windowsMedia) windowsMedia.stop();
  },
};
