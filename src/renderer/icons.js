// Små SVG-ikoner (24x24) - tegnes med currentColor så de følger tekstfargen
const ICONS = (() => {
  const svg = (inner, filled = false) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" ${filled
      ? 'fill="currentColor"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${inner}</svg>`;

  return {
    play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', true),
    pause: svg('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>', true),
    next: svg('<path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.4-5.8a1 1 0 0 0 0-1.66l-8.4-5.8A1 1 0 0 0 5 6.2z"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/>', true),
    previous: svg('<path d="M19 6.2v11.6a1 1 0 0 1-1.55.83l-8.4-5.8a1 1 0 0 1 0-1.66l8.4-5.8A1 1 0 0 1 19 6.2z"/><rect x="5" y="5" width="2.5" height="14" rx="1"/>', true),
    fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    exitFullscreen: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
    settings: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    mini: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="11" y="11" width="7" height="5" rx="1" fill="currentColor"/>'),
    pin: svg('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>'),
    minus: svg('<path d="M6 12h12"/>'),
    plus: svg('<path d="M12 6v12M6 12h12"/>'),
    note: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
    search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
    mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    pause2: svg('<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'),
  };
})();
