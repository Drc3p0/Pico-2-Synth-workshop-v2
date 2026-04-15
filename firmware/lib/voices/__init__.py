# voices/__init__.py — Voice registry for Pico 2 Synth Workshop v2
# Synth voices adapted from todbot's circuitpython-synthio-tricks
# Original code by Tod Kurt (@todbot) — https://github.com/todbot/circuitpython-synthio-tricks

VOICE_REGISTRY = {
    "eighties_dystopia": "lib.voices.eighties_dystopia",
    "tiny_lfo_song": "lib.voices.tiny_lfo_song",
    "monosynth": "lib.voices.monosynth",
    "eighties_arp": "lib.voices.eighties_arp",
    "wavetable_synth": "lib.voices.wavetable_synth",
    "falling_forever": "lib.voices.falling_forever",
    "deep_note": "lib.voices.deep_note",
}


def load_voice(voice_name, synth, config):
    """Load and instantiate a voice by name."""
    if voice_name not in VOICE_REGISTRY:
        raise ValueError("Unknown voice: {}".format(voice_name))

    module_path = VOICE_REGISTRY[voice_name]
    mod = __import__(module_path, None, None, ("Voice",), 0)
    return mod.Voice(synth, config)


def list_voices():
    """Return list of available voice names."""
    return list(VOICE_REGISTRY.keys())
