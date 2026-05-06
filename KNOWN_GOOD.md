# KNOWN GOOD - Do Not Break Contract

This file defines behaviors that are verified working on hardware.
Any change that violates these contracts MUST be tested on device before merging.

---

## Audio Output

- synthio.Synthesizer plays DIRECTLY to audiopwmio.PWMAudioOut
- DO NOT use audiomixer — it produces silence on Pico 2 hardware
- Sample rate: 28000 (from config)
- Audio pin: GP13 (from config)
- Hardware: GP13 → 1K resistor → PAM8403 L-IN, 1uF cap to GND, PAM8403 powered from VBUS

## Filesystem / Boot

- boot.py remounts "/" writable from code: `storage.remount("/", readonly=False)`
- Hold GP0 during boot = USB mass storage writable (drag-and-drop mode)
- Normal boot = code-writable filesystem (serial save works)
- save_config() writes /config.json — requires code-writable filesystem

## Serial Protocol

- Baud: 115200
- Commands are JSON + newline: `{"cmd":"ping"}\n`
- Responses use `sys.stdout.write("\n" + json.dumps(obj) + "\n")` to avoid
  concatenation with monitoring data stream
- Monitoring output: `print(json.dumps(mon))` every ~50ms (10 loop iterations)
- Commands: ping, get_config, put_config, save, reset

## Serial Connection Timing

- CircuitPython soft-reboots when USB serial connects
- Web must wait 4 seconds after connect before first ping
- Ping retries up to 3 times with 1 second between attempts
- putConfig timeout: 5 seconds
- save timeout: 5 seconds

## Button Input Handling

- Buttons use keypad.Keys with value_when_pressed=True, pull=False
- Wiring: GPIO → button → 3.3V, with 10K pulldown resistor to GND
- keypad.Keys returns 0-based array index (btn_idx), NOT GPIO pin number
- Firmware resolves btn_idx to pin number via: `btn_pin_names[btn_idx].replace("GP", "")`
- Source name format: "button_<pin_number>" (e.g. "button_0" for GP0, "button_4" for GP4)

## Key Map (firmware note mapping)

- Config field: `key_map` — maps source names to scale key indices
- Example: `{"button_0": 0, "button_4": 1, "button_6": 9}`
- Config field: `scale` — array of semitone intervals (e.g. `[0, 2, 4, 7, 9]` for pentatonic)
- Config field: `octave` — base octave (e.g. 3)
- MIDI note formula: `(octave + 1) * 12 + scale[degree] + (octave_offset * 12)`
  where `degree = key_index % len(scale)`, `octave_offset = key_index // len(scale)`
- Buttons in key_map play notes via voice.note_on/note_off
- Buttons NOT in key_map AND NOT in input_map fall back to hardcoded C major scale

## Web Monitor → Audio (handleMonitorData)

- When monitoring data shows a button press on a key item:
  - kind="key" items use `item.keyIndex` for note index
  - kind="keys" items use `gi` (gpio array loop index) for note index
- DO NOT use `gi` for kind="key" — it is always 0 for single-pin items

## Web buildDeviceConfig()

- Iterates hwZone.items to build: input_map, key_map, button_pins, analog_pins, touch_pins
- Items with paramName=null are key items — they go in key_map, not input_map
- key_map keys use GPIO pin numbers: "button_" + pin.replace("GP", "")
- key_map values are the item's keyIndex (integer)
- scale and octave are included in device config for firmware note computation
- button_pins/touch_pins/analog_pins are always emitted (even if empty)

## Touch Input Handling

- Native GPIO touch: same pattern as buttons — array index resolved to pin number
- MPR121 touch: channel number used directly (mpr121_0, mpr121_1, etc.)
- Both check key_map before falling back to unmapped behavior

## Voice Loading

- Voices are in firmware/lib/voices/
- load_voice() imports by name from VOICE_MAP in __init__.py
- Voice.note_on(midi_note) sets frequency on already-playing notes
- Voice.note_off(midi_note) releases notes (unless self_play=True)
- Voice.update() called every loop iteration for LFOs/wavetable scanning

## Config Persistence Flow

1. Web calls putConfig → firmware updates CONFIG dict in RAM → responds {"resp":"ok"}
2. Web calls save → firmware writes CONFIG to /config.json → responds {"resp":"saved"}
3. On reboot, load_config() reads /config.json and merges with DEFAULT_CONFIG
4. If /config.json missing or corrupt, DEFAULT_CONFIG is used

## Files That Must Stay In Sync

- web/app.js ↔ docs/app.js (docs is GitHub Pages deployment)
- firmware/ ↔ pico2-synth-bundle.zip CIRCUITPY/ contents
- pico2-synth-bundle.zip ↔ docs/pico2-synth-bundle.zip
