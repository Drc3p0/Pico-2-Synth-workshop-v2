# deep_note.py — THX Deep Note style chord convergence
# Adapted from todbot's derpnote2_synthio.py
# Original by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks
# A port of "derpnote2" from https://github.com/todbot/mozzi_experiments

import time
import math
import random
import synthio
import ulab.numpy as np
from lib.helpers import clamp, lerp


# Deep Note target chord (subset of the classic THX chord)
# D1 D2 D3 A3 D4 A4
DEEP_NOTE_TARGETS = (26, 38, 50, 57, 62, 69)

DEFAULTS = {
    "num_oscs": 6,
    "target_notes": DEEP_NOTE_TARGETS,
    "stage1_time": 3,    # static random chaos
    "stage2_time": 3,    # moving random chaos
    "stage3_time": 8,    # converge on big chord
    "stage4_time": 5,    # hold on big chord
    "time_steps": 100,   # iterations per stage
    "start_note": 45,    # A2 — center of initial chaos
    "loop": True,        # loop back to stage 1 after stage 4
    "self_play": True,
    "bpm": 60,
}

PARAMS = {
    "num_oscs": {"label": "Number of Voices", "type": "continuous", "min": 3, "max": 12, "default": 6},
    "stage3_time": {"label": "Converge Time (s)", "type": "continuous", "min": 2, "max": 20, "default": 8},
    "stage4_time": {"label": "Hold Time (s)", "type": "continuous", "min": 1, "max": 15, "default": 5},
    "restart": {"label": "Restart Sequence", "type": "trigger", "default": None},
    "bpm": {"label": "BPM", "type": "continuous", "min": 40, "max": 240, "default": 60},
}


def _quad_ease_in_out(a, b, t):
    """Quadratic ease-in-out interpolation."""
    t = 2 * t * t if t < 0.5 else 1 - pow(-2 * t + 2, 2) / 2
    return a + t * (b - a)


