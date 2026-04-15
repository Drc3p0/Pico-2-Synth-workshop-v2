# eighties_dystopia.py — Swirling ominous wub that evolves over time
# Adapted from todbot's synthio_eighties_dystopia.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# Video demo: https://youtu.be/EcDqYh-DzVA

import time
import random
import synthio
import ulab.numpy as np
from lib.helpers import map_range, clamp


# Default parameters
DEFAULTS = {
    "notes": (33, 34, 31),        # MIDI notes: A1, A#1, G1
    "note_duration": 15,           # seconds per note
    "num_voices": 5,               # detuned oscillators
    "lpf_base_freq": 500,          # filter lowest frequency
    "lpf_resonance": 1.5,          # filter Q
    "detune_range": 0.4,           # max random detune in semitones
    "filter_mod_rate": 0.05,       # LFO rate for filter modulation
    "filter_mod_depth": 2000,      # LFO scale for filter
    "self_play": True,             # auto-plays by default (no input needed)
    "bpm": 4,                      # very slow self-play cycling
}

# Parameters exposed to the configurator
PARAMS = {
    "lpf_base_freq": {"label": "Filter Base Freq", "type": "continuous", "min": 100, "max": 4000, "default": 500},
    "lpf_resonance": {"label": "Filter Resonance", "type": "continuous", "min": 0.5, "max": 4.0, "default": 1.5},
    "filter_mod_rate": {"label": "Filter Mod Rate", "type": "continuous", "min": 0.01, "max": 1.0, "default": 0.05},
    "filter_mod_depth": {"label": "Filter Mod Depth", "type": "continuous", "min": 200, "max": 8000, "default": 2000},
    "detune_range": {"label": "Detune Amount", "type": "continuous", "min": 0.0, "max": 2.0, "default": 0.4},
    "note_duration": {"label": "Note Duration (s)", "type": "continuous", "min": 2, "max": 30, "default": 15},
    "note_trigger": {"label": "Trigger New Note", "type": "trigger", "default": None},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 240, "default": 4},
}


class Voice:
    """Eighties Dystopia: five detuned oscillators with modulated low-pass filter."""

    name = "Eighties Dystopia"
    description = "A swirling ominous wub that evolves over time"

    def __init__(self, synth, config=None):
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.notes = cfg["notes"]
        self.note_duration = cfg["note_duration"]
        self.num_voices = cfg["num_voices"]
        self.lpf_base_freq = cfg["lpf_base_freq"]
        self.lpf_resonance = cfg["lpf_resonance"]
        self.detune_range = cfg["detune_range"]
        self.self_play = cfg.get("self_play", True)
        self.bpm = cfg["bpm"]
        self.note_duration = 60 / self.bpm * 4

        # Saw waveform — the signature sound
        self.wave_saw = np.linspace(30000, -30000, num=512, dtype=np.int16)
        self.amp_env = synthio.Envelope(attack_level=1, sustain_level=1)

        # LFO for filter modulation
        self.lfo_filtermod = synthio.LFO(
            rate=cfg["filter_mod_rate"],
            scale=cfg["filter_mod_depth"],
            offset=cfg["filter_mod_depth"],
        )
        synth.blocks.append(self.lfo_filtermod)

        # Create voice objects
        self.voices = []
        for i in range(self.num_voices):
            self.voices.append(
                synthio.Note(frequency=100, envelope=self.amp_env, waveform=self.wave_saw)
            )

        self.current_note = self.notes[0]
        self._last_note_time = time.monotonic()
        self._last_filtermod_time = time.monotonic()
        self._playing = False

        # Start playing immediately if self_play
        if self.self_play:
            self._set_notes(self.current_note)
            synth.press(self.voices)
            self._playing = True

    def _set_notes(self, midi_note):
        """Set all voices to the 'same' frequency with random detuning."""
        for voice in self.voices:
            f = synthio.midi_to_hz(midi_note + random.uniform(0, self.detune_range))
            voice.frequency = f
        # First voice is sub-oscillator, one octave down
        self.voices[0].frequency = self.voices[0].frequency / 2

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "lpf_base_freq":
            self.lpf_base_freq = clamp(value, 100, 4000)
        elif name == "lpf_resonance":
            self.lpf_resonance = clamp(value, 0.5, 4.0)
        elif name == "filter_mod_rate":
            self.lfo_filtermod.rate = clamp(value, 0.01, 1.0)
        elif name == "filter_mod_depth":
            depth = clamp(value, 200, 8000)
            self.lfo_filtermod.scale = depth
            self.lfo_filtermod.offset = depth
        elif name == "detune_range":
            self.detune_range = clamp(value, 0.0, 2.0)
            self._set_notes(self.current_note)
        elif name == "note_duration":
            self.note_duration = clamp(value, 2, 30)
        elif name == "bpm":
            self.bpm = clamp(value, 40, 240)
            self.note_duration = 60 / self.bpm * 4
        elif name == "note_trigger":
            self._trigger_new_note()

    def note_on(self, midi_note, vel=127):
        """Manually trigger a specific note."""
        self.current_note = midi_note
        self._set_notes(midi_note)
        if not self._playing:
            self.synth.press(self.voices)
            self._playing = True
        self._last_note_time = time.monotonic()

    def note_off(self, midi_note):
        """Release (only if not in self_play mode)."""
        if not self.self_play and self._playing:
            self.synth.release(self.voices)
            self._playing = False

    def _trigger_new_note(self):
        """Pick a new random note from the allowed list."""
        new_note = random.choice([n for n in self.notes if n != self.current_note])
        self.current_note = new_note
        self._set_notes(new_note)
        self._last_note_time = time.monotonic()

    def update(self):
        """Called every frame in the main loop."""
        now = time.monotonic()

        # Update filter on every voice
        for v in self.voices:
            try:
                v.filter = self.synth.low_pass_filter(
                    self.lpf_base_freq + self.lfo_filtermod.value,
                    self.lpf_resonance,
                )
            except Exception:
                pass

        # Randomly modulate filter rate every ~1 second
        if now - self._last_filtermod_time > 1:
            self._last_filtermod_time = now
            self.lfo_filtermod.rate = 0.01 + random.random() / 8

        # Auto-cycle notes in self_play mode
        if self.self_play and now - self._last_note_time > self.note_duration:
            self._trigger_new_note()
