# led_indicator.py — GP25 onboard LED activity indicator
# LED lights up only when user input is being received

import time

try:
    import board
    import digitalio
except ImportError:
    board = None
    digitalio = None


class LEDIndicator:
    """Controls the Pico onboard LED (GP25) to indicate input activity."""

    TIMEOUT = 0.15  # LED stays on for 150ms after last input

    def __init__(self, pin=None):
        self._led = None
        self._last_activity = 0.0
        self._is_on = False

        if digitalio is None or board is None:
            return

        if pin is None:
            pin = getattr(board, "GP25", getattr(board, "LED", None))

        if pin is None:
            return

        try:
            self._led = digitalio.DigitalInOut(pin)
            self._led.direction = digitalio.Direction.OUTPUT
            self._led.value = False
        except Exception:
            self._led = None

    def pulse(self):
        """Signal that input activity occurred."""
        self._last_activity = time.monotonic()
        if self._led and not self._is_on:
            self._led.value = True
            self._is_on = True

    def update(self):
        """Call in main loop. Turns LED off after timeout."""
        if not self._led or not self._is_on:
            return
        if time.monotonic() - self._last_activity > self.TIMEOUT:
            self._led.value = False
            self._is_on = False

    def deinit(self):
        if self._led:
            try:
                self._led.value = False
                self._led.deinit()
            except Exception:
                pass