class Voice:
    """Deep Note: THX-style chord convergence from chaos to harmony."""

    name = "Deep Note"
    description = "THX-style chord convergence from chaos to a massive chord"

    def __init__(self, synth, config=None):
        # Synthesis technique: Multiple oscillators with noise-driven LFOs create initial chaos,
        # then gradually converge to target pitches while noise LFOs decay, creating Shepard-like effect
        self.synth = synth
        cfg = dict(DEFAULTS)
        if config:
            cfg.update(config)

        self.num_oscs = cfg["num_oscs"]
        self.target_notes = cfg["target_notes"]
        self.stage1_time = cfg["stage1_time"]
        self.stage2_time = cfg["stage2_time"]
        self.stage3_time = cfg["stage3_time"]
        self.stage4_time = cfg["stage4_time"]
        self.time_steps = cfg["time_steps"]
        self.start_note = cfg["start_note"]
        self.loop = cfg["loop"]
        self.self_play = cfg.get("self_play", True)
        self.bpm = cfg["bpm"]
        self._bpm_scale = 60 / self.bpm

        # Saw waveform
        SAMPLE_SIZE = 256
        self.wave_saw = np.linspace(32767, -32767, num=SAMPLE_SIZE, dtype=np.int16)
        self.wave_noise = np.array(
            [random.randint(-32767, 32767) for _ in range(SAMPLE_SIZE)], dtype=np.int16
        )

        self.amp_env = synthio.Envelope(
            attack_time=0.5, release_time=3, sustain_level=0.75, attack_level=0.75
        )

        # Initialize oscillator state
        self.notes = [None] * self.num_oscs
        self.lfos = [None] * self.num_oscs

        # Generate random start/mid/target pitch sets
        self._notes_s1 = [random.uniform(self.start_note, self.start_note + 12) for _ in range(self.num_oscs)]
        self._notes_s2 = [random.uniform(self.start_note + 30, self.start_note) for _ in range(self.num_oscs)]
        self._notes_s3 = list(self.target_notes[:self.num_oscs])
        # Pad if we have more oscs than target notes
        while len(self._notes_s3) < self.num_oscs:
            self._notes_s3.append(self.target_notes[len(self._notes_s3) % len(self.target_notes)])

        # State machine
        self._stage = 0  # 0=not started, 1-4=stages
        self._stage_start = 0.0
        self._step = 0
        self._playing = False

        if self.self_play:
            self._start_sequence()

    def _start_sequence(self):
        """Begin the Deep Note sequence from stage 1."""
        # Regenerate random starting pitches
        self._notes_s1 = [random.uniform(self.start_note, self.start_note + 12) for _ in range(self.num_oscs)]
        self._notes_s2 = [random.uniform(self.start_note + 30, self.start_note) for _ in range(self.num_oscs)]

        # Create oscillators with noise LFOs for chaos
        for i in range(self.num_oscs):
            self.lfos[i] = synthio.LFO(
                rate=0.0001,
                scale=random.uniform(0.25, 0.5),
                phase_offset=random.random(),
                waveform=self.wave_noise,  # Random waveform creates pitch jitter
            )
            self.notes[i] = synthio.Note(
                synthio.midi_to_hz(self._notes_s1[i]),
                waveform=self.wave_saw,
                envelope=self.amp_env,
                bend=self.lfos[i],  # Pitch modulation creates chaotic effect
            )

        self.synth.press([n for n in self.notes if n is not None])
        self._playing = True
        self._stage = 1
        self._stage_start = time.monotonic()
        self._step = 0

    def get_params(self):
        return dict(PARAMS)

    def set_param(self, name, value):
        if name == "num_oscs":
            self.num_oscs = int(clamp(value, 3, 12))
        elif name == "stage3_time":
            self.stage3_time = clamp(value, 2, 20)
        elif name == "stage4_time":
            self.stage4_time = clamp(value, 1, 15)
        elif name == "restart":
            if self._playing:
                self.synth.release_all()
            self._start_sequence()
        elif name == "bpm":
            self.bpm = clamp(value, 40, 240)
            self._bpm_scale = 60 / self.bpm

    def note_on(self, midi_note, vel=127):
        """Restart the sequence with a new center note."""
        self.start_note = midi_note
        if self._playing:
            self.synth.release_all()
        self._start_sequence()

    def note_off(self, midi_note):
        pass  # Deep Note always plays through its sequence

    def update(self):
        if not self._playing or self._stage == 0:
            return

        now = time.monotonic()
        elapsed = now - self._stage_start

        if self._stage == 1:
            # Stage 1: static random chaos — just let it play
            if elapsed > self.stage1_time * self._bpm_scale:
                self._stage = 2
                self._stage_start = now
                self._step = 0

        elif self._stage == 2:
            # Stage 2: moving chaos — interpolate from s1 to s2
            stage_time = self.stage2_time * self._bpm_scale
            t = min(1.0, elapsed / stage_time)
            for i in range(self.num_oscs):
                if self.notes[i]:
                    self.notes[i].frequency = lerp(
                        synthio.midi_to_hz(self._notes_s1[i]),
                        synthio.midi_to_hz(self._notes_s2[i]),
                        t,
                    )
                    if self.lfos[i]:
                        self.lfos[i].scale = max(self.lfos[i].scale * 0.997, 0.01)  # Gradually reduce noise modulation
            if elapsed > stage_time:
                self._stage = 3
                self._stage_start = now

        elif self._stage == 3:
            # Stage 3: converge on the big chord
            stage_time = self.stage3_time * self._bpm_scale
            t = min(1.0, elapsed / stage_time)
            for i in range(self.num_oscs):
                if self.notes[i]:
                    self.notes[i].frequency = lerp(
                        synthio.midi_to_hz(self._notes_s2[i]),
                        synthio.midi_to_hz(self._notes_s3[i]),
                        t,
                    )
                    if self.lfos[i]:
                        self.lfos[i].scale = max(self.lfos[i].scale * 0.995, 0.001)  # Continue noise decay
            if elapsed > stage_time:
                self._stage = 4
                self._stage_start = now

        elif self._stage == 4:
            # Stage 4: hold the big chord
            if elapsed > self.stage4_time * self._bpm_scale:
                if self.loop or self.self_play:
                    self.synth.release_all()
                    self._start_sequence()  # Loop back to beginning
                else:
                    self.synth.release_all()
                    self._playing = False
                    self._stage = 0
