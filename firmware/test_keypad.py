import board
import keypad
import digitalio
import time

led = digitalio.DigitalInOut(board.GP25)
led.direction = digitalio.Direction.OUTPUT

print("=== KEYPAD.KEYS TEST ===")
print("Testing GP0 with value_when_pressed=True, pull=False")

keys = keypad.Keys(
    (board.GP0,),
    value_when_pressed=True,
    pull=False,
)

while True:
    event = keys.events.get()
    if event is not None:
        if event.pressed:
            led.value = True
            print("KEYPAD PRESS detected on key", event.key_number)
        elif event.released:
            led.value = False
            print("KEYPAD RELEASE detected on key", event.key_number)
    time.sleep(0.01)
