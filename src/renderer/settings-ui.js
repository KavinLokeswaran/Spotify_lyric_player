// Innstillingspanelet bygges fra en beskrivelse (SECTIONS) i stedet for å skrive all HTML for hånd
const SettingsUI = (() => {
  // Innstillingene et tema bestemmer - brukes for å se hvilket tema som er aktivt
  const LOOK_KEYS = ['layout', 'background', 'font', 'align', 'contextLines', 'uppercase',
    'glow', 'karaokeFill', 'blurInactive', 'grain', 'bgDim'];

  const PRESETS = [
    { id: 'aurora', name: 'Aurora', values: { layout: 'classic', background: 'aurora', font: 'system', align: 'center', contextLines: 1, uppercase: false, glow: true, karaokeFill: true, blurInactive: true, grain: false, bgDim: 0.3 } },
    { id: 'cover', name: 'Albumcover', values: { layout: 'scroll', background: 'cover-blur', font: 'system', align: 'center', contextLines: 1, uppercase: false, glow: true, karaokeFill: true, blurInactive: true, grain: false, bgDim: 0.35 } },
    { id: 'studio', name: 'Studio', values: { layout: 'split', background: 'cover-blur', font: 'system', align: 'left', contextLines: 2, uppercase: false, glow: false, karaokeFill: true, blurInactive: true, grain: false, bgDim: 0.45 } },
    { id: 'vinyl', name: 'Vinyl', values: { layout: 'vinyl', background: 'gradient', font: 'serif', align: 'left', contextLines: 2, uppercase: false, glow: false, karaokeFill: true, blurInactive: true, grain: true, bgDim: 0.35 } },
    { id: 'poster', name: 'Plakat', values: { layout: 'minimal', background: 'cover', font: 'condensed', align: 'center', contextLines: 0, uppercase: true, glow: false, karaokeFill: true, blurInactive: false, grain: true, bgDim: 0.55 } },
    { id: 'karaoke', name: 'Karaoke', values: { layout: 'classic', background: 'solid', font: 'rounded', align: 'center', contextLines: 2, uppercase: false, glow: true, karaokeFill: true, blurInactive: false, grain: false, bgDim: 0 } },
    { id: 'paper', name: 'Papir', values: { layout: 'scroll', background: 'paper', font: 'serif', align: 'left', contextLines: 1, uppercase: false, glow: false, karaokeFill: true, blurInactive: true, grain: true, bgDim: 0 } },
  ];

  const LAYOUTS = [
    { id: 'classic', name: 'Klassisk' },
    { id: 'scroll', name: 'Rulletekst' },
    { id: 'split', name: 'Cover + tekst' },
    { id: 'vinyl', name: 'Vinyl' },
    { id: 'minimal', name: 'Én linje' },
  ];

  const BACKGROUNDS = [
    { id: 'aurora', name: 'Aurora' },
    { id: 'cover-blur', name: 'Uskarpt cover' },
    { id: 'cover', name: 'Stort cover' },
    { id: 'gradient', name: 'Gradient' },
    { id: 'solid', name: 'Mørk' },
    { id: 'paper', name: 'Papir' },
  ];

  const percent = (v) => `${Math.round(v * 100)} %`;
  const seconds = (ms) => `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${(Math.abs(ms) / 1000).toFixed(2)} s`;

  function sections(env) {
    return [
      { title: 'Tema', hint: 'Ferdige kombinasjoner - du kan justere alt under etterpå.', items: [
        { type: 'cards', presets: true, options: PRESETS.map((p) => ({ id: p.id, name: p.name, layout: p.values.layout, bg: p.values.background, upper: p.values.uppercase })) },
      ] },
      { title: 'Oppsett', items: [
        { type: 'cards', key: 'layout', options: LAYOUTS.map((l) => ({ ...l, layout: l.id, bg: 'neutral' })) },
      ] },
      { title: 'Bakgrunn', items: [
        { type: 'cards', key: 'background', options: BACKGROUNDS.map((b) => ({ ...b, layout: 'classic', bg: b.id })) },
        { type: 'range', key: 'bgBlur', label: 'Uskarphet på cover', min: 0, max: 150, step: 5, format: (v) => `${v} px` },
        { type: 'range', key: 'bgDim', label: 'Demping', min: 0, max: 0.85, step: 0.05, format: percent },
        { type: 'range', key: 'animSpeed', label: 'Animasjonsfart', min: 0, max: 3, step: 0.1, format: (v) => (v === 0 ? 'Stillestående' : `${v.toFixed(1)}×`) },
        { type: 'toggle', key: 'grain', label: 'Filmkorn', hint: 'Lett støy over bakgrunnen for et analogt preg' },
      ] },
      { title: 'Tekst', items: [
        { type: 'segmented', key: 'font', label: 'Skrift', options: [
          { id: 'system', name: 'System' }, { id: 'serif', name: 'Serif' }, { id: 'rounded', name: 'Rund' },
          { id: 'condensed', name: 'Smal' }, { id: 'mono', name: 'Mono' }] },
        { type: 'range', key: 'textScale', label: 'Tekststørrelse', min: 0.6, max: 1.8, step: 0.05, format: percent },
        { type: 'segmented', key: 'align', label: 'Justering', options: [{ id: 'left', name: 'Venstre' }, { id: 'center', name: 'Midtstilt' }] },
        { type: 'range', key: 'contextLines', label: 'Linjer før og etter', min: 0, max: 4, step: 1, format: (v) => String(v), hint: 'Gjelder Klassisk, Cover + tekst og Vinyl' },
        { type: 'toggle', key: 'karaokeFill', label: 'Karaoke-fylling', hint: 'Linjen fylles gradvis mens den synges' },
        { type: 'toggle', key: 'glow', label: 'Glød rundt aktiv linje' },
        { type: 'toggle', key: 'blurInactive', label: 'Uskarpe inaktive linjer' },
        { type: 'toggle', key: 'uppercase', label: 'Store bokstaver' },
        { type: 'toggle', key: 'showInterludes', label: 'Vis ♪ i instrumentale pauser' },
      ] },
      { title: 'Farger og visning', items: [
        { type: 'segmented', key: 'accent', label: 'Aksentfarge', options: [
          { id: 'album', name: 'Fra cover' }, { id: 'spotify', name: 'Grønn' }, { id: 'white', name: 'Hvit' }] },
        { type: 'toggle', key: 'showTrackInfo', label: 'Vis sanginfo øverst' },
        { type: 'toggle', key: 'showControls', label: 'Vis kontroller nederst', hint: 'Skjules automatisk når musen er i ro' },
      ] },
      { title: 'Synkronisering', items: [
        { type: 'range', key: 'syncOffsetMs', label: 'Global forsinkelse', min: -2000, max: 2000, step: 50, format: seconds, hint: 'Positiv verdi viser teksten tidligere. Juster én sang med [ og ].' },
        { type: 'buttons', buttons: [{ action: 'reset-track-offset', label: 'Nullstill for denne sangen' }] },
      ] },
      { title: 'Vindu', items: [
        { type: 'toggle', key: 'alwaysOnTop', label: 'Alltid øverst' },
        { type: 'range', key: 'opacity', label: 'Synlighet', min: 0.3, max: 1, step: 0.05, format: percent },
        { type: 'toggle', key: 'globalShortcut', label: `Global hurtigtast (${env.shortcut || 'Ctrl+Shift+L'})`, hint: 'Vis/skjul appen fra hvor som helst' },
        { type: 'toggle', key: 'launchAtLogin', label: 'Start når du logger inn på maskinen', hint: 'Virker i den installerte appen' },
        { type: 'buttons', buttons: [{ action: 'mini', label: 'Minispiller' }, { action: 'fullscreen', label: 'Fullskjerm' }] },
      ] },
      { title: 'Konto og data', items: [
        { type: 'info', id: 'accountInfo' },
        { type: 'buttons', buttons: [
          { action: 'toggle-demo', label: 'Demomodus', id: 'demoToggle' },
          { action: 'logout', label: 'Logg ut' },
          { action: 'clear-cache', label: 'Tøm lyrics-cache' },
          { action: 'reset-settings', label: 'Tilbakestill innstillinger', style: 'danger' },
        ] },
      ] },
      { title: 'Hurtigtaster', items: [{ type: 'shortcuts' }] },
    ];
  }

  const SHORTCUTS = [
    ['Mellomrom', 'Spill av / pause'], ['← / →', 'Forrige / neste sang'],
    ['[ / ]', 'Tekst senere / tidligere (Shift = større steg)'], ['0', 'Nullstill synk for sangen'],
    ['↑ / ↓', 'Større / mindre tekst'], ['T / L / B', 'Neste tema / oppsett / bakgrunn'],
    ['F', 'Fullskjerm'], ['M', 'Minispiller'], ['P', 'Alltid øverst'], ['S', 'Innstillinger'],
    ['Esc', 'Lukk panel / avslutt fullskjerm'], ['Klikk på en linje', 'Hopp dit i sangen'],
  ];

  const controls = [];
  let current = {};

  function thumb(opt) {
    return `<div class="thumb tb-${opt.bg} tl-${opt.layout}${opt.upper ? ' tu' : ''}">
      <span class="tb-art"></span>
      <span class="tb-lines"><i></i><i class="on"></i><i></i></span>
    </div>`;
  }

  function matchingPreset(settings) {
    const preset = PRESETS.find((p) => LOOK_KEYS.every((k) => p.values[k] === settings[k]));
    return preset ? preset.id : null;
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function render(container, settings, env, { onChange, onAction }) {
    container.innerHTML = '';
    controls.length = 0;
    current = settings;

    for (const section of sections(env)) {
      const sec = el(`<section class="set-section"><h3>${section.title}</h3></section>`);
      if (section.hint) sec.appendChild(el(`<p class="set-hint">${section.hint}</p>`));

      for (const item of section.items) {
        let node;
        if (item.type === 'cards') {
          node = el(`<div class="cards${item.presets ? ' presets' : ''}"></div>`);
          for (const opt of item.options) {
            const card = el(`<button class="card-opt" data-id="${opt.id}">${thumb(opt)}<span>${opt.name}</span></button>`);
            card.addEventListener('click', () => {
              if (item.presets) onChange({ ...PRESETS.find((p) => p.id === opt.id).values });
              else onChange({ [item.key]: opt.id });
            });
            node.appendChild(card);
          }
          controls.push({ item, node, sync: (s) => {
            const active = item.presets ? matchingPreset(s) : s[item.key];
            node.querySelectorAll('.card-opt').forEach((c) => c.classList.toggle('active', c.dataset.id === active));
          } });
        } else if (item.type === 'segmented') {
          node = el(`<div class="set-row"><label>${item.label}</label><div class="segmented"></div></div>`);
          const seg = node.querySelector('.segmented');
          for (const opt of item.options) {
            const b = el(`<button data-id="${opt.id}">${opt.name}</button>`);
            b.addEventListener('click', () => onChange({ [item.key]: opt.id }));
            seg.appendChild(b);
          }
          controls.push({ item, node, sync: (s) => {
            seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === s[item.key]));
          } });
        } else if (item.type === 'range') {
          node = el(`<div class="set-row range">
            <label>${item.label}<output></output></label>
            <input type="range" min="${item.min}" max="${item.max}" step="${item.step}">
            ${item.hint ? `<small>${item.hint}</small>` : ''}
          </div>`);
          const input = node.querySelector('input');
          const out = node.querySelector('output');
          input.addEventListener('input', () => {
            out.textContent = item.format(Number(input.value));
            onChange({ [item.key]: Number(input.value) });
          });
          controls.push({ item, node, sync: (s) => {
            if (document.activeElement !== input) input.value = s[item.key];
            out.textContent = item.format(Number(s[item.key]));
          } });
        } else if (item.type === 'toggle') {
          node = el(`<label class="set-row toggle">
            <span><span class="t-label">${item.label}</span>${item.hint ? `<small>${item.hint}</small>` : ''}</span>
            <input type="checkbox"><i class="switch"></i>
          </label>`);
          const input = node.querySelector('input');
          input.addEventListener('change', () => onChange({ [item.key]: input.checked }));
          controls.push({ item, node, sync: (s) => { input.checked = Boolean(s[item.key]); } });
        } else if (item.type === 'buttons') {
          node = el('<div class="set-buttons"></div>');
          for (const b of item.buttons) {
            const btn = el(`<button class="chip ${b.style || ''}" ${b.id ? `id="${b.id}"` : ''}>${b.label}</button>`);
            btn.addEventListener('click', () => onAction(b.action));
            node.appendChild(btn);
          }
        } else if (item.type === 'info') {
          node = el(`<div class="set-info" id="${item.id}"></div>`);
        } else if (item.type === 'shortcuts') {
          node = el(`<dl class="shortcuts">${SHORTCUTS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl>`);
        }
        sec.appendChild(node);
      }
      container.appendChild(sec);
    }
    container.appendChild(el(`<p class="set-footer">Lyric Player ${env.version || ''} · Lyrics fra <a href="#" data-link="https://lrclib.net/">lrclib.net</a></p>`));
    sync(settings);
  }

  function sync(settings) {
    current = settings;
    for (const c of controls) c.sync(settings);
  }

  function cycle(key, settings, dir = 1) {
    const list = { layout: LAYOUTS, background: BACKGROUNDS }[key];
    const i = list.findIndex((o) => o.id === settings[key]);
    const next = list[(i + dir + list.length) % list.length];
    return { patch: { [key]: next.id }, name: next.name };
  }

  function nextPreset(settings) {
    const i = PRESETS.findIndex((p) => p.id === matchingPreset(settings));
    const next = PRESETS[(i + 1) % PRESETS.length];
    return { patch: { ...next.values }, name: next.name };
  }

  return { render, sync, cycle, nextPreset, LOOK_KEYS };
})();
