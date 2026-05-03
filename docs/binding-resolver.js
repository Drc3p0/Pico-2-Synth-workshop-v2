/**
 * binding-resolver.js
 * Maps hardware inputs to synth parameters via EventBus pub/sub.
 * When a physical input (pot, accel, button) reports a value,
 * this module resolves the binding and publishes the mapped parameter value.
 * 
 * Supported binding modes:
 * - pot/ldr: ADC input normalized from 0-1023 to parameter range [min, max]
 * - accel: Accelerometer axis (-1 to +1) mapped to parameter range
 * - button/touch: Press event triggers parameter value = 1
 * - pot_split: Pot range divided into voice selections
 * - button_cycle: Each button press cycles through voice list
 */
(function (root) {
  "use strict";

  /**
   * BindingResolver constructor
   * @param {EventBus} bus - The event bus for publishing/subscribing
   */
  function BindingResolver(bus) {
    this.bus = bus;
    this.bindings = {};
    this._unsubs = [];
  }

  /**
   * Replaces all bindings and re-subscribes to hardware channels
   * @param {Object} bindings - Map of paramName -> {mode, source, config}
   */
  BindingResolver.prototype.setBindings = function (bindings) {
    this.unbindAll();
    this.bindings = bindings || {};
    this._wireAll();
  };

  /**
   * Subscribes to all binding channels and wires them to parameter publication.
   * Creates unsubscribe functions stored in _unsubs for cleanup.
   * @private
   */
  BindingResolver.prototype._wireAll = function () {
    var self = this;
    for (var paramName in this.bindings) {
      if (!this.bindings.hasOwnProperty(paramName)) continue;
      (function (pName, binding) {
        var mode = binding.mode;
        var source = binding.source;
        var config = binding.config || {};

        /**
         * pot/ldr binding mode: Normalizes ADC value (0-1023) to parameter range [min, max]
         * ADC values are linear, so we normalize to 0-1 then scale to [min, max]
         */
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
        /**
         * accel binding mode: Normalizes accelerometer axis value (-1 to +1) to parameter range
         * Raw accel values range from -1 to +1; normalize to 0-1 then scale to [min, max]
         */
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
        /**
         * button/touch binding mode: Button press triggers parameter value = 1
         * Supports touch_native (GPIO-based) and touch_mpr121 (I2C-based)
         */
        } else if (mode === "button" || mode === "touch_native" || mode === "touch_mpr121") {
          var btnCh = "hw:" + mode + ":" + source;
          var unsub3 = self.bus.subscribe(btnCh, function (pressed) {
            if (pressed) self.bus.publish("param:" + pName, 1);
          });
          self._unsubs.push(unsub3);
        /**
         * pot_split binding mode: Maps pot range into discrete voice selections
         * Divides the pot range (0-1023) into N equal sections, one per voice
         */
        } else if (mode === "pot_split") {
          var splitCh = "hw:pot:" + source;
          var unsub4 = self.bus.subscribe(splitCh, function (rawVal) {
            var voices = config.voices || [];
            if (voices.length === 0) return;
            var idx = Math.min(Math.floor((rawVal / 1024) * voices.length), voices.length - 1);
            self.bus.publish("param:voice_select", voices[idx]);
          });
          self._unsubs.push(unsub4);
        /**
         * button_cycle binding mode: Each button press cycles to the next voice in the list
         * Maintains internal cycleIdx that increments on each press
         */
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

  /**
   * Cleanup pattern: Calls all unsubscribe functions to remove event listeners
   * Resets _unsubs array to empty, allowing setBindings to be called again
   */
  BindingResolver.prototype.unbindAll = function () {
    for (var i = 0; i < this._unsubs.length; i++) {
      this._unsubs[i]();
    }
    this._unsubs = [];
  };

  root.BindingResolver = BindingResolver;
})(window);
