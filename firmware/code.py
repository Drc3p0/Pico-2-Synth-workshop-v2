# ============================================================================
# PICO 2 SYNTH WORKSHOP v2 — code.py
# Synth voices adapted from todbot's circuitpython-synthio-tricks
# Original synth code by Tod Kurt (@todbot)
# https://github.com/todbot/circuitpython-synthio-tricks
# Workshop adaptation by Drc3p0
# ============================================================================
#
# Edit the CONFIG below to choose your voice, assign inputs, and customize!
# Save this file to your CIRCUITPY drive as code.py
# ============================================================================

CONFIG = {
    # ---- Voice Selection ----
    # Choose: "eighties_dystopia", "tiny_lfo_song", "monosynth",
    #         "eighties_arp", "wavetable_synth", "falling_forever", "deep_note"
    "voice": "eighties_dystopia",

    # ---- Self Play ----
    # Set True to auto-play without any input (great for demos!)
    "self_play": True,

    # ---- Input Assignments ----
    # Map physical inputs to voice parameters.
    # Each voice has different parameters — see the web configurator for details.
    #
    # Available input sources:
    #   "pot_a" (GP26), "pot_b" (GP27), "pot_c" (GP28)
    #   "ldr_a" (GP26), "ldr_b" (GP27), "ldr_c" (GP28)
    #   "accel_x", "accel_y"  (LIS3DH accelerometer via I2C)
    #   "mpr121_0" .. "mpr121_11" (capacitive touch channels)
    #   "button_0" .. "button_7" (GP0-GP7)
    #
    "input_map": {
        # Example: "filter_freq": "pot_a",
        # Example: "note_trigger": "button_0",
    },

    # ---- Hardware Options ----
    "extended_buttons": False,       # True to use GP4-GP7 as additional buttons
    "mpr121_enabled": False,         # True if MPR121 captouch is connected
    "mpr121_boards": 1,              # Number of MPR121 boards (1-4)
    "accelerometer_enabled": False,  # True if LIS3DH is connected
    "oled_enabled": True,            # True if 0.91" OLED is connected

    # ---- Effects (optional, layered on top of voice) ----
    "effects_enabled": False,
    "echo_mix": 0.0,
    "reverb_mix": 0.0,
    "distortion_mix": 0.0,

    # ---- Audio ----
    "sample_rate": 28000,
    "audio_pin": "GP15",
}


# ============================================================================
# Engine — don't edit below this line
# ============================================================================

import time
import board
import audiopwmio
import audiomixer
import synthio

from lib.helpers import map_range, clamp
from lib.inputs import InputManager
from lib.led_indicator import LEDIndicator
from lib.voices import load_voice

# --- Audio Setup ---
SAMPLE_RATE = CONFIG.get("sample_rate", 28000)
audio_pin = getattr(board, CONFIG.get("audio_pin", "GP15"))
audio = audiopwmio.PWMAudioOut(audio_pin)

mixer = audiomixer.Mixer(channel_count=1, sample_rate=SAMPLE_RATE, buffer_size=4096)
synth = synthio.Synthesizer(channel_count=1, sample_rate=SAMPLE_RATE)

# --- Effects Chain (optional) ---
final_output = mixer
if CONFIG.get("effects_enabled", False):
    try:
        from lib.fx import EffectsChain
        effects = EffectsChain(SAMPLE_RATE, 1, 4096)
        final_output = effects.build_chain(synth)
        effects.update_from_config(CONFIG)
    except Exception:
        mixer.voice[0].play(synth)
        effects = None
else:
    mixer.voice[0].play(synth)
    effects = None

audio.play(final_output if final_output is not mixer else mixer)
mixer.voice[0].level = 0.85

# --- Inputs ---
inputs = InputManager(CONFIG)
i2c = inputs.init_i2c()

# --- OLED Display ---
oled = None
if CONFIG.get("oled_enabled", False) and i2c:
    try:
        from lib.oled_display import OLEDDisplay
        voice_name = CONFIG.get("voice", "Synth")
        oled = OLEDDisplay(i2c, voice_name=voice_name)
    except Exception:
        oled = None

# --- LED Indicator ---
led = LEDIndicator()

# --- Load Voice ---
voice = load_voice(CONFIG.get("voice", "eighties_dystopia"), synth, CONFIG)

# --- Input Mapping ---
input_map = CONFIG.get("input_map", {})


def _get_input_value(source_name):
    """Read a named input source and return its normalized value."""
    if source_name.startswith("pot_") or source_name.startswith("ldr_"):
        idx = ord(source_name[-1]) - ord("a")
        return inputs.get_analog(idx)
    elif source_name == "accel_x":
        x, _ = inputs.get_accel()
        return (x + 1.0) / 2.0  # map -1..1 to 0..1
    elif source_name == "accel_y":
        _, y = inputs.get_accel()
        return (y + 1.0) / 2.0
    elif source_name.startswith("mpr121_"):
        ch = int(source_name.split("_")[1])
        touched = inputs.get_mpr121_touched()
        return 1.0 if ch in touched else 0.0
    elif source_name.startswith("button_"):
        # Buttons handled via events, not polling
        return None
    return None


# --- Main Loop ---
print("Pico 2 Synth Workshop v2")
print("Voice:", voice.name)
print("Self-play:", CONFIG.get("self_play", True))

while True:
    # Process button events
    for btn_idx, pressed in inputs.get_button_events():
        led.pulse()

        # Check if any param is mapped to this button
        btn_source = "button_{}".format(btn_idx)
        for param_name, source in input_map.items():
            if source == btn_source:
                param_info = voice.get_params().get(param_name, {})
                if param_info.get("type") == "trigger" and pressed:
                    voice.set_param(param_name, 1)
                    if oled:
                        oled.toggle_verbose(param_name)
                        oled.show_input(param_name, "ON")

        # Default: buttons 0-3 trigger notes (if not mapped to params)
        if btn_source not in input_map.values():
            scale = [0, 4, 7, 12, -5, -12, 5, 9]  # chromatic-friendly intervals
            midi_note = 48 + (scale[btn_idx % len(scale)])
            if pressed:
                voice.note_on(midi_note)
            else:
                voice.note_off(midi_note)

    # Process MPR121 touch events
    if inputs.mpr121:
        for ch, pressed in inputs.mpr121.get_events():
            led.pulse()
            touch_source = "mpr121_{}".format(ch)
            for param_name, source in input_map.items():
                if source == touch_source:
                    if pressed:
                        voice.set_param(param_name, 1)
            # Default: MPR121 triggers chromatic notes from C3
            if touch_source not in input_map.values():
                midi_note = 48 + ch
                if pressed:
                    voice.note_on(midi_note)
                else:
                    voice.note_off(midi_note)

    # Process continuous inputs (pots, LDRs, accelerometer)
    for param_name, source in input_map.items():
        val = _get_input_value(source)
        if val is not None:
            param_info = voice.get_params().get(param_name, {})
            if param_info.get("type") == "continuous":
                p_min = param_info.get("min", 0)
                p_max = param_info.get("max", 1)
                mapped = map_range(val, 0.0, 1.0, p_min, p_max)
                voice.set_param(param_name, mapped)

    # Activity LED
    if inputs.any_activity():
        led.pulse()
    led.update()

    # Voice update (self-play, filter updates, etc.)
    voice.update()

    # OLED update
    if oled:
        oled.update()

    time.sleep(0.005)
