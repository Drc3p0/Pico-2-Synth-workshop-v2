# monosynth.py — Complete monosynth with filter, vibrato, detune
# Adapted from todbot's monosynth1_synthio.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# Video demo: https://youtu.be/S1-TDjxE3Qs

import time
import synthio
import ulab.numpy as np
from lib.helpers import map_range, clamp


DEFAULTS = {
    "oscs_per_note": 3,
    "osc_detune": 0.001,
    "filter_freq": 2000,
    "filter_freq_lo": 100,
    "filter_freq_hi": 4500,
    "filter_res": 1.0,
    "filter_res_lo": 0.5,
    "filter_res_hi": 2.0,
    "vibrato_rate": 5,
    "vibrato_depth": 0.01,
    "release_time": 0.8,
    "self_play": True,
    "self_play_notes": (45, 48, 50, 52, 45, 48, 53, 50),
    "self_play_speed": 0.4,
    "bpm": 150,
}

PARAMS = {
    "filter_freq": {"label": "Filter Cutoff", "type": "continuous", "min": 100, "max": 4500, "default": 2000},
    "filter_res": {"label": "Filter Resonance", "type": "continuous", "min": 0.5, "max": 2.0, "default": 1.0},
    "osc_detune": {"label": "Detune", "type": "continuous", "min": 0.0, "max": 0.01, "default": 0.001},
    "vibrato_depth": {"label": "Vibrato Depth", "type": "continuous", "min": 0.0, "max": 0.1, "default": 0.01},
    "vibrato_rate": {"label": "Vibrato Rate", "type": "continuous", "min": 1.0, "max": 12.0, "default": 5.0},
    "release_time": {"label": "Release Time", "type": "continuous", "min": 0.05, "max": 2.0, "default": 0.8},
    "note_trigger": {"label": "Trigger Note", "type": "trigger", "default": None},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 240, "default": 150},
}


class Voice:
    """Monosynth: multiple detuned oscillators with filter and vibrato. Great for basslines."""

    name = "Monosynth"
    description = "A fat monosynth with filter, vibrato, and detune"

    def __init__(self, synth, config=None):
        # Synthesis technique: detuned oscillators (slightly different frequencies) 
        # mixed with a low-pass filter and vibrato LFO for warmth and movement
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.oscs_per_note = cfg["oscs_per_note"]
        self.osc_detune = cfg["osc_detune"]
        self.filter_freq = cfg["filter_freq"]
        self.filter_res = cfg["filter_res"]
        self.vibrato_rate = cfg["vibrato_rate"]
        self.vibrato_depth = cfg["vibrato_depth"]
        self.release_time = cfg["release_time"]
        self.self_play = cfg.get("self_play", True)
        self.self_play_notes = cfg["self_play_notes"]
        self.self_play_speed = cfg["self_play_speed"]
        self.bpm = cfg["bpm"]
        self.self_play_speed = 60 / self.bpm / 2

        # Saw waveform
        self.wave_saw = np.linspace(28000, -28000, num=512, dtype=np.int16)

        # Vibrato LFO
        self.lfo_vibrato = synthio.LFO(rate=self.vibrato_rate, scale=self.vibrato_depth)

        self.oscs = []
        self._note_played = 0
        self._playing = False

        # Self-play state
        self._auto_pos = 0
        self._last_auto_time = time.monotonic()

        if self.self_play:
            self._auto_play_next()

    def _make_note(self, midi_note, vel=127):
        """Create and press a monophonic note with detuned oscillators."""
        # Release old
        if self.oscs:
            self.synth.release(self.oscs)
            self.oscs.clear()

        amp_level = vel / 127.0
        amp_env = synthio.Envelope(
            attack_time=0.1,
            decay_time=0.05,
            release_time=self.release_time,
            attack_level=amp_level,
            sustain_level=amp_level * 0.8,
        )

        f = synthio.midi_to_hz(midi_note)
        for i in range(self.oscs_per_note):
            fr = f * (1 + (self.osc_detune * i))  # Each osc slightly detuned from base frequency
            try:
                lpf = self.synth.low_pass_filter(self.filter_freq, self.filter_res)
            except Exception:
                lpf = None
            kwargs = {
                "frequency": fr,
                "envelope": amp_env,
                "waveform": self.wave_saw,
                "bend": self.lfo_vibrato,  # LFO modulates pitch slightly for vibrato effect
            }
            if lpf:
                kwargs["filter"] = lpf
            self.oscs.append(synthio.Note(**kwargs))

        self.synth.press(self.oscs)
        self._note_played = midi_note
        self._playing = True

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "filter_freq":
            self.filter_freq = clamp(value, 100, 4500)
        elif name == "filter_res":
            self.filter_res = clamp(value, 0.5, 2.0)
        elif name == "osc_detune":
            self.osc_detune = clamp(value, 0.0, 0.01)
        elif name == "vibrato_depth":
            self.vibrato_depth = clamp(value, 0.0, 0.1)
            self.lfo_vibrato.scale = self.vibrato_depth
        elif name == "vibrato_rate":
            self.vibrato_rate = clamp(value, 1.0, 12.0)
            self.lfo_vibrato.rate = self.vibrato_rate
        elif name == "release_time":
            self.release_time = clamp(value, 0.05, 2.0)
        elif name == "note_trigger":
            self._auto_play_next()
        elif name == "bpm":
            self.bpm = clamp(value, 40, 240)
            self.self_play_speed = 60 / self.bpm / 2

    def note_on(self, midi_note, vel=127):
        self._make_note(midi_note, vel)

    def note_off(self, midi_note):
        if midi_note == self._note_played and self._playing:
            self.synth.release(self.oscs)
            self.oscs.clear()
            self._playing = False

    def _auto_play_next(self):
        """Play the next note in the self-play sequence."""
        note = self.self_play_notes[self._auto_pos]
        self._make_note(note, 100)
        self._auto_pos = (self._auto_pos + 1) % len(self.self_play_notes)
        self._last_auto_time = time.monotonic()

    def update(self):
        # Update filter on active oscillators
        for osc in self.oscs:
            try:
                osc.filter = self.synth.low_pass_filter(self.filter_freq, self.filter_res)  # Real-time filter cutoff changes
            except Exception:
                pass

        # Self-play auto-advance
        if self.self_play:
            now = time.monotonic()
            if now - self._last_auto_time > self.self_play_speed:  # Time-based sequencing
                self._auto_play_next()
