import board
import digitalio
import time
import json

led = digitalio.DigitalInOut(board.GP25)
led.direction = digitalio.Direction.OUTPUT

print("=== INPUT MANAGER TEST ===")

try:
    f = open("/config.json", "r")
    config = json.load(f)
    f.close()
    print("Loaded config.json:")
    print("  button_pins:", config.get("button_pins", "NOT SET"))
    print("  analog_pins:", config.get("analog_pins", "NOT SET"))
    print("  voice:", config.get("voice", "NOT SET"))
except Exception as e:
    config = {}
    print("No config.json found:", e)

print("")
print("Creating InputManager with config...")

from lib.inputs import InputManager
inputs = InputManager(config)

print("Buttons available:", inputs.buttons.available if inputs.buttons else False)
print("Button count:", inputs.buttons.count if inputs.buttons else 0)
print("")
print("Polling for button events... press the button!")

while True:
    events = inputs.get_button_events()
    for idx, pressed in events:
        led.value = pressed
        print("Button", idx, "pressed" if pressed else "released")
    time.sleep(0.01)
