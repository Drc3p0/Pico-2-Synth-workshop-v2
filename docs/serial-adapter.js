(function (root) {
  "use strict";

  function SerialAdapter(bus) {
    this.bus = bus;
  }

  SerialAdapter.prototype.init = function () {
    if (!root.PicoSerial) return;
    var self = this;
    PicoSerial.onData(function (data) {
      if (!data || data._raw) return;
      self._dispatch(data);
    });
  };

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
