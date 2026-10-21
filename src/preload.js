const { contextBridge, ipcRenderer } = require('electron');

// Det eneste rendereren får tilgang til - ingen Node-API-er direkte
contextBridge.exposeInMainWorld('lyricsApi', {
  getState: () => ipcRenderer.invoke('state:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  setClientId: (id) => ipcRenderer.invoke('auth:setClientId', id),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  playback: (source) => ipcRenderer.invoke('player:playback', source),
  control: (source, action, arg) => ipcRenderer.invoke('player:control', source, action, arg),

  lyrics: (track) => ipcRenderer.invoke('lyrics:get', track),
  clearLyricsCache: () => ipcRenderer.invoke('lyrics:clearCache'),
  cover: (url) => ipcRenderer.invoke('cover:get', url),

  getOffset: (trackId) => ipcRenderer.invoke('offset:get', trackId),
  setOffset: (trackId, ms) => ipcRenderer.invoke('offset:set', trackId, ms),

  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('window:exitFullscreen'),
  setMini: (enabled) => ipcRenderer.invoke('window:setMini', enabled),
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  setTitleBarColor: (color) => ipcRenderer.invoke('window:titleBarColor', color),
  onWindowState: (cb) => ipcRenderer.on('window:state', (_e, state) => cb(state)),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
