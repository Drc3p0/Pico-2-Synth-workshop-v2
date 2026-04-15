# helpers.py — Utility functions for the Pico 2 Synth Workshop v2


def map_range(value, in_min, in_max, out_min, out_max):
    """Map a value from one range to another (like Arduino map())."""
    if in_max == in_min:
        return out_min
    scaled = (float(value) - float(in_min)) / (float(in_max) - float(in_min))
    return float(out_min) + (scaled * (float(out_max) - float(out_min)))


def clamp(value, minimum, maximum):
    """Constrain a value between minimum and maximum."""
    if minimum > maximum:
        minimum, maximum = maximum, minimum
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


def lerp(a, b, t):
    """Linear interpolation between a and b by factor t (0.0-1.0)."""
    return float(a) + ((float(b) - float(a)) * float(t))
