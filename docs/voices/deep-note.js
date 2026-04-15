/**
 * deep-note.js — THX Deep Note convergence voice
 *
 * 6 sawtooth oscillators (configurable 3-12) evolve through four stages:
 *   Stage 1 (3s):  random frequencies around A2 with noise-like wobble
 *   Stage 2 (3s):  frequencies drift randomly
 *   Stage 3 (8s):  all converge on the target chord [D1, D2, D3, A3, D4, A4]
 *   Stage 4 (5s):  hold the final chord
 * Then loops back to stage 1.
 *
 * Uses scheduled frequency ramps via setValueAtTime / linearRampToValueAtTime.
 *
 * Exposes: window.DeepNoteVoice
 */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Target chord frequencies (MIDI to Hz)
  // D1=38.89, D2=73.42, D3=146.83, A3=220, D4=293.66, A4=440
  // Extended pool for >6 voices: double-up lower notes, add D5, A5
  // -------------------------------------------------------------------------

  var TARGET_CHORD = [
    36.71,   // D1
    73.42,   // D2
    146.83,  // D3
    220.00,  // A3
    293.66,  // D4
    440.00,  // A4
    587.33,  // D5
    880.00,  // A5
    73.42,   // D2 (dup)
    146.83,  // D3 (dup)
    293.66,  // D4 (dup)
    440.00   // A4 (dup)
  ];

  // Random frequency range for the chaotic opening (Hz)
  var CHAOS_CENTER = 110; // A2
  var CHAOS_SPREAD = 80;  // +/- Hz

  // -------------------------------------------------------------------------
  // DeepNoteVoice
  // -------------------------------------------------------------------------

  function DeepNoteVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;
    this._disposed = false;
    this._playing = false;

    // Parameters
    this._numOscs = 6;
    this._stage3Time = 8;    // convergence duration (seconds)
    this._stage4Time = 5;    // hold duration (seconds)

    // Stage timings (stages 1 & 2 are fixed at 3s each)
    this._stage1Time = 3;
    this._stage2Time = 3;

    // Audio nodes
    this._oscillators = [];  // OscillatorNode[]
    this._oscGains = [];     // GainNode[] (per-osc)
    this._voiceGain = null;  // overall voice gain

    // Sequence state
    this._stage = 0;         // 0=idle, 1..4
    this._stageTimer = null;
    this._wobbleInterval = null;
    this._currentFreqs = [];
  }

  // -----------------------------------------------------------------------
  // Build / destroy
  // -----------------------------------------------------------------------

  DeepNoteVoice.prototype._buildGraph = function (numOscs) {
    if (this._voiceGain) return; // already built

    var ctx = this._ctx;
    var n = SynthEngine.clamp(numOscs || this._numOscs, 3, 12);
    var sawWave = SynthEngine.createSawWave(ctx, 48);

    this._voiceGain = ctx.createGain();
    this._voiceGain.gain.value = 0;
    this._voiceGain.connect(this._masterGain);

    this._oscillators = [];
    this._oscGains = [];
    this._currentFreqs = [];

    var perOscGain = 0.18 / Math.sqrt(n); // scale down with voice count

    for (var i = 0; i < n; i++) {
      var osc = ctx.createOscillator();
      osc.setPeriodicWave(sawWave);

      // Random starting frequency around A2
      var startFreq = CHAOS_CENTER + (Math.random() * 2 - 1) * CHAOS_SPREAD;
      osc.frequency.value = startFreq;
      this._currentFreqs.push(startFreq);

      var g = ctx.createGain();
      g.gain.value = perOscGain;

      osc.connect(g);
      g.connect(this._voiceGain);
      osc.start();

      this._oscillators.push(osc);
      this._oscGains.push(g);
    }
  };

  DeepNoteVoice.prototype._destroyGraph = function () {
    this._stopTimers();

    for (var i = 0; i < this._oscillators.length; i++) {
      try { this._oscillators[i].stop(); } catch (e) { /* */ }
      try { this._oscillators[i].disconnect(); } catch (e) { /* */ }
    }
    for (var j = 0; j < this._oscGains.length; j++) {
      try { this._oscGains[j].disconnect(); } catch (e) { /* */ }
    }
    if (this._voiceGain) {
      try { this._voiceGain.disconnect(); } catch (e) { /* */ }
    }

    this._oscillators = [];
    this._oscGains = [];
    this._voiceGain = null;
    this._currentFreqs = [];
  };

  DeepNoteVoice.prototype._stopTimers = function () {
    if (this._stageTimer) {
      clearTimeout(this._stageTimer);
      this._stageTimer = null;
    }
    if (this._wobbleInterval) {
      clearInterval(this._wobbleInterval);
      this._wobbleInterval = null;
    }
  };

  // -----------------------------------------------------------------------
  // Stage machine
  // -----------------------------------------------------------------------

  DeepNoteVoice.prototype._startSequence = function () {
    this._stage = 0;
    this._enterStage1();
  };

  // Stage 1: Chaotic start — random frequencies with pitch wobble
  DeepNoteVoice.prototype._enterStage1 = function () {
    if (this._disposed || !this._playing) return;
    this._stage = 1;

    var ctx = this._ctx;
    var now = ctx.currentTime;
    var n = this._oscillators.length;

    // Fade in
    if (this._voiceGain) {
      this._voiceGain.gain.setValueAtTime(this._voiceGain.gain.value, now);
      this._voiceGain.gain.linearRampToValueAtTime(0.9, now + 1.0);
    }

    // Scatter frequencies
    for (var i = 0; i < n; i++) {
      var freq = CHAOS_CENTER + (Math.random() * 2 - 1) * CHAOS_SPREAD;
      this._oscillators[i].frequency.setValueAtTime(freq, now);
      this._currentFreqs[i] = freq;
    }

    // Start wobble
    this._startWobble();

    var self = this;
    this._stageTimer = setTimeout(function () {
      self._enterStage2();
    }, this._stage1Time * 1000);
  };

  // Stage 2: Random drift
  DeepNoteVoice.prototype._enterStage2 = function () {
    if (this._disposed || !this._playing) return;
    this._stage = 2;

    var ctx = this._ctx;
    var now = ctx.currentTime;
    var n = this._oscillators.length;
    var driftTime = this._stage2Time;

    // Drift each oscillator to a new random frequency
    for (var i = 0; i < n; i++) {
      var targetFreq = CHAOS_CENTER + (Math.random() * 2 - 1) * CHAOS_SPREAD * 1.5;
      targetFreq = Math.max(30, targetFreq);
      this._oscillators[i].frequency.setValueAtTime(this._currentFreqs[i], now);
      this._oscillators[i].frequency.linearRampToValueAtTime(targetFreq, now + driftTime);
      this._currentFreqs[i] = targetFreq;
    }

    var self = this;
    this._stageTimer = setTimeout(function () {
      self._enterStage3();
    }, driftTime * 1000);
  };

  // Stage 3: Convergence — all oscillators glide to target chord
  DeepNoteVoice.prototype._enterStage3 = function () {
    if (this._disposed || !this._playing) return;
    this._stage = 3;

    // Stop wobble — the convergence should be smooth
    if (this._wobbleInterval) {
      clearInterval(this._wobbleInterval);
      this._wobbleInterval = null;
    }

    var ctx = this._ctx;
    var now = ctx.currentTime;
    var n = this._oscillators.length;
    var convergeTime = this._stage3Time;

    // Swell volume slightly during convergence
    if (this._voiceGain) {
      this._voiceGain.gain.setValueAtTime(this._voiceGain.gain.value, now);
      this._voiceGain.gain.linearRampToValueAtTime(1.0, now + convergeTime * 0.8);
    }

    // Assign each oscillator a target from the chord
    for (var i = 0; i < n; i++) {
      var target = TARGET_CHORD[i % TARGET_CHORD.length];

      // Add slight random offset to convergence time for organic feel
      var oscConverge = convergeTime * (0.7 + Math.random() * 0.3);

      this._oscillators[i].frequency.setValueAtTime(this._currentFreqs[i], now);
      this._oscillators[i].frequency.linearRampToValueAtTime(target, now + oscConverge);
      this._currentFreqs[i] = target;
    }

    var self = this;
    this._stageTimer = setTimeout(function () {
      self._enterStage4();
    }, convergeTime * 1000);
  };

  // Stage 4: Hold the chord
  DeepNoteVoice.prototype._enterStage4 = function () {
    if (this._disposed || !this._playing) return;
    this._stage = 4;

    // Just hold — frequencies are already at target
    // Keep volume steady
    var now = this._ctx.currentTime;
    if (this._voiceGain) {
      this._voiceGain.gain.setValueAtTime(1.0, now);
    }

    var self = this;
    this._stageTimer = setTimeout(function () {
      // Fade down briefly before looping
      if (self._voiceGain && self._playing && !self._disposed) {
        var fadeNow = self._ctx.currentTime;
        self._voiceGain.gain.setValueAtTime(1.0, fadeNow);
        self._voiceGain.gain.linearRampToValueAtTime(0.15, fadeNow + 1.5);
      }

      setTimeout(function () {
        if (self._playing && !self._disposed) {
          self._enterStage1();
        }
      }, 1600);
    }, this._stage4Time * 1000);
  };

  // -----------------------------------------------------------------------
  // Wobble — adds pitch instability during stages 1 & 2
  // -----------------------------------------------------------------------

  DeepNoteVoice.prototype._startWobble = function () {
    if (this._wobbleInterval) return;

    var self = this;
    this._wobbleInterval = setInterval(function () {
      if (self._disposed || self._stage > 2) return;

      var now = self._ctx.currentTime;
      var n = self._oscillators.length;

      for (var i = 0; i < n; i++) {
        // Small random perturbation
        var wobble = (Math.random() * 2 - 1) * 15;
        var newFreq = self._currentFreqs[i] + wobble;
        newFreq = Math.max(25, newFreq);
        self._oscillators[i].frequency.setTargetAtTime(newFreq, now, 0.05);
      }
    }, 80); // ~12.5 Hz wobble update
  };

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  DeepNoteVoice.prototype.start = function () {
    if (this._disposed || this._playing) return;
    this._playing = true;
    this._buildGraph(this._numOscs);
    this._startSequence();
  };

  DeepNoteVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  DeepNoteVoice.prototype.stop = function () {
    this._playing = false;
    this._stage = 0;
    this._stopTimers();

    if (this._voiceGain) {
      var now = this._ctx.currentTime;
      this._voiceGain.gain.setValueAtTime(this._voiceGain.gain.value, now);
      this._voiceGain.gain.linearRampToValueAtTime(0, now + 0.3);
    }

    var self = this;
    setTimeout(function () {
      if (!self._playing && !self._disposed) {
        self._destroyGraph();
      }
    }, 500);
  };

  DeepNoteVoice.prototype.stopSelfPlay = function () {
    this.stop();
  };

  DeepNoteVoice.prototype.noteOn = function (midiNote, vel) {
    // noteOn restarts the sequence with a new base pitch (shifts the target chord)
    if (this._disposed) return;

    // Store root note for self-play reference
    this._rootNote = midiNote;

    if (!this._playing) {
      this.start();
      return;
    }

    // Retrigger: shift chord root relative to D1 (MIDI 26)
    // This is a creative reinterpretation for MIDI control
    var semitoneShift = midiNote - 26;
    var ratio = Math.pow(2, semitoneShift / 12);

    var now = this._ctx.currentTime;
    var n = this._oscillators.length;
    for (var i = 0; i < n; i++) {
      var target = TARGET_CHORD[i % TARGET_CHORD.length] * ratio;
      target = SynthEngine.clamp(target, 20, 10000);
      this._oscillators[i].frequency.setValueAtTime(this._currentFreqs[i], now);
      this._oscillators[i].frequency.linearRampToValueAtTime(target, now + 2.0);
      this._currentFreqs[i] = target;
    }
  };

  DeepNoteVoice.prototype.noteOff = function (midiNote) {
    // No-op — the deep note is a continuous sequence
  };

  DeepNoteVoice.prototype.setParam = function (name, value) {
    switch (name) {
      case "num_oscs":
        var newNum = SynthEngine.clamp(Math.round(value), 3, 12);
        if (newNum !== this._numOscs) {
          this._numOscs = newNum;
          // Rebuild on next restart — don't interrupt mid-sequence
        }
        break;
      case "stage3_time":
        this._stage3Time = SynthEngine.clamp(value, 2, 20);
        break;
      case "stage4_time":
        this._stage4Time = SynthEngine.clamp(value, 1, 15);
        break;
      case "restart":
        this._restart();
        break;
      case "bpm":
        this._bpm = value;
        // BPM scales all stage durations
        this._timeScale = 60 / value;
        this._stage1Time = 3 * this._timeScale;
        this._stage2Time = 3 * this._timeScale;
        this._stage3Time = SynthEngine.clamp(8 * this._timeScale, 2, 20);
        this._stage4Time = SynthEngine.clamp(5 * this._timeScale, 1, 15);
        break;
    }
  };

  DeepNoteVoice.prototype._restart = function () {
    if (this._disposed) return;

    var wasPlaying = this._playing;
    this._playing = false;
    this._stage = 0;
    this._stopTimers();
    this._destroyGraph();

    this._playing = true;
    this._buildGraph(this._numOscs);

    if (wasPlaying || true) {
      this._startSequence();
    }
  };

  DeepNoteVoice.prototype.update = function () {
    // Called from requestAnimationFrame — no-op; timing via setTimeout/setInterval
  };

  DeepNoteVoice.prototype.dispose = function () {
    this._disposed = true;
    this._playing = false;
    this._stage = 0;
    this._stopTimers();
    this._destroyGraph();
  };

  // -----------------------------------------------------------------------
  // Expose
  // -----------------------------------------------------------------------

  window.DeepNoteVoice = DeepNoteVoice;

})();
