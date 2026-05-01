# inputs.py — Unified input manager for the Pico 2 Synth Workshop v2
# Handles: buttons (GP0-GP7), analog (GP26-28), and reports activity

try:
    import analogio
except ImportError:
    analogio = None

try:
    import board
except ImportError:
    board = None

try:
    import keypad
except ImportError:
    keypad = None

try:
    import touchio
except ImportError:
    touchio = None


def _clamp(value, minimum, maximum):
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


class SmoothedAnalog:
    """ADC input with exponential moving average smoothing."""

    def __init__(self, pin, alpha=0.15):
        self.alpha = _clamp(alpha, 0.01, 1.0)
        self._adc = None
        self.available = False
        self._smoothed = 0.0

        try:
            if analogio is None:
                raise RuntimeError("analogio unavailable")
            self._adc = analogio.AnalogIn(pin)
            self._smoothed = float(self._adc.value)
            self.available = True
        except Exception:
            self._adc = None

    def _update(self):
        if not self.available or self._adc is None:
            return int(self._smoothed)
        try:
            raw = float(self._adc.value)
            self._smoothed += (raw - self._smoothed) * self.alpha
        except Exception:
            pass
        return int(self._smoothed)

    @property
    def value(self):
        return self._update()

    @property
    def normalized(self):
        return _clamp(self.value / 65535.0, 0.0, 1.0)

    @property
    def cc_value(self):
        return _clamp((self.value & 0xFF00) >> 9, 0, 127)

    def changed(self, threshold=0.01):
        """Return True if normalized value changed more than threshold since last check."""
        old = self._last_reported if hasattr(self, "_last_reported") else -1.0
        current = self.normalized
        if abs(current - old) > threshold:
            self._last_reported = current
            return True
        return False

    def deinit(self):
        if self._adc is not None:
            try:
                self._adc.deinit()
            except Exception:
                pass


class ButtonManager:
    """keypad.Keys wrapper that reports button press/release events."""

    def __init__(self, pins, value_when_pressed=False, pull=True):
        self._keys = None
        self.available = False
        self.count = len(pins) if pins else 0
        self._states = []

        try:
            if keypad is None:
                raise RuntimeError("keypad unavailable")
            valid_pins = tuple(p for p in pins if p is not None)
            if not valid_pins:
                raise RuntimeError("no valid pins")
            self.count = len(valid_pins)
            self._states = [False] * self.count
            self._keys = keypad.Keys(
                valid_pins,
                value_when_pressed=value_when_pressed,
                pull=pull,
            )
            self.available = True
        except Exception:
            self._keys = None

    def check(self):
        events = []
        if not self.available or self._keys is None:
            return events
        try:
            while True:
                event = self._keys.events.get()
                if event is None:
                    break
                if getattr(event, "pressed", False):
                    self._states[event.key_number] = True
                    events.append((event.key_number, True))
                elif getattr(event, "released", False):
                    self._states[event.key_number] = False
                    events.append((event.key_number, False))
        except Exception:
            return []
        return events

    def deinit(self):
        if self._keys is not None:
            try:
                self._keys.deinit()
            except Exception:
                pass


class TouchManager:
    """Manages native GPIO capacitive touch inputs via touchio.TouchIn."""

    def __init__(self, pin_names):
        self._pads = []
        self._prev = []
        self.available = False
        self.count = 0

        if touchio is None or board is None or not pin_names:
            return

        for name in pin_names:
            pin = getattr(board, name, None)
            if pin is None:
                continue
            try:
                pad = touchio.TouchIn(pin)
                self._pads.append(pad)
                self._prev.append(False)
                self.count += 1
            except Exception:
                pass

        self.available = self.count > 0

    def check(self):
        events = []
        for i in range(len(self._pads)):
            try:
                val = self._pads[i].value
            except Exception:
                val = False
            if val != self._prev[i]:
                events.append((i, val))
                self._prev[i] = val
        return events

    def get_states(self):
        states = []
        for i in range(len(self._pads)):
            try:
                states.append(1 if self._pads[i].value else 0)
            except Exception:
                states.append(0)
        return states

    def deinit(self):
        for pad in self._pads:
            try:
                pad.deinit()
            except Exception:
                pass


