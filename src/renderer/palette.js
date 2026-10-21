// Henter en fargepalett fra albumcoveret - samme idé som i Python-versjonen:
// finn de vanligste fargene og gjør dem litt mer mettede, så det blir fargerikt.
const Palette = (() => {
  const SIZE = 40;
  const COUNT = 5;

  // Brukes før første låt er lastet, og hvis coveret ikke kan leses
  const FALLBACK = [
    [255, 77, 141],   // rosa
    [123, 92, 255],   // lilla
    [0, 194, 255],    // blå
    [29, 185, 84],    // Spotify-grønn
    [255, 159, 67],   // oransje
  ];

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hslToRgb([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((c) => c * 255);
  }

  // Unngå nesten svart/hvitt og øk metningen
  function vivid(rgb) {
    const [h, s, l] = rgbToHsl(rgb);
    return hslToRgb([h, Math.max(0.6, s), Math.min(0.62, Math.max(0.38, l))]);
  }

  function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function mix(a, b, t) {
    return a.map((x, i) => x + (b[i] - x) * t);
  }

  function toCss(rgb) {
    return `rgb(${rgb.map((c) => Math.round(c)).join(' ')})`;
  }

  async function fromImage(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

    // Grupper pikslene i "bøtter" (4 bit per kanal) og tell hvor vanlig hver er
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bin.n++;
      bin.r += data[i];
      bin.g += data[i + 1];
      bin.b += data[i + 2];
      bins.set(key, bin);
    }

    // Fargerike farger teller mer enn grå, så paletten ikke blir kjedelig
    const ranked = [...bins.values()]
      .map((bin) => {
        const rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
        const [, s] = rgbToHsl(rgb);
        return { rgb, score: bin.n * (0.35 + s) };
      })
      .sort((a, b) => b.score - a.score);

    const picked = [];
    for (const { rgb } of ranked) {
      if (picked.every((p) => distance(p, rgb) > 56)) picked.push(rgb);
      if (picked.length === COUNT) break;
    }

    const dominant = ranked.length ? ranked[0].rgb : FALLBACK[0];
    const colors = picked.map(vivid);
    while (colors.length < COUNT) colors.push(FALLBACK[colors.length]);
    return { colors, dominant };
  }

  // Aksentfargen: den mest fargerike i paletten, lysnet litt så den syns på mørk bakgrunn
  function accentFrom(colors) {
    const best = [...colors].sort((a, b) => rgbToHsl(b)[1] - rgbToHsl(a)[1])[0];
    return mix(best, [255, 255, 255], 0.25);
  }

  return { FALLBACK, fromImage, vivid, mix, toCss, accentFrom };
})();
