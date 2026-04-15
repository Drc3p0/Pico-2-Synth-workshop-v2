/**
 * falling-forever.js — Endless falling wavetable effect
 *
 * Two oscillators with different wavetable sources and opposing pitch bends
 * create the illusion of an endlessly falling tone (a sonic barber-pole).
 * Wavetable scanning bounces back and forth through the table. Voice 2 sits
 * at lower amplitude for depth.
 *
 * Self-play: continuous drone, always playing.
 *
 * Exposes: window.FallingForeverVoice
 */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a single-cycle Float32Array waveform to a PeriodicWave via DFT.
   */
  function waveformToPeriodicWave(ctx, samples, numHarmonics) {
    numHarmonics = numHarmonics || 48;
    var N = samples.length;
    var real = new Float32Array(numHarmonics + 1);
    var imag = new Float32Array(numHarmonics + 1);

    real[0] = 0;
    imag[0] = 0;

    for (var h = 1; h <= numHarmonics; h++) {
      var sumR = 0;
      var sumI = 0;
      for (var n = 0; n < N; n++) {
        var angle = 2 * Math.PI * h * n / N;
        sumR += samples[n] * Math.cos(angle);
        sumI -= samples[n] * Math.sin(angle);
      }
      real[h] = (2 * sumR) / N;
      imag[h] = (2 * sumI) / N;
    }

    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  // -------------------------------------------------------------------------
  // FallingForeverVoice
  // -------------------------------------------------------------------------

  function FallingForeverVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;
    this._disposed = false;
    this._playing = false;

    // Parameters
    this._baseFreq = 65.4;        // C2
    this._scanSpeed = 0.07;       // wavetable scan rate (bounces/sec)
    this._bendRate = 0.10;        // pitch bend speed (octaves/sec of fall cycle)
    this._voice2Amplitude = 0.7;

    // Generate two wavetables with different characteristics
    this._rawTableA = SynthEngine.createWavetable(ctx, 32, 256);
    this._rawTableB = this._generateTableB(ctx, 32, 256);

    // Pre-compute PeriodicWave arrays
    this._wavesA = [];
    this._wavesB = [];
    for (var i = 0; i < this._rawTableA.length; i++) {
      this._wavesA.push(waveformToPeriodicWave(ctx, this._rawTableA[i], 48));
    }
    for (var j = 0; j < this._rawTableB.length; j++) {
      this._wavesB.push(waveformToPeriodicWave(ctx, this._rawTableB[j], 48));
    }

    // Audio nodes
    this._osc1 = null;
    this._osc2 = null;
    this._gain1 = null;
    this._gain2 = null;
    this._voiceGain = null;

    // Scanning state
    this._scanPhase = 0;       // 0..1 triangle position in wavetable
    this._scanDirection = 1;   // +1 or -1 (bounce)

    // Bend state — each osc has a bend phase that wraps around
    this._bend1Phase = 0;      // 0..1 falling
    this._bend2Phase = 0.5;    // offset — rising while 1 falls

    // Cross-fade state for wave swaps
    this._currentWaveIdxA = -1;
    this._currentWaveIdxB = -1;

    // Update interval
    this._tickInterval = null;
  }

  // -----------------------------------------------------------------------
  // Generate a second, different wavetable (more harmonics, different phase)
  // -----------------------------------------------------------------------

  FallingForeverVoice.prototype._generateTableB = function (ctx, numWaves, waveLength) {
    var table = [];
    for (var w = 0; w < numWaves; w++) {
      var wave = new Float32Array(waveLength);
      var numHarmonics = 2 + Math.floor(w * 8 / numWaves);
      var t = w / numWaves;

      for (var h = 1; h <= numHarmonics; h++) {
        var amp = 1.0 / Math.pow(h, 0.8 + t * 1.0);
        var phaseShift = t * Math.PI * h * 0.7 + Math.PI * 0.25;
        for (var i = 0; i < waveLength; i++) {
          wave[i] += amp * Math.sin(2 * Math.PI * i * h / waveLength + phaseShift);
        }
      }

      // Normalise
      var peak = 0;
      for (var k = 0; k < waveLength; k++) {
        if (Math.abs(wave[k]) > peak) peak = Math.abs(wave[k]);
      }
      if (peak > 0) {
        for (var m = 0; m < waveLength; m++) wave[m] /= peak;
      }
      table.push(wave);
    }
    return table;
  };

  // -----------------------------------------------------------------------
  // Build / destroy audio graph
  // -----------------------------------------------------------------------

  FallingForeverVoice.prototype._buildGraph = function () {
    if (this._voiceGain) return;

    var ctx = this._ctx;

    this._voiceGain = ctx.createGain();
    this._voiceGain.gain.value = 0;

    this._gain1 = ctx.createGain();
    this._gain1.gain.value = 0.30;

    this._gain2 = ctx.createGain();
    this._gain2.gain.value = 0.30 * this._voice2Amplitude;

    this._osc1 = ctx.createOscillator();
    this._osc2 = ctx.createOscillator();

    this._osc1.setPeriodicWave(this._wavesA[0]);
    this._osc2.setPeriodicWave(this._wavesB[0]);

    this._osc1.frequency.value = this._baseFreq;
    this._osc2.frequency.value = this._baseFreq;

    this._osc1.connect(this._gain1);
    this._osc2.connect(this._gain2);
    this._gain1.connect(this._voiceGain);
    this._gain2.connect(this._voiceGain);
    this._voiceGain.connect(this._masterGain);

    this._osc1.start();
    this._osc2.start();
  };

  FallingForeverVoice.prototype._destroyGraph = function () {
    try {
      if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
      if (this._osc1) { this._osc1.stop(); this._osc1.disconnect(); this._osc1 = null; }
      if (this._osc2) { this._osc2.stop(); this._osc2.disconnect(); this._osc2 = null; }
      if (this._gain1) { this._gain1.disconnect(); this._gain1 = null; }
      if (this._gain2) { this._gain2.disconnect(); this._gain2 = null; }
      if (this._voiceGain) { this._voiceGain.disconnect(); this._voiceGain = null; }
    } catch (e) { /* ignore */ }
  };

  // -----------------------------------------------------------------------
  // Tick — updates at ~100 Hz
  // -----------------------------------------------------------------------

  FallingForeverVoice.prototype._startTicking = function () {
    if (this._tickInterval) return;
    var self = this;
    this._tickInterval = setInterval(function () {
      if (self._disposed) return;
      self._tick();
    }, 10);
  };

  FallingForeverVoice.prototype._tick = function () {
    var dt = 0.01;
    var now = this._ctx.currentTime;
    var numWaves = this._wavesA.length;

    // --- Wavetable scanning (bounce) ---
    this._scanPhase += dt * this._scanSpeed * this._scanDirection;
    if (this._scanPhase >= 1.0) {
      this._scanPhase = 1.0;
      this._scanDirection = -1;
    } else if (this._scanPhase <= 0.0) {
      this._scanPhase = 0.0;
      this._scanDirection = 1;
    }

    var waveIdxA = Math.floor(this._scanPhase * (numWaves - 1));
    var waveIdxB = Math.floor((1.0 - this._scanPhase) * (numWaves - 1));
    waveIdxA = Math.max(0, Math.min(waveIdxA, numWaves - 1));
    waveIdxB = Math.max(0, Math.min(waveIdxB, numWaves - 1));

    if (waveIdxA !== this._currentWaveIdxA && this._osc1) {
      this._osc1.setPeriodicWave(this._wavesA[waveIdxA]);
      this._currentWaveIdxA = waveIdxA;
    }
    if (waveIdxB !== this._currentWaveIdxB && this._osc2) {
      this._osc2.setPeriodicWave(this._wavesB[waveIdxB]);
      this._currentWaveIdxB = waveIdxB;
    }

    // --- Opposing pitch bends ---
    // Osc1 bends down: starts at 2x base, falls to 0.5x base, then resets
    // Osc2 bends up:   starts at 0.5x base, rises to 2x base, then resets
    // Using exponential mapping for musical pitch bend (2 octaves range)
    this._bend1Phase += dt * this._bendRate;
    this._bend2Phase += dt * this._bendRate;

    if (this._bend1Phase >= 1.0) this._bend1Phase -= 1.0;
    if (this._bend2Phase >= 1.0) this._bend2Phase -= 1.0;

    // Osc1: falling — map phase 0..1 to frequency multiplier 2..0.5 (exponential)
    var mult1 = Math.pow(2, 1.0 - 2.0 * this._bend1Phase); // 2 -> 0.5
    // Osc2: rising — map phase 0..1 to frequency multiplier 0.5..2 (exponential)
    var mult2 = Math.pow(2, -1.0 + 2.0 * this._bend2Phase); // 0.5 -> 2

    // Cross-fade gains based on bend phase:
    // Each osc is loudest in the middle of its sweep, quieter at extremes
    // This hides the retrigger discontinuity
    var fade1 = Math.sin(this._bend1Phase * Math.PI);
    var fade2 = Math.sin(this._bend2Phase * Math.PI);

    if (this._osc1) {
      this._osc1.frequency.setTargetAtTime(this._baseFreq * mult1, now, 0.008);
    }
    if (this._osc2) {
      this._osc2.frequency.setTargetAtTime(this._baseFreq * mult2, now, 0.008);
    }
    if (this._gain1) {
      this._gain1.gain.setTargetAtTime(0.30 * fade1, now, 0.008);
    }
    if (this._gain2) {
      this._gain2.gain.setTargetAtTime(0.30 * this._voice2Amplitude * fade2, now, 0.008);
    }
  };

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  FallingForeverVoice.prototype.start = function () {
    if (this._disposed || this._playing) return;
    this._playing = true;
    this._buildGraph();
    this._startTicking();

    // Fade in
    if (this._voiceGain) {
      this._voiceGain.gain.setTargetAtTime(1.0, this._ctx.currentTime, 0.1);
    }
  };

  FallingForeverVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  FallingForeverVoice.prototype.stop = function () {
    this._playing = false;

    if (this._voiceGain) {
      this._voiceGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1);
    }

    var self = this;
    setTimeout(function () {
      if (!self._playing && !self._disposed) {
        self._destroyGraph();
      }
    }, 500);
  };

  FallingForeverVoice.prototype.stopSelfPlay = function () {
    this.stop();
  };

  FallingForeverVoice.prototype.noteOn = function (midiNote, vel) {
    if (this._disposed) return;
    // Continuous drone — noteOn changes the base frequency
    this._baseFreq = SynthEngine.midiToHz(midiNote);

    if (!this._playing) {
      this.start();
    }
  };

  FallingForeverVoice.prototype.noteOff = function (midiNote) {
    // Drone voice — noteOff is a no-op (keeps droning)
  };

  FallingForeverVoice.prototype.setParam = function (name, value) {
    switch (name) {
      case "base_freq":
        this._baseFreq = Math.max(20, Math.min(value, 2000));
        break;
      case "scan_speed":
        this._scanSpeed = Math.max(0.001, value);
        break;
      case "bend_rate":
        this._bendRate = Math.max(0.001, value);
        break;
      case "voice2_amplitude":
        this._voice2Amplitude = SynthEngine.clamp(value, 0, 1);
        break;
      case "bpm":
        this._bpm = value;
        // BPM scales scan speed relative to default
        this._scanSpeed = 0.07 * (value / 60);
        break;
    }
  };

  FallingForeverVoice.prototype.update = function () {
    // Called from requestAnimationFrame — no-op; timing via setInterval
  };

  FallingForeverVoice.prototype.dispose = function () {
    this._disposed = true;
    this._playing = false;
    this._destroyGraph();
  };

  // -----------------------------------------------------------------------
  // Expose
  // -----------------------------------------------------------------------

  window.FallingForeverVoice = FallingForeverVoice;

})();
