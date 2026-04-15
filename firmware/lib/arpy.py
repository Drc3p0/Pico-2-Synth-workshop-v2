# arpy.py — Arpeggiator library
# Adapted from todbot's Arpy class (circuitpython-synthio-tricks)
# https://github.com/todbot/circuitpython-synthio-tricks

import time


class Arpy:
    """Simple arpeggiator that cycles through chord patterns."""

    def __init__(self):
        self.enabled = False
        self.root_note = 48
        self.gate_percent = 0.30
        self.set_bpm(bpm=100, steps_per_beat=2)
        self.arps = [
            ("major", (0, 4, 7, 12)),
            ("minor7th", (0, 3, 7, 10)),
            ("diminished", (0, 3, 6, 3)),
            ("suspended4th", (0, 5, 7, 12)),
            ("octaves", (0, 12, 0, -12)),
            ("octaves2", (0, 12, 24, -12)),
            ("octaves3", (0, -12, -12, 0)),
            ("root", (0, 0, 0, 0)),
        ]
        self.arp_id = 0
        self.arp_pos = 0
        self.note_on_handler = lambda note: None
        self.note_off_handler = lambda note: None
        self.note_played = None
        self.last_beat_time = time.monotonic()
        self.trans_steps = 0
        self.trans_distance = 12
        self.trans_pos = 0

    def set_bpm(self, bpm, steps_per_beat=None):
        self.bpm = bpm
        if steps_per_beat:
            self.steps_per_beat = steps_per_beat
        self.per_beat_time = 60 / bpm / self.steps_per_beat
        self.note_duration = self.gate_percent * self.per_beat_time

    def set_transpose(self, distance=12, steps=0):
        self.trans_distance = distance
        self.trans_steps = steps

    def on(self):
        self.enabled = True
        self.last_beat_time = time.monotonic() - self.per_beat_time

    def off(self):
        self.enabled = False
        if self.note_played is not None:
            self.note_off_handler(self.note_played)
            self.note_played = None

    def set_arp(self, arp_id_or_str):
        if isinstance(arp_id_or_str, str):
            for i, (name, _) in enumerate(self.arps):
                if name == arp_id_or_str:
                    self.arp_id = i
                    return
        else:
            self.arp_id = arp_id_or_str

    def arp_name(self):
        return self.arps[self.arp_id][0]

    def next_arp(self):
        self.arp_id = (self.arp_id + 1) % len(self.arps)
        return self.arp_name()

    def update(self):
        if not self.enabled:
            return
        now = time.monotonic()

        if now - self.last_beat_time >= self.per_beat_time:
            self.last_beat_time = now
            arp = self.arps[self.arp_id][1]

            trans_amount = self.trans_distance * self.trans_pos
            if self.arp_pos == 0:
                self.trans_pos = (self.trans_pos + 1) % (self.trans_steps + 1)

            self.note_played = self.root_note + arp[self.arp_pos] + trans_amount
            self.note_on_handler(self.note_played)
            self.arp_pos = (self.arp_pos + 1) % len(arp)

        if now - self.last_beat_time > self.note_duration and self.note_played:
            self.note_off_handler(self.note_played)
            self.note_played = None
