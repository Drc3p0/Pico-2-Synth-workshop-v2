# oled_display.py — SSD1306 0.91" OLED display driver + waveform visualizer
# I2C on GP16/GP17, address 0x3C (128x32)
# Shows: voice name splash -> animated waveform -> verbose input mode (toggle)

import time
import math

try:
    import adafruit_ssd1306
except ImportError:
    adafruit_ssd1306 = None

try:
    import framebuf
except ImportError:
    framebuf = None

# Try adafruit_framebuf as fallback (CircuitPython)
try:
    import adafruit_framebuf
except ImportError:
    adafruit_framebuf = None


WIDTH = 128
HEIGHT = 32
SPLASH_DURATION = 3.0  # seconds to show voice name

# Waveform animation styles per voice mood
MOOD_STYLES = {
    "eighties_dystopia": "slow_roll",
    "tiny_lfo_song": "pulse_dots",
    "monosynth": "sawtooth_sweep",
    "eighties_arp": "bounce_dots",
    "wavetable_synth": "morph_wave",
    "falling_forever": "falling_lines",
    "deep_note": "converge",
}


class OLEDDisplay:
    """SSD1306 128x32 OLED with voice splash, waveform animation, and input display."""

    def __init__(self, i2c, address=0x3C, voice_name="Synth"):
        self._display = None
        self.available = False
        self._voice_name = voice_name
        self._mode = "splash"  # splash -> waveform -> verbose
        self._splash_start = time.monotonic()
        self._frame = 0
        self._verbose_text = ""
        self._verbose_value = ""
        self._last_input_name = ""
        self._mood = MOOD_STYLES.get(voice_name.lower().replace(" ", "_"), "slow_roll")

        if adafruit_ssd1306 is None:
            return

        try:
            self._display = adafruit_ssd1306.SSD1306_I2C(WIDTH, HEIGHT, i2c, addr=address)
            self._display.fill(0)
            self._display.show()
            self.available = True
        except Exception:
            self._display = None

    def set_voice(self, name):
        """Update voice name and restart splash."""
        self._voice_name = name
        self._mood = MOOD_STYLES.get(name.lower().replace(" ", "_"), "slow_roll")
        self._mode = "splash"
        self._splash_start = time.monotonic()
        self._frame = 0

    def toggle_verbose(self, input_name=""):
        """Toggle between waveform and verbose mode. Same input toggles back."""
        if self._mode == "verbose" and input_name == self._last_input_name:
            self._mode = "waveform"
        else:
            self._mode = "verbose"
            self._last_input_name = input_name

    def show_input(self, name, value):
        """Update verbose display with input name and value."""
        self._verbose_text = name
        if isinstance(value, float):
            self._verbose_value = "{:.2f}".format(value)
        else:
            self._verbose_value = str(value)

    def update(self):
        """Call in main loop to advance display animation."""
        if not self.available or self._display is None:
            return

        # Auto-transition from splash to waveform
        if self._mode == "splash":
            if time.monotonic() - self._splash_start > SPLASH_DURATION:
                self._mode = "waveform"
            else:
                self._draw_splash()
                return

        if self._mode == "verbose":
            self._draw_verbose()
        else:
            self._draw_waveform()

        self._frame += 1

    def _draw_splash(self):
        """Draw voice name centered on screen."""
        d = self._display
        d.fill(0)

        # Center the voice name
        name = self._voice_name
        # Approximate centering (5px per char at default font)
        x = max(0, (WIDTH - len(name) * 6) // 2)
        y = 8
        d.text(name, x, y, 1)

        # Small subtitle
        sub = "Pico 2 Synth"
        x2 = max(0, (WIDTH - len(sub) * 6) // 2)
        d.text(sub, x2, 22, 1)

        d.show()

    def _draw_verbose(self):
        """Draw input name and current value."""
        d = self._display
        d.fill(0)

        d.text(self._verbose_text, 0, 2, 1)
        d.text(self._verbose_value, 0, 18, 1)

        # Activity bar on right side
        bar_h = int(float(self._verbose_value) * 28) if self._verbose_value.replace(".", "").isdigit() else 0
        bar_h = max(0, min(28, bar_h))
        if bar_h > 0:
            d.fill_rect(120, 32 - bar_h, 6, bar_h, 1)

        d.show()

    def _draw_waveform(self):
        """Draw mood-matched animated waveform."""
        d = self._display
        d.fill(0)

        t = self._frame * 0.05  # time factor

        if self._mood == "slow_roll":
            self._anim_slow_roll(d, t)
        elif self._mood == "pulse_dots":
            self._anim_pulse_dots(d, t)
        elif self._mood == "sawtooth_sweep":
            self._anim_sawtooth_sweep(d, t)
        elif self._mood == "bounce_dots":
            self._anim_bounce_dots(d, t)
        elif self._mood == "morph_wave":
            self._anim_morph_wave(d, t)
        elif self._mood == "falling_lines":
            self._anim_falling_lines(d, t)
        elif self._mood == "converge":
            self._anim_converge(d, t)
        else:
            self._anim_slow_roll(d, t)

        d.show()

    # --- Waveform animation styles ---

    def _anim_slow_roll(self, d, t):
        """Eighties Dystopia: slow rolling waves with multiple harmonics."""
        mid = HEIGHT // 2
        for x in range(WIDTH):
            y1 = math.sin(x * 0.05 + t * 0.7) * 8
            y2 = math.sin(x * 0.08 + t * 0.3) * 5
            y = int(mid + y1 + y2)
            y = max(0, min(HEIGHT - 1, y))
            d.pixel(x, y, 1)

    def _anim_pulse_dots(self, d, t):
        """Tiny LFO Song: pulsing dots at different rates."""
        mid = HEIGHT // 2
        rates = [3.0, 2.0, 1.0, 0.75]
        for i, rate in enumerate(rates):
            x_center = 16 + i * 30
            amp = math.sin(t * rate) * 0.5 + 0.5  # 0-1
            radius = int(amp * 6) + 1
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if dx * dx + dy * dy <= radius * radius:
                        px = x_center + dx
                        py = mid + dy
                        if 0 <= px < WIDTH and 0 <= py < HEIGHT:
                            d.pixel(px, py, 1)

    def _anim_sawtooth_sweep(self, d, t):
        """Monosynth: sharp sawtooth with filter sweep."""
        mid = HEIGHT // 2
        sweep = math.sin(t * 0.4) * 0.5 + 0.5  # filter position 0-1
        harmonics = int(2 + sweep * 8)
        for x in range(WIDTH):
            y = 0.0
            for h in range(1, harmonics + 1):
                y += math.sin(x * 0.03 * h + t) / h
            y = int(mid + y * 10)
            y = max(0, min(HEIGHT - 1, y))
            d.pixel(x, y, 1)
            # Draw thin line to center for sawtooth look
            step = 1 if y >= mid else -1
            for ly in range(mid, y, step):
                if 0 <= ly < HEIGHT:
                    d.pixel(x, ly, 1)

    def _anim_bounce_dots(self, d, t):
        """Eighties Arp: bouncing dots in rhythm."""
        num_dots = 8
        for i in range(num_dots):
            phase = t * 4 + i * 0.8
            bounce = abs(math.sin(phase))
            x = int((i / num_dots) * WIDTH + 8)
            y = int((1.0 - bounce) * (HEIGHT - 4)) + 2
            if 0 <= x < WIDTH and 0 <= y < HEIGHT:
                d.pixel(x, y, 1)
                if y + 1 < HEIGHT:
                    d.pixel(x, y + 1, 1)
                if x + 1 < WIDTH:
                    d.pixel(x + 1, y, 1)

    def _anim_morph_wave(self, d, t):
        """Wavetable Synth: morphing between wave shapes."""
        mid = HEIGHT // 2
        morph = math.sin(t * 0.2) * 0.5 + 0.5  # 0-1 morph position
        for x in range(WIDTH):
            # Morph between sine and square
            sine_y = math.sin(x * 0.06 + t * 0.5) * 10
            square_y = 10 if math.sin(x * 0.06 + t * 0.5) > 0 else -10
            y = int(mid + sine_y * (1 - morph) + square_y * morph)
            y = max(0, min(HEIGHT - 1, y))
            d.pixel(x, y, 1)

    def _anim_falling_lines(self, d, t):
        """Falling Forever: lines drifting downward with varying speed."""
        for i in range(6):
            speed = 0.3 + i * 0.15
            y_base = int((t * speed * 20 + i * 40) % (HEIGHT + 20)) - 10
            x_start = int(i * 22)
            for dx in range(18):
                x = x_start + dx
                wobble = math.sin(dx * 0.3 + t + i) * 3
                y = int(y_base + wobble)
                if 0 <= x < WIDTH and 0 <= y < HEIGHT:
                    d.pixel(x, y, 1)

    def _anim_converge(self, d, t):
        """Deep Note: lines converging from chaos to order."""
        mid = HEIGHT // 2
        convergence = min(1.0, t * 0.05)  # slowly converges over time
        num_lines = 6
        for i in range(num_lines):
            target_y = mid + (i - num_lines // 2) * 4
            chaos_y = mid + math.sin(t * (0.5 + i * 0.3) + i * 2) * 14
            y = int(chaos_y * (1 - convergence) + target_y * convergence)
            for x in range(WIDTH):
                wobble = math.sin(x * 0.1 + t + i) * (2 * (1 - convergence))
                py = int(y + wobble)
                if 0 <= x < WIDTH and 0 <= py < HEIGHT:
                    d.pixel(x, py, 1)
        # Reset convergence cycle
        if convergence >= 1.0 and self._frame % 200 == 0:
            self._frame = 0
