# Pico 2 Synth Workshop v2

A hands-on workshop for building a configurable synthesizer with a Raspberry Pi Pico 2. Choose from 7 unique synth voices, assign physical inputs, and play music — all from a browser-based configurator.

## Voices

| Voice | Description | Self-Play |
|---|---|---|
| **Eighties Dystopia** | A swirling ominous wub that evolves over time | Cycles through dark notes with filter modulation |
| **Tiny LFO Song** | A simple generative piece using only LFOs | Four tremolo voices cycling through a 3-note song |
| **Monosynth** | A fat monosynth with filter, vibrato, and detune | Walks through a bass sequence |
| **Eighties Arp** | An arpeggio explorer for non-musicians | Arp runs with default pattern and BPM |
| **Wavetable Synth** | Morphing wavetables driven by LFO scanning | Auto-plays notes while scanning wavetable |
| **Falling Forever** | Morphing wavetables with opposing LFOs — endless falling | Continuous drone, always playing |
| **Deep Note** | THX-style chord convergence from chaos to harmony | Loops through the full 4-stage sequence |

## Hardware

### Required
- Raspberry Pi Pico 2 (RP2350)
- Breadboard + jumper wires
- Speaker or headphone (PWM audio on GP15)
- 4 tactile buttons (GP0-GP3)

### Optional
- 2-3 potentiometers (GP26, GP27, GP28)
- LDR + 10k resistor (voltage divider on GP26-28)
- MPR121 capacitive touch breakout (I2C on GP16/GP17) — up to 4 boards
- LIS3DH accelerometer (I2C on GP16/GP17)
- SSD1306 0.91" OLED display (I2C on GP16/GP17)

### Pin Map

| Pin | Function |
|---|---|
| GP0-GP3 | Buttons 0-3 |
| GP4-GP7 | Buttons 4-7 (optional) |
| GP15 | PWM Audio Out |
| GP16 | I2C SDA (OLED, MPR121, accelerometer) |
| GP17 | I2C SCL (OLED, MPR121, accelerometer) |
| GP25 | Onboard LED (input activity) |
| GP26 | ADC0 — Pot A or LDR A |
| GP27 | ADC1 — Pot B or LDR B |
| GP28 | ADC2 — Pot C or LDR C |

## Web Configurator

Open `web/index.html` in any browser. No build step, no internet required.

Features:
- **Voice selector** — choose from 7 synth voices
- **Live browser synth** — play sounds directly in the browser via Web Audio API
- **Input configurator** — assign physical inputs to voice parameters
- **Self-play mode** — hear each voice without any hardware
- **Interactive controls** — virtual buttons, sliders, and touch pads
- **Dynamic pinout diagram** — SVG updates based on your input selections
- **Wiring guides** — expandable instructions for each component
- **Code generator** — download `code.py` or JSON config for your Pico
- **Onboarding workflow** — step-by-step UF2 install and setup
- **Live Pico connection** — Web Serial streams real hardware input to the browser

## Quick Start

1. Open `web/index.html` in Chrome/Edge
2. Select a voice from the dropdown
3. Click anywhere to enable audio
4. Use virtual buttons/sliders or press keyboard keys 1-4
5. Adjust parameters with the sliders
6. Download the generated `code.py`
7. Copy to your Pico's CIRCUITPY drive

## Repo Structure

```
Pico-2-Synth-workshop-v2/
├── firmware/                    # CircuitPython code for Pico 2
│   ├── code.py                  # Main entry — edit CONFIG here
│   └── lib/
│       ├── voices/              # 7 synth voice modules
│       │   ├── eighties_dystopia.py
│       │   ├── tiny_lfo_song.py
│       │   ├── monosynth.py
│       │   ├── eighties_arp.py
│       │   ├── wavetable_synth.py
│       │   ├── falling_forever.py
│       │   └── deep_note.py
│       ├── inputs.py            # Unified input manager
│       ├── mpr121_input.py      # MPR121 multi-board wrapper
│       ├── accel_input.py       # LIS3DH accelerometer
│       ├── oled_display.py      # SSD1306 OLED + waveform viz
│       ├── led_indicator.py     # GP25 LED activity indicator
│       ├── fx.py                # Effects chain (echo/reverb/distortion)
│       ├── helpers.py           # Utility functions
│       └── arpy.py              # Arpeggiator library
│
├── web/                         # Browser-based configurator
│   ├── index.html
│   ├── style.css
│   ├── app.js                   # Main application logic
│   ├── synth-engine.js          # Web Audio API engine
│   ├── pinout.js                # Dynamic SVG pinout
│   ├── serial.js                # Web Serial for live Pico connection
│   └── voices/                  # Browser synth voice implementations
│       ├── eighties-dystopia.js
│       ├── tiny-lfo-song.js
│       ├── monosynth.js
│       ├── eighties-arp.js
│       ├── wavetable-synth.js
│       ├── falling-forever.js
│       └── deep-note.js
│
├── docs/
└── README.md
```

## Credits

- **Synth voices** originally by [Tod Kurt (@todbot)](https://github.com/todbot) from [circuitpython-synthio-tricks](https://github.com/todbot/circuitpython-synthio-tricks)
- **Workshop adaptation** by Drc3p0
- **Arpeggiator** adapted from todbot's Arpy library
- Built with [CircuitPython](https://circuitpython.org/) and the [synthio](https://docs.circuitpython.org/en/latest/shared-bindings/synthio/) library

## License

This project adapts open-source examples from todbot's circuitpython-synthio-tricks repository. Please respect the original author's work and provide attribution when sharing or modifying.
