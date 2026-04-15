# wavetable_synth.py — MIDI synth using morphing wavetables (generated in code)
# Adapted from todbot's wavetable_midisynth_code.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# Video demo: https://www.youtube.com/watch?v=CrxaB_AVQqM
#
# Instead of loading WAV files, we generate wavetables algorithmically using
# additive synthesis. This gives interesting morphable sounds without external files.

import time
import math
import synthio
import ulab.numpy as np
from lib.helpers import map_range, clamp, lerp


WAVE_LEN = 256
NUM_WAVES = 32  # number of waves in our generated wavetable


def _generate_wavetable():
    """Generate a wavetable using additive synthesis with evolving harmonics."""
    table = []
    for w in range(NUM_WAVES):
        wave = np.zeros(WAVE_LEN, dtype=np.int16)
        # Each wave in the table adds more harmonics and changes their mix
        num_harmonics = 1 + int(w * 12 / NUM_WAVES)
        t = w / NUM_WAVES  # 0.0 to ~1.0

        for h in range(1, num_harmonics + 1):
            # Amplitude decreases with harmonic number, modulated by table position
            amp = 28000 / (h ** (0.5 + t * 1.5))
            # Phase shifts create evolving timbre
            phase_shift = t * math.pi * h * 0.3
            for i in range(WAVE_LEN):
                angle = 2 * math.pi * i * h / WAVE_LEN + phase_shift
                wave[i] += int(amp * math.sin(angle))

        # Clamp to int16 range
        for i in range(WAVE_LEN):
            wave[i] = max(-32767, min(32767, wave[i]))

        table.append(wave)
    return table


DEFAULTS = {
    "wave_scan_min": 4,
    "wave_scan_max": 20,
    "wave_lfo_rate": 0.1,
    "filter_freq": 4000,
    "self_play": True,
    "self_play_notes": (36, 38, 40, 41, 43, 45, 46, 48, 50, 52),
    "self_play_speed": 0.9,
    "bpm": 67,
}

PARAMS = {
    "wave_scan_min": {"label": "Wave Scan Start", "type": "continuous", "min": 0, "max": 28, "default": 4},
    "wave_scan_max": {"label": "Wave Scan End", "type": "continuous", "min": 4, "max": 31, "default": 20},
    "wave_lfo_rate": {"label": "Scan LFO Rate", "type": "continuous", "min": 0.01, "max": 2.0, "default": 0.1},
    "filter_freq": {"label": "Filter Cutoff", "type": "continuous", "min": 500, "max": 8000, "default": 4000},
    "note_trigger": {"label": "Trigger Note", "type": "trigger", "default": None},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 240, "default": 67},
}


class Voice:
    """Wavetable Synth: morphing wavetables driven by LFO scanning."""

    name = "Wavetable Synth"
    description = "A MIDI synth using morphing wavetables"

    def __init__(self, synth, config=None):
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.self_play = cfg.get("self_play", True)
        self.self_play_notes = cfg["self_play_notes"]
        self.self_play_speed = cfg["self_play_speed"]
        self.filter_freq = cfg["filter_freq"]
        self.bpm = cfg["bpm"]
        self.self_play_speed = 60 / self.bpm

        # Generate wavetable
        self._wavetable = _generate_wavetable()
        self._current_waveform = np.zeros(WAVE_LEN, dtype=np.int16)
        self._current_waveform[:] = self._wavetable[0]

        # Scanning LFO
        self.wave_lfo = synthio.LFO(
            rate=cfg["wave_lfo_rate"],
            waveform=np.array((0, 32767), dtype=np.int16),
        )
        self._set_scan_range(cfg["wave_scan_min"], cfg["wave_scan_max"])
        synth.blocks.append(self.wave_lfo)

        self.amp_env = synthio.Envelope(sustain_level=0.8, attack_time=0.05, release_time=0.3)

        self._notes_pressed = {}  # midi_note -> synthio.Note
        self._auto_pos = -1
        self._last_auto_time = 0
        self._last_update_time = 0

        if self.self_play:
            self._auto_play_next()

    def _set_scan_range(self, wmin, wmax):
        scale = wmax - wmin
        self.wave_lfo.scale = scale
        self.wave_lfo.offset = wmin

    def _set_wave_pos(self, pos):
        """Morph between two adjacent waves in the wavetable."""
        pos = max(0, min(pos, NUM_WAVES - 2))
        idx = int(pos)
        frac = pos - idx

        waveA = self._wavetable[idx]
        waveB = self._wavetable[min(idx + 1, NUM_WAVES - 1)]

        # Linear interpolation between waves
        for i in range(WAVE_LEN):
            self._current_waveform[i] = int(waveA[i] * (1 - frac) + waveB[i] * frac)

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "wave_scan_min":
            self._set_scan_range(int(clamp(value, 0, 28)), int(self.wave_lfo.offset + self.wave_lfo.scale))
        elif name == "wave_scan_max":
            self._set_scan_range(int(self.wave_lfo.offset), int(clamp(value, 4, 31)))
        elif name == "wave_lfo_rate":
            self.wave_lfo.rate = clamp(value, 0.01, 2.0)
        elif name == "filter_freq":
            self.filter_freq = clamp(value, 500, 8000)
        elif name == "note_trigger":
            self._auto_play_next()
        elif name == "bpm":
            self.bpm = clamp(value, 40, 240)
            self.self_play_speed = 60 / self.bpm

    def note_on(self, midi_note, vel=100):
        # Release old note at this pitch if present
        if midi_note in self._notes_pressed:
            old = self._notes_pressed.pop(midi_note)
            self.synth.release(old)

        if not self.self_play:
            self.wave_lfo.retrigger()

        f = synthio.midi_to_hz(midi_note)
        vibrato_lfo = synthio.LFO(rate=1, scale=0.01)
        try:
            lpf = self.synth.low_pass_filter(self.filter_freq, 1)
        except Exception:
            lpf = None

        kwargs = {
            "frequency": f,
            "waveform": self._current_waveform,
            "envelope": self.amp_env,
            "bend": vibrato_lfo,
        }
        if lpf:
            kwargs["filter"] = lpf

        note = synthio.Note(**kwargs)
        self.synth.press(note)
        self._notes_pressed[midi_note] = note

    def note_off(self, midi_note, vel=0):
        if midi_note in self._notes_pressed:
            note = self._notes_pressed.pop(midi_note)
            self.synth.release(note)

    def _auto_play_next(self):
        # Release previous auto note
        if self._auto_pos >= 0:
            prev_note = self.self_play_notes[self._auto_pos]
            self.note_off(prev_note)
        self._auto_pos = (self._auto_pos + 3) % len(self.self_play_notes)
        self.note_on(self.self_play_notes[self._auto_pos])
        self._last_auto_time = time.monotonic()

    def update(self):
        # Update wavetable position from LFO (throttled to ~100Hz)
        now = time.monotonic()
        if now - self._last_update_time > 0.01:
            self._last_update_time = now
            try:
                self._set_wave_pos(self.wave_lfo.value)
            except Exception:
                pass

        # Self-play auto-advance
        if self.self_play and now - self._last_auto_time > self.self_play_speed:
            self._auto_play_next()
