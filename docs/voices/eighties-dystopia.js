/**
 * eighties-dystopia.js — Swirling ominous wub voice
 *
 * 5 detuned sawtooth oscillators with LFO-modulated low-pass filter.
 * Auto-cycles through notes [A1, A#1, G1] with random detune on each change.
 * First oscillator is a sub-oscillator one octave down.
 *
 * Exposed as window.EightiesDystopiaVoice
 */
(function () {
  "use strict";

  var NOTE_SEQUENCE = [33, 34, 31]; // A1, A#1, G1  (MIDI) — updated by noteOn
  var NUM_OSCS = 5;

  function EightiesDystopiaVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;

    // Parameters (defaults match app.js VOICES definition)
    this._params = {
      lpf_base_freq: 500,
      lpf_resonance: 1.5,
      filter_mod_rate: 0.05,
      filter_mod_depth: 2000,
      detune_range: 0.4,
      note_duration: 15,
      note_trigger: 0
    };

    // Internal state
    this._oscs = [];
    this._oscGains = [];
    this._filter = null;
    this._filterLfo = null;
    this._filterLfoGain = null;
    this._outputGain = null;
    this._noteIndex = 0;
    this._selfPlayTimer = null;
    this._playing = false;
    this._currentMidi = null;

    this._buildGraph();
  }

  EightiesDystopiaVoice.prototype._buildGraph = function () {
    var ctx = this._ctx;

    // Output gain — keeps overall level reasonable for 5 oscillators
    this._outputGain = ctx.createGain();
    this._outputGain.gain.value = 0.0;
    this._outputGain.connect(this._masterGain);

    // Low-pass filter
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.frequency.value = this._params.lpf_base_freq;
    this._filter.Q.value = this._params.lpf_resonance;
    this._filter.connect(this._outputGain);

    // LFO -> filter frequency
    this._filterLfo = ctx.createOscillator();
    this._filterLfo.type = "sine";
    this._filterLfo.frequency.value = this._params.filter_mod_rate;

    this._filterLfoGain = ctx.createGain();
    this._filterLfoGain.gain.value = this._params.filter_mod_depth;

    this._filterLfo.connect(this._filterLfoGain);
    this._filterLfoGain.connect(this._filter.frequency);
    this._filterLfo.start();

    // Create 5 sawtooth oscillators, each with its own gain for mixing
    for (var i = 0; i < NUM_OSCS; i++) {
      var osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 55; // placeholder

      var g = ctx.createGain();
      // Sub-oscillator (index 0) slightly louder, others softer
      g.gain.value = (i === 0) ? 0.25 : 0.15;

      osc.connect(g);
      g.connect(this._filter);
      osc.start();

      this._oscs.push(osc);
      this._oscGains.push(g);
    }
  };

  // ---------------------------------------------------------------------------
  // Apply detune spread to oscillators for current note
  // ---------------------------------------------------------------------------
  EightiesDystopiaVoice.prototype._setNote = function (midiNote) {
    var baseHz = 440 * Math.pow(2, (midiNote - 69) / 12);
    var range = this._params.detune_range;
    var now = this._ctx.currentTime;

    for (var i = 0; i < this._oscs.length; i++) {
      var hz;
      if (i === 0) {
        // Sub-oscillator: one octave down
        hz = baseHz * 0.5;
      } else {
        // Random detune factor around 1.0
        var detuneRatio = 1.0 + (Math.random() * 2 - 1) * range;
        hz = baseHz * detuneRatio;
      }
      this._oscs[i].frequency.setTargetAtTime(hz, now, 0.05);
    }

    this._currentMidi = midiNote;
  };

  // ---------------------------------------------------------------------------
  // Self-play: cycle through note sequence
  // ---------------------------------------------------------------------------
  EightiesDystopiaVoice.prototype._scheduleSelfPlayNote = function () {
    var self = this;
    if (!self._playing) return;

    var note = NOTE_SEQUENCE[self._noteIndex % NOTE_SEQUENCE.length];
    self._noteIndex++;
    self._setNote(note);

    // Fade in
    var now = self._ctx.currentTime;
    self._outputGain.gain.cancelScheduledValues(now);
    self._outputGain.gain.setTargetAtTime(0.7, now, 0.3);

    self._selfPlayTimer = setTimeout(function () {
      self._scheduleSelfPlayNote();
    }, self._params.note_duration * 1000);
  };

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  EightiesDystopiaVoice.prototype.start = function () {
    if (this._playing) return;
    this._playing = true;
    this._scheduleSelfPlayNote();
  };

  EightiesDystopiaVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  EightiesDystopiaVoice.prototype.stop = function () {
    this._playing = false;
    if (this._selfPlayTimer) {
      clearTimeout(this._selfPlayTimer);
      this._selfPlayTimer = null;
    }
    // Fade out
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.0, now, 0.15);
  };

  EightiesDystopiaVoice.prototype.stopSelfPlay = function () {
    this.stop();
  };

  EightiesDystopiaVoice.prototype.noteOn = function (midiNote, vel) {
    this._setNote(midiNote);
    // Update the note sequence root so self-play uses this note going forward
    NOTE_SEQUENCE = [midiNote, midiNote + 1, midiNote - 2];
    this._noteIndex = 0;
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.7, now, 0.05);
  };

  EightiesDystopiaVoice.prototype.noteOff = function (midiNote) {
    if (midiNote !== undefined && midiNote !== this._currentMidi) return;
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.0, now, 0.3);
  };

  EightiesDystopiaVoice.prototype.setParam = function (name, value) {
    this._params[name] = value;

    switch (name) {
      case "lpf_base_freq":
        this._filter.frequency.value = value;
        break;
      case "lpf_resonance":
        this._filter.Q.value = value;
        break;
      case "filter_mod_rate":
        this._filterLfo.frequency.setTargetAtTime(value, this._ctx.currentTime, 0.05);
        break;
      case "filter_mod_depth":
        this._filterLfoGain.gain.value = value;
        break;
      case "detune_range":
        // Applied on next note change
        break;
      case "note_duration":
        // Applied on next self-play cycle
        break;
      case "note_trigger":
        if (value) {
          // Immediately trigger the next note in sequence
          var note = NOTE_SEQUENCE[this._noteIndex % NOTE_SEQUENCE.length];
          this._noteIndex++;
          this._setNote(note);
        }
        break;
      case "bpm":
        this._bpm = value;
        // BPM controls note_duration: quarter notes at 4 beats per note change
        this._params.note_duration = 60 / value * 4;
        break;
    }
  };

  EightiesDystopiaVoice.prototype.update = function () {
    // No per-frame work needed — LFO runs on audio thread
  };

  EightiesDystopiaVoice.prototype.dispose = function () {
    this.stop();

    try { this._filterLfo.stop(); } catch (e) { /* already stopped */ }

    for (var i = 0; i < this._oscs.length; i++) {
      try { this._oscs[i].stop(); } catch (e) { /* ok */ }
      try { this._oscs[i].disconnect(); } catch (e) { /* ok */ }
      try { this._oscGains[i].disconnect(); } catch (e) { /* ok */ }
    }
    this._oscs = [];
    this._oscGains = [];

    try { this._filterLfo.disconnect(); } catch (e) { /* ok */ }
    try { this._filterLfoGain.disconnect(); } catch (e) { /* ok */ }
    try { this._filter.disconnect(); } catch (e) { /* ok */ }
    try { this._outputGain.disconnect(); } catch (e) { /* ok */ }

    this._filterLfo = null;
    this._filterLfoGain = null;
    this._filter = null;
    this._outputGain = null;
  };

  // Expose
  window.EightiesDystopiaVoice = EightiesDystopiaVoice;

})();
