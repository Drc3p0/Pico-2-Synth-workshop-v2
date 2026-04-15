/**
 * monosynth.js — Fat monosynth for basslines
 *
 * 3 detuned sawtooth oscillators (monophonic — new note kills old).
 * BiquadFilter lowpass with adjustable frequency and Q.
 * Vibrato via LFO on oscillator detune.
 * ADSR-like envelope using GainNode scheduling.
 * Self-play cycles through [A2, C3, D3, E3, A2, C3, F3, D3].
 *
 * Exposed as window.MonosynthVoice
 */
(function () {
  "use strict";

  var SELF_PLAY_NOTES = [45, 48, 50, 52, 45, 48, 53, 50]; // A2, C3, D3, E3, A2, C3, F3, D3
  var NUM_OSCS = 3;

  // Detune ratios for each oscillator relative to fundamental
  var DETUNE_RATIOS = [1.0, 1.0, 1.0]; // adjusted at runtime via _params.osc_detune

  function MonosynthVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;

    this._params = {
      filter_freq: 2000,
      filter_res: 1.0,
      osc_detune: 0.001,
      vibrato_depth: 0.01,
      vibrato_rate: 5.0,
      release_time: 0.8,
      note_trigger: 0
    };

    // Envelope times
    this._attack = 0.02;
    this._decay = 0.1;
    this._sustain = 0.7; // sustain level (0-1)

    // Audio nodes
    this._oscs = [];
    this._oscGains = [];
    this._filter = null;
    this._envGain = null;
    this._outputGain = null;
    this._vibratoLfo = null;
    this._vibratoGain = null;

    // State
    this._currentMidi = null;
    this._selfPlayIndex = 0;
    this._selfPlayTimer = null;
    this._selfPlayNoteTimer = null;
    this._playing = false;
    this._noteHeld = false;

    this._buildGraph();
  }

  MonosynthVoice.prototype._buildGraph = function () {
    var ctx = this._ctx;

    // Output gain (voice level)
    this._outputGain = ctx.createGain();
    this._outputGain.gain.value = 0.8;
    this._outputGain.connect(this._masterGain);

    // Envelope gain
    this._envGain = ctx.createGain();
    this._envGain.gain.value = 0.0;
    this._envGain.connect(this._outputGain);

    // Low-pass filter
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.frequency.value = this._params.filter_freq;
    this._filter.Q.value = this._params.filter_res;
    this._filter.connect(this._envGain);

    // Vibrato LFO
    this._vibratoLfo = ctx.createOscillator();
    this._vibratoLfo.type = "sine";
    this._vibratoLfo.frequency.value = this._params.vibrato_rate;
    this._vibratoLfo.start();

    this._vibratoGain = ctx.createGain();
    this._vibratoGain.gain.value = 0.0; // set per-note based on frequency

    this._vibratoLfo.connect(this._vibratoGain);

    // Create 3 sawtooth oscillators
    for (var i = 0; i < NUM_OSCS; i++) {
      var osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 110; // placeholder

      var g = ctx.createGain();
      g.gain.value = 0.3;

      osc.connect(g);
      g.connect(this._filter);

      // Connect vibrato to each oscillator's frequency
      this._vibratoGain.connect(osc.frequency);

      osc.start();

      this._oscs.push(osc);
      this._oscGains.push(g);
    }
  };

  // ---------------------------------------------------------------------------
  // Trigger a note with envelope
  // ---------------------------------------------------------------------------
  MonosynthVoice.prototype._triggerNote = function (midiNote) {
    var ctx = this._ctx;
    var now = ctx.currentTime;
    var baseHz = 440 * Math.pow(2, (midiNote - 69) / 12);
    var detune = this._params.osc_detune;

    // Set oscillator frequencies with detune spread
    this._oscs[0].frequency.setTargetAtTime(baseHz, now, 0.005);
    this._oscs[1].frequency.setTargetAtTime(baseHz * (1.0 + detune), now, 0.005);
    this._oscs[2].frequency.setTargetAtTime(baseHz * (1.0 - detune), now, 0.005);

    // Set vibrato depth proportional to base frequency
    this._vibratoGain.gain.setTargetAtTime(
      baseHz * this._params.vibrato_depth,
      now, 0.01
    );

    // ADSR envelope — attack, decay, sustain
    var env = this._envGain.gain;
    env.cancelScheduledValues(now);
    env.setValueAtTime(env.value, now);
    // Attack
    env.linearRampToValueAtTime(1.0, now + this._attack);
    // Decay to sustain level
    env.linearRampToValueAtTime(this._sustain, now + this._attack + this._decay);

    this._currentMidi = midiNote;
    this._noteHeld = true;
  };

  // ---------------------------------------------------------------------------
  // Release current note
  // ---------------------------------------------------------------------------
  MonosynthVoice.prototype._releaseNote = function () {
    if (!this._noteHeld) return;
    this._noteHeld = false;

    var now = this._ctx.currentTime;
    var env = this._envGain.gain;
    var releaseTime = this._params.release_time;

    env.cancelScheduledValues(now);
    env.setValueAtTime(env.value, now);
    env.linearRampToValueAtTime(0.0, now + releaseTime);
  };

  // ---------------------------------------------------------------------------
  // Self-play: cycle through bass sequence
  // ---------------------------------------------------------------------------
  MonosynthVoice.prototype._scheduleSelfPlayStep = function () {
    var self = this;
    if (!self._playing) return;

    var note = SELF_PLAY_NOTES[self._selfPlayIndex % SELF_PLAY_NOTES.length];
    self._selfPlayIndex++;
    self._triggerNote(note);

    // Hold note for 70% of step duration, then release
    var stepDuration = self._selfPlaySpeed || 0.4; // seconds per step
    var holdTime = stepDuration * 0.7;

    self._selfPlayNoteTimer = setTimeout(function () {
      self._releaseNote();
    }, holdTime * 1000);

    self._selfPlayTimer = setTimeout(function () {
      self._scheduleSelfPlayStep();
    }, stepDuration * 1000);
  };

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  MonosynthVoice.prototype.start = function () {
    if (this._playing) return;
    this._playing = true;
    this._scheduleSelfPlayStep();
  };

  MonosynthVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  MonosynthVoice.prototype.stop = function () {
    this._playing = false;

    if (this._selfPlayTimer) {
      clearTimeout(this._selfPlayTimer);
      this._selfPlayTimer = null;
    }
    if (this._selfPlayNoteTimer) {
      clearTimeout(this._selfPlayNoteTimer);
      this._selfPlayNoteTimer = null;
    }

    this._releaseNote();
  };

  MonosynthVoice.prototype.stopSelfPlay = function () {
    this.stop();
  };

  MonosynthVoice.prototype.noteOn = function (midiNote, vel) {
    this._triggerNote(midiNote);
    // Update self-play sequence root so self-play uses this note going forward
    this._selfPlayRoot = midiNote;
  };

  MonosynthVoice.prototype.noteOff = function (midiNote) {
    // Monophonic — only release if this is the current note
    if (midiNote !== undefined && midiNote !== this._currentMidi) return;
    this._releaseNote();
  };

  MonosynthVoice.prototype.setParam = function (name, value) {
    this._params[name] = value;

    var now = this._ctx.currentTime;
    switch (name) {
      case "filter_freq":
        this._filter.frequency.setTargetAtTime(value, now, 0.02);
        break;
      case "filter_res":
        this._filter.Q.setTargetAtTime(value, now, 0.02);
        break;
      case "osc_detune":
        // Re-apply detune if a note is active
        if (this._currentMidi !== null && this._noteHeld) {
          var hz = 440 * Math.pow(2, (this._currentMidi - 69) / 12);
          this._oscs[1].frequency.setTargetAtTime(hz * (1.0 + value), now, 0.02);
          this._oscs[2].frequency.setTargetAtTime(hz * (1.0 - value), now, 0.02);
        }
        break;
      case "vibrato_depth":
        if (this._currentMidi !== null) {
          var baseHz = 440 * Math.pow(2, (this._currentMidi - 69) / 12);
          this._vibratoGain.gain.setTargetAtTime(baseHz * value, now, 0.02);
        }
        break;
      case "vibrato_rate":
        this._vibratoLfo.frequency.setTargetAtTime(value, now, 0.02);
        break;
      case "release_time":
        // Applied on next release
        break;
      case "note_trigger":
        if (value) {
          // Trigger next self-play note
          var note = SELF_PLAY_NOTES[this._selfPlayIndex % SELF_PLAY_NOTES.length];
          this._selfPlayIndex++;
          this._triggerNote(note);
          // Auto-release after a short hold
          var self = this;
          setTimeout(function () {
            self._releaseNote();
          }, 250);
        }
        break;
      case "bpm":
        this._bpm = value;
        // BPM controls self-play step speed: eighth notes
        this._selfPlaySpeed = 60 / value / 2;
        break;
    }
  };

  MonosynthVoice.prototype.update = function () {
    // Nothing needed per-frame
  };

  MonosynthVoice.prototype.dispose = function () {
    this.stop();

    try { this._vibratoLfo.stop(); } catch (e) { /* ok */ }
    try { this._vibratoLfo.disconnect(); } catch (e) { /* ok */ }
    try { this._vibratoGain.disconnect(); } catch (e) { /* ok */ }

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
    this._vibratoLfo = null;
    this._vibratoGain = null;
  };

  // Expose
  window.MonosynthVoice = MonosynthVoice;

})();
