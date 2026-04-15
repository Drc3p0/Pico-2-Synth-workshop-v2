# fx.py — Audio effects chain: Distortion -> Echo -> Reverb -> Mixer
# Carried forward from Pico 2 Synth Workshop v1, adapted for v2
# Effects are optional — voices can opt-in via CONFIG

def clamp(value, minimum, maximum):
    if minimum > maximum:
        minimum, maximum = maximum, minimum
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


try:
    audiodelays = __import__("audiodelays")
except Exception:
    audiodelays = None

try:
    audiofilters = __import__("audiofilters")
except Exception:
    audiofilters = None

try:
    audiofreeverb = __import__("audiofreeverb")
except Exception:
    audiofreeverb = None

try:
    audiomixer = __import__("audiomixer")
except Exception:
    audiomixer = None

try:
    synthio = __import__("synthio")
except Exception:
    synthio = None


class EffectsChain:
    """Configurable effects chain: Distortion -> Echo -> Reverb -> Mixer."""

    def __init__(self, sample_rate, channel_count, buffer_size):
        if (
            audiodelays is None
            or audiofilters is None
            or audiofreeverb is None
            or audiomixer is None
            or synthio is None
        ):
            raise RuntimeError("Audio effects modules are unavailable")

        self.cfg = {
            "sample_rate": sample_rate,
            "channel_count": channel_count,
            "buffer_size": buffer_size,
        }

        self.mixer = audiomixer.Mixer(voice_count=1, **self.cfg)

        # LFOs for subtle parameter modulation
        self._echo_mix_lfo = synthio.LFO(rate=0.11, scale=0.0, offset=0.0)
        self._reverb_room_lfo = synthio.LFO(rate=0.07, scale=0.0, offset=0.5)
        self._dist_drive_lfo = synthio.LFO(rate=0.14, scale=0.0, offset=0.0)

        distortion_mode = audiofilters.DistortionMode.CLIP
        self.distortion = audiofilters.Distortion(
            mode=distortion_mode,
            soft_clip=True,
            drive=self._dist_drive_lfo,
            mix=0.0,
            pre_gain=0.0,
            post_gain=-8.0,
            **self.cfg
        )
        self.echo = audiodelays.Echo(
            max_delay_ms=900,
            delay_ms=250.0,
            decay=0.35,
            mix=self._echo_mix_lfo,
            **self.cfg
        )
        self.reverb = audiofreeverb.Freeverb(
            roomsize=self._reverb_room_lfo,
            damp=0.42,
            mix=0.0,
            **self.cfg
        )

    def _set_attr(self, obj, attr_name, value):
        try:
            setattr(obj, attr_name, value)
            return True
        except Exception:
            return False

    def _set_lfo_target(self, lfo, value, wiggle=0.015):
        target = clamp(float(value), 0.0, 1.0)
        span = min(target, 1.0 - target, wiggle)
        try:
            lfo.offset = target
            lfo.scale = span
        except Exception:
            return target
        return lfo

    def build_chain(self, synth):
        try:
            self.distortion.play(synth)
            self.echo.play(self.distortion)
            self.reverb.play(self.echo)
            self.mixer.voice[0].play(self.reverb)
        except Exception:
            self.mixer.voice[0].play(synth)

        self.mixer.voice[0].level = 1.0
        return self.mixer

    def set_echo_mix(self, value):
        mod = self._set_lfo_target(self._echo_mix_lfo, value)
        if mod is not self._echo_mix_lfo:
            self._set_attr(self.echo, "mix", mod)

    def set_reverb_mix(self, value):
        self._set_attr(self.reverb, "mix", clamp(float(value), 0.0, 1.0))

    def set_reverb_roomsize(self, value):
        mod = self._set_lfo_target(self._reverb_room_lfo, value)
        if mod is not self._reverb_room_lfo:
            self._set_attr(self.reverb, "roomsize", mod)

    def set_distortion_mix(self, value):
        self._set_attr(self.distortion, "mix", clamp(float(value), 0.0, 1.0))

    def set_distortion_drive(self, value):
        mod = self._set_lfo_target(self._dist_drive_lfo, value, wiggle=0.02)
        if mod is not self._dist_drive_lfo:
            self._set_attr(self.distortion, "drive", mod)

    def set_echo_delay_ms(self, delay_ms):
        self._set_attr(self.echo, "delay_ms", max(10.0, float(delay_ms)))

    def set_echo_decay(self, decay):
        self._set_attr(self.echo, "decay", clamp(float(decay), 0.0, 1.0))

    def update_from_config(self, cfg):
        self.set_echo_mix(cfg.get("echo_mix", 0.0))
        self.set_echo_delay_ms(cfg.get("echo_delay_ms", 250.0))
        self.set_echo_decay(cfg.get("echo_decay", 0.35))
        self.set_reverb_mix(cfg.get("reverb_mix", 0.0))
        self.set_reverb_roomsize(cfg.get("reverb_roomsize", 0.5))
        self.set_distortion_mix(cfg.get("distortion_mix", 0.0))
        self.set_distortion_drive(cfg.get("distortion_drive", 0.0))
