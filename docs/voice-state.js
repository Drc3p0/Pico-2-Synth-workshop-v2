/**
 * voice-state.js
 * Saves and restores per-voice hardware zone state.
 * Allows users to switch between voices without losing their hardware layout,
 * parameter bindings, and GPIO assignments. Uses deep clone via JSON round-trip.
 */
(function (root) {
  "use strict";

  /**
   * VoiceStateManager constructor
   * Maintains a cache of state snapshots per voice ID
   */
  function VoiceStateManager() {
    this._states = {};
    this._activeVoiceId = null;
  }

  /**
   * Snapshot pattern: Deep-clones current state and stores it for a voice ID.
   * Uses JSON.stringify/parse to ensure nested objects are fully copied.
   * @param {string} voiceId - Voice identifier
   * @param {Object} currentState - State object with params, layout, bindings, gpioAssignments
   */
  VoiceStateManager.prototype.snapshot = function (voiceId, currentState) {
    this._states[voiceId] = {
      params: JSON.parse(JSON.stringify(currentState.params || {})),
      layout: JSON.parse(JSON.stringify(currentState.layout || {})),
      bindings: JSON.parse(JSON.stringify(currentState.bindings || {})),
      gpioAssignments: JSON.parse(JSON.stringify(currentState.gpioAssignments || {})),
      zoneMinHeight: currentState.zoneMinHeight || 300
    };
  };

  /**
   * Restore pattern: Retrieves a previously snapshotted state and returns a deep copy.
   * Returns null if no snapshot exists for this voice ID.
   * @param {string} voiceId - Voice identifier
   * @returns {Object|null} Deep copy of saved state, or null if not found
   */
  VoiceStateManager.prototype.restore = function (voiceId) {
    var saved = this._states[voiceId];
    if (!saved) return null;
    return JSON.parse(JSON.stringify(saved));
  };

  /**
   * Checks if a voice has a saved state snapshot
   * @param {string} voiceId - Voice identifier
   * @returns {boolean} True if this voice has a snapshot
   */
  VoiceStateManager.prototype.hasState = function (voiceId) {
    return !!this._states[voiceId];
  };

  /**
   * Tracks the currently active voice ID
   * @param {string} voiceId - Voice identifier to set as active
   */
  VoiceStateManager.prototype.setActive = function (voiceId) {
    this._activeVoiceId = voiceId;
  };

  /**
   * Gets the currently active voice ID
   * @returns {string|null} Currently active voice ID, or null if none set
   */
  VoiceStateManager.prototype.getActive = function () {
    return this._activeVoiceId;
  };

  /**
   * Clears all saved state snapshots (reset for cleanup)
   */
  VoiceStateManager.prototype.clearAll = function () {
    this._states = {};
  };

  root.VoiceStateManager = VoiceStateManager;
})(window);
