// Demomodus: en liksom-avspiller med egenskrevne testtekster, så man kan prøve
// alle utseendene uten Spotify-konto. Svarer i samme format som spotify.playback().
const Demo = (() => {
  const TRACKS = [
    {
      id: 'demo-nordlys',
      name: 'Nordlys over byen',
      artists: ['Demo-artist'],
      album: 'Lyric Player Demo',
      durationMs: 74000,
      colors: ['#ff4d8d', '#7b5cff', '#00c2ff'],
      lines: [
        [5000, 'Gatelysene blinker sakte i det blå'],
        [9200, 'Jeg teller stjerner mens jeg venter på deg'],
        [13600, 'Byen sover, men vi er våkne nå'],
        [17800, 'Hver lyd er en farge, hver farge er en vei'],
        [31000, 'Nordlys over taket, grønt og rosa lys'],
        [35200, 'Hold meg fast til morgenen kommer'],
        [39400, 'Vi danser barbeint på et hav av is'],
        [43600, 'Og vinternatten blir til sommer'],
        [48000, 'Nordlys over taket, la det aldri gå'],
        [52400, 'Vi er lyset, vi er lyset nå'],
        [57000, ''],
        [62000, 'Vi er lyset nå'],
      ],
    },
    {
      id: 'demo-papirfly',
      name: 'Papirfly',
      artists: ['Demo-artist'],
      album: 'Lyric Player Demo',
      durationMs: 60000,
      colors: ['#ff9f43', '#ffd166', '#1db954'],
      lines: [
        [2500, 'Jeg brettet et fly av et gammelt brev'],
        [6500, 'Sendte det ut over taket i vind'],
        [10500, 'Alt det jeg aldri fikk sagt, det jeg skrev'],
        [14500, 'Seiler nå fritt forbi vinduet ditt inn'],
        [27000, 'Papirfly, papirfly'],
        [30500, 'Bær meg hjem gjennom sky etter sky'],
        [34500, 'Papirfly, papirfly'],
        [38500, 'Hver gang du lander, begynner jeg på ny'],
        [44000, 'Begynner jeg på ny'],
      ],
    },
  ];

  let index = 0;
  let playing = true;
  let startedAt = performance.now();
  let pausedAt = 0;
  const covers = {};

  // Lager et enkelt albumcover med gradient og sirkler - ingen nettverk trengs
  function makeCover(track) {
    if (covers[track.id]) return covers[track.id];
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    track.colors.forEach((color, i) => grad.addColorStop(i / (track.colors.length - 1), color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${0.06 + i * 0.02})`;
      ctx.arc(120 + i * 60, 380 - i * 45, 160 - i * 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 54px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(track.name.toUpperCase(), 36, 92, 440);
    covers[track.id] = c.toDataURL('image/jpeg', 0.9);
    return covers[track.id];
  }

  function current() {
    return TRACKS[index];
  }

  function progress() {
    const track = current();
    const ms = playing ? performance.now() - startedAt : pausedAt;
    if (ms >= track.durationMs) {
      // Låten er ferdig - gå videre til neste
      next();
      return 0;
    }
    return ms;
  }

  function playback() {
    const track = current();
    return {
      active: true,
      isPlaying: playing,
      progressMs: progress(),
      device: 'Demo',
      type: 'track',
      fetchedAt: Date.now(),
      track: {
        id: track.id,
        name: track.name,
        artists: track.artists,
        album: track.album,
        durationMs: track.durationMs,
        coverUrl: null,
        isEpisode: false,
      },
    };
  }

  function lyrics() {
    return { synced: current().lines.map(([time, text]) => ({ time, text })), plain: null, instrumental: false };
  }

  function seek(ms) {
    if (playing) startedAt = performance.now() - ms;
    else pausedAt = ms;
  }

  function next() {
    index = (index + 1) % TRACKS.length;
    startedAt = performance.now();
    pausedAt = 0;
  }

  function control(action, arg) {
    switch (action) {
      case 'play':
        startedAt = performance.now() - pausedAt;
        playing = true;
        break;
      case 'pause':
        pausedAt = progress();
        playing = false;
        break;
      case 'next':
        next();
        break;
      case 'previous':
        if (progress() > 3000) seek(0);
        else {
          index = (index - 1 + TRACKS.length) % TRACKS.length;
          seek(0);
        }
        break;
      case 'seek':
        seek(arg);
        break;
    }
  }

  return { playback, lyrics, control, cover: () => makeCover(current()) };
})();
