# ============================================================================
# PICO 2 SYNTH WORKSHOP v2 — code.py (Generic Firmware)
# Synth voices adapted from todbot's circuitpython-synthio-tricks
# Original synth code by Tod Kurt (@todbot)
# https://github.com/todbot/circuitpython-synthio-tricks
# Workshop adaptation by Drc3p0
# ============================================================================
#
# Flash once. Configure via WebSerial from the browser.
# On boot, loads /config.json if present, otherwise uses defaults.
# ============================================================================

import time
import json
import sys
import supervisor
import board
import audiopwmio
import audiomixer
import synthio

from lib.helpers import map_range, clamp
from lib.inputs import InputManager
from lib.led_indicator import LEDIndicator
from lib.voices import load_voice

# ============================================================================
# Default Configuration
# ============================================================================

DEFAULT_CONFIG = {
    "voice": "eighties_dystopia",
    "self_play": True,
    "input_map": {},
    "button_pins": [],
    "analog_pins": [],
    "touch_pins": [],
    "extended_buttons": False,
    "mpr121_enabled": False,
    "mpr121_boards": 1,
    "accelerometer_enabled": False,
    "oled_enabled": True,
    "effects_enabled": False,
    "echo_mix": 0.0,
    "reverb_mix": 0.0,
    "distortion_mix": 0.0,
    "sample_rate": 28000,
    "audio_pin": "GP13",
}

# ============================================================================
# Config Load / Save
# ============================================================================

def load_config():
    try:
        with open("/config.json", "r") as f:
            loaded = json.load(f)
        merged = dict(DEFAULT_CONFIG)
        merged.update(loaded)
        return merged
    except Exception:
        return dict(DEFAULT_CONFIG)


def save_config(config):
    try:
        with open("/config.json", "w") as f:
            json.dump(config, f)
        return True
    except Exception:
        return False

# ============================================================================
# Serial Protocol
# ============================================================================

_serial_buf = ""
_VERSION = "2.0"


def serial_send(obj):
    print(json.dumps(obj))


def serial_check():
    global _serial_buf
    if not supervisor.runtime.serial_bytes_available:
        return None
    while supervisor.runtime.serial_bytes_available:
        ch = sys.stdin.read(1)
        if ch is None:
            break
        if ch == "\n" or ch == "\r":
            line = _serial_buf.strip()
            _serial_buf = ""
            if line:
                return line
        else:
            _serial_buf += ch
    return None


def handle_command(line, config, voice, synth, inputs, oled):
    try:
        msg = json.loads(line)
    except Exception:
        serial_send({"resp": "error", "msg": "bad json"})
        return config, voice, inputs, oled, False

    cmd = msg.get("cmd", "")
    need_rebuild = False

    if cmd == "ping":
        serial_send({"resp": "pong", "version": _VERSION})

    elif cmd == "get_config":
        serial_send({"resp": "config", "data": config})

    elif cmd == "put_config":
        new_data = msg.get("data", {})
        old_voice = config.get("voice")
        old_hw_keys = (
            config.get("extended_buttons"),
            config.get("mpr121_enabled"),
            config.get("mpr121_boards"),
            config.get("accelerometer_enabled"),
            tuple(config.get("button_pins", ())),
            tuple(config.get("analog_pins", ())),
            tuple(config.get("touch_pins", ())),
        )
        config.update(new_data)

        new_hw_keys = (
            config.get("extended_buttons"),
            config.get("mpr121_enabled"),
            config.get("mpr121_boards"),
            config.get("accelerometer_enabled"),
            tuple(config.get("button_pins", ())),
            tuple(config.get("analog_pins", ())),
            tuple(config.get("touch_pins", ())),
        )

        # Rebuild inputs if hardware config changed
        if old_hw_keys != new_hw_keys:
            need_rebuild = True

        # Reload voice if voice changed
        if config.get("voice") != old_voice:
            voice = load_voice(config.get("voice", "eighties_dystopia"), synth, config)

        serial_send({"resp": "ok"})

    elif cmd == "save":
        ok = save_config(config)
        serial_send({"resp": "saved" if ok else "error", "msg": "" if ok else "write failed"})

    elif cmd == "reset":
        config = dict(DEFAULT_CONFIG)
        voice = load_voice(config.get("voice", "eighties_dystopia"), synth, config)
        need_rebuild = True
        serial_send({"resp": "ok"})

    else:
        serial_send({"resp": "error", "msg": "unknown cmd"})

    if need_rebuild:
        inputs = InputManager(config)
        inputs.init_i2c()
        oled = _init_oled(config, inputs)

    return config, voice, inputs, oled, need_rebuild

