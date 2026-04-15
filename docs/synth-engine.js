/**
 * synth-engine.js — Core Web Audio API synth engine for Pico 2 Synth Workshop v2
 *
 * Provides shared audio infrastructure (AudioContext, master gain, analyser)
 * and helper functions that individual voice JS files build upon.
 *
 * Voice files create their own oscillators / nodes and connect them to
 * SynthEngine.getMasterGain(). This engine handles the shared output chain:
 *   voice output  ->  master gain  ->  analyser  ->  destination
 *
 * No external dependencies.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  var _ctx = null;       // AudioContext
  var _masterGain = null; // GainNode
  var _analyser = null;   // AnalyserNode

  var MASTER_GAIN_DEFAULT = 0.7;
  var ANALYSER_FFT_SIZE = 2048;

  // ---------------------------------------------------------------------------
  // SynthEngine core
  // ---------------------------------------------------------------------------

  var SynthEngine = {

    /**
     * Initialise (or re-initialise) the audio graph.
     * Creates the AudioContext on first call and builds the master output chain.
     * Safe to call multiple times — subsequent calls resume a suspended context.
     * Returns a Promise that resolves when the context is running.
     */
    init: function () {
      try {
        if (!_ctx) {
          var AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) {
            throw new Error("Web Audio API is not supported in this browser.");
          }
          _ctx = new AudioCtx();
        }

        // Build the output chain only once
        if (!_masterGain) {
          _masterGain = _ctx.createGain();
          _masterGain.gain.value = MASTER_GAIN_DEFAULT;

          _analyser = _ctx.createAnalyser();
          _analyser.fftSize = ANALYSER_FFT_SIZE;

          // voice output -> masterGain -> analyser -> destination
          _masterGain.connect(_analyser);
          _analyser.connect(_ctx.destination);
        }

        // Handle autoplay-policy suspension
        if (_ctx.state === "suspended") {
          return _ctx.resume();
        }

        return Promise.resolve();
      } catch (err) {
        console.error("[SynthEngine] init failed:", err);
        return Promise.reject(err);
      }
    },

    /**
     * Returns the master GainNode. Voice files connect their output here.
     */
    getMasterGain: function () {
      return _masterGain;
    },

    /**
     * Returns the AnalyserNode (useful for waveform / FFT visualisation).
     */
    getAnalyser: function () {
      return _analyser;
    },

    /**
     * Returns the underlying AudioContext.
     */
    getContext: function () {
      return _ctx;
    },

    /**
     * Returns true if the AudioContext exists and is in the "running" state.
     */
    isRunning: function () {
      return _ctx !== null && _ctx.state === "running";
    },

    /**
     * Resumes a suspended AudioContext (required after autoplay-policy block).
     * Returns a Promise.
     */
    resume: function () {
      if (_ctx && _ctx.state === "suspended") {
        return _ctx.resume();
      }
      return Promise.resolve();
    },

    // -----------------------------------------------------------------------
    // Helper / utility functions
    // -----------------------------------------------------------------------

    /**
     * Convert a MIDI note number (0-127) to frequency in Hz.
     * Uses the standard equal-temperament formula: f = 440 * 2^((n-69)/12)
     */
    midiToHz: function (midiNote) {
      return 440 * Math.pow(2, (midiNote - 69) / 12);
    },

    /**
     * Create a PeriodicWave representing a band-limited sawtooth waveform.
     * @param {AudioContext} ctx   – AudioContext to use
     * @param {number}       length – number of harmonics (default 32)
     * @returns {PeriodicWave}
     */
    createSawWave: function (ctx, length) {
      length = length || 32;
      var real = new Float32Array(length + 1);
      var imag = new Float32Array(length + 1);
      // DC component is zero
      real[0] = 0;
      imag[0] = 0;
      for (var h = 1; h <= length; h++) {
        // Sawtooth: imag[h] = (-1)^(h+1) / h  (normalised)
        real[h] = 0;
        imag[h] = (h % 2 === 0 ? -1 : 1) / h;
      }
      return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    },

    /**
     * Create a PeriodicWave representing a band-limited square waveform.
     * @param {AudioContext} ctx   – AudioContext to use
     * @param {number}       length – number of harmonics (default 32)
     * @returns {PeriodicWave}
     */
    createSquareWave: function (ctx, length) {
      length = length || 32;
      var real = new Float32Array(length + 1);
      var imag = new Float32Array(length + 1);
      real[0] = 0;
      imag[0] = 0;
      for (var h = 1; h <= length; h++) {
        // Square: only odd harmonics, amplitude 1/h
        if (h % 2 !== 0) {
          real[h] = 0;
          imag[h] = 1 / h;
        }
      }
      return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    },

    /**
     * Create an AudioBuffer filled with white noise.
     * @param {AudioContext} ctx      – AudioContext to use
     * @param {number}       duration – length in seconds (default 2)
     * @returns {AudioBuffer}
     */
    createNoiseBuffer: function (ctx, duration) {
      duration = duration || 2;
      var sampleRate = ctx.sampleRate;
      var length = Math.floor(sampleRate * duration);
      var buffer = ctx.createBuffer(1, length, sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    },

    /**
     * Generate a wavetable as an array of Float32Arrays using additive synthesis.
     *
     * This mirrors the algorithm in the firmware's wavetable_synth.py:
     *   - Each successive wave in the table adds more harmonics.
     *   - Harmonic amplitudes decay as 1 / h^(0.5 + t*1.5) where t is the
     *     normalised position (0..1) through the table.
     *   - Phase shifts evolve as t * PI * h * 0.3 producing timbral movement.
     *
     * The values are normalised to the [-1, 1] range (Float32) so they can be
     * used directly with Web Audio PeriodicWave or as raw waveform data.
     *
     * @param {AudioContext} ctx        – AudioContext (used for consistency; not
     *                                    strictly required since we return raw arrays)
     * @param {number}       numWaves   – number of waves in the table (default 32)
     * @param {number}       waveLength – samples per wave (default 256)
     * @returns {Float32Array[]}  array of Float32Arrays, one per wave
     */
    createWavetable: function (ctx, numWaves, waveLength) {
      numWaves = numWaves || 32;
      waveLength = waveLength || 256;

      var table = [];

      for (var w = 0; w < numWaves; w++) {
        var wave = new Float32Array(waveLength);
        var numHarmonics = 1 + Math.floor(w * 12 / numWaves);
        var t = w / numWaves; // 0.0 .. ~1.0

        for (var h = 1; h <= numHarmonics; h++) {
          // Amplitude decreases with harmonic number, modulated by position
          var amp = 1.0 / Math.pow(h, 0.5 + t * 1.5);
          // Phase shifts create evolving timbre
          var phaseShift = t * Math.PI * h * 0.3;

          for (var i = 0; i < waveLength; i++) {
            var angle = 2 * Math.PI * i * h / waveLength + phaseShift;
            wave[i] += amp * Math.sin(angle);
          }
        }

        // Normalise to [-1, 1]
        var peak = 0;
        for (var j = 0; j < waveLength; j++) {
          var abs = Math.abs(wave[j]);
          if (abs > peak) {
            peak = abs;
          }
        }
        if (peak > 0) {
          for (var k = 0; k < waveLength; k++) {
            wave[k] /= peak;
          }
        }

        table.push(wave);
      }

      return table;
    },

    /**
     * Map a value from one numeric range to another.
     * @param {number} value – input value
     * @param {number} inMin – input range minimum
     * @param {number} inMax – input range maximum
     * @param {number} outMin – output range minimum
     * @param {number} outMax – output range maximum
     * @returns {number}
     */
    mapRange: function (value, inMin, inMax, outMin, outMax) {
      return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
    },

    /**
     * Clamp a value to the [min, max] range.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    clamp: function (value, min, max) {
      return value < min ? min : value > max ? max : value;
    },

    /**
     * Linear interpolation between a and b by factor t (0..1).
     * @param {number} a – start value
     * @param {number} b – end value
     * @param {number} t – interpolation factor
     * @returns {number}
     */
    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    /**
     * Load a WAV file as an AudioBuffer.
     * @param {string} url – path to WAV file (relative or absolute)
     * @returns {Promise<AudioBuffer>}
     */
    loadWav: function (url) {
      var ctx = SynthEngine.getContext();
      if (!ctx) return Promise.reject(new Error("AudioContext not initialized"));
      return fetch(url)
        .then(function (resp) {
          if (!resp.ok) throw new Error("Failed to load WAV: " + url);
          return resp.arrayBuffer();
        })
        .then(function (buf) {
          return ctx.decodeAudioData(buf);
        });
    },

    /**
     * Extract wavetable slices from an AudioBuffer.
     * Returns an array of Float32Arrays, each of waveLen samples.
     * @param {AudioBuffer} buffer – decoded WAV audio buffer
     * @param {number} waveLen – samples per wave slice (default 256)
     * @returns {Float32Array[]}
     */
    extractWavetable: function (buffer, waveLen) {
      waveLen = waveLen || 256;
      var data = buffer.getChannelData(0);
      var numWaves = Math.floor(data.length / waveLen);
      var table = [];
      for (var i = 0; i < numWaves; i++) {
        var slice = new Float32Array(waveLen);
        for (var j = 0; j < waveLen; j++) {
          slice[j] = data[i * waveLen + j];
        }
        table.push(slice);
      }
      return table;
    }
  };

  // ---------------------------------------------------------------------------
  // Expose on window
  // ---------------------------------------------------------------------------
  window.SynthEngine = SynthEngine;

})();
