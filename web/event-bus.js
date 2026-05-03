/**
 * event-bus.js
 * Lightweight pub/sub event bus with value retention.
 * Channels are string keys (e.g. "param:filter_freq", "hw:pot:0", "hw:accel:x").
 * The bus retains the last published value per channel for late subscribers.
 */
(function (root) {
  "use strict";

  /**
   * EventBus constructor
   * Initializes subscriber map and last-value cache
   */
  function EventBus() {
    this._subs = {};
    this._lastValues = {};
  }

  /**
   * Publishes a value to a channel, caches it, and notifies all subscribers
   * @param {string} channel - Channel identifier
   * @param {*} value - Value to publish
   */
  EventBus.prototype.publish = function (channel, value) {
    this._lastValues[channel] = value;
    var listeners = this._subs[channel];
    if (!listeners) return;
    for (var i = 0; i < listeners.length; i++) {
      listeners[i](value, channel);
    }
  };

  /**
   * Subscribes to a channel. Returns an unsubscribe function that removes the listener.
   * Late subscribers can query lastValue() to get the most recent published value.
   * @param {string} channel - Channel identifier
   * @param {Function} callback - Function to call when value is published
   * @returns {Function} Unsubscribe function to remove this listener
   */
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

  /**
   * Retrieves the last published value on a channel
   * @param {string} channel - Channel identifier
   * @returns {*} Last value published to this channel, or undefined if never published
   */
  EventBus.prototype.lastValue = function (channel) {
    return this._lastValues[channel];
  };

  /**
   * Clears all subscribers and cached values (for reset/cleanup)
   */
  EventBus.prototype.clear = function () {
    this._subs = {};
    this._lastValues = {};
  };

  root.EventBus = EventBus;
})(window);
