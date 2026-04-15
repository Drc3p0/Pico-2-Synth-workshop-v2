/**
 * wavetable-synth.js — Morphing wavetable synth voice
 *
 * Generates a 32-wave wavetable via SynthEngine.createWavetable() and scans
 * through it with an LFO. Two oscillators crossfade during wave transitions
 * to avoid clicks. A lowpass BiquadFilter shapes the timbre.
 *
 * Self-play cycles through a minor-flavoured scale stepping by 3.
 *
 * Exposes: window.WavetableSynthVoice
 */
(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a single-cycle Float32Array waveform into a PeriodicWave.
   * Performs a naive DFT to extract real/imag coefficients up to numHarmonics.
   */
  function waveformToPeriodicWave(ctx, samples, numHarmonics) {
    numHarmonics = numHarmonics || 64;
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
  // WavetableSynthVoice
  // -------------------------------------------------------------------------

  function WavetableSynthVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;
    this._disposed = false;
    this._playing = false;
    this._selfPlaying = false;

    // Parameters
    this._waveScanMin = 4;
    this._waveScanMax = 20;
    this._waveLfoRate = 0.1;   // Hz — full LFO cycle
    this._filterFreq = 4000;

    // Generate wavetable (array of Float32Array)
    this._rawTable = SynthEngine.createWavetable(ctx, 32, 256);

    // Pre-compute PeriodicWave objects for each table slot
    this._periodicWaves = [];
    for (var i = 0; i < this._rawTable.length; i++) {
      this._periodicWaves.push(waveformToPeriodicWave(ctx, this._rawTable[i], 48));
    }

    // Current wave position (float index into table)
    this._wavePos = this._waveScanMin;
    this._lfoPhase = 0; // 0..1

    // Audio nodes — two oscillators for crossfading
    this._oscA = null;
    this._oscB = null;
    this._gainA = null;
    this._gainB = null;
    this._currentOscIndex = -1; // which table index oscA is set to

    this._filter = null;
    this._voiceGain = null;

    // Scan interval
    this._scanInterval = null;

    // Self-play state
    this._selfPlayNotes = [36, 38, 40, 41, 43, 45, 46, 48, 50, 52]; // C2..E3
    this._selfPlayIndex = 0;
    this._selfPlayTimer = null;
    this._currentNote = null;

    // Active notes (for noteOn/noteOff)
    this._activeNotes = {};
  }

  // -----------------------------------------------------------------------
  // Internal: build / tear-down audio graph
  // -----------------------------------------------------------------------

  WavetableSynthVoice.prototype._buildGraph = function () {
    if (this._voiceGain) return; // already built

    var ctx = this._ctx;

    // Voice output gain
    this._voiceGain = ctx.createGain();
    this._voiceGain.gain.value = 0.35;

    // Lowpass filter
    this._filter = ctx.createBiquadFilter();
    this._filter.type = "lowpass";
    this._filter.frequency.value = this._filterFreq;
    this._filter.Q.value = 1.2;

    // Crossfade gains
    this._gainA = ctx.createGain();
    this._gainA.gain.value = 1.0;
    this._gainB = ctx.createGain();
    this._gainB.gain.value = 0.0;

    // Oscillators
    this._oscA = ctx.createOscillator();
    this._oscB = ctx.createOscillator();
    var initWave = this._periodicWaves[Math.floor(this._waveScanMin)];
    this._oscA.setPeriodicWave(initWave);
    this._oscB.setPeriodicWave(initWave);
    this._currentOscIndex = Math.floor(this._waveScanMin);

    this._oscA.frequency.value = 130.81; // C3 default
    this._oscB.frequency.value = 130.81;

    // Routing: oscA -> gainA -> filter -> voiceGain -> master
    //          oscB -> gainB -> filter
    this._oscA.connect(this._gainA);
    this._oscB.connect(this._gainB);
    this._gainA.connect(this._filter);
    this._gainB.connect(this._filter);
    this._filter.connect(this._voiceGain);
    this._voiceGain.connect(this._masterGain);

    this._oscA.start();
    this._oscB.start();
  };

  WavetableSynthVoice.prototype._destroyGraph = function () {
    try {
      if (this._scanInterval) {
        clearInterval(this._scanInterval);
        this._scanInterval = null;
      }
      if (this._oscA) { this._oscA.stop(); this._oscA.disconnect(); this._oscA = null; }
      if (this._oscB) { this._oscB.stop(); this._oscB.disconnect(); this._oscB = null; }
      if (this._gainA) { this._gainA.disconnect(); this._gainA = null; }
      if (this._gainB) { this._gainB.disconnect(); this._gainB = null; }
      if (this._filter) { this._filter.disconnect(); this._filter = null; }
      if (this._voiceGain) { this._voiceGain.disconnect(); this._voiceGain = null; }
    } catch (e) { /* ignore cleanup errors */ }
  };

  // -----------------------------------------------------------------------
  // Wave scanning
  // -----------------------------------------------------------------------

  WavetableSynthVoice.prototype._startScanning = function () {
    if (this._scanInterval) return;
    var self = this;
    var intervalMs = 10; // ~100 Hz update rate

    this._scanInterval = setInterval(function () {
      if (self._disposed) return;
      self._updateWavePosition();
    }, intervalMs);
  };

  WavetableSynthVoice.prototype._stopScanning = function () {
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
  };

  WavetableSynthVoice.prototype._updateWavePosition = function () {
    // Advance LFO phase
    var dt = 0.01; // ~10ms per tick
    this._lfoPhase += dt * this._waveLfoRate;
    if (this._lfoPhase > 1.0) this._lfoPhase -= 1.0;

    // Triangle LFO: 0..1..0 maps to scanMin..scanMax..scanMin
    var tri = this._lfoPhase < 0.5
      ? this._lfoPhase * 2.0
      : 2.0 - this._lfoPhase * 2.0;

    var scanMin = Math.max(0, Math.min(this._waveScanMin, this._periodicWaves.length - 1));
    var scanMax = Math.max(scanMin, Math.min(this._waveScanMax, this._periodicWaves.length - 1));

    this._wavePos = scanMin + tri * (scanMax - scanMin);

    var idxA = Math.floor(this._wavePos);
    var idxB = Math.min(idxA + 1, this._periodicWaves.length - 1);
    var frac = this._wavePos - idxA;

    // Crossfade: oscA plays idxA, oscB plays idxB, gains reflect fraction
    if (this._oscA && this._oscB && this._gainA && this._gainB) {
      if (idxA !== this._currentOscIndex) {
        this._oscA.setPeriodicWave(this._periodicWaves[idxA]);
        this._oscB.setPeriodicWave(this._periodicWaves[idxB]);
        this._currentOscIndex = idxA;
      }
      var now = this._ctx.currentTime;
      this._gainA.gain.setTargetAtTime(1.0 - frac, now, 0.005);
      this._gainB.gain.setTargetAtTime(frac, now, 0.005);
    }
  };

  // -----------------------------------------------------------------------
  // Set oscillator frequency
  // -----------------------------------------------------------------------

  WavetableSynthVoice.prototype._setFrequency = function (hz) {
    if (this._oscA) this._oscA.frequency.setTargetAtTime(hz, this._ctx.currentTime, 0.005);
    if (this._oscB) this._oscB.frequency.setTargetAtTime(hz, this._ctx.currentTime, 0.005);
  };

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  WavetableSynthVoice.prototype.start = function () {
    if (this._disposed || this._playing) return;
    this._playing = true;
    this._selfPlaying = true;
    this._buildGraph();
    this._startScanning();
    this._scheduleSelfPlayNote();
  };

  WavetableSynthVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  WavetableSynthVoice.prototype.stop = function () {
    this._playing = false;
    this._selfPlaying = false;
    this._stopScanning();

    if (this._selfPlayTimer) {
      clearTimeout(this._selfPlayTimer);
      this._selfPlayTimer = null;
    }

    // Fade out
    if (this._voiceGain) {
      this._voiceGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.05);
    }

    var self = this;
    setTimeout(function () {
      if (!self._playing) {
        self._destroyGraph();
      }
    }, 300);
  };

  WavetableSynthVoice.prototype.stopSelfPlay = function () {
    this._selfPlaying = false;
    if (this._selfPlayTimer) {
      clearTimeout(this._selfPlayTimer);
      this._selfPlayTimer = null;
    }
    // Keep graph alive for manual noteOn/noteOff
  };

  WavetableSynthVoice.prototype.noteOn = function (midiNote, vel) {
    if (this._disposed) return;
    this._buildGraph();
    this._startScanning();

    var hz = SynthEngine.midiToHz(midiNote);
    this._setFrequency(hz);
    this._activeNotes[midiNote] = hz;
    this._currentNote = midiNote;
    // Update self-play root so self-play uses this note going forward
    this._selfPlayRoot = midiNote;

    if (this._voiceGain) {
      var v = vel !== undefined ? (vel / 127) * 0.35 : 0.35;
      this._voiceGain.gain.setTargetAtTime(v, this._ctx.currentTime, 0.01);
    }
  };

  WavetableSynthVoice.prototype.noteOff = function (midiNote) {
    delete this._activeNotes[midiNote];

    // If no notes remain and not self-playing, fade out
    var remaining = Object.keys(this._activeNotes);
    if (remaining.length === 0 && !this._selfPlaying) {
      if (this._voiceGain) {
        this._voiceGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.08);
      }
    } else if (remaining.length > 0) {
      // Switch to last remaining note
      var lastHz = this._activeNotes[remaining[remaining.length - 1]];
      this._setFrequency(lastHz);
    }
  };

  WavetableSynthVoice.prototype.setParam = function (name, value) {
    switch (name) {
      case "wave_scan_min":
        this._waveScanMin = SynthEngine.clamp(Math.round(value), 0, this._periodicWaves.length - 1);
        break;
      case "wave_scan_max":
        this._waveScanMax = SynthEngine.clamp(Math.round(value), 0, this._periodicWaves.length - 1);
        break;
      case "wave_lfo_rate":
        this._waveLfoRate = Math.max(0.001, value);
        break;
      case "filter_freq":
        this._filterFreq = value;
        if (this._filter) {
          this._filter.frequency.setTargetAtTime(value, this._ctx.currentTime, 0.02);
        }
        break;
      case "note_trigger":
        this._triggerNextSelfPlayNote();
        break;
      case "bpm":
        this._bpm = value;
        // BPM controls auto-play speed: one note per beat
        this._autoPlaySpeed = 60 / value;
        break;
    }
  };

  WavetableSynthVoice.prototype.update = function () {
    // Called from requestAnimationFrame — no-op for this voice
    // (scanning is handled by setInterval for consistent timing)
  };

  WavetableSynthVoice.prototype.dispose = function () {
    this._disposed = true;
    this._selfPlaying = false;
    this._playing = false;

    if (this._selfPlayTimer) {
      clearTimeout(this._selfPlayTimer);
      this._selfPlayTimer = null;
    }

    this._stopScanning();
    this._destroyGraph();
    this._activeNotes = {};
  };

  // -----------------------------------------------------------------------
  // Self-play
  // -----------------------------------------------------------------------

  WavetableSynthVoice.prototype._scheduleSelfPlayNote = function () {
    if (!this._selfPlaying || this._disposed) return;

    this._triggerNextSelfPlayNote();

    var self = this;
    var autoPlayMs = (this._autoPlaySpeed || 2.0) * 1000 + Math.random() * 1500;
    this._selfPlayTimer = setTimeout(function () {
      if (self._selfPlaying && !self._disposed) {
        self._scheduleSelfPlayNote();
      }
    }, autoPlayMs);
  };

  WavetableSynthVoice.prototype._triggerNextSelfPlayNote = function () {
    if (this._disposed) return;
    this._buildGraph();
    this._startScanning();

    var noteIdx = this._selfPlayIndex % this._selfPlayNotes.length;
    var midi = this._selfPlayNotes[noteIdx];
    this._selfPlayIndex = (this._selfPlayIndex + 3) % this._selfPlayNotes.length;

    var hz = SynthEngine.midiToHz(midi);
    this._setFrequency(hz);
    this._currentNote = midi;

    if (this._voiceGain) {
      this._voiceGain.gain.setTargetAtTime(0.35, this._ctx.currentTime, 0.01);
    }
  };

  // -----------------------------------------------------------------------
  // Expose
  // -----------------------------------------------------------------------

  window.WavetableSynthVoice = WavetableSynthVoice;

})();
