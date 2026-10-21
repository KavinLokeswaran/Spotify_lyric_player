// Delt mellom hovedprosessen (require) og rendereren (<script>), så standardverdiene bare står ett sted
(function (root) {
  // Standardinnstillinger - alt brukeren kan endre i innstillingspanelet
  const DEFAULT_SETTINGS = {
    layout: 'classic',        // classic | scroll | split | vinyl | minimal
    background: 'aurora',     // aurora | cover-blur | cover | gradient | solid | paper
    font: 'system',           // system | serif | rounded | mono | condensed
    textScale: 1,
    align: 'center',          // left | center
    contextLines: 1,          // hvor mange linjer som vises før/etter den aktive (klassisk)
    uppercase: false,
    glow: true,
    karaokeFill: true,        // fyller den aktive linjen gradvis mens den synges
    blurInactive: true,
    showInterludes: true,     // viser ♪ i lange instrumentale pauser
    bgBlur: 70,
    bgDim: 0.3,
    animSpeed: 1,
    grain: false,
    showTrackInfo: true,
    showControls: true,
    accent: 'album',          // album | spotify | white
    syncOffsetMs: 0,
    alwaysOnTop: false,
    opacity: 1,
    launchAtLogin: false,
    globalShortcut: true,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULT_SETTINGS;
  else root.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(this);
