#!/bin/bash
# Build the Pico 2 Synth Workshop firmware bundle
# Produces: pico2-synth-bundle.zip containing:
#   - circuitpython.uf2 (official Adafruit build for Pico 2)
#   - CIRCUITPY-contents/ (drag these onto the CIRCUITPY drive)
#     - code.py
#     - config.json (default config)
#     - lib/ (all synth libraries)
#     - wav/ (todbot wavetable files)
#   - INSTALL.txt (quick setup instructions)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
BUNDLE_NAME="pico2-synth-bundle"
UF2_URL="https://downloads.circuitpython.org/bin/raspberry_pi_pico2/en_US/adafruit-circuitpython-raspberry_pi_pico2-en_US-9.2.7.uf2"
UF2_FILE="circuitpython-pico2.uf2"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/$BUNDLE_NAME"
mkdir -p "$BUILD_DIR/$BUNDLE_NAME/CIRCUITPY-contents"

echo "Downloading CircuitPython 9.2.x for Pico 2..."
if command -v curl &> /dev/null; then
    curl -L -o "$BUILD_DIR/$BUNDLE_NAME/$UF2_FILE" "$UF2_URL" 2>/dev/null || {
        echo "Download failed. You can manually download from:"
        echo "  https://circuitpython.org/board/raspberry_pi_pico2/"
        echo "Place the .uf2 file in $BUILD_DIR/$BUNDLE_NAME/"
        touch "$BUILD_DIR/$BUNDLE_NAME/$UF2_FILE"
    }
else
    echo "curl not found. Download CircuitPython .uf2 manually from:"
    echo "  https://circuitpython.org/board/raspberry_pi_pico2/"
    touch "$BUILD_DIR/$BUNDLE_NAME/$UF2_FILE"
fi

echo "Copying firmware files..."
cp "$SCRIPT_DIR/firmware/code.py" "$BUILD_DIR/$BUNDLE_NAME/CIRCUITPY-contents/"
cp -r "$SCRIPT_DIR/firmware/lib" "$BUILD_DIR/$BUNDLE_NAME/CIRCUITPY-contents/"
cp -r "$SCRIPT_DIR/web/wav" "$BUILD_DIR/$BUNDLE_NAME/CIRCUITPY-contents/"

cat > "$BUILD_DIR/$BUNDLE_NAME/CIRCUITPY-contents/config.json" << 'DEFAULTCONFIG'
{
    "voice": "eighties_dystopia",
    "self_play": true,
    "input_map": {},
    "extended_buttons": false,
    "mpr121_enabled": false,
    "mpr121_boards": 1,
    "accelerometer_enabled": false,
    "oled_enabled": true,
    "use_wav": true,
    "effects_enabled": false,
    "sample_rate": 28000,
    "audio_pin": "GP15"
}
DEFAULTCONFIG

cat > "$BUILD_DIR/$BUNDLE_NAME/INSTALL.txt" << 'INSTRUCTIONS'
Pico 2 Synth Workshop - Installation
=====================================

Step 1: Flash CircuitPython
---------------------------
1. Hold the BOOTSEL button on your Pico 2 while plugging it into USB.
2. It appears as a removable drive called "RPI-RP2".
3. Drag "circuitpython-pico2.uf2" onto the drive.
4. The Pico reboots. A new drive called "CIRCUITPY" appears.

Step 2: Copy Synth Files
-------------------------
1. Open the "CIRCUITPY-contents" folder from this bundle.
2. Select ALL files and folders inside it:
   - code.py
   - config.json
   - lib/
   - wav/
3. Drag them onto the "CIRCUITPY" drive.
4. The Pico reboots and starts playing!

Step 3: Configure (optional)
-----------------------------
1. Open the configurator: https://drc3p0.github.io/Pico-2-Synth-workshop-v2/
2. Build your hardware layout in the Active Hardware zone.
3. Click "Connect" to connect to your Pico over USB.
4. Click "Save to Device" to push your configuration.
5. No need to copy files again. Config is saved to flash.

Alternatively, click "Download code.py" in the configurator
and copy it to the CIRCUITPY drive manually.
INSTRUCTIONS

echo "Creating zip bundle..."
cd "$BUILD_DIR"
zip -r "$SCRIPT_DIR/$BUNDLE_NAME.zip" "$BUNDLE_NAME"

echo ""
echo "Bundle created: $SCRIPT_DIR/$BUNDLE_NAME.zip"
echo "Contents:"
ls -la "$SCRIPT_DIR/$BUNDLE_NAME.zip"
