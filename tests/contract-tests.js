/**
 * Contract tests for Pico 2 Synth Workshop
 * Run: node tests/contract-tests.js
 * 
 * These tests verify the KNOWN_GOOD.md contracts without needing hardware.
 * They simulate hwZone state and verify buildDeviceConfig output.
 */

var assert = require("assert");
var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS: " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL: " + name);
    console.log("        " + e.message);
  }
}

// --- Simulate the key_map building logic from buildDeviceConfig ---

function buildKeyMap(items) {
  var keyMap = {};
  for (var id in items) {
    var ti = items[id];
    if ((ti.kind === "key" || ti.kind === "keys") && ti.hwType && ti.gpio) {
      var gpioArr = Array.isArray(ti.gpio) ? ti.gpio : [ti.gpio];
      if (ti.kind === "key" && ti.keyIndex !== null) {
        for (var ki = 0; ki < gpioArr.length; ki++) {
          var pin = gpioArr[ki];
          if (!pin) continue;
          var src;
          if (ti.hwType === "button") src = "button_" + pin.replace("GP", "");
          else if (ti.hwType === "touch_native") src = "touch_" + pin.replace("GP", "");
          else if (ti.hwType === "touch_mpr121") src = "mpr121_" + pin.replace("CH", "");
          if (src) keyMap[src] = ti.keyIndex;
        }
      }
    }
  }
  return keyMap;
}

function buildButtonPins(items) {
  var buttonPins = [];
  for (var id in items) {
    var ti = items[id];
    if (ti.hwType === "button" && ti.gpio) {
      var gpios = Array.isArray(ti.gpio) ? ti.gpio : [ti.gpio];
      for (var i = 0; i < gpios.length; i++) {
        if (gpios[i] && buttonPins.indexOf(gpios[i]) === -1)
          buttonPins.push(gpios[i]);
      }
    }
  }
  return buttonPins;
}

// --- Simulate firmware MIDI calculation ---

function midiForKeyIndex(keyIndex, scale, octave) {
  var scaleLen = scale.length;
  var degree = keyIndex % scaleLen;
  var octaveOffset = Math.floor(keyIndex / scaleLen);
  var baseMidi = (octave + 1) * 12;
  return baseMidi + scale[degree] + (octaveOffset * 12);
}

// --- Simulate firmware button source resolution ---

function resolveButtonSource(btnIdx, buttonPins) {
  if (btnIdx < buttonPins.length) {
    return "button_" + buttonPins[btnIdx].replace("GP", "");
  }
  return "button_" + btnIdx;
}

// ============================================================================
// Tests
// ============================================================================

console.log("\n=== Key Map Generation ===");

test("Individual key items use keyIndex, not array index", function () {
  var items = {
    "a": { kind: "key", keyIndex: 0, hwType: "button", gpio: "GP0" },
    "b": { kind: "key", keyIndex: 5, hwType: "button", gpio: "GP4" },
    "c": { kind: "key", keyIndex: 9, hwType: "button", gpio: "GP6" },
  };
  var keyMap = buildKeyMap(items);
  assert.strictEqual(keyMap["button_0"], 0);
  assert.strictEqual(keyMap["button_4"], 5);
  assert.strictEqual(keyMap["button_6"], 9);
});

test("Key map uses GPIO pin number, not array index", function () {
  var items = {
    "a": { kind: "key", keyIndex: 0, hwType: "button", gpio: "GP5" },
  };
  var keyMap = buildKeyMap(items);
  assert.strictEqual(keyMap["button_5"], 0);
  assert.strictEqual(keyMap["button_0"], undefined);
});

test("Touch native keys use touch_ prefix", function () {
  var items = {
    "a": { kind: "key", keyIndex: 3, hwType: "touch_native", gpio: "GP2" },
  };
  var keyMap = buildKeyMap(items);
  assert.strictEqual(keyMap["touch_2"], 3);
});

test("MPR121 keys use mpr121_ prefix", function () {
  var items = {
    "a": { kind: "key", keyIndex: 7, hwType: "touch_mpr121", gpio: "CH3" },
  };
  var keyMap = buildKeyMap(items);
  assert.strictEqual(keyMap["mpr121_3"], 7);
});

test("Items without keyIndex (null) are skipped", function () {
  var items = {
    "a": { kind: "key", keyIndex: null, hwType: "button", gpio: "GP0" },
  };
  var keyMap = buildKeyMap(items);
  assert.deepStrictEqual(keyMap, {});
});

test("Param items (not key/keys kind) are not in key_map", function () {
  var items = {
    "a": { kind: "param", paramName: "lpf_base_freq", hwType: "pot", gpio: "GP26" },
  };
  var keyMap = buildKeyMap(items);
  assert.deepStrictEqual(keyMap, {});
});

console.log("\n=== Button Pin Collection ===");

test("Button pins collected from all button-type items", function () {
  var items = {
    "a": { kind: "key", keyIndex: 0, hwType: "button", gpio: "GP0" },
    "b": { kind: "key", keyIndex: 1, hwType: "button", gpio: "GP4" },
    "c": { kind: "param", paramName: "x", hwType: "pot", gpio: "GP26" },
  };
  var pins = buildButtonPins(items);
  assert.deepStrictEqual(pins, ["GP0", "GP4"]);
});

