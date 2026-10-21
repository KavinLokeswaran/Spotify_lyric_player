const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LRCLIB = 'https://lrclib.net/api';
const USER_AGENT = 'LyricPlayer/1.0 (https://github.com/KavinLokeswaran/Spotify_lyric_player)';
const DURATION_TOLERANCE_SEC = 4;

function cacheDir() {
  return path.join(app.getPath('userData'), 'lyrics-cache');
}

function cacheFile(trackId) {
  return path.join(cacheDir(), `${String(trackId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

/**
 * Leser LRC-format: "[mm:ss.xx]tekst". Støtter flere tidsstempler på én linje
 * og [offset:±ms]-taggen. Tomme linjer beholdes - de markerer instrumentale pauser.
 */
function parseLrc(lrc) {
  const lines = [];
  let offset = 0;
  for (const raw of lrc.split(/\r?\n/)) {
    const offsetTag = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (offsetTag) {
      offset = Number(offsetTag[1]);
      continue;
    }
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const [, min, sec] of stamps) {
      lines.push({ time: Math.round((Number(min) * 60 + Number(sec)) * 1000), text });
    }
  }
  // Positiv offset i LRC betyr at teksten skal komme tidligere
  return lines.map((l) => ({ ...l, time: Math.max(0, l.time - offset) })).sort((a, b) => a.time - b.time);
}

// "Song - Remastered 2011" / "Song (feat. X)" gir ofte ingen treff - fjern slike tillegg
function cleanTitle(title) {
  return title
    .replace(/\s+-\s+.*(remaster|version|live|edit|mix|mono|stereo).*$/i, '')
    .replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/i, '')
    .trim();
}

async function lrclib(endpoint, params) {
  const url = `${LRCLIB}/${endpoint}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`lrclib svarte ${resp.status}`);
  return resp.json();
}

function toResult(record) {
  if (!record) return null;
  if (record.instrumental) return { synced: null, plain: null, instrumental: true };
  if (record.syncedLyrics) return { synced: parseLrc(record.syncedLyrics), plain: null, instrumental: false };
  if (record.plainLyrics) return { synced: null, plain: record.plainLyrics.split(/\r?\n/), instrumental: false };
  return null;
}

async function findLyrics(track) {
  const artist = track.artists[0] || '';
  const durationSec = Math.round(track.durationMs / 1000);

  try {
    const exact = toResult(await lrclib('get', {
      track_name: track.name,
      artist_name: artist,
      album_name: track.album,
      duration: durationSec,
    }));
    if (exact && (exact.synced || exact.instrumental)) return exact;
  } catch {
    // Prøv søk under i stedet
  }

  // Fallback: søk, og velg treffet med nærmest lengde - foretrekk synkroniserte lyrics
  let results = [];
  try {
    results = await lrclib('search', { track_name: cleanTitle(track.name), artist_name: artist }) || [];
  } catch {
    // lrclib svarer av og til 503 - da regnes det som "ikke funnet" (og caches ikke)
  }
  const close = results.filter((r) => Math.abs((r.duration || 0) - durationSec) <= DURATION_TOLERANCE_SEC);
  const best = close.find((r) => r.syncedLyrics) || close.find((r) => r.plainLyrics) || close.find((r) => r.instrumental);
  return toResult(best);
}

async function getLyrics(track) {
  const file = cacheFile(track.id);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Ikke i cache
  }

  const result = await findLyrics(track);
  if (result) {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result));
  }
  return result || { synced: null, plain: null, instrumental: false, notFound: true };
}

function clearCache() {
  fs.rmSync(cacheDir(), { recursive: true, force: true });
}

module.exports = { getLyrics, clearCache, parseLrc };
