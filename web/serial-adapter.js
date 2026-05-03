/**
 * serial-adapter.js
 * Bridges PicoSerial incoming JSON data to the EventBus.
 * When the Pico sends monitor data (pot values, button states, accel XY, touch states),
 * this module dispatches each to the appropriate bus channel for downstream subscribers.
 */
(function (root) {
  "use strict";

  /**
   * SerialAdapter constructor
   * @param {EventBus} bus - The event bus for publishing hardware data
   */
  function SerialAdapter(bus) {
    this.bus = bus;
  }

  /**
   * Initializes the adapter by subscribing to PicoSerial.onData callback
   * Skips raw telemetry data (where _raw is set)
   */
  SerialAdapter.prototype.init = function () {
    if (!root.PicoSerial) return;
    var self = this;
    PicoSerial.onData(function (data) {
      if (!data || data._raw) return;
      self._dispatch(data);
    });
  };

  /**
   * Dispatch routing: Routes incoming Pico monitor data to appropriate bus channels.
   * - data.pot[N] -> publishes to "hw:pot:N"
   * - data.btn[N] -> publishes to "hw:button:N"
   * - data.accel[0] -> publishes to "hw:accel:x"
   * - data.accel[1] -> publishes to "hw:accel:y"
   * - data.touch[N] -> publishes to "hw:touch_mpr121:N"
   * @private
   */
  SerialAdapter.prototype._dispatch = function (data) {
    if (data.pot && Array.isArray(data.pot)) {
      for (var p = 0; p < data.pot.length; p++) {
        this.bus.publish("hw:pot:" + p, data.pot[p]);
      }
    }
    if (data.btn && Array.isArray(data.btn)) {
      for (var b = 0; b < data.btn.length; b++) {
        this.bus.publish("hw:button:" + b, data.btn[b]);
      }
    }
    if (data.accel && Array.isArray(data.accel)) {
      if (data.accel.length > 0) this.bus.publish("hw:accel:x", data.accel[0]);
      if (data.accel.length > 1) this.bus.publish("hw:accel:y", data.accel[1]);
    }
    if (data.touch && Array.isArray(data.touch)) {
      for (var t = 0; t < data.touch.length; t++) {
        this.bus.publish("hw:touch_mpr121:" + t, data.touch[t]);
      }
    }
  };

  root.SerialAdapter = SerialAdapter;
})(window);
