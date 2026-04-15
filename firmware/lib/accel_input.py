# accel_input.py — LIS3DH accelerometer input wrapper
# Provides normalized X/Y axes as continuous inputs (optional, I2C on GP16/GP17)

try:
    import adafruit_lis3dh
except ImportError:
    adafruit_lis3dh = None


class AccelInput:
    """LIS3DH accelerometer wrapper providing normalized X/Y values."""

    # Gravity in m/s^2 — used for normalization
    GRAVITY = 9.806

    def __init__(self, i2c, address=0x18):
        self._sensor = None
        self.available = False

        if adafruit_lis3dh is None:
            return

        try:
            self._sensor = adafruit_lis3dh.LIS3DH_I2C(i2c, address=address)
            self._sensor.range = adafruit_lis3dh.RANGE_2_G
            self.available = True
        except Exception:
            # Try alternate address
            try:
                self._sensor = adafruit_lis3dh.LIS3DH_I2C(i2c, address=0x19)
                self._sensor.range = adafruit_lis3dh.RANGE_2_G
                self.available = True
            except Exception:
                self._sensor = None

    def get_raw(self):
        """Return raw (x, y, z) acceleration in m/s^2."""
        if not self.available or self._sensor is None:
            return (0.0, 0.0, 0.0)
        try:
            return self._sensor.acceleration
        except Exception:
            return (0.0, 0.0, 0.0)

    def get_xy_normalized(self):
        """Return (x, y) normalized to -1.0 to 1.0 range based on gravity."""
        x, y, _ = self.get_raw()
        # Clamp to -1g to +1g and normalize
        nx = max(-1.0, min(1.0, x / self.GRAVITY))
        ny = max(-1.0, min(1.0, y / self.GRAVITY))
        return (nx, ny)

    def get_xy_unsigned(self):
        """Return (x, y) normalized to 0.0-1.0 range (maps -1g..+1g to 0..1)."""
        nx, ny = self.get_xy_normalized()
        return ((nx + 1.0) / 2.0, (ny + 1.0) / 2.0)
