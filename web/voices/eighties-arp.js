/**
 * eighties-arp.js — Arpeggio explorer
 *
 * Internal arpeggiator cycling through chord patterns.
 * 8 arp patterns: major, minor7th, diminished, suspended4th,
 *   octaves, octaves2, octaves3, root.
 * 3 detuned sawtooth oscillators per arp note with key-tracked filter.
 * BPM-synced note timing with gate percentage.
 * Self-play starts immediately.
 *
 * Exposed as window.EightiesArpVoice
 */
(function () {
  "use strict";

  // Arp patterns as arrays of semitone offsets from root
  var ARP_PATTERNS = {
    major:       [0, 4, 7, 12, 7, 4],
    minor7th:    [0, 3, 7, 10, 12, 10, 7, 3],
    diminished:  [0, 3, 6, 9, 12, 9, 6, 3],
    suspended4th:[0, 5, 7, 12, 7, 5],
    octaves:     [0, 12, 0, 12, 0, 12],
    octaves2:    [0, 12, 24, 12, 0, 12],
    octaves3:    [0, 7, 12, 19, 24, 19, 12, 7],
    root:        [0, 0, 0, 0]
  };

  var ARP_PATTERN_NAMES = [
    "major", "minor7th", "diminished", "suspended4th",
    "octaves", "octaves2", "octaves3", "root"
  ];

  var NUM_OSCS = 3;
  var GATE_PERCENT = 0.7;

  function EightiesArpVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;

    this._params = {
      root_note: 37,
      bpm: 110,
      lpf_base_freq: 2500,
      lpf_resonance: 1.5,
      arp_next: 0,
      transpose_up: 0
    };

    // Arp state
    this._patternIndex = 0;
    this._stepIndex = 0;
    this._transposeSteps = 0;

    // Audio nodes
    this._oscs = [];
    this._oscGains = [];
    this._filter = null;
    this._envGain = null;
    this._outputGain = null;

    // Timing
    this._arpTimer = null;
    this._gateTimer = null;
    this._playing = false;

    this._buildGraph();
  }

  EightiesArpVoice.prototype._buildGraph = function () {
    var ctx = this._ctx;

    // Output gain
    this._outputGain = ctx.createGain();
    this._outputGain.gain.value = 0.8;
    this._outputGain.connect(this._masterGain);

    // Envelope gain for note gating
    this._envGain = ctx.createGain();
    this._envGain.gain.value = 0.0;
    this._envGain.connect(this._outputGain);

    // Low-pass filter
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.frequency.value = this._params.lpf_base_freq;
    this._filter.Q.value = this._params.lpf_resonance;
    this._filter.connect(this._envGain);

    // 3 detuned sawtooth oscillators
    for (var i = 0; i < NUM_OSCS; i++) {
      var osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 110; // placeholder

      var g = ctx.createGain();
      g.gain.value = 0.22;

      osc.connect(g);
      g.connect(this._filter);
      osc.start();

      this._oscs.push(osc);
      this._oscGains.push(g);
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  EightiesArpVoice.prototype._getCurrentPattern = function () {
    var name = ARP_PATTERN_NAMES[this._patternIndex % ARP_PATTERN_NAMES.length];
    return ARP_PATTERNS[name];
  };

  EightiesArpVoice.prototype._stepIntervalMs = function () {
    // One step = one 16th note at current BPM
    // 16th note duration = 60 / bpm / 4 seconds
    return (60 / this._params.bpm / 4) * 1000;
  };

  EightiesArpVoice.prototype._setOscFrequency = function (midiNote) {
    var baseHz = 440 * Math.pow(2, (midiNote - 69) / 12);
    var now = this._ctx.currentTime;
    var detune = 0.004; // slight detune spread

    this._oscs[0].frequency.setTargetAtTime(baseHz, now, 0.003);
    this._oscs[1].frequency.setTargetAtTime(baseHz * (1.0 + detune), now, 0.003);
    this._oscs[2].frequency.setTargetAtTime(baseHz * (1.0 - detune), now, 0.003);

    // Key-tracked filter: higher notes open the filter more
    var filterHz = this._params.lpf_base_freq + (midiNote - 40) * 40;
    filterHz = Math.min(filterHz, 12000);
    filterHz = Math.max(filterHz, 100);
    this._filter.frequency.setTargetAtTime(filterHz, now, 0.005);
  };

  // ---------------------------------------------------------------------------
  // Arp step scheduling
  // ---------------------------------------------------------------------------
  EightiesArpVoice.prototype._scheduleArpStep = function () {
    var self = this;
    if (!self._playing) return;

    var pattern = self._getCurrentPattern();
    var semitoneOffset = pattern[self._stepIndex % pattern.length];
    self._stepIndex++;

    var midiNote = self._params.root_note + self._transposeSteps + semitoneOffset;
    self._setOscFrequency(midiNote);

    // Note on (gate open)
    var now = self._ctx.currentTime;
    var env = self._envGain.gain;
    env.cancelScheduledValues(now);
    env.setValueAtTime(0.0, now);
    env.linearRampToValueAtTime(0.9, now + 0.008);

    // Gate off after gate percentage of step
    var stepMs = self._stepIntervalMs();
    var gateMs = stepMs * GATE_PERCENT;

    self._gateTimer = setTimeout(function () {
      if (!self._playing) return;
      var t = self._ctx.currentTime;
      env.cancelScheduledValues(t);
      env.setValueAtTime(env.value, t);
      env.linearRampToValueAtTime(0.0, t + 0.02);
    }, gateMs);

    // Schedule next step
    self._arpTimer = setTimeout(function () {
      self._scheduleArpStep();
    }, stepMs);
  };

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  EightiesArpVoice.prototype.start = function () {
    if (this._playing) return;
    this._playing = true;
    this._stepIndex = 0;
    this._scheduleArpStep();
  };

  EightiesArpVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  EightiesArpVoice.prototype.stop = function () {
    this._playing = false;

    if (this._arpTimer) {
      clearTimeout(this._arpTimer);
      this._arpTimer = null;
    }
    if (this._gateTimer) {
      clearTimeout(this._gateTimer);
      this._gateTimer = null;
    }

    // Silence
    var now = this._ctx.currentTime;
    this._envGain.gain.cancelScheduledValues(now);
    this._envGain.gain.setTargetAtTime(0.0, now, 0.02);
  };

  EightiesArpVoice.prototype.stopSelfPlay = function () {
    this.stop();
  };

  EightiesArpVoice.prototype.noteOn = function (midiNote, vel) {
    // External noteOn sets root and restarts arp from step 0
    this._params.root_note = midiNote;
    this._stepIndex = 0;

    // If not already playing, start
    if (!this._playing) {
      this._playing = true;
      this._scheduleArpStep();
    }
  };

  EightiesArpVoice.prototype.noteOff = function (midiNote) {
    // Arp keeps running — noteOff is a no-op for the arpeggiator
  };

  EightiesArpVoice.prototype.setParam = function (name, value) {
    switch (name) {
      case "root_note":
        this._params.root_note = Math.round(value);
        break;

      case "bpm":
        this._bpm = value;
        this._params.bpm = value;
        // Tempo change takes effect on next scheduled step
        break;

      case "lpf_base_freq":
        this._params.lpf_base_freq = value;
        this._filter.frequency.setTargetAtTime(value, this._ctx.currentTime, 0.02);
        break;

      case "lpf_resonance":
        this._params.lpf_resonance = value;
        this._filter.Q.setTargetAtTime(value, this._ctx.currentTime, 0.02);
        break;

      case "arp_next":
        if (value) {
          this._patternIndex = (this._patternIndex + 1) % ARP_PATTERN_NAMES.length;
          this._stepIndex = 0;
        }
        break;

      case "transpose_up":
        if (value) {
          this._transposeSteps += 12;
          // Wrap back after 3 octaves
          if (this._transposeSteps > 36) {
            this._transposeSteps = 0;
          }
        }
        break;
    }
  };

  EightiesArpVoice.prototype.update = function () {
    // Timing is driven by setTimeout — nothing needed per frame
  };

  EightiesArpVoice.prototype.dispose = function () {
    this.stop();

    for (var i = 0; i < NUM_OSCS; i++) {
      try { this._oscs[i].stop(); } catch (e) { /* ok */ }
      try { this._oscs[i].disconnect(); } catch (e) { /* ok */ }
      try { this._oscGains[i].disconnect(); } catch (e) { /* ok */ }
    }
    this._oscs = [];
    this._oscGains = [];

    try { this._filter.disconnect(); } catch (e) { /* ok */ }
    try { this._envGain.disconnect(); } catch (e) { /* ok */ }
    try { this._outputGain.disconnect(); } catch (e) { /* ok */ }

    this._filter = null;
    this._envGain = null;
    this._outputGain = null;
  };

  // Expose
  window.EightiesArpVoice = EightiesArpVoice;

})();
