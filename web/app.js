/**
 * app.js — Main application logic for Pico 2 Synth Workshop v2 Web Configurator
 *
 * Ties together the voice selector, input configurator, code generator,
 * live play UI (piano keyboard, latch, octave, arpeggiator), pinout diagram,
 * waveform animation, serial integration, and browser synth preview.
 *
 * Globals expected from previously loaded scripts:
 *   window.SynthEngine, window.PinoutGenerator, window.PicoSerial
 *   Voice classes: EightiesDystopiaVoice, TinyLfoSongVoice, MonosynthVoice,
 *     EightiesArpVoice, WavetableSynthVoice, FallingForeverVoice, DeepNoteVoice
 */
(function () {
  "use strict";

  // =========================================================================
  // Voice definitions
  // =========================================================================

  var VOICES = {
    eighties_dystopia: {
      label: "Eighties Dystopia",
      jsClass: "EightiesDystopiaVoice",
      polyphony: "poly",
      params: {
        lpf_base_freq:    { label: "Filter Base Freq",  type: "continuous", min: 100,  max: 4000, default: 500 },
        filter_mod_rate:  { label: "Filter Mod Rate (s)", type: "continuous", min: 0.033, max: 5.0, default: 0.5 },
        filter_mod_depth: { label: "Filter Mod Depth",  type: "continuous", min: 200,  max: 5500, default: 2000 },
        detune_range:     { label: "Detune Amount",     type: "continuous", min: -2.0, max: 2.0, default: 0.0 }
      }
    },
    tiny_lfo_song: {
      label: "Tiny LFO Song",
      jsClass: "TinyLfoSongVoice",
      polyphony: "poly",
      params: {
        start_note:   { label: "Root Note",       type: "continuous", min: 36,   max: 84,  default: 65 },
        lfo_rate_1:   { label: "Tremolo Rate 1",  type: "continuous", min: 0.25, max: 8.0, default: 3.0 },
        lfo_rate_2:   { label: "Tremolo Rate 2",  type: "continuous", min: 0.25, max: 8.0, default: 2.0 },
        lfo_rate_3:   { label: "Tremolo Rate 3",  type: "continuous", min: 0.25, max: 8.0, default: 1.0 },
        lfo_rate_4:   { label: "Tremolo Rate 4",  type: "continuous", min: 0.1,  max: 4.0, default: 0.75 }
      }
    },
    monosynth: {
      label: "Monosynth",
      jsClass: "MonosynthVoice",
      polyphony: "mono",
      params: {
        filter_freq:   { label: "Filter Cutoff",    type: "continuous", min: 100,  max: 4500, default: 2000 },
        osc_detune:    { label: "Detune",           type: "continuous", min: -0.01, max: 0.01, default: 0.0 },
        vibrato_depth: { label: "Vibrato Depth",    type: "continuous", min: 0.0,  max: 0.1,  default: 0.01 },
        vibrato_rate:  { label: "Vibrato Rate",     type: "continuous", min: 1.0,  max: 12.0, default: 5.0 },
        release_time:  { label: "Release Time",     type: "continuous", min: 0.05, max: 2.0,  default: 0.8 }
      }
    },
    eighties_arp: {
      label: "Eighties Arp",
      jsClass: "EightiesArpVoice",
      polyphony: "poly",
      params: {
        root_note:     { label: "Root Note",        type: "continuous", min: 24,  max: 72,   default: 37 },
        lpf_base_freq: { label: "Filter Frequency", type: "continuous", min: 200, max: 8000, default: 2500 },
        arp_next:      { label: "Next Arp Pattern", type: "trigger" }
      }
    },
    wavetable_synth: {
      label: "Wavetable Synth",
      jsClass: "WavetableSynthVoice",
      polyphony: "mono",
      params: {
        wave_scan_min: { label: "Wave Scan Start", type: "continuous", min: 0,    max: 28,   default: 4 },
        wave_scan_max: { label: "Wave Scan End",   type: "continuous", min: 4,    max: 31,   default: 20 },
        wave_lfo_rate: { label: "Scan LFO Rate",   type: "continuous", min: 0.01, max: 2.0,  default: 0.1 },
        filter_freq:   { label: "Filter Cutoff",   type: "continuous", min: 500,  max: 8000, default: 4000 }
      }
    },
    falling_forever: {
      label: "Falling Forever",
      jsClass: "FallingForeverVoice",
      polyphony: "mono",
      params: {
        base_freq:        { label: "Base Frequency",  type: "continuous", min: 30,   max: 200, default: 65.4 },
        scan_speed:       { label: "Scan Speed",      type: "continuous", min: 0.01, max: 0.5, default: 0.07 },
        bend_rate:        { label: "Pitch Bend Rate", type: "continuous", min: 0.01, max: 1.0, default: 0.10 },
        voice2_amplitude: { label: "Voice 2 Level",   type: "continuous", min: 0.0,  max: 1.0, default: 0.7 }
      }
    },
    deep_note: {
      label: "Deep Note",
      jsClass: "DeepNoteVoice",
      polyphony: "poly",
      params: {
        num_oscs:    { label: "Number of Voices",  type: "continuous", min: 3, max: 12, default: 6 },
        stage3_time: { label: "Converge Time (s)", type: "continuous", min: 2, max: 20, default: 8 },
        stage4_time: { label: "Hold Time (s)",     type: "continuous", min: 1, max: 15, default: 5 },
        restart:     { label: "Restart Sequence",  type: "trigger" }
      }
    }
  };

  // =========================================================================
  // Input sources
  // =========================================================================

  var INPUT_SOURCES = [
    { value: "",         label: "Not assigned" },
    { value: "pot_a",    label: "Pot A (GP26)" },
    { value: "pot_b",    label: "Pot B (GP27)" },
    { value: "pot_c",    label: "Pot C (GP28)" },
    { value: "ldr_a",    label: "LDR A (GP26)" },
    { value: "ldr_b",    label: "LDR B (GP27)" },
    { value: "ldr_c",    label: "LDR C (GP28)" },
    { value: "accel_x",  label: "Accel X",        requiresAccel: true },
    { value: "accel_y",  label: "Accel Y",        requiresAccel: true },
    { value: "button_0", label: "Button 0 (GP0)" },
    { value: "button_1", label: "Button 1 (GP1)" },
    { value: "button_2", label: "Button 2 (GP2)" },
    { value: "button_3", label: "Button 3 (GP3)" }
  ];

  // MPR121 channels 0-11 (added dynamically based on mpr121 checkbox)
  for (var t = 0; t < 12; t++) {
    INPUT_SOURCES.push({ value: "mpr121_" + t, label: "Touch " + t, requiresMpr121: true });
  }

  // =========================================================================
  // Scales and note mapping
  // =========================================================================

  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  var SCALES = {
    chromatic:        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    pentatonic_major: [0, 2, 4, 7, 9],
    pentatonic_minor: [0, 3, 5, 7, 10],
    blues_major:      [0, 2, 3, 4, 7, 9],
    blues_minor:      [0, 3, 5, 6, 7, 10],
    dorian:           [0, 2, 3, 5, 7, 9, 10],
    mixolydian:       [0, 2, 4, 5, 7, 9, 10],
    harmonic_minor:   [0, 2, 3, 5, 7, 8, 11]
  };

  // 11 white keys mapped to computer keyboard
  // a=0, s=1, d=2, f=3, g=4, h=5, j=6, k=7, l=8, ;=9, '=10
  var KEY_BINDINGS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"];

  var KEY_TO_NOTE_INDEX = {};
  (function () {
    for (var i = 0; i < KEY_BINDINGS.length; i++) {
      KEY_TO_NOTE_INDEX[KEY_BINDINGS[i]] = i;
    }
  })();

  // GPIO options for assignable fields
  var GPIO_BUTTON_PINS = ["GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7"];
  var GPIO_POT_PINS = ["GP26", "GP27", "GP28"];
  var GPIO_TOUCH_PINS = [];
  (function () {
    for (var i = 0; i < 12; i++) {
      GPIO_TOUCH_PINS.push("MPR#" + i);
    }
  })();

  // =========================================================================
  // Application state
  // =========================================================================

   var state = {
     selectedVoice: "eighties_dystopia",
     boardType: "pico2",
      useWav: true,
     latchMode: false,
     currentOctave: 3,
     currentScale: "pentatonic_major",
     tonalityMajor: true,
     inputMap: {},
     paramValues: {},
     hardwareOptions: {
       mpr121_enabled: false,
       accelerometer_enabled: false
     },
     // Arpeggiator
     arpEnabled: false,
     arpPattern: "up",
     arpSpeed: 120,
     loopEnabled: false,
     // Assignable GPIO map: { fieldId: { type: "button"|"pot"|"touch"|"none", gpio: "GP0" } }
     assignMap: {},
     pots: [],
     workspaceState: { params: {}, keys: {} }
   };

  var browserVoice = null;
  var audioInitDone = false;
  var latchedNotes = new Set();
  var activeKeys = {};
  var heldKeyboardKeys = {};
  var animFrameId = null;
  var workspace = null;
  var palettePots = {};
  var bus = new EventBus();
  var voiceStateMgr = new VoiceStateManager();
  var bindingResolver = new BindingResolver(bus);
  var serialAdapter = new SerialAdapter(bus);
  var hwZone = null;
  var handleMonitorData;

  // Arpeggiator runtime
  var arpIntervalId = null;
  var arpNoteIndex = 0;
  var arpDirection = 1;          // 1 = up, -1 = down (for updown pattern)
  var lastArpMidi = null;

  // =========================================================================
  // DOM references
  // =========================================================================

  var $ = function (id) { return document.getElementById(id); };

   var $voiceSelect     = $("voice-select");
    var $latchToggle     = $("latch-toggle");
    var $waveformCanvas  = $("waveform-canvas");
    var $keyboard        = $("keyboard");
    var $octaveDown      = $("octave-down");
    var $octaveUp        = $("octave-up");
    var $octaveDisplay   = $("octave-display");
    var $paramPanel      = $("param-panel");
    var $paramSection    = $("param-section");
    var $potA            = $("pot-a");
    var $accelX          = $("accel-x");
    var $accelY          = $("accel-y");
    var $accelXVal       = $("accel-x-val");
    var $accelYVal       = $("accel-y-val");
    var $accelSliders    = $("accel-sliders");
    var $potList         = $("pot-list");
    var $addPotBtn       = $("add-pot-btn");
    var $pinoutContainer = $("pinout-container");
    var $codeOutput      = $("code-output");
    var $btnCopyCode     = $("btn-copy-code");
    var $btnDownloadCode = $("btn-download-code");
    var $btnDownloadJson = $("btn-download-json");
    var $btnDownloadBundle = $("btn-download-bundle");
    var $btnConnectPico  = $("btn-connect");
    var $btnSaveDevice   = $("btn-save-device");
    var $serialStatus    = $("serial-status");
  var $inputActivity   = $("input-activity");
  var _activityTimer   = null;
    var $onboarding      = $("onboarding");
    var $boardSelect     = $("board-select");
    var $boardHint       = $("board-hint");
    var $scaleSelect     = $("scale-select");
    var $btnTonality     = $("btn-tonality");
    var $arpToggle       = $("arp-toggle");
    var $arpPattern      = $("arp-pattern");
    var $arpSpeed        = $("arp-speed");
    var $arpSpeedVal     = $("arp-speed-val");
    var $loopToggle      = $("loop-toggle");
    var $requirementsList = $("requirements-list");

  // =========================================================================
  // Utility helpers
  // =========================================================================

  function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
  }

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function displayNum(val, decimals) {
    if (typeof decimals === "undefined") {
      if (Math.abs(val) < 0.01) return val.toFixed(4);
      if (Math.abs(val) < 1)    return val.toFixed(3);
      if (Math.abs(val) < 100)  return val.toFixed(2);
      return val.toFixed(1);
    }
    return val.toFixed(decimals);
  }

  function sliderStep(min, max) {
    var range = max - min;
    if (range <= 0.1)  return 0.0001;
    if (range <= 1)    return 0.001;
    if (range <= 10)   return 0.01;
    if (range <= 100)  return 0.1;
    return 1;
  }

  /** Convert HTML select value (hyphenated) to VOICES key (underscored) */
  function selectToKey(val) {
    return val.replace(/-/g, "_");
  }

  /** Convert VOICES key to HTML select value */
  function keyToSelect(key) {
    return key.replace(/_/g, "-");
  }

  /** Get the scale intervals for current scale setting */
  function getScaleIntervals() {
    return SCALES[state.currentScale] || SCALES.chromatic;
  }

  /**
   * Compute MIDI note for key index (0-10) using current scale and octave.
   * Maps key indices into scale degrees, wrapping octaves as needed.
   */
  function midiNoteForIndex(keyIndex) {
    var intervals = getScaleIntervals();
    var scaleLen = intervals.length;
    var degree = keyIndex % scaleLen;
    var octaveOffset = Math.floor(keyIndex / scaleLen);
    var baseMidi = (state.currentOctave + 1) * 12;
    return baseMidi + intervals[degree] + (octaveOffset * 12);
  }

  /**
   * Get the note name (e.g. "C3", "F#4") for a key index.
   */
  function noteNameForIndex(keyIndex) {
    var midi = midiNoteForIndex(keyIndex);
    var noteName = NOTE_NAMES[midi % 12];
    var octave = Math.floor(midi / 12) - 1;
    return noteName + octave;
  }

  /** Check if the current voice is mono */
  function isMonoVoice() {
    var def = VOICES[state.selectedVoice];
    return def && def.polyphony === "mono";
  }

  // =========================================================================
  // Board type selector
  // =========================================================================

  function initBoardSelector() {
    if (!$boardSelect) return;
    $boardSelect.addEventListener("change", function () {
      state.boardType = $boardSelect.value;
      updateBoardDisplay();
      updatePinout();
      scheduleCodeUpdate();
    });
  }

  function updateBoardDisplay() {
    var isPico2 = state.boardType === "pico2";

    if ($boardHint) {
      $boardHint.textContent = isPico2
        ? "RP2350 - Uses internal pull-down resistors. Buttons wire to 3V3."
        : "RP2040 - Uses internal pull-up resistors. Buttons wire to GND.";
    }

    var togglePairs = [
      ["uf2-link-pico2", "uf2-link-pico"],
      ["wiring-note-pico2", "wiring-note-pico"],
      ["btn-wiring-desc-pico2", "btn-wiring-desc-pico"],
      ["btn-wiring-diag-pico2", "btn-wiring-diag-pico"],
      ["btn-tip-pico2", "btn-tip-pico"]
    ];

    for (var i = 0; i < togglePairs.length; i++) {
      var el2 = document.getElementById(togglePairs[i][0]);
      var el1 = document.getElementById(togglePairs[i][1]);
      if (el2) el2.style.display = isPico2 ? "" : "none";
      if (el1) el1.style.display = isPico2 ? "none" : "";
    }
  }

  // =========================================================================
  // Audio initialization (autoplay policy)
  // =========================================================================

  function ensureAudioInit() {
    if (audioInitDone) return Promise.resolve();
    return SynthEngine.init().then(function () {
      audioInitDone = true;
    });
  }

  function handleFirstInteraction() {
    ensureAudioInit();
    document.removeEventListener("click", handleFirstInteraction);
    document.removeEventListener("keydown", handleFirstInteraction);
    document.removeEventListener("touchstart", handleFirstInteraction);
  }

  document.addEventListener("click", handleFirstInteraction);
  document.addEventListener("keydown", handleFirstInteraction);
  document.addEventListener("touchstart", handleFirstInteraction);

  // =========================================================================
  // Browser voice management
  // =========================================================================

  function stopBrowserVoice() {
    if (browserVoice) {
      try {
        if (typeof browserVoice.stop === "function") browserVoice.stop();
        if (typeof browserVoice.dispose === "function") browserVoice.dispose();
      } catch (e) {
        console.warn("[app] Error stopping browser voice:", e);
      }
      browserVoice = null;
    }
  }

  function createBrowserVoice(voiceKey) {
    var def = VOICES[voiceKey];
    if (!def) return null;
    var Ctor = window[def.jsClass];
    if (!Ctor) {
      console.warn("[app] Voice class not found:", def.jsClass);
      return null;
    }
    try {
      return new Ctor(SynthEngine.getContext(), SynthEngine.getMasterGain());
    } catch (e) {
      console.error("[app] Failed to create voice:", e);
      return null;
    }
  }

  /** Apply all current param values to the browser voice */
  function syncParamsToVoice() {
    if (!browserVoice || typeof browserVoice.setParam !== "function") return;
    for (var pName in state.paramValues) {
      if (state.paramValues.hasOwnProperty(pName)) {
        browserVoice.setParam(pName, state.paramValues[pName]);
      }
    }
  }

  // =========================================================================
  // Param defaults initialization
  // =========================================================================

  function initParamValues(voiceKey) {
    var def = VOICES[voiceKey];
    if (!def) return;
    state.paramValues = {};
    state.inputMap = {};
    var params = def.params;
    for (var pName in params) {
      if (params.hasOwnProperty(pName)) {
        var p = params[pName];
        if (p.type === "continuous" && typeof p.default !== "undefined") {
          state.paramValues[pName] = p.default;
        }
      }
    }
  }

  // =========================================================================
  // Assignable GPIO fields
  // =========================================================================

  /**
   * Populate a GPIO dropdown based on the selected input type.
   * type: "button" -> GP0-GP7, "pot" -> GP26/27/28, "touch" -> MPR#0-11, "none" -> hide
   */
  function populateGpioDropdown(gpioSelect, inputType) {
    if (!gpioSelect) return;
    gpioSelect.innerHTML = "";

    var pins = [];
    if (inputType === "button") {
      pins = GPIO_BUTTON_PINS;
    } else if (inputType === "pot") {
      pins = GPIO_POT_PINS;
    } else if (inputType === "touch") {
      pins = GPIO_TOUCH_PINS;
    }

    if (pins.length === 0) {
      gpioSelect.style.display = "none";
      return;
    }

    gpioSelect.style.display = "";
    for (var i = 0; i < pins.length; i++) {
      var opt = document.createElement("option");
      opt.value = pins[i];
      opt.textContent = pins[i];
      gpioSelect.appendChild(opt);
    }
  }

  /** Wire up all assign-input-type / assign-gpio pairs on the page */
  function initAssignFields() {
    var typeSelects = document.querySelectorAll(".assign-input-type");
    for (var i = 0; i < typeSelects.length; i++) {
      (function (typeSelect) {
        var id = typeSelect.id; // e.g. "assign-scale-type"
        var baseName = id.replace("assign-", "").replace("-type", "");
        var gpioId = "assign-" + baseName + "-gpio";
        var gpioSelect = document.getElementById(gpioId);

        // Set initial state
        populateGpioDropdown(gpioSelect, typeSelect.value);

        // Store initial assignment
        updateAssignState(baseName, typeSelect.value, gpioSelect ? gpioSelect.value : "");

        typeSelect.addEventListener("change", function () {
          populateGpioDropdown(gpioSelect, typeSelect.value);
          updateAssignState(baseName, typeSelect.value, gpioSelect ? gpioSelect.value : "");
          updatePinout();
          scheduleCodeUpdate();
        });

        if (gpioSelect) {
          gpioSelect.addEventListener("change", function () {
            updateAssignState(baseName, typeSelect.value, gpioSelect.value);
            updatePinout();
            scheduleCodeUpdate();
          });
        }
      })(typeSelects[i]);
    }
  }

  function updateAssignState(fieldName, inputType, gpio) {
    if (inputType === "none" || !inputType) {
      delete state.assignMap[fieldName];
    } else {
      state.assignMap[fieldName] = { type: inputType, gpio: gpio };
    }
  }

  // =========================================================================
  // Dynamic Keyboard Rendering
  // =========================================================================

  function renderKeyboard() {
    if (!$keyboard) return;
    $keyboard.innerHTML = "";

    for (var i = 0; i < 11; i++) {
      var col = document.createElement("div");
      col.className = "key-column";

      // Key button
      var keyBtn = document.createElement("div");
      keyBtn.className = "key white";
      keyBtn.setAttribute("data-note", i);
      keyBtn.setAttribute("data-key", KEY_BINDINGS[i]);

      var noteLabel = document.createElement("span");
      noteLabel.className = "key-note";
      noteLabel.textContent = noteNameForIndex(i);

      var bindLabel = document.createElement("span");
      bindLabel.className = "key-bind";
      bindLabel.textContent = KEY_BINDINGS[i] === ";" ? ";" : KEY_BINDINGS[i] === "'" ? "'" : KEY_BINDINGS[i].toUpperCase();

      keyBtn.appendChild(noteLabel);
      keyBtn.appendChild(bindLabel);

      // Assign section below the key
      var assignDiv = document.createElement("div");
      assignDiv.className = "key-assign";

      var typeSelect = document.createElement("select");
      typeSelect.className = "assign-input-type";
      typeSelect.id = "assign-key-" + i + "-type";
      var noneOpt = document.createElement("option");
      noneOpt.value = "none";
      noneOpt.textContent = "--";
      var btnOpt = document.createElement("option");
      btnOpt.value = "button";
      btnOpt.textContent = "BTN";
      var touchOpt = document.createElement("option");
      touchOpt.value = "touch";
      touchOpt.textContent = "TCH";
      typeSelect.appendChild(noneOpt);
      typeSelect.appendChild(btnOpt);
      typeSelect.appendChild(touchOpt);

      var gpioSelect = document.createElement("select");
      gpioSelect.className = "assign-gpio";
      gpioSelect.id = "assign-key-" + i + "-gpio";
      gpioSelect.style.display = "none";

      assignDiv.appendChild(typeSelect);
      assignDiv.appendChild(gpioSelect);

      col.appendChild(keyBtn);
      col.appendChild(assignDiv);
      $keyboard.appendChild(col);

      // Wire assign events for this key
      (function (idx, tSel, gSel) {
        tSel.addEventListener("change", function () {
          populateGpioDropdown(gSel, tSel.value);
          updateAssignState("key-" + idx, tSel.value, gSel.value);
          updatePinout();
          scheduleCodeUpdate();
        });
        gSel.addEventListener("change", function () {
          updateAssignState("key-" + idx, tSel.value, gSel.value);
          updatePinout();
          scheduleCodeUpdate();
        });
      })(i, typeSelect, gpioSelect);
    }
  }

  function updateKeyLabels() {
    if (!$keyboard) return;
    var keys = $keyboard.querySelectorAll(".key");
    for (var i = 0; i < keys.length; i++) {
      var keyEl = keys[i];
      var noteIndex = parseInt(keyEl.getAttribute("data-note"), 10);
      var noteLabel = keyEl.querySelector(".key-note");
      if (noteLabel) {
        noteLabel.textContent = noteNameForIndex(noteIndex);
      }
    }
  }

  // =========================================================================
  // Piano note on/off
  // =========================================================================

  function pianoNoteOn(noteIndex) {
    var midi = midiNoteForIndex(noteIndex);
    ensureAudioInit().then(function () {
      if (!browserVoice) {
        browserVoice = createBrowserVoice(state.selectedVoice);
        syncParamsToVoice();
      }
      if (browserVoice && typeof browserVoice.noteOn === "function") {
        browserVoice.noteOn(midi);
      }
    });
  }

  function pianoNoteOff(noteIndex) {
    var midi = midiNoteForIndex(noteIndex);
    if (browserVoice && typeof browserVoice.noteOff === "function") {
      browserVoice.noteOff(midi);
    }
  }

  function setKeyActive(noteIndex, active) {
    if (!$keyboard) return;
    var keyEl = $keyboard.querySelector('.key[data-note="' + noteIndex + '"]');
    if (!keyEl) return;
    if (active) {
      keyEl.classList.add("active");
      keyEl.classList.add("pressed");
    } else {
      keyEl.classList.remove("active");
      keyEl.classList.remove("pressed");
    }
  }

  function setKeyLatched(noteIndex, latched) {
    if (!$keyboard) return;
    var keyEl = $keyboard.querySelector('.key[data-note="' + noteIndex + '"]');
    if (!keyEl) return;
    if (latched) {
      keyEl.classList.add("latched");
    } else {
      keyEl.classList.remove("latched");
    }
  }

  // =========================================================================
  // Mono latch: unlatch previous key when mono voice + latch mode
  // =========================================================================

  function unlatchAllExcept(keepMidi) {
    var toRemove = [];
    latchedNotes.forEach(function (midi) {
      if (midi !== keepMidi) {
        toRemove.push(midi);
      }
    });
    for (var i = 0; i < toRemove.length; i++) {
      latchedNotes.delete(toRemove[i]);
      if (browserVoice && typeof browserVoice.noteOff === "function") {
        browserVoice.noteOff(toRemove[i]);
      }
    }
    // Clear latched CSS from all keys, then re-mark the kept one
    if ($keyboard) {
      var keys = $keyboard.querySelectorAll(".key.latched");
      for (var j = 0; j < keys.length; j++) {
        keys[j].classList.remove("latched");
      }
    }
  }

  function handleKeyPress(noteIndex) {
    if (state.latchMode) {
      var midi = midiNoteForIndex(noteIndex);
      if (latchedNotes.has(midi)) {
        // Second press: unlatch
        latchedNotes.delete(midi);
        setKeyLatched(noteIndex, false);
        pianoNoteOff(noteIndex);
      } else {
        // Mono voice: unlatch previous note first
        if (isMonoVoice()) {
          unlatchAllExcept(midi);
        }
        // Latch this note
        latchedNotes.add(midi);
        setKeyLatched(noteIndex, true);
        pianoNoteOn(noteIndex);
      }
      // Restart arpeggiator if running, so it picks up the new set
      if (state.arpEnabled) {
        restartArpeggiator();
      }
    } else {
      activeKeys[noteIndex] = true;
      setKeyActive(noteIndex, true);
      pianoNoteOn(noteIndex);
    }
  }

  function handleKeyRelease(noteIndex) {
    if (state.latchMode) {
      // In latch mode, release does nothing, toggle handled in press
      return;
    }
    if (activeKeys[noteIndex]) {
      delete activeKeys[noteIndex];
      setKeyActive(noteIndex, false);
      pianoNoteOff(noteIndex);
    }
  }

  function releaseAllLatched() {
    latchedNotes.forEach(function (midi) {
      if (browserVoice && typeof browserVoice.noteOff === "function") {
        browserVoice.noteOff(midi);
      }
    });
    latchedNotes.clear();
    if ($keyboard) {
      var keys = $keyboard.querySelectorAll(".key.latched");
      for (var i = 0; i < keys.length; i++) {
        keys[i].classList.remove("latched");
      }
    }
  }

  function releaseAllActive() {
    for (var idx in activeKeys) {
      if (activeKeys.hasOwnProperty(idx)) {
        var ni = parseInt(idx, 10);
        setKeyActive(ni, false);
        pianoNoteOff(ni);
      }
    }
    activeKeys = {};
  }

  // =========================================================================
  // Keyboard event handling (mouse, touch, computer keyboard)
  // =========================================================================

  function initPianoKeyboard() {
    if (!$keyboard) return;

    // Render dynamic keys first
    renderKeyboard();

    var keys = $keyboard.querySelectorAll(".key");

    for (var i = 0; i < keys.length; i++) {
      (function (keyEl) {
        var noteIndex = parseInt(keyEl.getAttribute("data-note"), 10);

        // Mouse
        keyEl.addEventListener("mousedown", function (e) {
          e.preventDefault();
          handleKeyPress(noteIndex);
        });
        keyEl.addEventListener("mouseup", function (e) {
          e.preventDefault();
          handleKeyRelease(noteIndex);
        });
        keyEl.addEventListener("mouseleave", function () {
          if (!state.latchMode && activeKeys[noteIndex]) {
            handleKeyRelease(noteIndex);
          }
        });

        // Touch
        keyEl.addEventListener("touchstart", function (e) {
          e.preventDefault();
          handleKeyPress(noteIndex);
        }, { passive: false });
        keyEl.addEventListener("touchend", function (e) {
          e.preventDefault();
          handleKeyRelease(noteIndex);
        }, { passive: false });
        keyEl.addEventListener("touchcancel", function (e) {
          e.preventDefault();
          handleKeyRelease(noteIndex);
        }, { passive: false });
      })(keys[i]);
    }

    // Computer keyboard -- NO focus guard; always active regardless of focused element
    // Only preventDefault on note keys and octave keys to avoid interfering with typing
    var noteKeySet = {};
    for (var k = 0; k < KEY_BINDINGS.length; k++) {
      noteKeySet[KEY_BINDINGS[k]] = true;
    }
    noteKeySet["z"] = true;
    noteKeySet["x"] = true;

    document.addEventListener("keydown", function (e) {
      if (e.repeat) return;

      var key = e.key.toLowerCase();

      // Only prevent default for our synth keys
      if (noteKeySet[key]) {
        e.preventDefault();
      }

      // Octave controls
      if (key === "z") {
        state.currentOctave = Math.max(0, state.currentOctave - 1);
        if ($octaveDisplay) $octaveDisplay.textContent = "Octave " + state.currentOctave;
        updateKeyLabels();
        return;
      }
      if (key === "x") {
        state.currentOctave = Math.min(8, state.currentOctave + 1);
        if ($octaveDisplay) $octaveDisplay.textContent = "Octave " + state.currentOctave;
        updateKeyLabels();
        return;
      }

      // Note keys
      if (KEY_TO_NOTE_INDEX.hasOwnProperty(key)) {
        var noteIndex = KEY_TO_NOTE_INDEX[key];
        if (!heldKeyboardKeys[key]) {
          heldKeyboardKeys[key] = true;
          handleKeyPress(noteIndex);
        }
      }
    });

    document.addEventListener("keyup", function (e) {
      var key = e.key.toLowerCase();

      if (noteKeySet[key]) {
        e.preventDefault();
      }

      if (KEY_TO_NOTE_INDEX.hasOwnProperty(key)) {
        var noteIndex = KEY_TO_NOTE_INDEX[key];
        heldKeyboardKeys[key] = false;
        handleKeyRelease(noteIndex);
      }
    });

    updateKeyLabels();
  }

  // =========================================================================
  // Octave controls
  // =========================================================================

  function initOctaveControls() {
    if ($octaveDown) {
      $octaveDown.addEventListener("click", function () {
        state.currentOctave = Math.max(0, state.currentOctave - 1);
        if ($octaveDisplay) $octaveDisplay.textContent = "Octave " + state.currentOctave;
        updateKeyLabels();
      });
    }
    if ($octaveUp) {
      $octaveUp.addEventListener("click", function () {
        state.currentOctave = Math.min(8, state.currentOctave + 1);
        if ($octaveDisplay) $octaveDisplay.textContent = "Octave " + state.currentOctave;
        updateKeyLabels();
      });
    }
  }

  // =========================================================================
  // Scale / Tonality controls
  // =========================================================================

  function initScaleControls() {
    if ($scaleSelect) {
      $scaleSelect.addEventListener("change", function () {
        state.currentScale = $scaleSelect.value;
        updateKeyLabels();
        scheduleCodeUpdate();
      });
    }

    if ($btnTonality) {
      $btnTonality.addEventListener("click", function () {
        state.tonalityMajor = !state.tonalityMajor;
        $btnTonality.textContent = state.tonalityMajor ? "Major" : "Minor";

        // Swap pentatonic/blues scale variant to match tonality
        if (state.currentScale === "pentatonic_major" && !state.tonalityMajor) {
          state.currentScale = "pentatonic_minor";
          if ($scaleSelect) $scaleSelect.value = "pentatonic_minor";
        } else if (state.currentScale === "pentatonic_minor" && state.tonalityMajor) {
          state.currentScale = "pentatonic_major";
          if ($scaleSelect) $scaleSelect.value = "pentatonic_major";
        } else if (state.currentScale === "blues_major" && !state.tonalityMajor) {
          state.currentScale = "blues_minor";
          if ($scaleSelect) $scaleSelect.value = "blues_minor";
        } else if (state.currentScale === "blues_minor" && state.tonalityMajor) {
          state.currentScale = "blues_major";
          if ($scaleSelect) $scaleSelect.value = "blues_major";
        }

        updateKeyLabels();
        scheduleCodeUpdate();
      });
    }
  }

  // =========================================================================
  // Latch mode
  // =========================================================================

  function initLatchControls() {
    if ($latchToggle) {
      $latchToggle.addEventListener("change", function () {
        state.latchMode = $latchToggle.checked;
        if ($keyboard) {
          var container = $keyboard.closest(".keyboard-container");
          if (container) {
            if (state.latchMode) {
              container.classList.add("latch-active");
            } else {
              container.classList.remove("latch-active");
              // Release all latched when turning off latch
              releaseAllLatched();
              stopArpeggiator();
            }
          }
        }
        // Also release any held keys from non-latch mode
        if (!state.latchMode) {
          releaseAllActive();
        }
      });
    }
  }

  // =========================================================================
  // Arpeggiator
  // =========================================================================

  function initArpControls() {
    if ($arpToggle) {
      $arpToggle.addEventListener("change", function () {
        state.arpEnabled = $arpToggle.checked;
        if (state.arpEnabled) {
          startArpeggiator();
        } else {
          stopArpeggiator();
        }
        scheduleCodeUpdate();
      });
    }

    if ($arpPattern) {
      $arpPattern.addEventListener("change", function () {
        state.arpPattern = $arpPattern.value;
        if (state.arpEnabled) {
          restartArpeggiator();
        }
        scheduleCodeUpdate();
      });
    }

    if ($arpSpeed) {
      $arpSpeed.addEventListener("input", function () {
        state.arpSpeed = parseInt($arpSpeed.value, 10);
        if ($arpSpeedVal) $arpSpeedVal.textContent = state.arpSpeed;
        if (state.arpEnabled) {
          restartArpeggiator();
        }
        scheduleCodeUpdate();
      });
    }

    if ($loopToggle) {
      $loopToggle.addEventListener("change", function () {
        state.loopEnabled = $loopToggle.checked;
        scheduleCodeUpdate();
      });
    }
  }

  function getArpNotes() {
    // Collect all latched + held note MIDI values, sorted
    var notes = [];
    latchedNotes.forEach(function (midi) {
      notes.push(midi);
    });
    for (var idx in activeKeys) {
      if (activeKeys.hasOwnProperty(idx)) {
        var midi = midiNoteForIndex(parseInt(idx, 10));
        if (notes.indexOf(midi) === -1) {
          notes.push(midi);
        }
      }
    }
    notes.sort(function (a, b) { return a - b; });
    return notes;
  }

  function arpTick() {
    var notes = getArpNotes();
    if (notes.length === 0) {
      // Silence the last played arp note
      if (lastArpMidi !== null && browserVoice && typeof browserVoice.noteOff === "function") {
        browserVoice.noteOff(lastArpMidi);
        lastArpMidi = null;
      }
      return;
    }

    // Turn off previous arp note
    if (lastArpMidi !== null && browserVoice && typeof browserVoice.noteOff === "function") {
      browserVoice.noteOff(lastArpMidi);
    }

    // Determine next note index based on pattern
    if (arpNoteIndex >= notes.length) arpNoteIndex = 0;
    if (arpNoteIndex < 0) arpNoteIndex = notes.length - 1;

    var midi = notes[arpNoteIndex];

    // Play it
    ensureAudioInit().then(function () {
      if (!browserVoice) {
        browserVoice = createBrowserVoice(state.selectedVoice);
        syncParamsToVoice();
      }
      if (browserVoice && typeof browserVoice.noteOn === "function") {
        browserVoice.noteOn(midi);
      }
    });
    lastArpMidi = midi;

    // Advance index based on pattern
    if (state.arpPattern === "up") {
      arpNoteIndex++;
      if (arpNoteIndex >= notes.length) arpNoteIndex = 0;
    } else if (state.arpPattern === "down") {
      arpNoteIndex--;
      if (arpNoteIndex < 0) arpNoteIndex = notes.length - 1;
    } else if (state.arpPattern === "updown") {
      arpNoteIndex += arpDirection;
      if (arpNoteIndex >= notes.length) {
        arpDirection = -1;
        arpNoteIndex = Math.max(notes.length - 2, 0);
      } else if (arpNoteIndex < 0) {
        arpDirection = 1;
        arpNoteIndex = Math.min(1, notes.length - 1);
      }
    } else if (state.arpPattern === "random") {
      arpNoteIndex = Math.floor(Math.random() * notes.length);
    }
  }

  function startArpeggiator() {
    stopArpeggiator();
    if (!state.arpEnabled) return;
    var intervalMs = Math.round(60000 / state.arpSpeed);
    arpNoteIndex = 0;
    arpDirection = 1;
    arpIntervalId = setInterval(arpTick, intervalMs);
  }

  function stopArpeggiator() {
    if (arpIntervalId !== null) {
      clearInterval(arpIntervalId);
      arpIntervalId = null;
    }
    // Release last arp note
    if (lastArpMidi !== null && browserVoice && typeof browserVoice.noteOff === "function") {
      browserVoice.noteOff(lastArpMidi);
      lastArpMidi = null;
    }
  }

  function restartArpeggiator() {
    if (state.arpEnabled) {
      startArpeggiator();
    }
  }

  // =========================================================================
  // WAV files included by default (todbot wavetables)
  // =========================================================================

  // =========================================================================
  // Hardware checkboxes (MPR121, Accelerometer)
  // =========================================================================

  function initHardwareCheckboxes() {
     var $mpr121Enabled = document.getElementById("mpr121-enabled");
     var $accelEnabled  = document.getElementById("accel-enabled");
     var $mpr121Row     = document.getElementById("mpr121-row");
     var $mpr121Status  = document.getElementById("mpr121-status");
     var $accelRow      = document.getElementById("accel-row");
     var $accelStatus   = document.getElementById("accel-status");

       if ($mpr121Enabled) {
        $mpr121Enabled.addEventListener("change", function () {
          state.hardwareOptions.mpr121_enabled = $mpr121Enabled.checked;
          if ($mpr121Row) {
            if ($mpr121Enabled.checked) {
              $mpr121Row.classList.add("connected");
              if ($mpr121Status) $mpr121Status.textContent = "Connected";
            } else {
              $mpr121Row.classList.remove("connected");
              if ($mpr121Status) $mpr121Status.textContent = "Not connected";
            }
          }
          updateInputSourceDropdowns();
          updatePinout();
          scheduleCodeUpdate();
          updateRequirementsList();
        });
      }

      if ($accelEnabled) {
        $accelEnabled.addEventListener("change", function () {
          state.hardwareOptions.accelerometer_enabled = $accelEnabled.checked;
          if ($accelRow) {
            if ($accelEnabled.checked) {
              $accelRow.classList.add("connected");
              if ($accelStatus) $accelStatus.textContent = "Connected";
            } else {
              $accelRow.classList.remove("connected");
              if ($accelStatus) $accelStatus.textContent = "Not connected";
            }
          }
          if ($accelSliders) {
            if (state.hardwareOptions.accelerometer_enabled) {
              $accelSliders.classList.remove("hw-disabled");
            } else {
              $accelSliders.classList.add("hw-disabled");
            }
          }
          updateInputSourceDropdowns();
          updatePinout();
          scheduleCodeUpdate();
          updateRequirementsList();
        });
      }

     if ($accelSliders && !state.hardwareOptions.accelerometer_enabled) {
       $accelSliders.classList.add("hw-disabled");
     }
   }

  /** Update disabled state on all input source dropdowns based on hardware checkboxes */
  function updateInputSourceDropdowns() {
    var selects = document.querySelectorAll(".input-source");
    for (var s = 0; s < selects.length; s++) {
      var select = selects[s];
      var options = select.querySelectorAll("option");
      for (var o = 0; o < options.length; o++) {
        var opt = options[o];
        var val = opt.value;
        if (val.indexOf("mpr121_") === 0) {
          opt.disabled = !state.hardwareOptions.mpr121_enabled;
          if (opt.disabled && opt.selected) {
            select.value = "";
            // Remove from input map
            var paramName = select.id.replace("input-source-", "");
            delete state.inputMap[paramName];
          }
        }
        if (val === "accel_x" || val === "accel_y") {
          opt.disabled = !state.hardwareOptions.accelerometer_enabled;
          if (opt.disabled && opt.selected) {
            select.value = "";
            var pn = select.id.replace("input-source-", "");
            delete state.inputMap[pn];
          }
        }
      }
    }
  }

  // =========================================================================
  // Parameter panel rendering
  // =========================================================================

  function renderParamPanel() {
    var def = VOICES[state.selectedVoice];
    if (!def) return;

    var paletteEl = document.getElementById('param-palette');
    if (!paletteEl) return;

    paletteEl.innerHTML = '';
    paletteEl.className = 'palette-param-grid';
    palettePots = {};
    var params = def.params;

    for (var pName in params) {
      if (!params.hasOwnProperty(pName)) continue;
      var p = params[pName];

      var row = document.createElement('div');
      row.className = 'palette-param-row';
      row.setAttribute('draggable', 'true');
      row.setAttribute('data-param', pName);

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'palette-param-checkbox';
      cb.id = 'ws-check-' + pName;
      cb.title = 'Check to make adjustable';

      (function (paramName) {
        cb.addEventListener('change', function () {
          if (cb.checked) {
            if (hwZone) hwZone.addItem({ kind: 'param', paramName: paramName, x: 20, y: 20 });
          } else {
            if (hwZone) {
              for (var itemId in hwZone.items) {
                if (hwZone.items[itemId].paramName === paramName) {
                  hwZone.removeItem(itemId);
                  break;
                }
              }
            }
          }
        });
      })(pName);

      var info = document.createElement('div');
      info.className = 'palette-param-info';
      var nameEl = document.createElement('div');
      nameEl.className = 'palette-param-name';
      nameEl.textContent = p.label;
      info.appendChild(nameEl);

      if (p.type === 'continuous') {
        var rangeEl = document.createElement('div');
        rangeEl.className = 'palette-param-range';
        rangeEl.textContent = displayNum(p.min) + ' \u2013 ' + displayNum(p.max);
        info.appendChild(rangeEl);
      }

      row.appendChild(cb);

      if (p.type === 'continuous') {
        var currentVal = state.paramValues[pName] !== undefined ? state.paramValues[pName] : p.default;
        var pot = new CircularPot({
          name: pName,
          label: '',
          min: p.min,
          max: p.max,
          step: sliderStep(p.min, p.max),
          value: currentVal,
          color: CircularPot.COLOR_PURPLE,
          size: 40,
          onChange: function (name, val) {
            state.paramValues[name] = val;
            if (browserVoice && typeof browserVoice.setParam === 'function') {
              browserVoice.setParam(name, val);
            }
            if (hwZone) {
              for (var uid in hwZone.items) {
                if (hwZone.items[uid].paramName === name) {
                  hwZone.items[uid]._pot && hwZone.items[uid]._pot.setValue(val);
                  break;
                }
              }
            }
            scheduleCodeUpdate();
          }
        });
        row.appendChild(pot.node());
        palettePots[pName] = pot;
      } else if (p.type === 'trigger') {
        var trigBtn = document.createElement('button');
        trigBtn.type = 'button';
        trigBtn.className = 'btn btn-sm';
        trigBtn.textContent = '\u25b6';
        trigBtn.style.fontSize = '0.7rem';
        trigBtn.addEventListener('click', function () {
          ensureAudioInit().then(function () {
            if (browserVoice && typeof browserVoice.setParam === 'function') {
              browserVoice.setParam(pName, 1);
            }
          });
        });
        row.appendChild(trigBtn);
      }

      row.appendChild(info);

      row.addEventListener('dragstart', function (e) {
        var paramName = this.getAttribute('data-param');
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'param', name: paramName }));
        e.dataTransfer.effectAllowed = 'move';
        this.classList.add('dragging');
      });

      row.addEventListener('dragend', function () {
        this.classList.remove('dragging');
      });

      paletteEl.appendChild(row);
    }

    renderKeyPalette();
  }

  function syncPaletteToZone() {
    var rows = document.querySelectorAll('.palette-param-row');
    var inZone = {};
    if (hwZone) {
      for (var id in hwZone.items) {
        var it = hwZone.items[id];
        if (it.paramName) inZone[it.paramName] = true;
      }
    }
    for (var i = 0; i < rows.length; i++) {
      var pName = rows[i].getAttribute('data-param');
      var cb = rows[i].querySelector('.palette-param-checkbox');
      if (inZone[pName]) {
        rows[i].classList.add('in-workspace');
        if (cb) cb.checked = true;
      } else {
        rows[i].classList.remove('in-workspace');
        if (cb) cb.checked = false;
      }
    }
  }

  function renderKeyPalette() {
    var keyPaletteEl = document.getElementById('key-palette');
    if (!keyPaletteEl) return;
    keyPaletteEl.innerHTML = '';

    var allKeysBtn = document.createElement('div');
    allKeysBtn.className = 'palette-drag-all-keys';
    allKeysBtn.setAttribute('draggable', 'true');
    allKeysBtn.textContent = '\u266b Drag All Keys (Scale)';
    allKeysBtn.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'all-keys' }));
      e.dataTransfer.effectAllowed = 'move';
    });
    keyPaletteEl.appendChild(allKeysBtn);

    var keysRow = document.createElement('div');
    keysRow.className = 'palette-keys-row';

    for (var i = 0; i < 11; i++) {
      var keyDrag = document.createElement('div');
      keyDrag.className = 'palette-key-drag';
      keyDrag.setAttribute('draggable', 'true');
      keyDrag.setAttribute('data-key-index', i);
      keyDrag.textContent = noteNameForIndex(i);

      (function (idx) {
        keyDrag.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'key', keyIndex: idx }));
          e.dataTransfer.effectAllowed = 'move';
        });
      })(i);

      keysRow.appendChild(keyDrag);
    }

    keyPaletteEl.appendChild(keysRow);
  }

  // =========================================================================
  // Continuous inputs (Pots / Accel)
  // =========================================================================

  function wirePotSlider(potEl, potIdx, gpio) {
    if (!potEl) return;
    var $output = potEl.parentElement.querySelector("output");
    potEl.addEventListener("input", function () {
      var raw = parseInt(potEl.value, 10);
      if ($output) $output.textContent = raw;
      var normalized = raw / 1023;
      var potId = String.fromCharCode(97 + potIdx);
      var potLetter = potId;
      applyNormalizedInput("pot_" + potLetter, normalized);
    });
  }

  function createPotRow(potIdx, gpio) {
    var potId = String.fromCharCode(97 + potIdx);
    var rowDiv = document.createElement("div");
    rowDiv.className = "live-input-row";
    rowDiv.setAttribute("data-pot", String(potIdx));

    var label = document.createElement("label");
    label.textContent = "Pot " + potId.toUpperCase();

    var assignField = document.createElement("div");
    assignField.className = "assign-field";
    var gpioSelect = document.createElement("select");
    gpioSelect.className = "assign-gpio";
    gpioSelect.id = "pot-" + potIdx + "-gpio";
    var opts = [
      { value: "GP26", label: "GP26" },
      { value: "GP27", label: "GP27" },
      { value: "GP28", label: "GP28" }
    ];
    for (var oi = 0; oi < opts.length; oi++) {
      var opt = document.createElement("option");
      opt.value = opts[oi].value;
      opt.textContent = opts[oi].label;
      if (opts[oi].value === gpio) opt.selected = true;
      gpioSelect.appendChild(opt);
    }
    assignField.appendChild(gpioSelect);

    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1023";
    slider.value = "512";
    slider.id = "pot-" + potId;

    var output = document.createElement("output");
    output.id = "pot-" + potId + "-val";
    output.textContent = "512";

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-sm btn-remove";
    removeBtn.textContent = "Remove";
    removeBtn.style.marginLeft = "8px";

    removeBtn.addEventListener("click", function () {
      state.pots = state.pots.filter(function (p) { return p.id !== potId; });
      rowDiv.parentElement.removeChild(rowDiv);
      if ($addPotBtn) $addPotBtn.disabled = false;
      updatePinout();
      scheduleCodeUpdate();
    });

    rowDiv.appendChild(label);
    rowDiv.appendChild(assignField);
    rowDiv.appendChild(slider);
    rowDiv.appendChild(output);
    rowDiv.appendChild(removeBtn);

    wirePotSlider(slider, potIdx, gpio);

    gpioSelect.addEventListener("change", function () {
      updatePinout();
      scheduleCodeUpdate();
    });

    return { el: rowDiv, slider: slider, output: output, id: potId, gpio: gpio, gpioSelect: gpioSelect };
  }

  function initContinuousInputs() {
    if (!$potA) return;

    state.pots = [];

    var firstPotEl = $potA;
    var firstOutput = document.getElementById("pot-a-val");
    wirePotSlider(firstPotEl, 0, "GP26");
    state.pots.push({ id: "a", gpio: "GP26", el: $potA.parentElement, slider: $potA, output: firstOutput, gpioSelect: document.getElementById("pot-0-gpio") });

    if ($addPotBtn) {
      $addPotBtn.addEventListener("click", function () {
        var nextIdx = state.pots.length;
        if (nextIdx >= 3) return;

        var nextGpio = ["GP26", "GP27", "GP28"][nextIdx];
        var potRow = createPotRow(nextIdx, nextGpio);
        state.pots.push(potRow);

        if ($potList) {
          $potList.appendChild(potRow.el);
        }

        if (state.pots.length >= 3) {
          $addPotBtn.disabled = true;
        }

        updatePinout();
        scheduleCodeUpdate();
      });
    }

    var accels = [
      { slider: $accelX, output: $accelXVal, source: "accel_x" },
      { slider: $accelY, output: $accelYVal, source: "accel_y" }
    ];

    for (var j = 0; j < accels.length; j++) {
      (function (acc) {
        if (!acc.slider) return;
        acc.slider.addEventListener("input", function () {
          var raw = parseInt(acc.slider.value, 10);
          if (acc.output) acc.output.textContent = raw;
          var normalized = (raw + 1000) / 2000;
          applyNormalizedInput(acc.source, normalized);
        });
      })(accels[j]);
    }
  }

  /** Apply a normalized (0-1) input value to any param mapped to the given source */
  function applyNormalizedInput(source, normalized) {
    if (!browserVoice) return;

    for (var param in state.inputMap) {
      if (!state.inputMap.hasOwnProperty(param)) continue;
      var assignment = state.inputMap[param];
      if (!assignment || typeof assignment !== "object") continue;

      var inputType = assignment.type;
      var gpio = assignment.gpio;
      var matches = false;

      if (inputType === "POT" && source.indexOf("pot_") === 0) {
        var potIndex = source.charAt(4);
        if ((potIndex === "a" && gpio === "GP26") || (potIndex === "b" && gpio === "GP27") || (potIndex === "c" && gpio === "GP28")) {
          matches = true;
        }
      } else if (inputType === "LDR" && source.indexOf("ldr_") === 0) {
        var ldrIndex = source.charAt(4);
        if ((ldrIndex === "a" && gpio === "GP26") || (ldrIndex === "b" && gpio === "GP27") || (ldrIndex === "c" && gpio === "GP28")) {
          matches = true;
        }
      } else if (inputType === "Accel" && (source === "accel_x" || source === "accel_y")) {
        if ((source === "accel_x" && gpio === "X") || (source === "accel_y" && gpio === "Y")) {
          matches = true;
        }
      }

      if (!matches) continue;

      var def = VOICES[state.selectedVoice];
      if (!def || !def.params[param]) continue;
      var p = def.params[param];

      if (p.type === "continuous") {
        var val = mapRange(normalized, 0, 1, p.min, p.max);
        val = clamp(val, p.min, p.max);
        state.paramValues[param] = val;

        var slider = document.getElementById("param-slider-" + param);
        var valueDisp = document.getElementById("param-value-" + param);
        if (slider) slider.value = val;
        if (valueDisp) valueDisp.textContent = displayNum(val);

        if (typeof browserVoice.setParam === "function") {
          browserVoice.setParam(param, val);
        }
      }
    }
  }

  // =========================================================================
  // Waveform animation
  // =========================================================================

  function initWaveformAnimation() {
    if (!$waveformCanvas) return;
    var ctx = $waveformCanvas.getContext("2d");
    var w = $waveformCanvas.width;
    var h = $waveformCanvas.height;

    // Colors from CSS scheme (dark mode)
    var primaryColor = "#8B5CF6";

    var dataArray = null;
    var bufferLength = 0;

    function draw() {
      animFrameId = requestAnimationFrame(draw);

      var analyser = SynthEngine.getAnalyser();
      if (!analyser) {
        // Draw idle line
        ctx.clearRect(0, 0, w, h);
        ctx.beginPath();
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.3;
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        drawOledMirrors(null, null);
        return;
      }

      if (!dataArray || bufferLength !== analyser.fftSize) {
        bufferLength = analyser.fftSize;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
      }

      analyser.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, w, h);

      // Background glow
      var gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, "rgba(139, 92, 246, 0.08)");
      gradient.addColorStop(0.5, "rgba(96, 165, 250, 0.1)");
      gradient.addColorStop(1, "rgba(167, 139, 250, 0.08)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // Main waveform
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = primaryColor;

      var sliceWidth = w / dataArray.length;
      var x = 0;

      for (var i = 0; i < dataArray.length; i++) {
        var v = dataArray[i] / 128.0;
        var y = (v * h) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.stroke();

      // Secondary glow line (slightly offset, lower opacity)
      ctx.beginPath();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(167, 139, 250, 0.2)";
      x = 0;
      for (var j = 0; j < dataArray.length; j++) {
        var v2 = dataArray[j] / 128.0;
        var y2 = (v2 * h) / 2;
        if (j === 0) {
          ctx.moveTo(x, y2);
        } else {
          ctx.lineTo(x, y2);
        }
        x += sliceWidth;
      }
      ctx.stroke();

      drawOledMirrors(analyser, dataArray);
    }

    function drawOledMirrors(analyserNode, sourceDataArray) {
      var oledCanvases = document.querySelectorAll('.hw-oled-canvas');
      if (!oledCanvases.length) return;

      for (var ci = 0; ci < oledCanvases.length; ci++) {
        var oc = oledCanvases[ci];
        var octx = oc.getContext("2d");
        var ow = oc.width;
        var oh = oc.height;

        octx.fillStyle = "#000";
        octx.fillRect(0, 0, ow, oh);

        if (!analyserNode || !sourceDataArray) {
          octx.strokeStyle = "#14B8A6";
          octx.lineWidth = 1;
          octx.globalAlpha = 0.3;
          octx.beginPath();
          octx.moveTo(0, oh / 2);
          octx.lineTo(ow, oh / 2);
          octx.stroke();
          octx.globalAlpha = 1;
          continue;
        }

        octx.beginPath();
        octx.lineWidth = 1.5;
        octx.strokeStyle = "#14B8A6";
        var oSlice = ow / sourceDataArray.length;
        var ox = 0;
        for (var oi = 0; oi < sourceDataArray.length; oi++) {
          var ov = sourceDataArray[oi] / 128.0;
          var oy = (ov * oh) / 2;
          if (oi === 0) octx.moveTo(ox, oy);
          else octx.lineTo(ox, oy);
          ox += oSlice;
        }
        octx.stroke();
      }
    }

    draw();
  }

  // =========================================================================
  // Pinout update
  // =========================================================================

  function updatePinout() {
    if (!window.PinoutGenerator) return;

    var activeConnections;
    if (hwZone) {
      activeConnections = hwZone.getActiveConnections();
    } else {
      activeConnections = { buttons: null, analog: null, i2c: null, audio: true, led: false, oled: false, mpr121: false, accelerometer: false };
    }

    activeConnections.audio = true;
    PinoutGenerator.render("pinout-container", activeConnections);
  }

  // =========================================================================
  // Code generation
  // =========================================================================

  var codeUpdateTimer = null;

   function scheduleCodeUpdate() {
    if (codeUpdateTimer) clearTimeout(codeUpdateTimer);
    codeUpdateTimer = setTimeout(function () {
      updateCodeOutput();
      updateRequirementsList();
    }, 150);
  }

  function generatePythonCode() {
    var voiceKey = state.selectedVoice;
    var def = VOICES[voiceKey];
    if (!def) return "# No voice selected";

    var lines = [];

    // Header
    lines.push("# ============================================================================");
    lines.push("# PICO 2 SYNTH WORKSHOP v2 -- code.py");
    lines.push("# Synth voices adapted from todbot's circuitpython-synthio-tricks");
    lines.push("# Original synth code by Tod Kurt (@todbot)");
    lines.push("# https://github.com/todbot/circuitpython-synthio-tricks");
    lines.push("# Workshop adaptation by Drc3p0");
    lines.push("# ============================================================================");
    lines.push("#");
    lines.push("# Voice: " + def.label);
    lines.push("# ============================================================================");
    lines.push("");

    // CONFIG dict
    lines.push("CONFIG = {");
    lines.push('    # ---- Board Type ----');
    lines.push('    "board": "' + state.boardType + '",');
    lines.push('    "pull_mode": "' + (state.boardType === "pico2" ? "DOWN" : "UP") + '",');
    lines.push("");
    lines.push('    # ---- Voice Selection ----');
    lines.push('    "voice": "' + voiceKey + '",');
    lines.push('    "polyphony": "' + (def.polyphony || "poly") + '",');
    lines.push("");
    lines.push('    # ---- Scale ----');
    lines.push('    "scale": "' + state.currentScale + '",');
    lines.push('    "octave": ' + state.currentOctave + ',');
    lines.push("");
    lines.push('    # ---- Arpeggiator ----');
    lines.push('    "arp_enabled": ' + (state.arpEnabled ? "True" : "False") + ',');
    lines.push('    "arp_pattern": "' + state.arpPattern + '",');
    lines.push('    "arp_speed": ' + state.arpSpeed + ',');
    lines.push('    "loop_enabled": ' + (state.loopEnabled ? "True" : "False") + ',');
    lines.push("");
    lines.push('    # ---- Wavetable Source ----');
    lines.push('    "use_wav": ' + (state.useWav ? "True" : "False") + ',');
    lines.push("");
    lines.push('    # ---- Input Assignments ----');
    lines.push('    "input_map": {');

    var wsState = state.workspaceState || { params: {}, keys: {} };
    var wsParams = wsState.params || {};

    for (var pName in wsParams) {
      if (!wsParams.hasOwnProperty(pName)) continue;
      var ws = wsParams[pName];
      if (!ws.adjustable || !ws.hwType || !ws.gpio) continue;
      var srcName = '';
      if (ws.hwType === 'pot') srcName = 'pot_' + String.fromCharCode(97 + GPIO_POT_PINS.indexOf(ws.gpio));
      else if (ws.hwType === 'ldr') srcName = 'ldr_' + String.fromCharCode(97 + GPIO_POT_PINS.indexOf(ws.gpio));
      else if (ws.hwType === 'button') srcName = 'button_' + ws.gpio.replace('GP', '');
      else if (ws.hwType === 'touch_native') srcName = 'touch_native_' + ws.gpio.replace('GP', '');
      else if (ws.hwType === 'touch_mpr121') srcName = 'mpr121_' + ws.gpio;
      else if (ws.hwType === 'accel') srcName = 'accel_' + ws.gpio.toLowerCase();
      if (srcName) {
        lines.push('        "' + pName + '": {"type": "' + ws.hwType + '", "gpio": "' + ws.gpio + '", "source": "' + srcName + '"},');
      }
    }

    var mapKeys = Object.keys(state.inputMap);
    for (var m = 0; m < mapKeys.length; m++) {
      var mKey = mapKeys[m];
      if (wsParams[mKey]) continue;
      var mVal = state.inputMap[mKey];
      if (!mVal || typeof mVal !== "object") continue;
      lines.push('        "' + mKey + '": {"type": "' + mVal.type + '", "gpio": "' + (mVal.gpio || "") + '"},');
    }

    lines.push("    },");
    lines.push("");

    var wsKeys = wsState.keys || {};
    lines.push('    # ---- Key Mapping ----');
    lines.push('    "key_map": {');
    for (var kId in wsKeys) {
      if (!wsKeys.hasOwnProperty(kId)) continue;
      var kc = wsKeys[kId];
      if (!kc.hwType) continue;
      var gpioList = Object.keys(kc.gpioAssignments || {});
      lines.push('        "' + kId + '": {"type": "' + kc.hwType + '", "sweep": ' + (kc.sweepMode ? 'True' : 'False') + ', "gpio": ' + JSON.stringify(gpioList) + '},');
    }
    lines.push("    },");
    lines.push("");

    // GPIO assignments
    lines.push('    # ---- GPIO Assignments ----');
    lines.push('    "gpio_map": {');
    for (var gField in state.assignMap) {
      if (!state.assignMap.hasOwnProperty(gField)) continue;
      var ga = state.assignMap[gField];
      if (!ga || ga.type === "none") continue;
      lines.push('        "' + gField + '": {"type": "' + ga.type + '", "gpio": "' + (ga.gpio || "") + '"},');
    }
    lines.push("    },");
    lines.push("");

    // Parameter defaults
    lines.push("    # ---- Voice Parameters ----");
    for (var pName in def.params) {
      if (!def.params.hasOwnProperty(pName)) continue;
      var p = def.params[pName];
      if (p.type === "continuous") {
        var val = state.paramValues[pName] !== undefined ? state.paramValues[pName] : p.default;
        var isAdjustable = wsParams[pName] && wsParams[pName].adjustable;
        var marker = isAdjustable ? "(adjustable via " + (wsParams[pName].hwType || "?") + ")" : "(hard-set)";
        lines.push('    "' + pName + '": ' + displayNum(val) + ',  # ' + marker + ' range: ' + displayNum(p.min) + ' - ' + displayNum(p.max));
      }
    }
    lines.push("");

    // Hardware
    lines.push('    # ---- Hardware Options ----');
    lines.push('    "mpr121_enabled": ' + (state.hardwareOptions.mpr121_enabled ? "True" : "False") + ',');
    lines.push('    "accelerometer_enabled": ' + (state.hardwareOptions.accelerometer_enabled ? "True" : "False") + ',');
    lines.push("");

    // Audio
    lines.push('    # ---- Audio ----');
    lines.push('    "sample_rate": 28000,');
    lines.push('    "audio_pin": "GP13",');
    lines.push("}");
    lines.push("");
    lines.push("");

    // Engine bootstrap
    lines.push("# ============================================================================");
    lines.push("# Engine -- don't edit below this line");
    lines.push("# ============================================================================");
    lines.push("");
    lines.push("import time");
    lines.push("import board");
    lines.push("import audiopwmio");
    lines.push("import audiomixer");
    lines.push("import synthio");
    lines.push("");
    lines.push("from lib.helpers import map_range, clamp");
    lines.push("from lib.inputs import InputManager");
    lines.push("from lib.led_indicator import LEDIndicator");
    lines.push("from lib.voices import load_voice");
    lines.push("");
    lines.push("# --- Audio Setup ---");
    lines.push('SAMPLE_RATE = CONFIG.get("sample_rate", 28000)');
    lines.push('audio_pin = getattr(board, CONFIG.get("audio_pin", "GP13"))');
    lines.push("audio = audiopwmio.PWMAudioOut(audio_pin)");
    lines.push("");
    lines.push("mixer = audiomixer.Mixer(channel_count=1, sample_rate=SAMPLE_RATE, buffer_size=4096)");
    lines.push("synth = synthio.Synthesizer(channel_count=1, sample_rate=SAMPLE_RATE)");
    lines.push("mixer.voice[0].play(synth)");
    lines.push("audio.play(mixer)");
    lines.push("mixer.voice[0].level = 0.85");
    lines.push("");
    lines.push("# --- Inputs ---");
    lines.push("inputs = InputManager(CONFIG)");
    lines.push("i2c = inputs.init_i2c()");
    lines.push("");
    lines.push("# --- LED Indicator ---");
    lines.push("led = LEDIndicator()");
    lines.push("");
    lines.push("# --- Load Voice ---");
    lines.push('voice = load_voice(CONFIG.get("voice", "eighties_dystopia"), synth, CONFIG)');
    lines.push("");
    lines.push("# --- Input Mapping ---");
    lines.push('input_map = CONFIG.get("input_map", {})');
    lines.push("");
    lines.push("");
    lines.push("def _get_input_value(source_name):");
    lines.push('    """Read a named input source and return its normalized value."""');
    lines.push('    if source_name.startswith("pot_") or source_name.startswith("ldr_"):');
    lines.push('        idx = ord(source_name[-1]) - ord("a")');
    lines.push("        return inputs.get_analog(idx)");
    lines.push('    elif source_name == "accel_x":');
    lines.push("        x, _ = inputs.get_accel()");
    lines.push("        return (x + 1.0) / 2.0");
    lines.push('    elif source_name == "accel_y":');
    lines.push("        _, y = inputs.get_accel()");
    lines.push("        return (y + 1.0) / 2.0");
    lines.push('    elif source_name.startswith("mpr121_"):');
    lines.push('        ch = int(source_name.split("_")[1])');
    lines.push("        touched = inputs.get_mpr121_touched()");
    lines.push("        return 1.0 if ch in touched else 0.0");
    lines.push('    elif source_name.startswith("button_"):');
    lines.push("        return None");
    lines.push("    return None");
    lines.push("");
    lines.push("");
    lines.push("# --- Main Loop ---");
    lines.push('print("Pico 2 Synth Workshop v2")');
    lines.push('print("Voice:", voice.name)');
    lines.push("");
    lines.push("while True:");
    lines.push("    # Process button events");
    lines.push("    for btn_idx, pressed in inputs.get_button_events():");
    lines.push("        led.pulse()");
    lines.push("");
    lines.push('        btn_source = "button_{}".format(btn_idx)');
    lines.push("        for param_name, source in input_map.items():");
    lines.push("            if source == btn_source:");
    lines.push("                param_info = voice.get_params().get(param_name, {})");
    lines.push('                if param_info.get("type") == "trigger" and pressed:');
    lines.push("                    voice.set_param(param_name, 1)");
    lines.push("");
    lines.push("        if btn_source not in input_map.values():");
    lines.push("            scale = [0, 4, 7, 12, -5, -12, 5, 9]");
    lines.push("            midi_note = 48 + (scale[btn_idx % len(scale)])");
    lines.push("            if pressed:");
    lines.push("                voice.note_on(midi_note)");
    lines.push("            else:");
    lines.push("                voice.note_off(midi_note)");
    lines.push("");
    lines.push("    # Process MPR121 touch events");
    lines.push("    if inputs.mpr121:");
    lines.push("        for ch, pressed in inputs.mpr121.get_events():");
    lines.push("            led.pulse()");
    lines.push('            touch_source = "mpr121_{}".format(ch)');
    lines.push("            for param_name, source in input_map.items():");
    lines.push("                if source == touch_source:");
    lines.push("                    if pressed:");
    lines.push("                        voice.set_param(param_name, 1)");
    lines.push("            if touch_source not in input_map.values():");
    lines.push("                midi_note = 48 + ch");
    lines.push("                if pressed:");
    lines.push("                    voice.note_on(midi_note)");
    lines.push("                else:");
    lines.push("                    voice.note_off(midi_note)");
    lines.push("");
    lines.push("    # Process continuous inputs");
    lines.push("    for param_name, source in input_map.items():");
    lines.push("        val = _get_input_value(source)");
    lines.push("        if val is not None:");
    lines.push("            param_info = voice.get_params().get(param_name, {})");
    lines.push('            if param_info.get("type") == "continuous":');
    lines.push('                p_min = param_info.get("min", 0)');
    lines.push('                p_max = param_info.get("max", 1)');
    lines.push("                mapped = map_range(val, 0.0, 1.0, p_min, p_max)");
    lines.push("                voice.set_param(param_name, mapped)");
    lines.push("");
    lines.push("    # Activity LED");
    lines.push("    if inputs.any_activity():");
    lines.push("        led.pulse()");
    lines.push("    led.update()");
    lines.push("");
    lines.push("    # Voice update");
    lines.push("    voice.update()");
    lines.push("");
    lines.push("    time.sleep(0.005)");

    return lines.join("\n");
  }

  // =========================================================================
  // Syntax highlighting (Python)
  // =========================================================================

  function highlightPython(code) {
    var escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    var lines = escaped.split("\n");
    var result = [];
    for (var i = 0; i < lines.length; i++) {
      result.push(highlightPythonLine(lines[i]));
    }
    return result.join("\n");
  }

  function highlightPythonLine(line) {
    var trimmed = line.replace(/^\s+/, "");
    if (trimmed.indexOf("#") === 0) {
      return '<span class="syn-comment">' + line + '</span>';
    }

    var result = "";
    var idx = 0;
    var len = line.length;

    while (idx < len) {
      // Inline comment
      if (line[idx] === "#") {
        result += '<span class="syn-comment">' + line.substring(idx) + '</span>';
        break;
      }

      // Strings
      if (line[idx] === '"' || line[idx] === "'") {
        var quote = line[idx];
        var strEnd = idx + 1;
        while (strEnd < len && line[strEnd] !== quote) {
          if (line[strEnd] === "\\") strEnd++;
          strEnd++;
        }
        if (strEnd < len) strEnd++;
        result += '<span class="syn-string">' + line.substring(idx, strEnd) + '</span>';
        idx = strEnd;
        continue;
      }

      // Numbers
      var numMatch = line.substring(idx).match(/^(\b\d+\.?\d*\b)/);
      if (numMatch && (idx === 0 || /[\s,=:([\]{}+\-*/]/.test(line[idx - 1]))) {
        result += '<span class="syn-number">' + numMatch[1] + '</span>';
        idx += numMatch[1].length;
        continue;
      }

      // Keywords
      var kwMatch = line.substring(idx).match(
        /^(import|from|if|else|elif|for|while|in|not|and|or|is|def|class|return|try|except|finally|with|as|pass|break|continue|yield|raise|assert|del|global|nonlocal|lambda)\b/
      );
      if (kwMatch && (idx === 0 || /[\s,=:([\]{}]/.test(line[idx - 1]))) {
        result += '<span class="syn-keyword">' + kwMatch[1] + '</span>';
        idx += kwMatch[1].length;
        continue;
      }

      // Builtins
      var builtinMatch = line.substring(idx).match(
        /^(True|False|None|print|len|range|int|float|str|list|dict|tuple|set|getattr|format|ord|Exception)\b/
      );
      if (builtinMatch && (idx === 0 || /[\s,=:([\]{}]/.test(line[idx - 1]))) {
        result += '<span class="syn-builtin">' + builtinMatch[1] + '</span>';
        idx += builtinMatch[1].length;
        continue;
      }

      result += line[idx];
      idx++;
    }

    return result;
  }

   // =========================================================================
  // Code output rendering
  // =========================================================================

  function updateCodeOutput() {
    if (!$codeOutput) return;
    var code = generatePythonCode();
    $codeOutput.innerHTML = highlightPython(code);
  }

  // =========================================================================
  // Requirements list generation
  // =========================================================================

  function updateRequirementsList() {
    if (!$requirementsList) return;

    var html = "";

    // Firmware
    var boardName = state.boardType === "pico2" ? "Pico 2 (RP2350)" : "Pico (RP2040)";
    var uf2Name = state.boardType === "pico2" ? "pico2-latest.uf2" : "pico-latest.uf2";
    html += "<div><strong>1. Firmware:</strong> <code>" + uf2Name + "</code> (" + boardName + ")</div>";

    // Code files
    html += "<div><strong>2. Code files:</strong>";
    html += "<ul><li><code>code.py</code> (main program)</li>";
    html += "<li><code>synth-config.json</code> (configuration backup)</li></ul></div>";

    // Libraries
    var libs = ["adafruit_bus_device", "adafruit_midi"];
    if (state.hardwareOptions.mpr121_enabled) {
      libs.push("adafruit_mpr121");
    }
    if (state.hardwareOptions.accelerometer_enabled) {
      libs.push("adafruit_lis3dh");
    }

    html += "<div><strong>3. Libraries (from ";
    html += "<a href='https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases' target='_blank'>Adafruit library bundle</a>";
    html += "):</strong><ul>";
    for (var i = 0; i < libs.length; i++) {
      html += "<li><code>" + libs[i] + ".mpy</code></li>";
    }
    html += "</ul></div>";

    // WAV files
    if (state.useWav) {
      html += "<div><strong>4. Media:</strong> <code>wav/</code> folder (wavetable samples)</div>";
    }

    $requirementsList.innerHTML = html;
  }

  // =========================================================================
  // JSON config generation
  // =========================================================================

  function generateJsonConfig() {
    var def = VOICES[state.selectedVoice];
    var config = {
      board: state.boardType,
      pull_mode: state.boardType === "pico2" ? "DOWN" : "UP",
      voice: state.selectedVoice,
      voice_label: def ? def.label : "",
      polyphony: def ? (def.polyphony || "poly") : "poly",
      scale: state.currentScale,
      octave: state.currentOctave,
      arp_enabled: state.arpEnabled,
      arp_pattern: state.arpPattern,
      arp_speed: state.arpSpeed,
      loop_enabled: state.loopEnabled,
      use_wav: state.useWav,
      input_map: {},
      gpio_map: {},
      param_values: {},
      hardware_options: {
        mpr121_enabled: state.hardwareOptions.mpr121_enabled,
        accelerometer_enabled: state.hardwareOptions.accelerometer_enabled
      },
      audio: {
        sample_rate: 28000,
        audio_pin: "GP13"
      },
      workspace: state.workspaceState || { params: {}, keys: {} }
    };

    for (var k in state.inputMap) {
      if (state.inputMap.hasOwnProperty(k) && state.inputMap[k] && typeof state.inputMap[k] === "object") {
        config.input_map[k] = state.inputMap[k];
      }
    }

    for (var gf in state.assignMap) {
      if (state.assignMap.hasOwnProperty(gf) && state.assignMap[gf] && state.assignMap[gf].type !== "none") {
        config.gpio_map[gf] = state.assignMap[gf];
      }
    }

    if (def) {
      for (var pName in def.params) {
        if (!def.params.hasOwnProperty(pName)) continue;
        if (def.params[pName].type === "continuous") {
          config.param_values[pName] = state.paramValues[pName] !== undefined
            ? state.paramValues[pName]
            : def.params[pName].default;
        }
      }
    }

    return config;
  }

   // =========================================================================
  // Copy / Download buttons
  // =========================================================================

  function generateInstructionsText() {
    var boardName = state.boardType === "pico2" ? "Pico 2 (RP2350)" : "Pico (RP2040)";
    var uf2Name = state.boardType === "pico2" ? "pico2-latest.uf2" : "pico-latest.uf2";

    var libs = ["adafruit_bus_device", "adafruit_midi"];
    if (state.hardwareOptions.mpr121_enabled) {
      libs.push("adafruit_mpr121");
    }
    if (state.hardwareOptions.accelerometer_enabled) {
      libs.push("adafruit_lis3dh");
    }

    var lines = [];
    lines.push("==============================================================================");
    lines.push("PICO 2 SYNTH WORKSHOP v2 -- Setup Instructions");
    lines.push("==============================================================================");
    lines.push("");
    lines.push("STEP 1: Install Firmware");
    lines.push("-----------------------");
    lines.push("1. Download CircuitPython for your board:");
    lines.push("   - Board: " + boardName);
    lines.push("   - Filename: " + uf2Name);
    lines.push("   - Download from: https://circuitpython.org/downloads");
    lines.push("");
    lines.push("2. Put your Pico in bootloader mode:");
    lines.push("   - Hold BOOTSEL button while plugging in USB");
    lines.push("   - A mass storage device should appear");
    lines.push("");
    lines.push("3. Drag the .uf2 file onto the mass storage device");
    lines.push("4. The Pico will reboot with CircuitPython installed");
    lines.push("");
    lines.push("STEP 2: Copy Code Files");
    lines.push("----------------------");
    lines.push("1. The Pico will now appear as 'CIRCUITPY' drive");
    lines.push("2. Copy the following files to the CIRCUITPY drive:");
    lines.push("   - code.py (main program)");
    lines.push("   - synth-config.json (configuration)");
    lines.push("");
    lines.push("STEP 3: Install Libraries");
    lines.push("------------------------");
    lines.push("1. Download the Adafruit CircuitPython library bundle:");
    lines.push("   https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases");
    lines.push("");
    lines.push("2. Extract the bundle and copy these .mpy files to");
    lines.push("   CIRCUITPY/lib/:");
    for (var i = 0; i < libs.length; i++) {
      lines.push("   - " + libs[i] + ".mpy");
    }
    lines.push("");

    if (state.useWav) {
      lines.push("STEP 4: Copy Wavetable Samples");
      lines.push("------------------------------");
      lines.push("1. Create a 'wav' folder on the CIRCUITPY drive");
      lines.push("2. Copy your .wav wavetable files into this folder");
      lines.push("3. Update synth-config.json if using non-standard filenames");
      lines.push("");
    }

    lines.push("STEP 5: Verify Installation");
    lines.push("---------------------------");
    lines.push("1. Open a terminal/serial monitor at 115200 baud");
    lines.push("2. You should see startup messages like:");
    lines.push("   Pico 2 Synth Workshop v2");
    lines.push("   Voice: [your selected voice]");
    lines.push("");
    lines.push("That's it! Your synth is ready to use.");
    lines.push("");
    lines.push("==============================================================================");

    return lines.join("\n");
  }

   function initActionButtons() {
    if ($btnCopyCode) {
      $btnCopyCode.addEventListener("click", function () {
        var code = generatePythonCode();
        copyToClipboard(code).then(function () {
          var original = $btnCopyCode.textContent;
          $btnCopyCode.textContent = "Copied!";
          $btnCopyCode.classList.add("copied");
          setTimeout(function () {
            $btnCopyCode.textContent = original;
            $btnCopyCode.classList.remove("copied");
          }, 2000);
        });
      });
    }

    if ($btnDownloadCode) {
      $btnDownloadCode.addEventListener("click", function () {
        var code = generatePythonCode();
        downloadFile("code.py", code, "text/x-python");
      });
    }

    if ($btnDownloadJson) {
      $btnDownloadJson.addEventListener("click", function () {
        var json = JSON.stringify(generateJsonConfig(), null, 2);
        downloadFile("synth-config.json", json, "application/json");
      });
    }

    if ($btnDownloadBundle) {
      $btnDownloadBundle.addEventListener("click", function () {
        downloadBundle();
      });
    }
  }

  function downloadBundle() {
    var code = generatePythonCode();
    var json = JSON.stringify(generateJsonConfig(), null, 2);
    var instructions = generateInstructionsText();

    if (typeof JSZip !== "undefined") {
      var zip = new JSZip();
      zip.file("code.py", code);
      zip.file("synth-config.json", json);
      zip.file("INSTRUCTIONS.txt", instructions);

      zip.generateAsync({ type: "blob" }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "pico-synth-bundle.zip";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      });
    } else {
      downloadFile("INSTRUCTIONS.txt", instructions, "text/plain");
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      resolve();
    });
  }

  function downloadFile(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // =========================================================================
  // Serial integration
  // =========================================================================

  function initSerial() {
    if (!window.PicoSerial) return;

    if ($btnConnectPico) {
      $btnConnectPico.addEventListener("click", function () {
        if (PicoSerial.isConnected()) {
          PicoSerial.disconnect();
        } else {
          connectAndSync();
        }
      });
    }

    if ($btnSaveDevice) {
      $btnSaveDevice.addEventListener("click", function () {
        saveConfigToDevice();
      });
    }

    PicoSerial.onStatus(function (info) {
      if ($serialStatus) {
        $serialStatus.className = "serial-status-dot " + info.status;
      }
      if ($btnConnectPico) {
        if (info.connected) {
          $btnConnectPico.textContent = "Disconnect";
          if ($btnSaveDevice) $btnSaveDevice.style.display = "";
          if ($inputActivity) $inputActivity.classList.add("visible");
        } else {
          $btnConnectPico.textContent = "Connect";
          if ($btnSaveDevice) $btnSaveDevice.style.display = "none";
          if ($inputActivity) { $inputActivity.classList.remove("visible"); $inputActivity.classList.remove("active"); }
        }
      }
    });

    PicoSerial.onData(function (data) {
      if (!data || data._raw || data.resp) return;
      if (data.mon) {
        handleMonitorData(data);
        var hasActivity = !!data.act;
        if (!hasActivity && data.btn) {
          for (var bi = 0; bi < data.btn.length; bi++) {
            if (data.btn[bi]) { hasActivity = true; break; }
          }
        }
        if (hasActivity && $inputActivity) {
          $inputActivity.classList.add("active");
          clearTimeout(_activityTimer);
          _activityTimer = setTimeout(function () {
            if ($inputActivity) $inputActivity.classList.remove("active");
          }, 200);
        }
      }
    });
  }

  function buildDeviceConfig() {
    var voiceKey = state.selectedVoice;
    var inputMap = {};

    if (hwZone) {
      for (var id in hwZone.items) {
        var it = hwZone.items[id];
        if (!it.paramName || !it.hwType || !it.gpio) continue;
        var src = null;
        if (it.hwType === "pot") {
          var gpioNum = (it.gpio || "").replace("GP", "");
          if (gpioNum === "26") src = "pot_a";
          else if (gpioNum === "27") src = "pot_b";
          else if (gpioNum === "28") src = "pot_c";
        } else if (it.hwType === "ldr") {
          var ldrNum = (it.gpio || "").replace("GP", "");
          if (ldrNum === "26") src = "ldr_a";
          else if (ldrNum === "27") src = "ldr_b";
          else if (ldrNum === "28") src = "ldr_c";
        } else if (it.hwType === "button") {
          var btnPin = (it.gpio || "").replace("GP", "");
          src = "button_" + btnPin;
        } else if (it.hwType === "accel") {
          src = "accel_x";
        } else if (it.hwType === "touch_native") {
          var touchPin = (it.gpio || "").replace("GP", "");
          src = "touch_" + touchPin;
        } else if (it.hwType === "touch_mpr121") {
          var mprCh = (it.gpio || "").replace("CH", "");
          src = "mpr121_" + mprCh;
        }
        if (src) inputMap[it.paramName] = src;
      }
    }

    var hasAccel = false;
    var hasMpr121 = false;
    var hasOled = false;
    var touchPins = [];
    var buttonPins = [];
    var analogPins = [];
    var accelDeadZone = 5;
    var accelSmoothing = 25;
    if (hwZone) {
      var conns = hwZone.getActiveConnections();
      hasAccel = !!conns.accelerometer;
      hasMpr121 = !!conns.mpr121;
      hasOled = !!conns.oled;
      for (var tid in hwZone.items) {
        var ti = hwZone.items[tid];
        if (ti.hwType === "touch_native" && ti.gpio) {
          var gpios = Array.isArray(ti.gpio) ? ti.gpio : [ti.gpio];
          for (var tg = 0; tg < gpios.length; tg++) {
            if (gpios[tg] && touchPins.indexOf(gpios[tg]) === -1)
              touchPins.push(gpios[tg]);
          }
        }
        if (ti.hwType === "button" && ti.gpio) {
          var bGpios = Array.isArray(ti.gpio) ? ti.gpio : [ti.gpio];
          for (var bg = 0; bg < bGpios.length; bg++) {
            if (bGpios[bg] && buttonPins.indexOf(bGpios[bg]) === -1)
              buttonPins.push(bGpios[bg]);
          }
        }
        if ((ti.hwType === "pot" || ti.hwType === "ldr") && ti.gpio) {
          if (analogPins.indexOf(ti.gpio) === -1)
            analogPins.push(ti.gpio);
        }
        if (ti.hwType === "accel" && ti.config) {
          accelDeadZone = ti.config.deadZone !== undefined ? ti.config.deadZone : 5;
          accelSmoothing = ti.config.smoothing !== undefined ? ti.config.smoothing : 25;
        }
      }
    }

    return {
      voice: voiceKey,
      self_play: false,
      input_map: inputMap,
      touch_pins: touchPins,
      button_pins: buttonPins,
      analog_pins: analogPins,
      extended_buttons: false,
      mpr121_enabled: hasMpr121,
      mpr121_boards: 1,
      accelerometer_enabled: hasAccel,
      accel_dead_zone: accelDeadZone,
      accel_smoothing: accelSmoothing,
      oled_enabled: hasOled,
      use_wav: true,
      effects_enabled: false,
      sample_rate: 28000,
      audio_pin: "GP13"
    };
  }

  async function connectAndSync() {
    var ok = await PicoSerial.connect();
    if (!ok) return;

    var pong = await PicoSerial.ping();
    if (!pong) {
      console.warn("Device did not respond to ping");
      return;
    }
    console.log("Connected to:", pong.version);

    var deviceConfig = await PicoSerial.getConfig();
    if (deviceConfig) {
      console.log("Loaded config from device");
    }

    var config = buildDeviceConfig();
    await PicoSerial.putConfig(config);
    console.log("Pushed zone config to device");
  }

  async function saveConfigToDevice() {
    if (!PicoSerial.isConnected()) return;
    var config = buildDeviceConfig();
    var ok = await PicoSerial.putConfig(config);
    if (!ok) {
      console.error("Failed to push config");
      return;
    }
    var saved = await PicoSerial.saveToFlash();
    if (saved) {
      if ($btnSaveDevice) {
        $btnSaveDevice.textContent = "Saved!";
        setTimeout(function () { $btnSaveDevice.textContent = "Save to Device"; }, 2000);
      }
    }
  }

  handleMonitorData = function(data) {
    if (!hwZone) return;

    for (var id in hwZone.items) {
      var item = hwZone.items[id];
      if (!item.hwType) continue;

      if (item.hwType === "accel") {
        if (data.accel && Array.isArray(data.accel) && data.accel.length >= 2) {
          var params2 = hwZone.getVoiceParams();
          var def2 = params2[item.paramName] || {};
          var aMin = def2.min !== undefined ? def2.min : 0;
          var aMax = def2.max !== undefined ? def2.max : 1023;

          var cfg = item.config || {};
          var deadPct = (cfg.deadZone || 0) / 100.0;
          var smoothAlpha = 1.0 - (cfg.smoothing || 0) / 100.0;

          var rawX = data.accel[0];
          var rawY = data.accel[1];

          if (Math.abs(rawX) < deadPct) rawX = 0;
          else rawX = (rawX - Math.sign(rawX) * deadPct) / (1.0 - deadPct);
          if (Math.abs(rawY) < deadPct) rawY = 0;
          else rawY = (rawY - Math.sign(rawY) * deadPct) / (1.0 - deadPct);

          if (item._smoothX === undefined) { item._smoothX = rawX; item._smoothY = rawY; }
          item._smoothX += (rawX - item._smoothX) * smoothAlpha;
          item._smoothY += (rawY - item._smoothY) * smoothAlpha;

          var xNorm = (item._smoothX + 1.0) / 2.0;
          var yNorm = (item._smoothY + 1.0) / 2.0;
          xNorm = Math.max(0, Math.min(1, xNorm));
          yNorm = Math.max(0, Math.min(1, yNorm));

          var mappedX = aMin + xNorm * (aMax - aMin);
          var mappedY = aMin + yNorm * (aMax - aMin);
          if (item._potX && item._potX.setValueSilent) item._potX.setValueSilent(mappedX);
          if (item._potY && item._potY.setValueSilent) item._potY.setValueSilent(mappedY);
          if (item._pot && item._pot.setValueSilent) item._pot.setValueSilent(mappedX);
          if (item.paramName) {
            state.paramValues[item.paramName] = mappedX;
            if (browserVoice && typeof browserVoice.setParam === 'function') {
              browserVoice.setParam(item.paramName, mappedX);
            }
          }
        }
        continue;
      }

      if (!item.gpio) continue;

      var gpio = Array.isArray(item.gpio) ? item.gpio : [item.gpio];

      for (var gi = 0; gi < gpio.length; gi++) {
        var pin = gpio[gi];
        if (!pin) continue;
        var pinNum = parseInt(pin.replace("GP", "").replace("CH", ""), 10);

        if (item.hwType === "button") {
          if (data.btn && Array.isArray(data.btn)) {
            var btnIdx = pinNum;
            if (btnIdx >= 0 && btnIdx < data.btn.length) {
              var pressed = data.btn[btnIdx] === 1;
              var btnEl = item.el ? item.el.querySelector(".hw-visual-button") : null;
              if (btnEl) {
                if (pressed) btnEl.classList.add("hw-btn-pressed");
                else btnEl.classList.remove("hw-btn-pressed");
              }
              if (item.kind === "key" || item.kind === "keys") {
                var devKey = "_devPressed_" + gi;
                if (pressed && !item[devKey]) {
                  handleKeyPress(gi);
                  item[devKey] = true;
                } else if (!pressed && item[devKey]) {
                  handleKeyRelease(gi);
                  item[devKey] = false;
                }
              }
              if (item.kind === "param" && item.paramName) {
                state.paramValues[item.paramName] = pressed ? 1 : 0;
                if (browserVoice && typeof browserVoice.setParam === 'function') {
                  browserVoice.setParam(item.paramName, pressed ? 1 : 0);
                }
              }
            }
          }
        } else if (item.hwType === "touch_native") {
          if (data.touch_gpio && Array.isArray(data.touch_gpio)) {
            var touchPins = [];
            for (var zid in hwZone.items) {
              var zi = hwZone.items[zid];
              if (zi.hwType === "touch_native" && zi.gpio) {
                var zGpios = Array.isArray(zi.gpio) ? zi.gpio : [zi.gpio];
                for (var zg = 0; zg < zGpios.length; zg++) {
                  if (zGpios[zg] && touchPins.indexOf(zGpios[zg]) === -1)
                    touchPins.push(zGpios[zg]);
                }
              }
            }
            var tIdx = touchPins.indexOf(pin);
            if (tIdx >= 0 && tIdx < data.touch_gpio.length) {
              var tActive = data.touch_gpio[tIdx] === 1;
              var tEl = item.el ? item.el.querySelector(".hw-visual-touch") : null;
              if (tEl) {
                if (tActive) tEl.classList.add("hw-touch-active");
                else tEl.classList.remove("hw-touch-active");
              }
              if (item.kind === "key" || item.kind === "keys") {
                var devKeyT = "_devPressed_" + gi;
                if (tActive && !item[devKeyT]) {
                  handleKeyPress(gi);
                  item[devKeyT] = true;
                } else if (!tActive && item[devKeyT]) {
                  handleKeyRelease(gi);
                  item[devKeyT] = false;
                }
              }
            }
          }
        } else if (item.hwType === "touch_mpr121") {
          if (data.touch && Array.isArray(data.touch)) {
            var chIdx = pinNum;
            if (chIdx < data.touch.length) {
              var tActive = data.touch[chIdx] === 1;
              var tEl = item.el ? item.el.querySelector(".hw-visual-touch") : null;
              if (tEl) {
                if (tActive) tEl.classList.add("hw-touch-active");
                else tEl.classList.remove("hw-touch-active");
              }
            }
          }
        } else if (item.hwType === "pot" || item.hwType === "ldr") {
          if (data.pot && Array.isArray(data.pot)) {
            var adcIdx = pinNum === 26 ? 0 : (pinNum === 27 ? 1 : (pinNum === 28 ? 2 : -1));
            if (adcIdx >= 0 && adcIdx < data.pot.length) {
              var rawVal = data.pot[adcIdx];
              var params = hwZone.getVoiceParams();
              var def = params[item.paramName] || {};
              var pMin = def.min !== undefined ? def.min : 0;
              var pMax = def.max !== undefined ? def.max : 1023;
              var mapped = pMin + (rawVal / 65535) * (pMax - pMin);
              if (item._pot && item._pot.setValueSilent) item._pot.setValueSilent(mapped);
              if (item.paramName) {
                state.paramValues[item.paramName] = mapped;
                if (palettePots[item.paramName] && palettePots[item.paramName].setValueSilent) {
                  palettePots[item.paramName].setValueSilent(mapped);
                }
                if (browserVoice && typeof browserVoice.setParam === 'function') {
                  browserVoice.setParam(item.paramName, mapped);
                }
              }
            }
          }
        }
      }
    }
  }

  function handleSerialData(data) {
    if (data.mon) { handleMonitorData(data); return; }
     // Expected: {"btn":[0,1,0,0],"pot":[512,1023,0],"accel":[0.1,-0.3],"touch":[1,0,0,1,...]}

     // Pots (handle dynamic pot tracking)
     if (data.pot && Array.isArray(data.pot)) {
       for (var p = 0; p < data.pot.length && p < state.pots.length; p++) {
         var rawVal = data.pot[p];
         var displayVal = clamp(Math.round(rawVal), 0, 1023);
         var potRec = state.pots[p];
         if (potRec && potRec.slider) {
           potRec.slider.value = displayVal;
           if (potRec.output) potRec.output.textContent = displayVal;
           applyNormalizedInput("pot_" + potRec.id, displayVal / 1023);
         }
       }
     }

     // Accelerometer
     if (data.accel && Array.isArray(data.accel)) {
       var accelSliders = [$accelX, $accelY];
       var accelOutputs = [$accelXVal, $accelYVal];
       var accelSources = ["accel_x", "accel_y"];
       for (var a = 0; a < data.accel.length && a < 2; a++) {
         var accelRaw = data.accel[a];
         var accelDisplay = clamp(Math.round(accelRaw * 1000), -1000, 1000);
         if (accelSliders[a]) {
           accelSliders[a].value = accelDisplay;
           if (accelOutputs[a]) accelOutputs[a].textContent = accelDisplay;
           applyNormalizedInput(accelSources[a], (accelDisplay + 1000) / 2000);
         }
       }
     }

     // Buttons
     if (data.btn && Array.isArray(data.btn)) {
       for (var b = 0; b < data.btn.length; b++) {
         var pressed = data.btn[b] === 1;
         // Map button index to keyboard key (first keys)
         if (b < 11) {
           var noteIdx = b;
           if (pressed) {
             if (!activeKeys[noteIdx]) {
               handleKeyPress(noteIdx);
             }
           } else {
             handleKeyRelease(noteIdx);
           }
         }
       }
     }

     // Touch (MPR121)
     if (data.touch && Array.isArray(data.touch)) {
       for (var tc = 0; tc < data.touch.length && tc < 12; tc++) {
         var touchActive = data.touch[tc] === 1;
         var noteIndex = tc % 11;
         if (touchActive) {
           if (!activeKeys[noteIndex]) {
             handleKeyPress(noteIndex);
           }
         } else {
           handleKeyRelease(noteIndex);
         }
       }
     }
   }

  // =========================================================================
  // Voice selection handler
  // =========================================================================

  function onVoiceChange() {
    var val = $voiceSelect.value;
    var voiceKey = selectToKey(val);
    if (!VOICES[voiceKey]) return;

    stopBrowserVoice();
    stopArpeggiator();
    releaseAllLatched();
    releaseAllActive();

    var prevVoice = state.selectedVoice;
    if (prevVoice) {
      voiceStateMgr.snapshot(prevVoice, {
        params: state.paramValues
      });
    }

    state.selectedVoice = voiceKey;
    voiceStateMgr.setActive(voiceKey);

    var restored = voiceStateMgr.restore(voiceKey);
    if (restored && restored.params) {
      state.paramValues = restored.params;
    } else {
      initParamValues(voiceKey);
    }

    renderParamPanel();
    if (hwZone) hwZone.refreshParamSelectors();

    if (audioInitDone) {
      browserVoice = createBrowserVoice(voiceKey);
      syncParamsToVoice();
    }

    updatePinout();
    scheduleCodeUpdate();
  }

  function initControlsPromotion() {
    var promotables = document.querySelectorAll('.controls-promotable[draggable="true"]');
    for (var i = 0; i < promotables.length; i++) {
      (function (el) {
        el.addEventListener('dragstart', function (e) {
          var controlName = el.getAttribute('data-control');
          var label = el.querySelector('label');
          var labelText = label ? label.textContent.trim() : controlName;
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'control', name: controlName, label: labelText }));
          e.dataTransfer.effectAllowed = 'move';
        });
      })(promotables[i]);
    }
  }

  function initWaveformDrag() {
    var wfDraggable = document.getElementById('waveform-draggable');
    if (!wfDraggable) return;
    wfDraggable.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'waveform' }));
      e.dataTransfer.effectAllowed = 'move';
    });
  }

  function initVoiceHwAssign() {
    var toggle = document.getElementById('voice-hw-assign-toggle');
    var configDiv = document.getElementById('voice-hw-assign-config');
    if (!toggle || !configDiv) return;
    toggle.addEventListener('change', function () {
      configDiv.style.display = toggle.checked ? '' : 'none';
    });
  }

  function initControlsCollapse() {
    var toggle = document.getElementById('controls-collapse-toggle');
    var body = document.getElementById('controls-body');
    if (!toggle || !body) return;
    toggle.addEventListener('click', function () {
      toggle.classList.toggle('collapsed');
      body.style.display = toggle.classList.contains('collapsed') ? 'none' : '';
    });
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  function init() {
    // Set initial voice
    if ($voiceSelect) {
      state.selectedVoice = selectToKey($voiceSelect.value);
    }

    // Init param values
    initParamValues(state.selectedVoice);

    // Set initial scale
    if ($scaleSelect) {
      state.currentScale = $scaleSelect.value;
    }

    // Render parameter panel
    renderParamPanel();

    hwZone = new HardwareZone({
      bus: bus,
      onStateChange: function (zoneState) {
        state.workspaceState = zoneState;
        updatePinout();
        scheduleCodeUpdate();
        syncPaletteToZone();
      },
      getVoiceParams: function () {
        var def = VOICES[state.selectedVoice];
        return def ? def.params : {};
      },
      getParamValue: function (name) {
        return state.paramValues[name];
      },
      setParamValue: function (name, val) {
        state.paramValues[name] = val;
        if (palettePots[name]) palettePots[name].setValue(val);
        if (browserVoice && typeof browserVoice.setParam === 'function') {
          browserVoice.setParam(name, val);
        }
        scheduleCodeUpdate();
      },
      getScaleKeys: function () {
        var keys = [];
        for (var i = 0; i < 11; i++) {
          keys.push({ index: i, label: noteNameForIndex(i) });
        }
        return keys;
      },
      onKeyPress: function (noteIndex) {
        ensureAudioInit().then(function () {
          handleKeyPress(noteIndex);
        });
      },
      onKeyRelease: function (noteIndex) {
        handleKeyRelease(noteIndex);
      },
      getControlValue: function (name) {
        if (name === "scale") return state.currentScale || ($scaleSelect ? $scaleSelect.value : "pentatonic_major");
        if (name === "tonality") return state.tonality || "major";
        if (name === "arp_pattern") return state.arpPattern || ($arpPattern ? $arpPattern.value : "up");
        if (name === "arp_speed") return state.arpSpeed || ($arpSpeed ? parseInt($arpSpeed.value, 10) : 120);
        if (name === "latch") return state.latchMode || false;
        if (name === "arp") return state.arpEnabled || false;
        if (name === "loop") return state.loopMode || false;
        return null;
      },
      setControlValue: function (name, val) {
        if (name === "scale") {
          state.currentScale = val;
          if ($scaleSelect) $scaleSelect.value = val;
          if ($scaleSelect) $scaleSelect.dispatchEvent(new Event("change"));
        } else if (name === "tonality") {
          state.tonality = val;
          var tonBtn = document.getElementById("btn-tonality");
          if (tonBtn) tonBtn.textContent = val === "minor" ? "Minor" : "Major";
        } else if (name === "arp_pattern") {
          state.arpPattern = val;
          if ($arpPattern) { $arpPattern.value = val; $arpPattern.dispatchEvent(new Event("change")); }
        } else if (name === "arp_speed") {
          state.arpSpeed = val;
          if ($arpSpeed) { $arpSpeed.value = val; }
          if ($arpSpeedVal) { $arpSpeedVal.textContent = val; }
        } else if (name === "latch") {
          state.latchMode = !!val;
          if ($latchToggle) { $latchToggle.checked = state.latchMode; $latchToggle.dispatchEvent(new Event("change")); }
        } else if (name === "arp") {
          state.arpEnabled = !!val;
          if ($arpToggle) { $arpToggle.checked = state.arpEnabled; $arpToggle.dispatchEvent(new Event("change")); }
        } else if (name === "loop") {
          state.loopMode = !!val;
          if ($loopToggle) { $loopToggle.checked = state.loopMode; $loopToggle.dispatchEvent(new Event("change")); }
        }
        scheduleCodeUpdate();
      }
    });
    hwZone.init('hw-zone-container');

    initControlsPromotion();
    initWaveformDrag();
    initVoiceHwAssign();
    initControlsCollapse();
    serialAdapter.init();

    if ($voiceSelect) {
      $voiceSelect.addEventListener("change", onVoiceChange);
    }

    // Wire up controls
    initBoardSelector();
    initLatchControls();
    initHardwareCheckboxes();
    initOctaveControls();
    initScaleControls();
    initArpControls();
    initPianoKeyboard();
    initAssignFields();
    initContinuousInputs();
    initActionButtons();

    // Initial pinout render
    updatePinout();

    // Initial code generation and requirements
    updateCodeOutput();
    updateRequirementsList();

    // Waveform animation
    initWaveformAnimation();

    // Serial
    initSerial();
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
