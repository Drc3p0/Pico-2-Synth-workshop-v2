(function (root) {
  "use strict";

  function EventBus() {
    this._subs = {};
    this._lastValues = {};
  }

  EventBus.prototype.publish = function (channel, value) {
    this._lastValues[channel] = value;
    var listeners = this._subs[channel];
    if (!listeners) return;
    for (var i = 0; i < listeners.length; i++) {
      listeners[i](value, channel);
    }
  };

  EventBus.prototype.subscribe = function (channel, callback) {
    if (!this._subs[channel]) this._subs[channel] = [];
    this._subs[channel].push(callback);
    return function () {
      var arr = this._subs[channel];
      if (!arr) return;
      var idx = arr.indexOf(callback);
      if (idx !== -1) arr.splice(idx, 1);
    }.bind(this);
  };

  EventBus.prototype.lastValue = function (channel) {
    return this._lastValues[channel];
  };

  EventBus.prototype.clear = function () {
    this._subs = {};
    this._lastValues = {};
  };

  root.EventBus = EventBus;
})(window);
