// Tegner app-ikonet (build/icon.png, 1024x1024) med Electron selv, så vi slipper
// ekstra verktøy. electron-builder lager .icns (Mac) og .ico (Windows) fra denne.
// Kjør med: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="a" cx="25%" cy="20%" r="80%">
      <stop offset="0" stop-color="#ff4d8d"/><stop offset="1" stop-color="#ff4d8d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b" cx="85%" cy="85%" r="75%">
      <stop offset="0" stop-color="#00c2ff"/><stop offset="1" stop-color="#00c2ff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="r"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect x="100" y="100" width="824" height="824" fill="#7b5cff"/>
    <rect x="100" y="100" width="824" height="824" fill="url(#a)"/>
    <rect x="100" y="100" width="824" height="824" fill="url(#b)"/>
    <rect x="100" y="100" width="824" height="824" fill="#000" opacity=".12"/>
  </g>
  <g fill="#fff" stroke-linecap="round">
    <rect x="262" y="330" width="380" height="44" rx="22" opacity=".45"/>
    <rect x="262" y="468" width="500" height="76" rx="38"/>
    <rect x="262" y="638" width="300" height="44" rx="22" opacity=".45"/>
  </g>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`Lagret ${out}`);
  app.quit();
});
