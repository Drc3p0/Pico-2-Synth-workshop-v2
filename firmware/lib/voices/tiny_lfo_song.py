# tiny_lfo_song.py — Generative piece using only LFOs for tremolo
# Adapted from todbot's synthio_tiny_lfo_song.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# Video demo: https://www.youtube.com/watch?v=m_ALNCWXor0

import time
import synthio
import ulab.numpy as np
from lib.helpers import map_range, clamp


DEFAULTS = {
    "start_note": 65,               # F4
    "song_offsets": (0, 5, -3),      # relative semitone offsets for the song cycle
    "note_interval": 8,              # seconds between note changes
    "lfo_rates": (3.0, 2.0, 1.0, 0.75),  # tremolo rates per voice layer
    "voice_intervals": (0, -7, -12, -24),  # semitone offsets from root for each voice
    "self_play": True,
    "bpm": 8,
}

PARAMS = {
    "start_note": {"label": "Root Note", "type": "continuous", "min": 36, "max": 84, "default": 65},
    "note_interval": {"label": "Note Interval (s)", "type": "continuous", "min": 2, "max": 20, "default": 8},
    "lfo_rate_1": {"label": "Tremolo Rate 1", "type": "continuous", "min": 0.25, "max": 8.0, "default": 3.0},
    "lfo_rate_2": {"label": "Tremolo Rate 2", "type": "continuous", "min": 0.25, "max": 8.0, "default": 2.0},
    "lfo_rate_3": {"label": "Tremolo Rate 3", "type": "continuous", "min": 0.25, "max": 8.0, "default": 1.0},
    "lfo_rate_4": {"label": "Tremolo Rate 4", "type": "continuous", "min": 0.1, "max": 4.0, "default": 0.75},
    "note_trigger": {"label": "Next Note", "type": "trigger", "default": None},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 240, "default": 8},
}


class Voice:
    """Tiny LFO Song: four voices with LFO-driven tremolo creating a generative piece."""

    name = "Tiny LFO Song"
    description = "A simple generative piece using only LFOs"

    def __init__(self, synth, config=None):
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.start_note = cfg["start_note"]
        self.song_offsets = cfg["song_offsets"]
        self.note_interval = cfg["note_interval"]
        self.voice_intervals = cfg["voice_intervals"]
        self.self_play = cfg.get("self_play", True)
        self.bpm = cfg["bpm"]
        self.note_interval = 60 / self.bpm * 8

        synth.envelope = synthio.Envelope(attack_time=0.1, release_time=0.05)

        # LFO waveform for tremolo: silence -> loud -> silence
        self.lfo_wav = np.array([0, 32000, 0], dtype=np.int16)

        # Create LFOs with different rates
        rates = cfg["lfo_rates"]
        self.lfos = []
        for r in rates:
            self.lfos.append(synthio.LFO(rate=r, waveform=self.lfo_wav))

        self._song_pos = 0
        self._last_change_time = time.monotonic()
        self._active_notes = []
        self._playing = False

        if self.self_play:
            self._play_current_chord()

    def _play_current_chord(self):
        """Play the current chord in the song cycle."""
        midi_note = self.start_note + self.song_offsets[self._song_pos]

        # Release previous notes
        if self._active_notes:
            self.synth.release_all_then_press([])
            self._active_notes.clear()

        # Create 4 voices at different octave intervals
        new_notes = []
        for i, interval in enumerate(self.voice_intervals):
            lfo = self.lfos[i] if i < len(self.lfos) else self.lfos[-1]
            note = synthio.Note(
                synthio.midi_to_hz(midi_note + interval),
                amplitude=lfo,
            )
            new_notes.append(note)

        self.synth.release_all_then_press(new_notes)
        self._active_notes = new_notes
        self._playing = True
        self._last_change_time = time.monotonic()

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "start_note":
            self.start_note = int(clamp(value, 36, 84))
            if self._playing:
                self._play_current_chord()
        elif name == "note_interval":
            self.note_interval = clamp(value, 2, 20)
        elif name == "bpm":
            self.bpm = clamp(value, 40, 240)
            self.note_interval = 60 / self.bpm * 8
        elif name.startswith("lfo_rate_"):
            idx = int(name[-1]) - 1
            if 0 <= idx < len(self.lfos):
                self.lfos[idx].rate = clamp(value, 0.1, 8.0)
        elif name == "note_trigger":
            self._advance_song()

    def note_on(self, midi_note, vel=127):
        """Manual note trigger overrides song position."""
        self.start_note = midi_note
        self._play_current_chord()

    def note_off(self, midi_note):
        if not self.self_play and self._playing:
            if self._active_notes:
                for n in self._active_notes:
                    self.synth.release(n)
                self._active_notes.clear()
            self._playing = False

    def _advance_song(self):
        self._song_pos = (self._song_pos + 1) % len(self.song_offsets)
        self._play_current_chord()

    def update(self):
        """Called every frame."""
        if self.self_play:
            now = time.monotonic()
            if now - self._last_change_time > self.note_interval:
                self._advance_song()
