const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen } = require('electron');
const { Store } = require('./store');
const { SpotifyClient, REDIRECT_URI } = require('./spotify');
const lyrics = require('./lyrics');

const IS_MAC = process.platform === 'darwin';
const MINI_SIZE = { width: 460, height: 150 };
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+L';
// Lenker renderer-prosessen har lov til å åpne i nettleseren
const EXTERNAL_ALLOWLIST = ['https://developer.spotify.com/', 'https://lrclib.net/', 'https://github.com/'];

// Under utvikling kan Client ID ligge i .env i prosjektmappa
function loadDotEnv() {
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // Ingen .env - helt greit
  }
}

let store;
let spotify;
let win;
let miniMode = false;
let normalBounds = null;

function sendWindowState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('window:state', {
    fullscreen: win.isFullScreen(),
    mini: miniMode,
    alwaysOnTop: win.isAlwaysOnTop(),
  });
}

function createWindow() {
  const bounds = store.get('windowBounds') || { width: 1000, height: 620 };
  const settings = store.get('settings');

  win = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 140,
    title: 'Lyric Player',
    backgroundColor: '#0b0b0f',
    show: false,
    // Egen tittellinje: trafikklys på Mac, innebygde knapper oppå innholdet på Windows
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    titleBarOverlay: IS_MAC ? undefined : { color: '#00000000', symbolColor: '#ffffff', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(settings.alwaysOnTop);
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  for (const event of ['enter-full-screen', 'leave-full-screen', 'always-on-top-changed']) {
    win.on(event, sendWindowState);
  }

  win.on('close', () => {
    store.set('windowBounds', miniMode && normalBounds ? normalBounds : win.getBounds());
  });

  // Lenker i appen skal aldri åpne nye Electron-vinduer
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function setMiniMode(enabled) {
  if (enabled === miniMode || !win) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  miniMode = enabled;
  if (enabled) {
    normalBounds = win.getBounds();
    // Legg minivinduet nederst til høyre på skjermen vinduet står på
    const area = screen.getDisplayMatching(normalBounds).workArea;
    win.setBounds({
      x: area.x + area.width - MINI_SIZE.width - 24,
      y: area.y + area.height - MINI_SIZE.height - 24,
      ...MINI_SIZE,
    }, true);
    win.setAlwaysOnTop(true, 'floating');
  } else {
    if (normalBounds) win.setBounds(normalBounds, true);
    win.setAlwaysOnTop(store.get('settings').alwaysOnTop);
  }
  sendWindowState();
}

function applySettings(settings) {
  if (win && !miniMode) win.setAlwaysOnTop(settings.alwaysOnTop);
  if (win) win.setOpacity(Math.min(1, Math.max(0.3, settings.opacity)));

  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });

  globalShortcut.unregister(TOGGLE_SHORTCUT);
  if (settings.globalShortcut) {
    globalShortcut.register(TOGGLE_SHORTCUT, () => {
      if (!win) return;
      if (win.isVisible() && win.isFocused()) {
        IS_MAC ? app.hide() : win.minimize();
      } else {
        win.show();
        win.focus();
      }
    });
  }
}

// Gjør feil om til et objekt som kan sendes over IPC uten å miste meldingen
function wrap(fn) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message, rateLimited: Boolean(e.rateLimited), status: e.status };
    }
  };
}

function registerIpc() {
  ipcMain.handle('state:get', () => ({
    settings: store.get('settings'),
    clientId: spotify.clientId,
    loggedIn: spotify.isLoggedIn(),
    platform: process.platform,
    version: app.getVersion(),
    redirectUri: REDIRECT_URI,
    shortcut: TOGGLE_SHORTCUT.replace('CommandOrControl', IS_MAC ? '⌘' : 'Ctrl'),
  }));

  ipcMain.handle('settings:set', (_e, patch) => {
    const settings = store.updateSettings(patch);
    applySettings(settings);
    return settings;
  });
  ipcMain.handle('settings:reset', () => {
    const settings = store.resetSettings();
    applySettings(settings);
    return settings;
  });

  ipcMain.handle('auth:setClientId', (_e, id) => store.set('clientId', String(id || '').trim()));
  ipcMain.handle('auth:login', wrap(() => spotify.login()));
  ipcMain.handle('auth:logout', () => spotify.logout());

  ipcMain.handle('spotify:playback', wrap(() => spotify.playback()));
  ipcMain.handle('spotify:control', wrap((action, arg) => spotify.control(action, arg)));

  ipcMain.handle('lyrics:get', wrap((track) => lyrics.getLyrics(track)));
  ipcMain.handle('lyrics:clearCache', () => lyrics.clearCache());

  // Albumcoveret hentes her og sendes som data-URL, så rendereren kan lese
  // pikslene (fargepaletten) uten CORS-problemer
  ipcMain.handle('cover:get', wrap(async (url) => {
    if (!/^https:\/\/[a-z0-9.-]+\.(scdn\.co|spotifycdn\.com)\//i.test(url)) throw new Error('Ugyldig bilde-URL');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Bildet svarte ${resp.status}`);
    const type = resp.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await resp.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  }));

  ipcMain.handle('offset:get', (_e, trackId) => (store.get('offsets') || {})[trackId] || 0);
  ipcMain.handle('offset:set', (_e, trackId, ms) => {
    const offsets = { ...(store.get('offsets') || {}) };
    if (ms) offsets[trackId] = ms;
    else delete offsets[trackId];
    store.set('offsets', offsets);
  });

  ipcMain.handle('window:toggleFullscreen', () => {
    if (miniMode) setMiniMode(false);
    win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.handle('window:exitFullscreen', () => win.setFullScreen(false));
  ipcMain.handle('window:setMini', (_e, enabled) => setMiniMode(Boolean(enabled)));
  ipcMain.handle('window:getState', () => ({
    fullscreen: win.isFullScreen(),
    mini: miniMode,
    alwaysOnTop: win.isAlwaysOnTop(),
  }));
  ipcMain.handle('window:titleBarColor', (_e, symbolColor) => {
    if (!IS_MAC && win.setTitleBarOverlay) {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 40 });
    }
  });
  ipcMain.handle('app:quit', () => app.quit());

  ipcMain.handle('app:openExternal', (_e, url) => {
    if (EXTERNAL_ALLOWLIST.some((prefix) => String(url).startsWith(prefix))) shell.openExternal(url);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    loadDotEnv();
    store = new Store();
    spotify = new SpotifyClient(store);
    registerIpc();
    createWindow();
    applySettings(store.get('settings'));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });
}
