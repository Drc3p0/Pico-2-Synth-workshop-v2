import board
import digitalio
import storage

# Hold GP0 button during boot = USB writable (for dragging files)
# Normal boot = code writable (for save-to-flash from web serial)
btn = digitalio.DigitalInOut(board.GP0)
btn.direction = digitalio.Direction.INPUT
btn.pull = digitalio.Pull.DOWN

if btn.value:
    # Button pressed: USB mass storage writable (normal drag-and-drop)
    pass
else:
    # Button not pressed: code can write to filesystem
    storage.remount("/", readonly=False)

btn.deinit()