class InputManager:
    """Unified input manager — creates and manages all physical inputs."""

    # Default pin assignments
    BUTTON_PINS = ("GP0", "GP1", "GP2", "GP3")
    BUTTON_PINS_EXTENDED = ("GP4", "GP5", "GP6", "GP7")
    ANALOG_PINS = ("GP26", "GP27", "GP28")
    I2C_SDA = "GP16"
    I2C_SCL = "GP17"
    AUDIO_PIN = "GP15"
    LED_PIN = "GP25"

    def __init__(self, config=None):
        if config is None:
            config = {}

        self.config = config
        self.buttons = None
        self.touch_native = None
        self.analogs = []
        self.mpr121 = None
        self.accelerometer = None
        self._activity = False
        self._accel_smooth_x = 0.0
        self._accel_smooth_y = 0.0

        # Initialize buttons
        button_pin_names = config.get("button_pins", self.BUTTON_PINS)
        if config.get("extended_buttons", False):
            button_pin_names = list(button_pin_names) + list(self.BUTTON_PINS_EXTENDED)

        button_pins = []
        for name in button_pin_names:
            pin = getattr(board, name, None) if board else None
            button_pins.append(pin)

        self.buttons = ButtonManager(
            tuple(button_pins),
            value_when_pressed=False,
            pull=True,
        )

        touch_pin_names = config.get("touch_pins", [])
        if touch_pin_names:
            self.touch_native = TouchManager(touch_pin_names)

        # Initialize analog inputs (pots, LDRs)
        analog_pin_names = config.get("analog_pins", self.ANALOG_PINS)
        for name in analog_pin_names:
            pin = getattr(board, name, None) if board else None
            if pin is not None:
                self.analogs.append(SmoothedAnalog(pin, alpha=0.15))
            else:
                self.analogs.append(None)

        # I2C devices initialized separately via init_i2c()

    def init_i2c(self):
        """Initialize I2C bus and optional devices (MPR121, accelerometer)."""
        try:
            import busio
            sda = getattr(board, self.I2C_SDA, None)
            scl = getattr(board, self.I2C_SCL, None)
            if sda is None or scl is None:
                return None
            i2c = busio.I2C(scl=scl, sda=sda)

            # Try MPR121
            if self.config.get("mpr121_enabled", False):
                try:
                    from lib.mpr121_input import MPR121Input
                    num_boards = self.config.get("mpr121_boards", 1)
                    self.mpr121 = MPR121Input(i2c, num_boards=num_boards)
                except Exception:
                    self.mpr121 = None

            # Try accelerometer
            if self.config.get("accelerometer_enabled", False):
                try:
                    from lib.accel_input import AccelInput
                    self.accelerometer = AccelInput(i2c)
                except Exception:
                    self.accelerometer = None

            return i2c
        except Exception:
            return None

    def get_analog(self, index):
        """Get normalized value (0.0-1.0) for analog input at index."""
        if 0 <= index < len(self.analogs) and self.analogs[index]:
            return self.analogs[index].normalized
        return 0.0

    def get_button_events(self):
        """Return list of (button_index, is_pressed) events."""
        if self.buttons:
            events = self.buttons.check()
            if events:
                self._activity = True
            return events
        return []

    def get_touch_events(self):
        """Return list of (pad_index, is_touched) events from native GPIO touch."""
        if self.touch_native:
            events = self.touch_native.check()
            if events:
                self._activity = True
            return events
        return []

    def get_touch_states(self):
        """Return list of 0/1 states for native GPIO touch pads."""
        if self.touch_native:
            return self.touch_native.get_states()
        return []

    def get_button_states(self):
        """Return list of 0/1 states for buttons (for monitoring)."""
        if not self.buttons or not self.buttons.available:
            return []
        return [1 if s else 0 for s in self.buttons._states]

    def get_mpr121_touched(self):
        """Return set of currently touched MPR121 channel numbers."""
        if self.mpr121:
            touched = self.mpr121.get_touched()
            if touched:
                self._activity = True
            return touched
        return set()

    def get_accel(self):
        """Return (x, y) normalized -1.0 to 1.0 with dead zone and smoothing applied."""
        if not self.accelerometer:
            return 0.0, 0.0

        x, y = self.accelerometer.get_xy_normalized()

        dead_pct = self.config.get("accel_dead_zone", 5) / 100.0
        smooth_pct = self.config.get("accel_smoothing", 25) / 100.0
        alpha = 1.0 - smooth_pct

        if abs(x) < dead_pct:
            x = 0.0
        else:
            x = (x - (1.0 if x > 0 else -1.0) * dead_pct) / (1.0 - dead_pct)

        if abs(y) < dead_pct:
            y = 0.0
        else:
            y = (y - (1.0 if y > 0 else -1.0) * dead_pct) / (1.0 - dead_pct)

        self._accel_smooth_x += (x - self._accel_smooth_x) * alpha
        self._accel_smooth_y += (y - self._accel_smooth_y) * alpha

        if abs(self._accel_smooth_x) > 0.05 or abs(self._accel_smooth_y) > 0.05:
            self._activity = True

        return self._accel_smooth_x, self._accel_smooth_y

    def any_activity(self):
        """Return True if any input was active since last call, then reset."""
        # Check analogs for change
        for a in self.analogs:
            if a and a.changed():
                self._activity = True

        result = self._activity
        self._activity = False
        return result
