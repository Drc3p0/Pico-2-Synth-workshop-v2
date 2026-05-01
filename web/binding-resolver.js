(function (root) {
  "use strict";

  function BindingResolver(bus) {
    this.bus = bus;
    this.bindings = {};
    this._unsubs = [];
  }

  BindingResolver.prototype.setBindings = function (bindings) {
    this.unbindAll();
    this.bindings = bindings || {};
    this._wireAll();
  };

  BindingResolver.prototype._wireAll = function () {
    var self = this;
    for (var paramName in this.bindings) {
      if (!this.bindings.hasOwnProperty(paramName)) continue;
      (function (pName, binding) {
        var mode = binding.mode;
        var source = binding.source;
        var config = binding.config || {};

        if (mode === "pot" || mode === "ldr") {
          var channel = "hw:" + mode + ":" + source;
          var unsub = self.bus.subscribe(channel, function (rawVal) {
            var min = config.min !== undefined ? config.min : 0;
            var max = config.max !== undefined ? config.max : 1;
            var normalized = rawVal / 1023;
            var mapped = min + normalized * (max - min);
            self.bus.publish("param:" + pName, mapped);
          });
          self._unsubs.push(unsub);
        } else if (mode === "accel") {
          var axis = config.axis || "x";
          var ch = "hw:accel:" + axis;
          var unsub2 = self.bus.subscribe(ch, function (rawVal) {
            var normalized = (rawVal + 1.0) / 2.0;
            var min = config.min !== undefined ? config.min : 0;
            var max = config.max !== undefined ? config.max : 1;
            self.bus.publish("param:" + pName, min + normalized * (max - min));
          });
          self._unsubs.push(unsub2);
        } else if (mode === "button" || mode === "touch_native" || mode === "touch_mpr121") {
          var btnCh = "hw:" + mode + ":" + source;
          var unsub3 = self.bus.subscribe(btnCh, function (pressed) {
            if (pressed) self.bus.publish("param:" + pName, 1);
          });
          self._unsubs.push(unsub3);
        } else if (mode === "pot_split") {
          var splitCh = "hw:pot:" + source;
          var unsub4 = self.bus.subscribe(splitCh, function (rawVal) {
            var voices = config.voices || [];
            if (voices.length === 0) return;
            var idx = Math.min(Math.floor((rawVal / 1024) * voices.length), voices.length - 1);
            self.bus.publish("param:voice_select", voices[idx]);
          });
          self._unsubs.push(unsub4);
        } else if (mode === "button_cycle") {
          var cycleCh = "hw:button:" + source;
          var cycleIdx = 0;
          var unsub5 = self.bus.subscribe(cycleCh, function (pressed) {
            if (!pressed) return;
            var voices = config.voices || [];
            if (voices.length === 0) return;
            cycleIdx = (cycleIdx + 1) % voices.length;
            self.bus.publish("param:voice_select", voices[cycleIdx]);
          });
          self._unsubs.push(unsub5);
        }
      })(paramName, this.bindings[paramName]);
    }
  };

  BindingResolver.prototype.unbindAll = function () {
    for (var i = 0; i < this._unsubs.length; i++) {
      this._unsubs[i]();
    }
    this._unsubs = [];
  };

  root.BindingResolver = BindingResolver;
})(window);
