"""Minimal button test - replace code.py on CIRCUITPY with this.
LED will light solid when GP0 button is pressed.
If LED never lights: wiring problem.
If LED lights on press: wiring works, firmware bug in main code.
"""
import board
import digitalio
import time

# LED setup
led = digitalio.DigitalInOut(board.GP25)
led.direction = digitalio.Direction.OUTPUT

# Button on GP0 - reads HIGH when pressed (3V3 + 10K pulldown)
btn = digitalio.DigitalInOut(board.GP0)
btn.direction = digitalio.Direction.INPUT
# NO internal pull - using external 10K pulldown

print("=== BUTTON TEST ===")
print("GP0 configured as INPUT, no pull")
print("Expecting: HIGH when pressed, LOW when released")
print("LED will light when button pressed")
print("")

while True:
    val = btn.value
    led.value = val
    if val:
        print("PRESSED - GP0 is HIGH")
    time.sleep(0.05)