test("Duplicate GPIO pins not repeated", function () {
  var items = {
    "a": { kind: "key", keyIndex: 0, hwType: "button", gpio: "GP0" },
    "b": { kind: "key", keyIndex: 1, hwType: "button", gpio: "GP0" },
  };
  var pins = buildButtonPins(items);
  assert.deepStrictEqual(pins, ["GP0"]);
});

console.log("\n=== Firmware MIDI Calculation ===");

test("Pentatonic scale C3: index 0 = C3 (MIDI 48)", function () {
  var midi = midiForKeyIndex(0, [0, 2, 4, 7, 9], 3);
  assert.strictEqual(midi, 48);
});

test("Pentatonic scale C3: index 1 = D3 (MIDI 50)", function () {
  var midi = midiForKeyIndex(1, [0, 2, 4, 7, 9], 3);
  assert.strictEqual(midi, 50);
});

test("Pentatonic scale C3: index 4 = A3 (MIDI 57)", function () {
  var midi = midiForKeyIndex(4, [0, 2, 4, 7, 9], 3);
  assert.strictEqual(midi, 57);
});

test("Pentatonic scale wraps: index 5 = C4 (MIDI 60)", function () {
  var midi = midiForKeyIndex(5, [0, 2, 4, 7, 9], 3);
  assert.strictEqual(midi, 60);
});

test("Chromatic scale: index 7 = G3 (MIDI 55)", function () {
  var midi = midiForKeyIndex(7, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 3);
  assert.strictEqual(midi, 55);
});

test("Octave 4: index 0 = C4 (MIDI 60)", function () {
  var midi = midiForKeyIndex(0, [0, 2, 4, 7, 9], 4);
  assert.strictEqual(midi, 60);
});

console.log("\n=== Firmware Button Source Resolution ===");

test("btn_idx 0 with pins [GP0,GP4,GP6] resolves to button_0", function () {
  assert.strictEqual(resolveButtonSource(0, ["GP0", "GP4", "GP6"]), "button_0");
});

test("btn_idx 1 with pins [GP0,GP4,GP6] resolves to button_4", function () {
  assert.strictEqual(resolveButtonSource(1, ["GP0", "GP4", "GP6"]), "button_4");
});

test("btn_idx 2 with pins [GP0,GP4,GP6] resolves to button_6", function () {
  assert.strictEqual(resolveButtonSource(2, ["GP0", "GP4", "GP6"]), "button_6");
});

test("btn_idx beyond pin list falls back to index", function () {
  assert.strictEqual(resolveButtonSource(5, ["GP0", "GP4"]), "button_5");
});

console.log("\n=== End-to-End: Key Map + Source Resolution Match ===");

test("Web key_map keys match firmware resolved source names", function () {
  var items = {
    "a": { kind: "key", keyIndex: 0, hwType: "button", gpio: "GP0" },
    "b": { kind: "key", keyIndex: 1, hwType: "button", gpio: "GP4" },
    "c": { kind: "key", keyIndex: 9, hwType: "button", gpio: "GP6" },
  };
  var keyMap = buildKeyMap(items);
  var buttonPins = buildButtonPins(items);

  // Simulate firmware receiving events for each button
  for (var btnIdx = 0; btnIdx < buttonPins.length; btnIdx++) {
    var source = resolveButtonSource(btnIdx, buttonPins);
    assert.ok(source in keyMap, "Source " + source + " should be in key_map");
  }

  // Verify correct key indices
  assert.strictEqual(keyMap[resolveButtonSource(0, buttonPins)], 0);
  assert.strictEqual(keyMap[resolveButtonSource(1, buttonPins)], 1);
  assert.strictEqual(keyMap[resolveButtonSource(2, buttonPins)], 9);
});

test("Full chain: button press → correct MIDI note", function () {
  var items = {
    "a": { kind: "key", keyIndex: 0, hwType: "button", gpio: "GP0" },
    "b": { kind: "key", keyIndex: 2, hwType: "button", gpio: "GP4" },
  };
  var keyMap = buildKeyMap(items);
  var buttonPins = buildButtonPins(items);
  var scale = [0, 2, 4, 7, 9];
  var octave = 3;

  // Button 0 pressed (btn_idx=0) → GP0 → key_index 0 → C3 (48)
  var src0 = resolveButtonSource(0, buttonPins);
  var midi0 = midiForKeyIndex(keyMap[src0], scale, octave);
  assert.strictEqual(midi0, 48);

  // Button 1 pressed (btn_idx=1) → GP4 → key_index 2 → E3 (52)
  var src1 = resolveButtonSource(1, buttonPins);
  var midi1 = midiForKeyIndex(keyMap[src1], scale, octave);
  assert.strictEqual(midi1, 52);
});

// ============================================================================
// Summary
// ============================================================================

console.log("\n---");
console.log("Results: " + passed + " passed, " + failed + " failed");
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All contracts verified.");
}
