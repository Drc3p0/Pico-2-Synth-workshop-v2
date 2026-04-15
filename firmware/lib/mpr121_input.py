# mpr121_input.py — Multi-board MPR121 capacitive touch input
# Supports up to 4 MPR121 boards on the same I2C bus (GP16/GP17)
# Channels 0-11 per board, expandable to 0-47 with 4 boards
# Address selection: 0x5A (GND), 0x5B (3V3), 0x5C (SDA), 0x5D (SCL)

try:
    import adafruit_mpr121
except ImportError:
    adafruit_mpr121 = None


# Default I2C addresses for up to 4 MPR121 boards
MPR121_ADDRESSES = (0x5A, 0x5B, 0x5C, 0x5D)
CHANNELS_PER_BOARD = 12


class MPR121Input:
    """Multi-board MPR121 wrapper with unified channel numbering."""

    def __init__(self, i2c, num_boards=1, addresses=None):
        self.boards = []
        self.available = False
        self.num_boards = min(num_boards, 4)
        self._prev_touched = set()

        if adafruit_mpr121 is None:
            return

        if addresses is None:
            addresses = MPR121_ADDRESSES

        for i in range(self.num_boards):
            try:
                addr = addresses[i] if i < len(addresses) else MPR121_ADDRESSES[i]
                mpr = adafruit_mpr121.MPR121(i2c, address=addr)
                self.boards.append(mpr)
            except Exception:
                self.boards.append(None)

        self.available = any(b is not None for b in self.boards)

    @property
    def total_channels(self):
        """Total number of touch channels across all connected boards."""
        return len(self.boards) * CHANNELS_PER_BOARD

    def get_touched(self):
        """Return set of currently touched channel numbers (0-based global)."""
        touched = set()
        if not self.available:
            return touched

        for board_idx, mpr in enumerate(self.boards):
            if mpr is None:
                continue
            try:
                for ch in range(CHANNELS_PER_BOARD):
                    if mpr[ch].value:
                        global_ch = board_idx * CHANNELS_PER_BOARD + ch
                        touched.add(global_ch)
            except Exception:
                continue

        return touched

    def get_events(self):
        """Return list of (channel, is_pressed) events since last call."""
        current = self.get_touched()
        events = []

        # Newly touched
        for ch in current - self._prev_touched:
            events.append((ch, True))

        # Newly released
        for ch in self._prev_touched - current:
            events.append((ch, False))

        self._prev_touched = current
        return events

    def is_touched(self, channel):
        """Check if a specific global channel number is currently touched."""
        if not self.available:
            return False
        board_idx = channel // CHANNELS_PER_BOARD
        local_ch = channel % CHANNELS_PER_BOARD
        if board_idx >= len(self.boards) or self.boards[board_idx] is None:
            return False
        try:
            return self.boards[board_idx][local_ch].value
        except Exception:
            return False
