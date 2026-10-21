const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
// Innebygd Client ID (fra package.json), så brukerne bare trenger å logge inn med Spotify
const { spotifyClientId: BUILT_IN_CLIENT_ID = '' } = require('../../package.json');

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
].join(' ');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Lyric Player</title>
<body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0b0b0f;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>✓ Du er logget inn</h1><p style="opacity:.7">Du kan lukke denne fanen og gå tilbake til Lyric Player.</p></div>`;

/**
 * Spotify-klient med PKCE-innlogging. PKCE trenger ikke Client Secret, så ingen
 * hemmeligheter må ligge i appen - brukeren limer bare inn sin egen Client ID.
 */
class SpotifyClient {
  constructor(store) {
    this.store = store;
    this.tokens = store.getTokens();
    this.rateLimitedUntil = 0;
  }

  // Egen Client ID (avansert) går foran den innebygde
  get clientId() {
    return this.store.get('clientId') || BUILT_IN_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID || '';
  }

  get hasBuiltInClientId() {
    return Boolean(BUILT_IN_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID);
  }

  isLoggedIn() {
    return Boolean(this.tokens && this.tokens.refresh_token);
  }

  login() {
    const clientId = this.clientId;
    if (!clientId) return Promise.reject(new Error('Mangler Client ID'));

    const verifier = base64url(crypto.randomBytes(64));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));

    return new Promise((resolve, reject) => {
      let timer;
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const finish = (err) => {
          clearTimeout(timer);
          server.close();
          err ? reject(err) : resolve();
        };
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400).end('Ugyldig state');
          finish(new Error('Ugyldig svar fra Spotify (state)'));
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Innlogging avbrutt: ${error}`);
          finish(new Error(`Innlogging avbrutt: ${error}`));
          return;
        }
        try {
          await this.requestToken({
            grant_type: 'authorization_code',
            code: url.searchParams.get('code'),
            redirect_uri: REDIRECT_URI,
            client_id: clientId,
            code_verifier: verifier,
          });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
          finish();
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(e.message);
          finish(e);
        }
      });

      server.on('error', (e) => {
        clearTimeout(timer);
        reject(e.code === 'EADDRINUSE'
          ? new Error(`Port ${REDIRECT_PORT} er opptatt - lukk andre programmer som bruker den (f.eks. den gamle Python-versjonen)`)
          : e);
      });

      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        const auth = new URL('https://accounts.spotify.com/authorize');
        auth.search = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: REDIRECT_URI,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          scope: SCOPES,
          state,
        }).toString();
        shell.openExternal(auth.toString());
      });

      timer = setTimeout(() => {
        server.close();
        reject(new Error('Innloggingen tok for lang tid - prøv igjen'));
      }, LOGIN_TIMEOUT_MS);
    });
  }

  logout() {
    this.tokens = null;
    this.store.setTokens(null);
  }

  async requestToken(params) {
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error_description || data.error || `Spotify svarte ${resp.status}`);
    }
    // Ved fornyelse sender Spotify ikke alltid ny refresh_token - behold den gamle
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || (this.tokens && this.tokens.refresh_token),
      expires_at: Date.now() + data.expires_in * 1000,
    };
    this.store.setTokens(this.tokens);
  }

  async accessToken(forceRefresh = false) {
    if (!this.isLoggedIn()) throw new Error('Ikke logget inn');
    if (forceRefresh || Date.now() > this.tokens.expires_at - 60_000) {
      try {
        await this.requestToken({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refresh_token,
          client_id: this.clientId,
        });
      } catch (e) {
        // Refresh token er trukket tilbake - brukeren må logge inn på nytt
        if (/invalid_grant|revoked/i.test(e.message)) this.logout();
        throw e;
      }
    }
    return this.tokens.access_token;
  }

  async api(method, endpoint, retry = true) {
    if (Date.now() < this.rateLimitedUntil) {
      const err = new Error('rate-limited');
      err.rateLimited = true;
      throw err;
    }
    const token = await this.accessToken();
    const resp = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401 && retry) {
      await this.accessToken(true);
      return this.api(method, endpoint, false);
    }
    if (resp.status === 429) {
      const wait = Number(resp.headers.get('Retry-After') || 5);
      this.rateLimitedUntil = Date.now() + wait * 1000;
      const err = new Error('rate-limited');
      err.rateLimited = true;
      throw err;
    }
    if (resp.status === 204) return null;
    const text = await resp.text();
    const data = text ? JSON.parse(text) : null;
    if (!resp.ok) {
      const message = (data && data.error && data.error.message) || `Spotify svarte ${resp.status}`;
      const err = new Error(message);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  // Forenkler svaret fra /me/player til akkurat det appen trenger
  async playback() {
    const data = await this.api('GET', '/me/player?additional_types=episode');
    if (!data) return { active: false };

    const item = data.item;
    const base = {
      active: true,
      isPlaying: Boolean(data.is_playing),
      progressMs: data.progress_ms || 0,
      device: data.device ? data.device.name : null,
      type: data.currently_playing_type,
      fetchedAt: Date.now(),
    };
    if (!item) return { ...base, track: null };

    const images = (item.album && item.album.images) || item.images || [];
    return {
      ...base,
      track: {
        id: item.id || item.uri,
        name: item.name,
        artists: item.artists ? item.artists.map((a) => a.name) : [item.show ? item.show.name : ''],
        album: item.album ? item.album.name : '',
        durationMs: item.duration_ms,
        coverUrl: images.length ? images[0].url : null,
        isEpisode: data.currently_playing_type === 'episode',
      },
    };
  }

  async control(action, arg) {
    switch (action) {
      case 'play': return this.api('PUT', '/me/player/play');
      case 'pause': return this.api('PUT', '/me/player/pause');
      case 'next': return this.api('POST', '/me/player/next');
      case 'previous': return this.api('POST', '/me/player/previous');
      case 'seek': return this.api('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(arg))}`);
      default: throw new Error(`Ukjent handling: ${action}`);
    }
  }
}

module.exports = { SpotifyClient, REDIRECT_URI };