# ============================================================================
# Monitoring
# ============================================================================

def build_monitor(config, inputs):
    mon = {"mon": True}

    pot_vals = []
    for i in range(len(inputs.analogs)):
        a = inputs.analogs[i]
        if a and a.available:
            pot_vals.append(a.value)
        else:
            pot_vals.append(0)
    if pot_vals:
        mon["pot"] = pot_vals

    if inputs.buttons and inputs.buttons.available:
        btn_pin_names = CONFIG.get("button_pins", InputManager.BUTTON_PINS)
        if not btn_pin_names:
            btn_pin_names = []
        btn_states = inputs.get_button_states()
        full_btn = [0] * 8
        for i, name in enumerate(btn_pin_names):
            pin_num = int(name.replace("GP", ""))
            if i < len(btn_states):
                full_btn[pin_num] = btn_states[i]
        mon["btn"] = full_btn

    if inputs.touch_native and inputs.touch_native.available:
        mon["touch_gpio"] = inputs.get_touch_states()

    if inputs.mpr121:
        touched = inputs.get_mpr121_touched()
        num_ch = config.get("mpr121_boards", 1) * 12
        touch_states = []
        for i in range(num_ch):
            touch_states.append(1 if i in touched else 0)
        mon["touch"] = touch_states

    if inputs.accelerometer:
        x, y = inputs.get_accel()
        mon["accel"] = [round(x, 3), round(y, 3)]

    return mon

# ============================================================================
# Helpers
# ============================================================================

def _get_input_value(source_name, inputs):
    if source_name.startswith("pot_") or source_name.startswith("ldr_"):
        idx = ord(source_name[-1]) - ord("a")
        return inputs.get_analog(idx)
    elif source_name == "accel_x":
        x, _ = inputs.get_accel()
        return (x + 1.0) / 2.0
    elif source_name == "accel_y":
        _, y = inputs.get_accel()
        return (y + 1.0) / 2.0
    elif source_name.startswith("mpr121_"):
        ch = int(source_name.split("_")[1])
        touched = inputs.get_mpr121_touched()
        return 1.0 if ch in touched else 0.0
    elif source_name.startswith("touch_"):
        return None
    elif source_name.startswith("button_"):
        return None
    return None


def _init_oled(config, inputs):
    if config.get("oled_enabled", False):
        try:
            i2c = None
            import busio
            sda = getattr(board, InputManager.I2C_SDA, None)
            scl = getattr(board, InputManager.I2C_SCL, None)
            if sda and scl:
                i2c = busio.I2C(scl=scl, sda=sda)
        except Exception:
            i2c = None
        if i2c:
            try:
                from lib.oled_display import OLEDDisplay
                return OLEDDisplay(i2c, voice_name=config.get("voice", "Synth"))
            except Exception:
                pass
    return None

# ============================================================================
# Boot
# ============================================================================

CONFIG = load_config()

SAMPLE_RATE = CONFIG.get("sample_rate", 28000)
audio_pin = getattr(board, CONFIG.get("audio_pin", "GP13"))
audio = audiopwmio.PWMAudioOut(audio_pin)

mixer = audiomixer.Mixer(channel_count=1, sample_rate=SAMPLE_RATE, buffer_size=4096)
synth = synthio.Synthesizer(channel_count=1, sample_rate=SAMPLE_RATE)

# --- Effects Chain ---
final_output = mixer
effects = None
if CONFIG.get("effects_enabled", False):
    try:
        from lib.fx import EffectsChain
        effects = EffectsChain(SAMPLE_RATE, 1, 4096)
        final_output = effects.build_chain(synth)
        effects.update_from_config(CONFIG)
    except Exception:
        mixer.voice[0].play(synth)
else:
    mixer.voice[0].play(synth)

audio.play(final_output if final_output is not mixer else mixer)
mixer.voice[0].level = 0.85

# --- Inputs ---
inputs = InputManager(CONFIG)
i2c = inputs.init_i2c()

# --- OLED ---
oled = None
if CONFIG.get("oled_enabled", False) and i2c:
    try:
        from lib.oled_display import OLEDDisplay
        oled = OLEDDisplay(i2c, voice_name=CONFIG.get("voice", "Synth"))
    except Exception:
        oled = None

# --- LED ---
led = LEDIndicator()
led.pulse()
import time
time.sleep(0.5)
led.update()
time.sleep(0.2)

# --- Voice ---
voice = load_voice(CONFIG.get("voice", "eighties_dystopia"), synth, CONFIG)

# ============================================================================
# Main Loop
# ============================================================================

