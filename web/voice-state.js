(function (root) {
  "use strict";

  function VoiceStateManager() {
    this._states = {};
    this._activeVoiceId = null;
  }

  VoiceStateManager.prototype.snapshot = function (voiceId, currentState) {
    this._states[voiceId] = {
      params: JSON.parse(JSON.stringify(currentState.params || {})),
      layout: JSON.parse(JSON.stringify(currentState.layout || {})),
      bindings: JSON.parse(JSON.stringify(currentState.bindings || {})),
      gpioAssignments: JSON.parse(JSON.stringify(currentState.gpioAssignments || {})),
      zoneMinHeight: currentState.zoneMinHeight || 300
    };
  };

  VoiceStateManager.prototype.restore = function (voiceId) {
    var saved = this._states[voiceId];
    if (!saved) return null;
    return JSON.parse(JSON.stringify(saved));
  };

  VoiceStateManager.prototype.hasState = function (voiceId) {
    return !!this._states[voiceId];
  };

  VoiceStateManager.prototype.setActive = function (voiceId) {
    this._activeVoiceId = voiceId;
  };

  VoiceStateManager.prototype.getActive = function () {
    return this._activeVoiceId;
  };

  VoiceStateManager.prototype.clearAll = function () {
    this._states = {};
  };

  root.VoiceStateManager = VoiceStateManager;
})(window);
