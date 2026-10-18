import os
import math
import time
import colorsys
import threading
import tkinter as tk
import tkinter.font as tkfont
from io import BytesIO

import requests
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
from PIL import Image, ImageTk

load_dotenv()

POLL_INTERVAL_SEC = 2.0   # hvor ofte vi faktisk spør Spotify (for å unngå rate-limiting)
TICK_INTERVAL_MS = 100    # hvor ofte GUI oppdaterer linjen (jo lavere, jo raskere/jevnere)
BG_FRAME_MS = 50          # hvor ofte bakgrunnen animeres (~20 fps)
BG_COLOR = "#0b0b0f"
FG_ACTIVE = "#ffffff"
FG_DIM = "#d6d6e4"
FG_HINT = "#a0a0b4"
SHADOW_COLOR = "#08080c"

# Bakgrunnen tegnes i lav oppløsning og skaleres opp - det gir en myk gradient
# helt gratis, og er mye raskere enn å regne ut hver piksel i full størrelse.
BG_RENDER_W = 48
BG_RENDER_H = 27
BG_BRIGHTNESS = 0.68      # demper fargene litt så hvit tekst er lett å lese
PALETTE_FADE = 0.03       # hvor fort fargene glir over til et nytt albumcover per frame

# Brukes før første låt er lastet, og hvis albumcoveret ikke kan hentes
FALLBACK_PALETTE = [
    (255, 77, 141),   # rosa
    (123, 92, 255),   # lilla
    (0, 194, 255),    # blå
    (29, 185, 84),    # Spotify-grønn
    (255, 159, 67),   # oransje
]

# Referansestørrelse vinduet er designet for - skriftstørrelser skaleres opp/ned herfra
BASE_WIDTH = 900
BASE_HEIGHT = 500
BASE_TITLE_SIZE = 26
BASE_SIDE_SIZE = 28
BASE_MAIN_SIZE = 48
BASE_LINE_GAP = 28
MIN_SCALE = 0.5
MAX_SCALE = 3.0


def to_hex(rgb):
    return "#%02x%02x%02x" % tuple(int(c) for c in rgb)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


class ShadowText:
    """Tekst på canvas med en svak skygge bak, så den er lesbar over fargerik bakgrunn."""

    def __init__(self, canvas, font, fill, **kwargs):
        self.canvas = canvas
        self.font = font
        self.shadow = canvas.create_text(0, 0, text="", fill=SHADOW_COLOR, font=font,
                                         justify="center", **kwargs)
        self.main = canvas.create_text(0, 0, text="", fill=fill, font=font,
                                       justify="center", **kwargs)
        self.text = ""

    def set_text(self, text):
        if text == self.text:
            return False
        self.text = text
        self.canvas.itemconfig(self.shadow, text=text)
        self.canvas.itemconfig(self.main, text=text)
        return True

    def set_fill(self, fill):
        self.canvas.itemconfig(self.main, fill=fill)

    def set_width(self, width):
        self.canvas.itemconfig(self.shadow, width=width)
        self.canvas.itemconfig(self.main, width=width)

    def height(self):
        # Tom tekst skal fortsatt ta opp én linje, så resten ikke hopper
        bbox = self.canvas.bbox(self.main)
        text_h = bbox[3] - bbox[1] if bbox and self.text else 0
        return max(text_h, self.font.metrics("linespace"))

    def move_to(self, x, y, offset=2):
        self.canvas.coords(self.shadow, x + offset, y + offset)
        self.canvas.coords(self.main, x, y)


class LyricsApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Lyrics")
        self.root.configure(bg=BG_COLOR)
        self.root.geometry("900x500")
        self.is_fullscreen = False

        self.root.bind("<f>", self.toggle_fullscreen)
        self.root.bind("<F>", self.toggle_fullscreen)
        self.root.bind("<Escape>", self.exit_fullscreen)
        self.root.bind("<q>", lambda e: self.root.destroy())

        # Alt tegnes på ett canvas: animert gradient i bunnen, tekst oppå
        self.canvas = tk.Canvas(root, bg=BG_COLOR, highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True)

        self.bg_photo = None
        self.bg_item = self.canvas.create_image(0, 0, anchor="nw")
        self.bg_start = time.time()
        self.palette = list(FALLBACK_PALETTE)
        self.target_palette = list(FALLBACK_PALETTE)

        self.title_font = tkfont.Font(family="Helvetica", size=BASE_TITLE_SIZE, weight="bold")
        self.side_font = tkfont.Font(family="Helvetica", size=BASE_SIDE_SIZE)
        self.main_font = tkfont.Font(family="Helvetica", size=BASE_MAIN_SIZE, weight="bold")
        self.hint_font = tkfont.Font(family="Helvetica", size=10)

        # UI-elementer: låt-info øverst, tre lyrics-linjer i midten
        self.track_text = ShadowText(self.canvas, self.title_font, FG_ACTIVE)
        self.prev_text = ShadowText(self.canvas, self.side_font, FG_DIM)
        self.current_text = ShadowText(self.canvas, self.main_font, FG_ACTIVE)
        self.next_text = ShadowText(self.canvas, self.side_font, FG_DIM)
        self.stack = [self.track_text, self.prev_text, self.current_text, self.next_text]
        self.track_text.set_text("Kobler til Spotify …")

        self.hint_text = ShadowText(self.canvas, self.hint_font, FG_HINT)
        self.hint_text.set_text("F = fullskjerm   Esc = avslutt fullskjerm   Q = avslutt")

        # Responsiv skalering: regn ut ny skriftstørrelse når vinduet endrer størrelse
        self.canvas.bind("<Configure>", self.on_resize)
        self._last_scale = 1.0

        # Spotify-klient
        self.sp = spotipy.Spotify(auth_manager=SpotifyOAuth(
            client_id=os.getenv("SPOTIFY_CLIENT_ID"),
            client_secret=os.getenv("SPOTIFY_CLIENT_SECRET"),
            redirect_uri=os.getenv("SPOTIFY_REDIRECT_URI"),
            scope="user-read-playback-state",
            cache_path=".cache"
        ))

        self.current_track_id = None
        self.lrc_lines = []  # liste av (ms, tekst)
        self.stop_flag = False

        # For lokal interpolering av avspillingsposisjon mellom Spotify-spørringer
        self.last_known_progress_ms = 0
        self.last_progress_timestamp = time.time()
        self.is_playing = False
        self.progress_lock = threading.Lock()

        # Poll Spotify i egen tråd så GUI ikke fryser
        self.worker = threading.Thread(target=self.poll_loop, daemon=True)
        self.worker.start()

        # Rask GUI-tikker som interpolerer posisjon og oppdaterer linjen jevnt
        self.root.after(TICK_INTERVAL_MS, self.tick)
        self.root.after(BG_FRAME_MS, self.animate_background)

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def tick(self):
        if self.stop_flag:
            return
        with self.progress_lock:
            if self.is_playing and self.lrc_lines:
                elapsed = (time.time() - self.last_progress_timestamp) * 1000
                estimated_progress_ms = self.last_known_progress_ms + elapsed
                self.update_current_line(estimated_progress_ms)
        self.root.after(TICK_INTERVAL_MS, self.tick)

    def on_resize(self, event):
        scale = min(event.width / BASE_WIDTH, event.height / BASE_HEIGHT)
        scale = max(MIN_SCALE, min(MAX_SCALE, scale))

        # Unngå å oppdatere fonten på hver eneste pixel - bare når skalaen faktisk
        # har endret seg nok til å utgjøre en forskjell.
        if abs(scale - self._last_scale) >= 0.02:
            self._last_scale = scale
            self.title_font.configure(size=max(10, int(BASE_TITLE_SIZE * scale)))
            self.side_font.configure(size=max(8, int(BASE_SIDE_SIZE * scale)))
            self.main_font.configure(size=max(14, int(BASE_MAIN_SIZE * scale)))

        wrap = max(300, int(event.width * 0.85))
        for item in self.stack:
            item.set_width(wrap)
        self.layout()
        self.draw_background()

    def layout(self):
        # Stable tittel + tre linjer vertikalt, sentrert i vinduet
        w = self.canvas.winfo_width()
        h = self.canvas.winfo_height()
        gap = BASE_LINE_GAP * self._last_scale
        heights = [item.height() for item in self.stack]
        y = (h - sum(heights) - gap * (len(heights) - 1)) / 2
        for item, item_h in zip(self.stack, heights):
            item.move_to(w / 2, y + item_h / 2)
            y += item_h + gap
        self.hint_text.move_to(w / 2, h - 16, offset=1)

    # ---------- Animert bakgrunn ----------

    def animate_background(self):
        if self.stop_flag:
            return
        # Gli mykt mot fargene fra det nye albumcoveret
        target = self.target_palette
        self.palette = [mix(c, t, PALETTE_FADE) for c, t in zip(self.palette, target)]
        self.track_text.set_fill(to_hex(mix(self.palette[0], (255, 255, 255), 0.55)))
        self.draw_background()
        self.root.after(BG_FRAME_MS, self.animate_background)

    def draw_background(self):
        w = self.canvas.winfo_width()
        h = self.canvas.winfo_height()
        if w < 2 or h < 2:
            return

        # Hver farge er en "flekk" som sakte glir rundt i vinduet. Hver piksel blir
        # et vektet snitt av flekkene, der nærmeste flekk teller mest.
        t = time.time() - self.bg_start
        aspect = w / h
        blobs = []
        for i, color in enumerate(self.palette):
            bx = 0.5 + 0.42 * math.sin(t * 0.13 * (1 + i * 0.21) + i * 1.7)
            by = 0.5 + 0.42 * math.cos(t * 0.11 * (1 + i * 0.17) + i * 2.3)
            radius = 0.40 + 0.08 * math.sin(t * 0.2 + i)
            blobs.append((bx * aspect, by, 1 / (radius * radius), color))

        pixels = []
        for py in range(BG_RENDER_H):
            fy = py / (BG_RENDER_H - 1)
            for px in range(BG_RENDER_W):
                fx = px / (BG_RENDER_W - 1) * aspect
                r = g = b = total = 0.0
                for bx, by, inv_r2, (cr, cg, cb) in blobs:
                    weight = math.exp(-((fx - bx) ** 2 + (fy - by) ** 2) * inv_r2) + 0.001
                    r += cr * weight
                    g += cg * weight
                    b += cb * weight
                    total += weight
                k = BG_BRIGHTNESS / total
                pixels.append((int(r * k), int(g * k), int(b * k)))

        small = Image.new("RGB", (BG_RENDER_W, BG_RENDER_H))
        small.putdata(pixels)
        frame = small.resize((w, h), Image.BICUBIC)

        if self.bg_photo is not None and (self.bg_photo.width(), self.bg_photo.height()) == (w, h):
            self.bg_photo.paste(frame)
        else:
            self.bg_photo = ImageTk.PhotoImage(frame)
            self.canvas.itemconfig(self.bg_item, image=self.bg_photo)

    def fetch_palette(self, track):
        # Minste versjon av albumcoveret holder fint for å finne fargene
        images = track.get("album", {}).get("images") or []
        if not images:
            return list(FALLBACK_PALETTE)
        try:
            resp = requests.get(images[-1]["url"], timeout=5)
            cover = Image.open(BytesIO(resp.content)).convert("RGB").resize((32, 32))
        except (requests.RequestException, OSError):
            return list(FALLBACK_PALETTE)

        quantized = cover.quantize(colors=8)
        raw = quantized.getpalette()
        colors = []
        for _, idx in sorted(quantized.getcolors(), reverse=True):
            r, g, b = (c / 255 for c in raw[idx * 3: idx * 3 + 3])
            hue, light, sat = colorsys.rgb_to_hls(r, g, b)
            # Gjør fargene mer mettede og unngå nesten svart/hvitt, så det blir fargerikt
            light = min(0.62, max(0.38, light))
            sat = max(0.6, sat)
            colors.append(tuple(c * 255 for c in colorsys.hls_to_rgb(hue, light, sat)))
        while len(colors) < len(FALLBACK_PALETTE):
            colors.append(FALLBACK_PALETTE[len(colors)])
        return colors[:len(FALLBACK_PALETTE)]

    def toggle_fullscreen(self, event=None):
        self.is_fullscreen = not self.is_fullscreen
        self.root.attributes("-fullscreen", self.is_fullscreen)

    def exit_fullscreen(self, event=None):
        self.is_fullscreen = False
        self.root.attributes("-fullscreen", False)

    def on_close(self):
        self.stop_flag = True
        self.root.destroy()

    # ---------- Lyrics-henting ----------

    def fetch_synced_lyrics(self, title, artist, duration_sec):
        try:
            resp = requests.get(
                "https://lrclib.net/api/get",
                params={
                    "track_name": title,
                    "artist_name": artist,
                    "duration": duration_sec,
                },
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("syncedLyrics")
        except requests.RequestException:
            pass
        return None

    def parse_lrc(self, lrc_text):
        lines = []
        for raw_line in lrc_text.split("\n"):
            if raw_line.startswith("["):
                timestamp, _, text = raw_line.partition("]")
                try:
                    minutes, seconds = timestamp[1:].split(":")
                    total_ms = int((float(minutes) * 60 + float(seconds)) * 1000)
                    if text.strip():
                        lines.append((total_ms, text.strip()))
                except ValueError:
                    continue
        return lines

    # ---------- Bakgrunnstråd: poller Spotify ----------

    def poll_loop(self):
        while not self.stop_flag:
            try:
                playback = self.sp.current_playback()
            except Exception as e:
                self.update_track_label(f"Feil: {e}")
                time.sleep(POLL_INTERVAL_SEC)
                continue

            if playback and playback.get("is_playing") and playback.get("item"):
                track = playback["item"]
                progress_ms = playback["progress_ms"]

                if track["id"] != self.current_track_id:
                    self.current_track_id = track["id"]
                    title = track["name"]
                    artist = track["artists"][0]["name"]
                    duration_sec = track["duration_ms"] // 1000

                    self.update_track_label(f"{title} — {artist}")
                    self.target_palette = self.fetch_palette(track)
                    lrc_text = self.fetch_synced_lyrics(title, artist, duration_sec)
                    self.lrc_lines = self.parse_lrc(lrc_text) if lrc_text else []

                    if not self.lrc_lines:
                        self.update_lyrics("", "Ingen synkroniserte lyrics funnet", "")

                # Sett referansepunkt for interpolering - tick() tar seg av
                # å oppdatere linjen jevnt mellom hver spørring herfra.
                with self.progress_lock:
                    self.last_known_progress_ms = progress_ms
                    self.last_progress_timestamp = time.time()
                    self.is_playing = True
            else:
                self.update_track_label("Ingenting spilles av akkurat nå")
                self.update_lyrics("", "", "")
                self.current_track_id = None
                self.target_palette = list(FALLBACK_PALETTE)
                with self.progress_lock:
                    self.is_playing = False

            time.sleep(POLL_INTERVAL_SEC)

    # ---------- Finn riktig linje ----------

    def update_current_line(self, progress_ms):
        # Kalles fra tick() på GUI-tråden - trygt å oppdatere direkte.
        if not self.lrc_lines:
            return
        idx = -1
        for i, (ts, _) in enumerate(self.lrc_lines):
            if ts <= progress_ms:
                idx = i
            else:
                break
        prev_text = self.lrc_lines[idx - 1][1] if idx > 0 else ""
        current_text = self.lrc_lines[idx][1] if idx >= 0 else ""
        next_text = self.lrc_lines[idx + 1][1] if 0 <= idx + 1 < len(self.lrc_lines) else ""
        self.update_lyrics(prev_text, current_text, next_text)

    # ---------- Trådsikre GUI-oppdateringer ----------

    def update_track_label(self, text):
        def apply():
            if self.track_text.set_text(text):
                self.layout()
        self.root.after(0, apply)

    def update_lyrics(self, prev_text, current_text, next_text):
        def apply():
            changed = self.prev_text.set_text(prev_text)
            changed = self.current_text.set_text(current_text) or changed
            changed = self.next_text.set_text(next_text) or changed
            # Bare regn ut plasseringen på nytt når teksten faktisk har endret seg
            if changed:
                self.layout()
        self.root.after(0, apply)


if __name__ == "__main__":
    root = tk.Tk()
    app = LyricsApp(root)
    root.mainloop()
