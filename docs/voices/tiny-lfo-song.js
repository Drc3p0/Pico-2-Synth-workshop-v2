/**
 * tiny-lfo-song.js — Generative LFO piece
 *
 * 4 oscillators at intervals (0, -7, -12, -24 semitones from root).
 * Each oscillator has a tremolo LFO at different rates modulating its gain.
 * Song cycles through 3 note offsets (0, +5, -3) from start_note every
 * note_interval seconds.
 *
 * Exposed as window.TinyLfoSongVoice
 */
(function () {
  "use strict";

  var SEMITONE_OFFSETS = [0, -7, -12, -24];
  var SONG_OFFSETS = [0, 5, -3];
  var DEFAULT_LFO_RATES = [3.0, 2.0, 1.0, 0.75];
  var NUM_VOICES = 4;

  function TinyLfoSongVoice(ctx, masterGain) {
    this._ctx = ctx;
    this._masterGain = masterGain;

    this._params = {
      start_note: 65,
      note_interval: 8,
      lfo_rate_1: DEFAULT_LFO_RATES[0],
      lfo_rate_2: DEFAULT_LFO_RATES[1],
      lfo_rate_3: DEFAULT_LFO_RATES[2],
      lfo_rate_4: DEFAULT_LFO_RATES[3],
      note_trigger: 0
    };

    this._oscs = [];
    this._oscGains = [];
    this._lfos = [];
    this._lfoGains = [];
    this._outputGain = null;
    this._songIndex = 0;
    this._selfPlayTimer = null;
    this._playing = false;

    this._buildGraph();
  }

  TinyLfoSongVoice.prototype._buildGraph = function () {
    var ctx = this._ctx;

    // Master output gain
    this._outputGain = ctx.createGain();
    this._outputGain.gain.value = 0.0;
    this._outputGain.connect(this._masterGain);

    for (var i = 0; i < NUM_VOICES; i++) {
      // Oscillator — sine for a gentle generative feel
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 440; // placeholder
      osc.start();

      // Per-voice gain (tremolo target)
      var g = ctx.createGain();
      g.gain.value = 0.25;

      osc.connect(g);
      g.connect(this._outputGain);

      // Tremolo LFO -> gain
      var lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = DEFAULT_LFO_RATES[i];
      lfo.start();

      var lfoG = ctx.createGain();
      // Modulation depth — oscillates gain between ~0 and 0.5
      lfoG.gain.value = 0.25;

      lfo.connect(lfoG);
      lfoG.connect(g.gain);

      this._oscs.push(osc);
      this._oscGains.push(g);
      this._lfos.push(lfo);
      this._lfoGains.push(lfoG);
    }
  };

  // ---------------------------------------------------------------------------
  // Set frequencies for all oscillators based on root note + song offset
  // ---------------------------------------------------------------------------
  TinyLfoSongVoice.prototype._applyNotes = function (rootMidi) {
    var now = this._ctx.currentTime;
    for (var i = 0; i < NUM_VOICES; i++) {
      var midi = rootMidi + SEMITONE_OFFSETS[i];
      var hz = 440 * Math.pow(2, (midi - 69) / 12);
      this._oscs[i].frequency.setTargetAtTime(hz, now, 0.08);
    }
  };

  // ---------------------------------------------------------------------------
  // Self-play: cycle through song offsets
  // ---------------------------------------------------------------------------
  TinyLfoSongVoice.prototype._scheduleSongStep = function () {
    var self = this;
    if (!self._playing) return;

    var offset = SONG_OFFSETS[self._songIndex % SONG_OFFSETS.length];
    self._songIndex++;
    self._applyNotes(self._params.start_note + offset);

    self._selfPlayTimer = setTimeout(function () {
      self._scheduleSongStep();
    }, self._params.note_interval * 1000);
  };

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  TinyLfoSongVoice.prototype.start = function () {
    if (this._playing) return;
    this._playing = true;
    // Fade in
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.7, now, 0.2);
    this._scheduleSongStep();
  };

  TinyLfoSongVoice.prototype.startSelfPlay = function () {
    this.start();
  };

  TinyLfoSongVoice.prototype.stop = function () {
    this._playing = false;
    if (this._selfPlayTimer) {
      clearTimeout(this._selfPlayTimer);
      this._selfPlayTimer = null;
    }
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.0, now, 0.15);
  };

  TinyLfoSongVoice.prototype.stopSelfPlay = function () {
    this.stop();
  };

  TinyLfoSongVoice.prototype.noteOn = function (midiNote, vel) {
    this._applyNotes(midiNote);
    // Update start_note so self-play uses this root going forward
    this._params.start_note = midiNote;
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.7, now, 0.05);
  };

  TinyLfoSongVoice.prototype.noteOff = function (midiNote) {
    var now = this._ctx.currentTime;
    this._outputGain.gain.cancelScheduledValues(now);
    this._outputGain.gain.setTargetAtTime(0.0, now, 0.4);
  };

  TinyLfoSongVoice.prototype.setParam = function (name, value) {
    this._params[name] = value;

    var now = this._ctx.currentTime;
    switch (name) {
      case "start_note":
        // Re-apply current song step with new root
        var offset = SONG_OFFSETS[(this._songIndex - 1 + SONG_OFFSETS.length) % SONG_OFFSETS.length];
        this._applyNotes(value + offset);
        break;
      case "note_interval":
        // Applied on next cycle
        break;
      case "lfo_rate_1":
        this._lfos[0].frequency.setTargetAtTime(value, now, 0.05);
        break;
      case "lfo_rate_2":
        this._lfos[1].frequency.setTargetAtTime(value, now, 0.05);
        break;
      case "lfo_rate_3":
        this._lfos[2].frequency.setTargetAtTime(value, now, 0.05);
        break;
      case "lfo_rate_4":
        this._lfos[3].frequency.setTargetAtTime(value, now, 0.05);
        break;
      case "note_trigger":
        if (value) {
          // Advance to next song step immediately
          var nextOffset = SONG_OFFSETS[this._songIndex % SONG_OFFSETS.length];
          this._songIndex++;
          this._applyNotes(this._params.start_note + nextOffset);
        }
        break;
      case "bpm":
        this._bpm = value;
        // BPM controls note_interval: 8 beats between changes
        this._params.note_interval = 60 / value * 8;
        break;
    }
  };

  TinyLfoSongVoice.prototype.update = function () {
    // LFOs run on audio thread — nothing needed per frame
  };

  TinyLfoSongVoice.prototype.dispose = function () {
    this.stop();

    for (var i = 0; i < NUM_VOICES; i++) {
      try { this._oscs[i].stop(); } catch (e) { /* ok */ }
      try { this._lfos[i].stop(); } catch (e) { /* ok */ }
      try { this._oscs[i].disconnect(); } catch (e) { /* ok */ }
      try { this._oscGains[i].disconnect(); } catch (e) { /* ok */ }
      try { this._lfos[i].disconnect(); } catch (e) { /* ok */ }
      try { this._lfoGains[i].disconnect(); } catch (e) { /* ok */ }
    }
    this._oscs = [];
    this._oscGains = [];
    this._lfos = [];
    this._lfoGains = [];

    try { this._outputGain.disconnect(); } catch (e) { /* ok */ }
    this._outputGain = null;
  };

  // Expose
  window.TinyLfoSongVoice = TinyLfoSongVoice;

})();
