# falling_forever.py — Wavetable morphing with opposing pitch-bend LFOs
# Adapted from todbot's falling_forever_code.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# Video demo: https://www.youtube.com/watch?v=V3454a47xIs

import time
import math
import synthio
import ulab.numpy as np
from lib.helpers import clamp


WAVE_LEN = 256
NUM_WAVES = 24


def _generate_wavetable_a():
    """Generate wavetable A: evolving from pure sine to complex harmonic content."""
    table = []
    for w in range(NUM_WAVES):
        wave = np.zeros(WAVE_LEN, dtype=np.int16)
        t = w / NUM_WAVES
        harmonics = 1 + int(t * 10)
        for h in range(1, harmonics + 1):
            amp = 28000 / (h ** (1.2 - t * 0.5))
            for i in range(WAVE_LEN):
                angle = 2 * math.pi * i * h / WAVE_LEN
                wave[i] += int(amp * math.sin(angle))
        for i in range(WAVE_LEN):
            wave[i] = max(-32767, min(32767, wave[i]))
        table.append(wave)
    return table


def _generate_wavetable_b():
    """Generate wavetable B: organ-like harmonics evolving to metallic."""
    table = []
    for w in range(NUM_WAVES):
        wave = np.zeros(WAVE_LEN, dtype=np.int16)
        t = w / NUM_WAVES
        for h in [1, 2, 3, 4, 6, 8]:
            amp = 20000 / (h ** (0.8 + t))
            phase = t * math.pi * h * 0.5
            for i in range(WAVE_LEN):
                angle = 2 * math.pi * i * h / WAVE_LEN + phase
                wave[i] += int(amp * math.sin(angle))
        for i in range(WAVE_LEN):
            wave[i] = max(-32767, min(32767, wave[i]))
        table.append(wave)
    return table


DEFAULTS = {
    "base_freq": 65.4,       # C2
    "scan_speed": 0.07,      # how fast to scan through wavetable
    "bend_rate": 0.10,       # pitch bend LFO rate
    "voice2_amplitude": 0.7,
    "self_play": True,
    "bpm": 60,
}

PARAMS = {
    "base_freq": {"label": "Base Frequency", "type": "continuous", "min": 30, "max": 200, "default": 65.4},
    "scan_speed": {"label": "Wavetable Scan Speed", "type": "continuous", "min": 0.01, "max": 0.5, "default": 0.07},
    "bend_rate": {"label": "Pitch Bend Rate", "type": "continuous", "min": 0.01, "max": 1.0, "default": 0.10},
    "voice2_amplitude": {"label": "Voice 2 Level", "type": "continuous", "min": 0.0, "max": 1.0, "default": 0.7},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 240, "default": 60},
}


class Voice:
    """Falling Forever: two wavetables with opposing pitch bends create an endless falling effect."""

    name = "Falling Forever"
    description = "Morphing wavetables with opposing LFOs — endless falling"

    def __init__(self, synth, config=None):
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.self_play = cfg.get("self_play", True)
        self.bpm = cfg["bpm"]
        self.scan_speed = cfg["scan_speed"] * (self.bpm / 60)

        # Generate two wavetables
        self._table_a = _generate_wavetable_a()
        self._table_b = _generate_wavetable_b()
        self._waveform_a = np.zeros(WAVE_LEN, dtype=np.int16)
        self._waveform_b = np.zeros(WAVE_LEN, dtype=np.int16)
        self._waveform_a[:] = self._table_a[0]
        self._waveform_b[:] = self._table_b[0]

        # Opposing pitch bend LFOs (one bends down, other bends up)
        lfo_wave_dz = np.array((-32767, 0), dtype=np.int16)
        lfo_wave_uz = np.array((32767, 0), dtype=np.int16)
        self.plfo1 = synthio.LFO(rate=cfg["bend_rate"], once=True, waveform=lfo_wave_dz)
        self.plfo2 = synthio.LFO(rate=cfg["bend_rate"], once=True, waveform=lfo_wave_uz)

        # Two notes with opposing bends
        self.note1 = synthio.Note(
            frequency=cfg["base_freq"],
            waveform=self._waveform_a,
            bend=self.plfo1,
        )
        self.note2 = synthio.Note(
            frequency=cfg["base_freq"],
            waveform=self._waveform_b,
            bend=self.plfo2,
            amplitude=cfg["voice2_amplitude"],
        )

        # Wavetable scan state
        self._scan_pos = 0.0
        self._scan_dir = 1  # 1 = forward, -1 = backward (bounce)

        self._playing = False
        if self.self_play:
            synth.press((self.note1, self.note2))
            self._playing = True

    def _set_wave_pos(self, table, waveform, pos):
        """Morph waveform buffer between two adjacent table entries."""
        pos = max(0, min(pos, len(table) - 2))
        idx = int(pos)
        frac = pos - idx
        wA = table[idx]
        wB = table[min(idx + 1, len(table) - 1)]
        for i in range(WAVE_LEN):
            waveform[i] = int(wA[i] * (1 - frac) + wB[i] * frac)

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "base_freq":
            f = clamp(value, 30, 200)
            self.note1.frequency = f
            self.note2.frequency = f
        elif name == "scan_speed":
            self.scan_speed = clamp(value, 0.01, 0.5)
        elif name == "bend_rate":
            rate = clamp(value, 0.01, 1.0)
            self.plfo1.rate = rate
            self.plfo2.rate = rate
        elif name == "voice2_amplitude":
            self.note2.amplitude = clamp(value, 0.0, 1.0)
        elif name == "bpm":
            self.bpm = clamp(value, 40, 240)
            self.scan_speed = 0.07 * (self.bpm / 60)

    def note_on(self, midi_note, vel=127):
        f = synthio.midi_to_hz(midi_note)
        self.note1.frequency = f
        self.note2.frequency = f
        if not self._playing:
            self.synth.press((self.note1, self.note2))
            self._playing = True

    def note_off(self, midi_note):
        if not self.self_play and self._playing:
            self.synth.release((self.note1, self.note2))
            self._playing = False

    def update(self):
        # Scan through wavetables (bounce at ends)
        self._scan_pos += self.scan_speed * self._scan_dir
        if self._scan_pos <= 0 or self._scan_pos >= NUM_WAVES - 1:
            self._scan_dir = -self._scan_dir

        self._set_wave_pos(self._table_a, self._waveform_a, self._scan_pos)
        self._set_wave_pos(self._table_b, self._waveform_b, self._scan_pos / 3)

        # Retrigger pitch bend LFOs when they complete
        try:
            if self.plfo1.phase > 0.99:
                self.plfo1.retrigger()
                self.plfo2.retrigger()
        except Exception:
            pass

        time.sleep(0.001)
