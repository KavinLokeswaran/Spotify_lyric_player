(() => {
  const POLL_MS = 1500;           // hvor ofte vi faktisk spør Spotify (for å unngå rate-limiting)
  const POLL_HIDDEN_MS = 5000;    // sjeldnere når vinduet er skjult
  const IDLE_MS = 2600;           // kontrollene skjules når musen har vært i ro så lenge
  const JITTER_MS = 250;          // små avvik mellom estimat og Spotify ignoreres, så teksten ikke hakker
  const INTERLUDE_MIN_MS = 6000;  // pauser lengre enn dette vises som ♪
  const AURORA_FPS = 30;
  const PALETTE_FADE = 0.04;      // hvor fort aurora-fargene glir over til et nytt cover per frame

  // Nettleser-fallback: lar index.html åpnes direkte (f.eks. for å teste utseendet) i demomodus
  const api = window.lyricsApi || browserApi();
  const $ = (sel) => document.querySelector(sel);
  const body = document.body;

  const state = {
    env: {},
    settings: { ...DEFAULT_SETTINGS },
    demo: false,
    track: null,
    lyricsData: null,
    lines: [],                    // [{ time, end, text, interlude, el }]
    idx: -2,
    ref: { progress: 0, at: performance.now(), playing: false },
    trackOffset: 0,
    loadToken: 0,
    palette: Palette.FALLBACK.map((c) => [...c]),
    targetPalette: Palette.FALLBACK,
    cover: null,
    windowState: { fullscreen: false, mini: false, alwaysOnTop: false },
  };

  let pollTimer = null;
  let idleTimer = null;
  let saveTimer = null;
  let toastTimer = null;
  let pendingSave = {};

  // ---------- Oppstart ----------

  async function init() {
    state.env = await api.getState();
    state.settings = { ...DEFAULT_SETTINGS, ...state.env.settings };
    body.classList.add(`os-${state.env.platform}`);

    setupIcons();
    setupControls();
    setupKeyboard();
    setupOnboarding();
    SettingsUI.render($('#settingsBody'), state.settings, state.env, { onChange: changeSettings, onAction: runAction });
    applySettings();
    applyPalette(Palette.FALLBACK);
    updateAccountInfo();

    api.onWindowState((ws) => applyWindowState(ws));
    applyWindowState(await api.getWindowState());

    new ResizeObserver(() => centerOn(state.idx, false)).observe($('#lyrics'));
    requestAnimationFrame(frame);

    if (state.env.loggedIn) startPolling();
    else showOnboarding();
  }

  function browserApi() {
    const KEY = 'lyric-player-settings';
    const unavailable = async () => ({ ok: false, error: 'Ikke tilgjengelig i nettleseren' });
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* privat modus */ }
    return {
      getState: async () => ({ settings: saved, loggedIn: false, platform: 'web', version: 'web', redirectUri: 'http://127.0.0.1:8888/callback', clientId: '' }),
      setSettings: async (patch) => {
        Object.assign(saved, patch);
        try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* ignorer */ }
        return saved;
      },
      resetSettings: async () => { saved = {}; return { ...DEFAULT_SETTINGS }; },
      setClientId: async () => {},
      login: unavailable, logout: async () => {}, playback: unavailable, control: unavailable,
      lyrics: unavailable, cover: unavailable, clearLyricsCache: async () => {},
      getOffset: async () => 0, setOffset: async () => {},
      toggleFullscreen: async () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
      exitFullscreen: async () => document.fullscreenElement && document.exitFullscreen(),
      setMini: async () => {}, getWindowState: async () => ({ fullscreen: false, mini: false, alwaysOnTop: false }),
      setTitleBarColor: async () => {}, onWindowState: () => {}, quit: async () => {},
      openExternal: async (url) => window.open(url, '_blank'),
    };
  }

  // ---------- Innlogging ----------

  function setupOnboarding() {
    $('#redirectUri').textContent = state.env.redirectUri;
    $('#clientIdInput').value = state.env.clientId || '';
    $('#copyRedirect').addEventListener('click', () => {
      navigator.clipboard.writeText(state.env.redirectUri);
      toast('Kopiert');
    });
    $('#loginBtn').addEventListener('click', login);
    $('#clientIdInput').addEventListener('keydown', (e) => e.key === 'Enter' && login());
    $('#demoBtn').addEventListener('click', () => startDemo(true));
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-link]');
      if (link) {
        e.preventDefault();
        api.openExternal(link.dataset.link);
      }
    });
  }

  async function login() {
    const id = $('#clientIdInput').value.trim();
    const error = $('#loginError');
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      error.textContent = 'Client ID ser ikke riktig ut - den er 32 tegn med tall og bokstaver.';
      return;
    }
    error.textContent = '';
    await api.setClientId(id);
    state.env.clientId = id;
    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Venter på nettleseren …';
    const res = await api.login();
    btn.disabled = false;
    btn.textContent = 'Logg inn med Spotify';
    if (!res.ok) {
      error.textContent = res.error;
      return;
    }
    state.env.loggedIn = true;
    updateAccountInfo();
    hideOnboarding();
    startDemo(false);
    startPolling();
  }

  function showOnboarding() {
    $('#onboarding').hidden = false;
    body.classList.add('onboarding');
    setTrackInfo(null);
    showMessage('', '', '');
  }

  function hideOnboarding() {
    $('#onboarding').hidden = true;
    body.classList.remove('onboarding');
  }

  function startDemo(enabled) {
    state.demo = enabled;
    state.track = null;
    body.classList.toggle('demo', enabled);
    updateAccountInfo();
    if (enabled) {
      hideOnboarding();
      startPolling();
      toast('Demomodus - prøv utseendene under innstillinger (S)');
    }
  }

  function updateAccountInfo() {
    const info = $('#accountInfo');
    if (info) {
      info.innerHTML = state.env.loggedIn
        ? `Logget inn med Client ID <code>${(state.env.clientId || '').slice(0, 8)}…</code>`
        : 'Ikke logget inn på Spotify.';
    }
    const demoBtn = $('#demoToggle');
    if (demoBtn) demoBtn.textContent = state.demo ? 'Avslutt demo' : 'Demomodus';
  }

  // ---------- Henting av avspilling ----------

  function startPolling() {
    clearTimeout(pollTimer);
    poll();
  }

  async function poll() {
    clearTimeout(pollTimer);
    let delay = POLL_MS;
    const res = state.demo ? { ok: true, data: Demo.playback() } : await api.playback();

    if (res.ok) {
      delay = handlePlayback(res.data);
    } else if (res.rateLimited) {
      delay = 5000;
    } else if (/Ikke logget inn|invalid_grant/i.test(res.error)) {
      state.env.loggedIn = false;
      updateAccountInfo();
      showOnboarding();
      return;
    } else {
      setStatus(`Feil: ${res.error}`);
      delay = 4000;
    }
    pollTimer = setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : delay);
  }

  function handlePlayback(pb) {
    if (!pb.active || !pb.track) {
      state.ref = { progress: 0, at: performance.now(), playing: false };
      body.classList.remove('playing');
      updatePlayButton();
      if (state.track) {
        state.track = null;
        clearLyrics();
      }
      setTrackInfo(null);
      if (pb.active) showMessage('note', 'Reklame eller ukjent innhold', 'Lyrics kommer tilbake på neste sang');
      else showMessage('note', 'Ingenting spilles av akkurat nå', 'Start en sang i Spotify på hvilken som helst enhet');
      setStatus('');
      return POLL_MS * 2;
    }

    if (!state.track || pb.track.id !== state.track.id) loadTrack(pb.track);

    // Sett referansepunkt for interpolering - frame() oppdaterer linjen jevnt herfra
    const progress = pb.progressMs + (Date.now() - pb.fetchedAt);
    const estimate = estimatePosition(performance.now());
    const drift = Math.abs(estimate - progress);
    if (!(pb.isPlaying && state.ref.playing && drift < JITTER_MS)) {
      state.ref = { progress, at: performance.now(), playing: pb.isPlaying };
    }
    body.classList.toggle('playing', pb.isPlaying);
    updatePlayButton();
    setStatus(state.demo ? 'Demo' : pb.device ? `Spiller på ${pb.device}` : '');

    // Spør igjen rett etter at låten er ferdig, så neste låt dukker opp raskt
    const remaining = pb.track.durationMs - progress;
    return pb.isPlaying && remaining < POLL_MS ? Math.max(250, remaining + 250) : POLL_MS;
  }

  function estimatePosition(now) {
    const { progress, at, playing } = state.ref;
    const pos = progress + (playing ? now - at : 0);
    return state.track ? Math.min(pos, state.track.durationMs) : pos;
  }

  function lyricPosition(now) {
    return estimatePosition(now) + state.settings.syncOffsetMs + state.trackOffset;
  }

  // ---------- Ny låt ----------

  async function loadTrack(track) {
    const token = ++state.loadToken;
    state.track = track;
    state.ref = { progress: 0, at: performance.now(), playing: false };
    clearLyrics();
    setTrackInfo(track);
    loadCover(track, token);

    if (track.isEpisode) {
      showMessage('mic', 'Podkaster har ikke synkroniserte lyrics', '');
      return;
    }
    showMessage('search', 'Henter lyrics …', '');

    state.trackOffset = state.demo ? 0 : await api.getOffset(track.id);
    updateOffsetLabel();
    const res = state.demo ? { ok: true, data: Demo.lyrics() } : await api.lyrics(track);
    if (token !== state.loadToken) return;

    if (!res.ok) {
      showMessage('note', 'Klarte ikke å hente lyrics', res.error);
      return;
    }
    state.lyricsData = res.data;
    renderLyrics();
  }

  async function loadCover(track, token) {
    let src = null;
    if (state.demo) src = Demo.cover();
    else if (track.coverUrl) {
      const res = await api.cover(track.coverUrl);
      if (res.ok) src = res.data;
    }
    if (token !== state.loadToken) return;
    state.cover = src;
    // Forhåndsvisningene i innstillingene viser også coveret
    if (src) document.documentElement.style.setProperty('--cover-img', `url("${src}")`);
    else document.documentElement.style.removeProperty('--cover-img');

    for (const img of [$('#thumb'), $('#artCover'), $('#vinylLabel')]) {
      if (src) img.src = src;
      img.classList.toggle('empty', !src);
    }
    // Krysstoning mellom to bildelag i bakgrunnen
    const layers = document.querySelectorAll('.cover-layer');
    const next = [...layers].find((l) => !l.classList.contains('on')) || layers[0];
    if (src) {
      next.src = src;
      next.decode().catch(() => {}).finally(() => {
        layers.forEach((l) => l.classList.toggle('on', l === next));
      });
    }

    let colors = Palette.FALLBACK;
    if (src) {
      try {
        colors = (await Palette.fromImage(src)).colors;
      } catch {
        // Behold standardfargene
      }
    }
    if (token === state.loadToken) applyPalette(colors);
  }

  function applyPalette(colors) {
    state.targetPalette = colors;
    const root = document.documentElement.style;
    colors.forEach((c, i) => root.setProperty(`--c${i}`, Palette.toCss(c)));
    applyAccent();
  }

  function applyAccent() {
    const accent = {
      album: Palette.toCss(Palette.accentFrom(state.targetPalette)),
      spotify: '#1ed760',
      white: '#ffffff',
    }[state.settings.accent];
    document.documentElement.style.setProperty('--accent', accent || '#ffffff');
  }

  function setTrackInfo(track) {
    const title = track ? track.name : 'Lyric Player';
    const artist = track ? track.artists.join(', ') : '';
    $('#trackTitle').textContent = title;
    $('#trackArtist').textContent = artist;
    $('#artTitle').textContent = track ? title : '';
    $('#artArtist').textContent = artist;
    document.title = track ? `${title} – ${artist}` : 'Lyric Player';
    $('#timeDur').textContent = track ? formatTime(track.durationMs) : '0:00';
    if (!track) {
      for (const img of [$('#thumb'), $('#artCover'), $('#vinylLabel')]) img.classList.add('empty');
    }
  }

  // ---------- Lyrics ----------

  // Gjetter hvor lenge en linje synges - brukes til karaoke-fyll og til å finne pauser
  function sungDuration(text) {
    return Math.min(7000, Math.max(1200, text.length * 85));
  }

  function buildLines(synced) {
    const out = [];
    const first = synced.find((l) => l.text);
    if (first && first.time > INTERLUDE_MIN_MS) out.push({ time: 0, end: first.time, interlude: true });

    synced.forEach((line, i) => {
      const next = synced[i + 1];
      const end = next ? next.time : line.time + 8000;
      if (!line.text) {
        out.push({ time: line.time, end, interlude: true });
        return;
      }
      const sung = sungDuration(line.text);
      if (next && end - line.time > sung + INTERLUDE_MIN_MS) {
        out.push({ time: line.time, end: line.time + sung, text: line.text });
        out.push({ time: line.time + sung, end, interlude: true });
      } else {
        out.push({ time: line.time, end, text: line.text });
      }
    });

    // Slå sammen pauser som kommer rett etter hverandre
    const merged = [];
    for (const line of out) {
      const prev = merged[merged.length - 1];
      if (line.interlude && prev && prev.interlude) prev.end = line.end;
      else merged.push(line);
    }
    if (state.settings.showInterludes) {
      // Korte "pauser" fra tomme LRC-linjer gir ingen mening å vise
      return merged.filter((l) => !l.interlude || l.end - l.time >= 2500);
    }
    return merged.filter((l) => !l.interlude);
  }

  function clearLyrics() {
    state.lines = [];
    state.lyricsData = null;
    state.idx = -2;
    $('#track').innerHTML = '';
    $('#track').style.transform = '';
    $('#lyrics').classList.remove('unsynced');
  }

  function renderLyrics() {
    const data = state.lyricsData;
    const trackEl = $('#track');
    trackEl.innerHTML = '';
    state.lines = [];
    state.idx = -2;
    $('#lyrics').classList.remove('unsynced');

    if (data && data.synced && data.synced.length) {
      state.lines = buildLines(data.synced);
      for (const line of state.lines) {
        const el = document.createElement('div');
        el.className = line.interlude ? 'line interlude' : 'line';
        el.innerHTML = line.interlude
          ? '<span class="txt"><b></b><b></b><b></b></span>'
          : '<span class="txt"></span>';
        if (!line.interlude) el.firstChild.textContent = line.text;
        el.addEventListener('click', () => seekTo(line.time - state.settings.syncOffsetMs - state.trackOffset + 50));
        trackEl.appendChild(el);
        line.el = el;
      }
      hideMessage();
      setActive(findIndex(lyricPosition(performance.now())), false);
    } else if (data && data.plain) {
      $('#lyrics').classList.add('unsynced');
      for (const text of data.plain) {
        const el = document.createElement('div');
        el.className = 'line';
        el.innerHTML = '<span class="txt"></span>';
        el.firstChild.textContent = text || ' ';
        trackEl.appendChild(el);
      }
      hideMessage();
      toast('Bare usynkroniserte lyrics finnes for denne sangen');
    } else if (data && data.instrumental) {
      showMessage('note', 'Instrumental', 'Bare å lene seg tilbake og lytte');
    } else {
      showMessage('search', 'Fant ingen lyrics for denne sangen', 'Lyrics hentes fra lrclib.net - der kan du også legge dem til selv');
    }
  }

  function findIndex(pos) {
    // Binærsøk: siste linje som har startet
    let lo = 0;
    let hi = state.lines.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (state.lines[mid].time <= pos) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return idx;
  }

  function contextLines() {
    if (state.windowState.mini) return 0;
    if (state.settings.layout === 'scroll') return Infinity;
    if (state.settings.layout === 'minimal') return 0;
    return state.settings.contextLines;
  }

  function setActive(idx, animate = true) {
    state.idx = idx;
    const ctx = contextLines();
    state.lines.forEach((line, i) => {
      const d = i - idx;
      const ad = Math.abs(d);
      const el = line.el;
      el.style.setProperty('--ad', Math.min(ad, 6));
      el.classList.toggle('current', d === 0);
      el.classList.toggle('past', d < 0);
      // Før første linje vises de neste linjene som "kommende"
      el.classList.toggle('out', idx >= 0 ? ad > ctx : (i > ctx));
      if (d !== 0) el.style.removeProperty('--p');
    });
    centerOn(idx, animate);
  }

  function centerOn(idx, animate = true) {
    if (!state.lines.length) return;
    const lyricsEl = $('#lyrics');
    const trackEl = $('#track');
    const target = state.lines[Math.max(0, idx)].el;
    const y = lyricsEl.clientHeight / 2 - (target.offsetTop + target.offsetHeight / 2);
    trackEl.classList.toggle('no-anim', !animate);
    trackEl.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  function seekTo(ms) {
    if (!state.track) return;
    const pos = Math.max(0, Math.min(ms, state.track.durationMs - 500));
    state.ref = { progress: pos, at: performance.now(), playing: state.ref.playing };
    control('seek', pos);
  }

  // ---------- Animasjonsløkke ----------

  let lastAurora = 0;
  let auroraTime = 0;

  function frame(now) {
    requestAnimationFrame(frame);

    if (state.track) {
      const pos = estimatePosition(now);
      const pct = Math.min(1, pos / state.track.durationMs);
      $('#barFill').style.transform = `scaleX(${pct})`;
      $('#barKnob').style.left = `${pct * 100}%`;
      $('#timeCur').textContent = formatTime(pos);
    }

    if (state.lines.length) {
      const lpos = lyricPosition(now);
      const idx = findIndex(lpos);
      if (idx !== state.idx) setActive(idx);
      if (idx >= 0) {
        const line = state.lines[idx];
        const dur = line.interlude ? line.end - line.time : Math.min(line.end - line.time, sungDuration(line.text) * 1.25);
        const p = Math.max(0, Math.min(1, (lpos - line.time) / dur));
        line.el.style.setProperty('--p', p.toFixed(4));
      }
    }

    if (state.settings.background === 'aurora' && now - lastAurora > 1000 / AURORA_FPS) {
      auroraTime += ((now - lastAurora) / 1000) * state.settings.animSpeed;
      lastAurora = now;
      state.palette = state.palette.map((c, i) => Palette.mix(c, state.targetPalette[i], PALETTE_FADE));
      drawAurora(auroraTime);
    }
  }

  // Samme teknikk som Python-versjonen: hver farge er en "flekk" som glir rundt,
  // tegnet i lav oppløsning og skalert opp - det gir en myk gradient helt gratis.
  const auroraCanvas = $('#aurora');
  const auroraCtx = auroraCanvas.getContext('2d');
  const auroraImage = auroraCtx.createImageData(auroraCanvas.width, auroraCanvas.height);

  function drawAurora(t) {
    const W = auroraCanvas.width;
    const H = auroraCanvas.height;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const blobs = state.palette.map((color, i) => {
      const bx = 0.5 + 0.42 * Math.sin(t * 0.13 * (1 + i * 0.21) + i * 1.7);
      const by = 0.5 + 0.42 * Math.cos(t * 0.11 * (1 + i * 0.17) + i * 2.3);
      const radius = 0.4 + 0.08 * Math.sin(t * 0.2 + i);
      return [bx * aspect, by, 1 / (radius * radius), color];
    });
    const data = auroraImage.data;
    let p = 0;
    for (let py = 0; py < H; py++) {
      const fy = py / (H - 1);
      for (let px = 0; px < W; px++) {
        const fx = (px / (W - 1)) * aspect;
        let r = 0;
        let g = 0;
        let b = 0;
        let total = 0;
        for (const [bx, by, invR2, c] of blobs) {
          const w = Math.exp(-((fx - bx) ** 2 + (fy - by) ** 2) * invR2) + 0.001;
          r += c[0] * w;
          g += c[1] * w;
          b += c[2] * w;
          total += w;
        }
        data[p++] = r / total;
        data[p++] = g / total;
        data[p++] = b / total;
        data[p++] = 255;
      }
    }
    auroraCtx.putImageData(auroraImage, 0, 0);
  }

  // ---------- Innstillinger ----------

  function changeSettings(patch, { silent = false } = {}) {
    const prev = state.settings;
    state.settings = { ...state.settings, ...patch };
    applySettings(prev);
    SettingsUI.sync(state.settings);

    // Lagre med litt forsinkelse, så glidebrytere ikke skriver til disk hele tiden
    Object.assign(pendingSave, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      api.setSettings(pendingSave);
      pendingSave = {};
    }, silent ? 0 : 200);
  }

  function applySettings(prev = {}) {
    const s = state.settings;
    const classes = [
      `layout-${s.layout}`, `bg-${s.background}`, `align-${s.align}`, `font-${s.font}`, `accent-${s.accent}`,
    ];
    const flags = {
      uppercase: s.uppercase,
      glow: s.glow,
      karaoke: s.karaokeFill,
      'blur-inactive': s.blurInactive,
      grain: s.grain,
      'hide-info': !s.showTrackInfo,
      'hide-controls': !s.showControls,
      'tone-light': s.background === 'paper',
      still: s.animSpeed === 0,
    };
    body.className = body.className
      .split(' ')
      .filter((c) => c && !/^(layout|bg|align|font|accent)-/.test(c) && !(c in flags))
      .concat(classes, Object.keys(flags).filter((k) => flags[k]))
      .join(' ');

    const root = document.documentElement.style;
    root.setProperty('--text-scale', s.textScale);
    root.setProperty('--bg-blur', `${s.bgBlur}px`);
    root.setProperty('--bg-dim', s.bgDim);
    root.setProperty('--speed', Math.max(0.05, s.animSpeed));

    if (prev.accent !== s.accent) applyAccent();
    if (prev.background !== s.background) api.setTitleBarColor(s.background === 'paper' ? '#1b1a17' : '#ffffff');
    if (prev.showInterludes !== undefined && prev.showInterludes !== s.showInterludes && state.lyricsData) renderLyrics();

    // Skriftstørrelse og oppsett påvirker hvor linjene står - sentrer på nytt
    if (state.lines.length) {
      setActive(state.idx, false);
      requestAnimationFrame(() => centerOn(state.idx, false));
    }
  }

  async function runAction(action) {
    switch (action) {
      case 'logout':
        await api.logout();
        state.env.loggedIn = false;
        state.demo = false;
        body.classList.remove('demo');
        state.track = null;
        clearLyrics();
        clearTimeout(pollTimer);
        closeSettings();
        updateAccountInfo();
        showOnboarding();
        break;
      case 'toggle-demo':
        clearLyrics();
        if (state.demo) {
          startDemo(false);
          if (state.env.loggedIn) startPolling();
          else {
            closeSettings();
            showOnboarding();
          }
        } else startDemo(true);
        break;
      case 'clear-cache':
        await api.clearLyricsCache();
        toast('Lyrics-cachen er tømt');
        break;
      case 'reset-settings': {
        const prev = state.settings;
        state.settings = { ...DEFAULT_SETTINGS, ...(await api.resetSettings()) };
        applySettings(prev);
        SettingsUI.sync(state.settings);
        toast('Innstillingene er tilbakestilt');
        break;
      }
      case 'reset-track-offset':
        setTrackOffset(0);
        break;
      case 'mini':
        closeSettings();
        api.setMini(!state.windowState.mini);
        break;
      case 'fullscreen':
        api.toggleFullscreen();
        break;
    }
  }

  function setTrackOffset(ms) {
    state.trackOffset = Math.max(-10000, Math.min(10000, ms));
    if (state.track && !state.demo) api.setOffset(state.track.id, state.trackOffset);
    updateOffsetLabel();
    toast(`Synk for denne sangen: ${formatOffset(state.trackOffset)}`);
  }

  function updateOffsetLabel() {
    $('#offsetLabel').textContent = formatOffset(state.trackOffset);
    $('#offsetLabel').classList.toggle('changed', state.trackOffset !== 0);
  }

  // ---------- Vindu ----------

  function applyWindowState(ws) {
    const wasMini = state.windowState.mini;
    state.windowState = ws;
    body.classList.toggle('fullscreen', ws.fullscreen);
    body.classList.toggle('mini', ws.mini);
    body.classList.toggle('on-top', ws.alwaysOnTop);
    setIcon('[data-action="fullscreen"]', ws.fullscreen ? 'exitFullscreen' : 'fullscreen');
    if (wasMini !== ws.mini && state.lines.length) setActive(state.idx, false);
  }

  function toggleSettings() {
    body.classList.toggle('settings-open');
  }

  function closeSettings() {
    body.classList.remove('settings-open');
  }

  // ---------- Kontroller ----------

  function setIcon(selector, name) {
    document.querySelectorAll(selector).forEach((b) => { b.innerHTML = ICONS[name]; });
  }

  function setupIcons() {
    setIcon('[data-action="previous"]', 'previous');
    setIcon('[data-action="next"]', 'next');
    setIcon('[data-action="playpause"]', 'play');
    setIcon('[data-action="fullscreen"]', 'fullscreen');
    setIcon('#controls [data-action="settings"]', 'settings');
    setIcon('#settings [data-action="settings"]', 'close');
    setIcon('[data-action="mini"]', 'mini');
    setIcon('[data-action="pin"]', 'pin');
    setIcon('[data-action="offset-minus"]', 'minus');
    setIcon('[data-action="offset-plus"]', 'plus');
    document.querySelector('#onboarding .logo').innerHTML = ICONS.note;
  }

  function updatePlayButton() {
    setIcon('[data-action="playpause"]', state.ref.playing ? 'pause' : 'play');
  }

  async function control(action, arg) {
    if (state.demo) {
      Demo.control(action, arg);
      setTimeout(poll, 30);
      return;
    }
    const res = await api.control(action, arg);
    if (!res.ok) {
      toast(res.status === 403 ? 'Spotify Premium kreves for å styre avspillingen' : `Kunne ikke styre Spotify: ${res.error}`);
    }
    setTimeout(poll, 350);
  }

  function playPause() {
    if (!state.track) return;
    const playing = !state.ref.playing;
    // Oppdater med en gang - Spotify bekrefter ved neste spørring
    state.ref = { progress: estimatePosition(performance.now()), at: performance.now(), playing };
    body.classList.toggle('playing', playing);
    updatePlayButton();
    control(playing ? 'play' : 'pause');
  }

  function handleAction(action) {
    switch (action) {
      case 'playpause': return playPause();
      case 'next': return control('next');
      case 'previous': return control('previous');
      case 'fullscreen': return api.toggleFullscreen();
      case 'mini': return runAction('mini');
      case 'pin': {
        const on = !state.settings.alwaysOnTop;
        changeSettings({ alwaysOnTop: on });
        return toast(on ? 'Alltid øverst: på' : 'Alltid øverst: av');
      }
      case 'settings': return toggleSettings();
      case 'offset-minus': return setTrackOffset(state.trackOffset - 100);
      case 'offset-plus': return setTrackOffset(state.trackOffset + 100);
    }
  }

  function setupControls() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn) handleAction(btn.dataset.action);
    });

    $('#bar').addEventListener('click', (e) => {
      if (!state.track) return;
      const rect = e.currentTarget.getBoundingClientRect();
      seekTo(((e.clientX - rect.left) / rect.width) * state.track.durationMs);
    });

    // Dobbeltklikk på teksten = fullskjerm (som i videospillere)
    $('#lyrics').addEventListener('dblclick', (e) => {
      if (!e.target.closest('.line')) api.toggleFullscreen();
    });

    const wake = () => {
      body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!body.classList.contains('settings-open') && !$('#controls').matches(':hover')) body.classList.add('idle');
      }, IDLE_MS);
    };
    document.addEventListener('mousemove', wake);
    document.addEventListener('mousedown', wake);
    document.addEventListener('mouseleave', () => {
      clearTimeout(idleTimer);
      if (!body.classList.contains('settings-open')) body.classList.add('idle');
    });
    wake();

    document.addEventListener('visibilitychange', () => !document.hidden && startPolling());
  }

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input:not([type=range]):not([type=checkbox])')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = state.settings;
      const step = e.shiftKey ? 500 : 100;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          playPause();
          break;
        case 'ArrowRight': control('next'); break;
        case 'ArrowLeft': control('previous'); break;
        case 'ArrowUp':
          e.preventDefault();
          changeSettings({ textScale: Math.min(1.8, +(s.textScale + 0.05).toFixed(2)) });
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeSettings({ textScale: Math.max(0.6, +(s.textScale - 0.05).toFixed(2)) });
          break;
        case '[': case '{': setTrackOffset(state.trackOffset - step); break;
        case ']': case '}': setTrackOffset(state.trackOffset + step); break;
        case '0': setTrackOffset(0); break;
        case 'f': case 'F': api.toggleFullscreen(); break;
        case 'm': case 'M': runAction('mini'); break;
        case 'p': case 'P': handleAction('pin'); break;
        case 's': case 'S': toggleSettings(); break;
        case 't': case 'T': {
          const { patch, name } = SettingsUI.nextPreset(s);
          changeSettings(patch);
          toast(`Tema: ${name}`);
          break;
        }
        case 'l': case 'L': {
          const { patch, name } = SettingsUI.cycle('layout', s, e.shiftKey ? -1 : 1);
          changeSettings(patch);
          toast(`Oppsett: ${name}`);
          break;
        }
        case 'b': case 'B': {
          const { patch, name } = SettingsUI.cycle('background', s, e.shiftKey ? -1 : 1);
          changeSettings(patch);
          toast(`Bakgrunn: ${name}`);
          break;
        }
        case 'Escape':
          if (body.classList.contains('settings-open')) closeSettings();
          else if (state.windowState.mini) api.setMini(false);
          else api.exitFullscreen();
          break;
        case 'q': case 'Q': api.quit(); break;
      }
    });
  }

  // ---------- Små hjelpere ----------

  function showMessage(icon, text, sub) {
    $('#messageIcon').innerHTML = icon ? ICONS[icon] : '';
    $('#messageText').textContent = text;
    $('#messageSub').textContent = sub;
    $('#message').classList.toggle('visible', Boolean(text));
  }

  function hideMessage() {
    $('#message').classList.remove('visible');
  }

  function setStatus(text) {
    $('#status').textContent = text;
  }

  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2200);
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function formatOffset(ms) {
    return `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${(Math.abs(ms) / 1000).toFixed(1)}s`;
  }

  init();
})();
