# eighties_arp.py — Arpeggio explorer with patterns
# Adapted from todbot's eighties_arp_synthio.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# Video demo: https://www.youtube.com/watch?v=noj92Ae0IQI

import synthio
import ulab.numpy as np
from lib.helpers import map_range, clamp
from lib.arpy import Arpy


DEFAULTS = {
    "root_note": 37,
    "bpm": 110,
    "steps_per_beat": 4,
    "arp_pattern": "suspended4th",
    "num_voices": 3,
    "lpf_base_freq": 2500,
    "lpf_resonance": 1.5,
    "transpose_distance": 12,
    "transpose_steps": 0,
    "self_play": True,
}

PARAMS = {
    "root_note": {"label": "Root Note", "type": "continuous", "min": 24, "max": 72, "default": 37},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 200, "default": 110},
    "lpf_base_freq": {"label": "Filter Frequency", "type": "continuous", "min": 200, "max": 8000, "default": 2500},
    "lpf_resonance": {"label": "Filter Resonance", "type": "continuous", "min": 0.5, "max": 4.0, "default": 1.5},
    "arp_next": {"label": "Next Arp Pattern", "type": "trigger", "default": None},
    "transpose_up": {"label": "Transpose Steps +", "type": "trigger", "default": None},
}


class Voice:
    """Eighties Arp: an arpeggio explorer — no musical knowledge needed."""

    name = "Eighties Arp"
    description = "An arpeggio explorer for non-musicians"

    def __init__(self, synth, config=None):
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.num_voices = cfg["num_voices"]
        self.lpf_base_freq = cfg["lpf_base_freq"]
        self.lpf_resonance = cfg["lpf_resonance"]
        self.self_play = cfg.get("self_play", True)
        self.bpm = cfg["bpm"]

        # Saw waveform
        self.wave_saw = np.linspace(30000, -30000, num=512, dtype=np.int16)
        self.amp_env = synthio.Envelope(attack_level=1, sustain_level=1, release_time=0.5)

        self.voices = []

        # Set up arpeggiator
        self.arpy = Arpy()
        self.arpy.root_note = cfg["root_note"]
        self.arpy.set_bpm(bpm=cfg["bpm"], steps_per_beat=cfg["steps_per_beat"])
        self.arpy.set_arp(cfg["arp_pattern"])
        self.arpy.set_transpose(distance=cfg["transpose_distance"], steps=cfg["transpose_steps"])
        self.arpy.note_on_handler = self._arp_note_on
        self.arpy.note_off_handler = self._arp_note_off

        if self.self_play:
            self.arpy.on()

    def _arp_note_on(self, midi_note):
        """Called by Arpy when a note should sound."""
        fo = synthio.midi_to_hz(midi_note)
        self.voices.clear()
        for i in range(self.num_voices):
            f = fo * (1 + i * 0.007)
            lpf_f = fo * 8  # key tracking
            try:
                lpf = self.synth.low_pass_filter(lpf_f, self.lpf_resonance)
            except Exception:
                lpf = None
            kwargs = {
                "frequency": f,
                "envelope": self.amp_env,
                "waveform": self.wave_saw,
            }
            if lpf:
                kwargs["filter"] = lpf
            self.voices.append(synthio.Note(**kwargs))
        self.synth.press(self.voices)

    def _arp_note_off(self, midi_note):
        """Called by Arpy when a note should release."""
        self.synth.release(self.voices)

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "root_note":
            self.arpy.root_note = int(clamp(value, 24, 72))
        elif name == "bpm":
            self.bpm = clamp(value, 40, 200)
            self.arpy.set_bpm(self.bpm)
        elif name == "lpf_base_freq":
            self.lpf_base_freq = clamp(value, 200, 8000)
        elif name == "lpf_resonance":
            self.lpf_resonance = clamp(value, 0.5, 4.0)
        elif name == "arp_next":
            self.arpy.next_arp()
        elif name == "transpose_up":
            steps = (self.arpy.trans_steps + 1) % 3
            self.arpy.set_transpose(steps=steps)

    def note_on(self, midi_note, vel=127):
        """Override root note from external input."""
        self.arpy.root_note = midi_note
        if not self.arpy.enabled:
            self.arpy.on()

    def note_off(self, midi_note):
        if not self.self_play:
            self.arpy.off()

    def update(self):
        self.arpy.update()
