const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const DEFAULT_SETTINGS = require('../shared/defaults');

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = { clientId: '', settings: {}, offsets: {}, windowBounds: null, tokens: null };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      // Første oppstart eller ødelagt fil - start med standardverdier
    }
    this.data.settings = { ...DEFAULT_SETTINGS, ...this.data.settings };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  resetSettings() {
    this.data.settings = { ...DEFAULT_SETTINGS };
    this.save();
    return this.data.settings;
  }

  // Tokens krypteres med OS-ets nøkkelring (Keychain / DPAPI) når det er mulig
  getTokens() {
    const stored = this.data.tokens;
    if (!stored) return null;
    try {
      const json = stored.encrypted
        ? safeStorage.decryptString(Buffer.from(stored.value, 'base64'))
        : stored.value;
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  setTokens(tokens) {
    if (!tokens) {
      this.set('tokens', null);
      return;
    }
    const json = JSON.stringify(tokens);
    if (safeStorage.isEncryptionAvailable()) {
      this.set('tokens', { encrypted: true, value: safeStorage.encryptString(json).toString('base64') });
    } else {
      this.set('tokens', { encrypted: false, value: json });
    }
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