print("Pico 2 Synth Workshop v2.1 (generic firmware)")
print("Button pins:", CONFIG.get("button_pins", InputManager.BUTTON_PINS))
print("Button mode: value_when_pressed=True, pull=False (3V3 + 10K pulldown)")
print("Analog pins:", CONFIG.get("analog_pins", InputManager.ANALOG_PINS))
print("Voice: " + voice.name)

_loop_count = 0
_mon_activity = False

while True:
    # --- Serial Commands ---
    line = serial_check()  # Check for incoming WebSerial config updates
    if line is not None:
        CONFIG, voice, inputs, oled, _ = handle_command(
            line, CONFIG, voice, synth, inputs, oled
        )
        input_map = CONFIG.get("input_map", {})

    # --- Button Events ---
    input_map = CONFIG.get("input_map", {})
    for btn_idx, pressed in inputs.get_button_events():  # GPIO button press/release events
        led.pulse()
        _mon_activity = True
        btn_source = "button_{}".format(btn_idx)
        # Check if this button maps to a voice parameter (e.g., trigger, effect toggle)
        for param_name, source in input_map.items():
            if source == btn_source:
                param_info = voice.get_params().get(param_name, {})
                if param_info.get("type") == "trigger" and pressed:  # Only trigger on button down
                    voice.set_param(param_name, 1)
                    if oled:
                        oled.toggle_verbose(param_name)
                        oled.show_input(param_name, "ON")

        # If button is unmapped, use as playable keyboard (C major scale starting at MIDI 48)
        if btn_source not in input_map.values():
            scale = [0, 4, 7, 12, -5, -12, 5, 9]  # C major intervals in semitones
            midi_note = 48 + (scale[btn_idx % len(scale)])
            if pressed:
                voice.note_on(midi_note)
            else:
                voice.note_off(midi_note)

    # --- MPR121 Touch Events ---
    if inputs.mpr121:  # Capacitive touch pads (I2C MPR121 chip)
        for ch, pressed in inputs.mpr121.get_events():
            led.pulse()
            _mon_activity = True
            touch_source = "mpr121_{}".format(ch)
            # Check if touch pad maps to a voice parameter
            for param_name, source in input_map.items():
                if source == touch_source:
                    if pressed:
                        voice.set_param(param_name, 1)
            # If unmapped, use as keyboard keyboard starting at MIDI 48
            if touch_source not in input_map.values():
                midi_note = 48 + ch
                if pressed:
                    voice.note_on(midi_note)
                else:
                    voice.note_off(midi_note)

    # --- Native GPIO Touch Events ---
    for t_idx, touched in inputs.get_touch_events():  # Pico built-in capacitive GPIO (GP2-4)
        led.pulse()
        _mon_activity = True
        touch_source = "touch_{}".format(t_idx)
        # Check if touch GPIO maps to a voice parameter
        for param_name, source in input_map.items():
            if source == touch_source:
                if touched:
                    voice.set_param(param_name, 1)
        # If unmapped, use as playable keyboard
        if touch_source not in input_map.values():
            midi_note = 48 + t_idx
            if touched:
                voice.note_on(midi_note)
            else:
                voice.note_off(midi_note)

    # --- Continuous Inputs ---
    for param_name, source in input_map.items():  # Map analog/accelerometer to voice parameters
        val = _get_input_value(source, inputs)  # Normalized 0.0-1.0
        if val is not None:
            param_info = voice.get_params().get(param_name, {})
            if param_info.get("type") == "continuous":  # Parameter accepts continuous values
                p_min = param_info.get("min", 0)
                p_max = param_info.get("max", 1)
                mapped = map_range(val, 0.0, 1.0, p_min, p_max)  # Scale to param range
                voice.set_param(param_name, mapped)

    # --- LED ---
    if inputs.any_activity():  # Pulse LED on any input activity for visual feedback
        led.pulse()
        _mon_activity = True
    led.update()

    # --- Voice ---
    voice.update()  # Update voice state (LFOs, wavetable scans, self-play sequencing)

    # --- OLED ---
    if oled:
        oled.update()  # Update display state

    # --- Monitoring (every ~50ms = every 10 loops) ---
    _loop_count += 1
    if _loop_count >= 10:  # Send sensor telemetry every ~50ms (10 x 5ms)
        _loop_count = 0
        try:
            mon = build_monitor(CONFIG, inputs)  # Collect current state (buttons, pots, touch)
            if _mon_activity:
                mon["act"] = 1  # Mark frame with activity
                _mon_activity = False
            serial_send(mon)  # Send via WebSerial for browser UI
        except Exception:
            pass

    time.sleep(0.005)  # ~200Hz update rate
