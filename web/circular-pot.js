(function (root) {
  "use strict";

  var KNOB_SIZE = 70;
  var ANGLE_START = 0.75 * Math.PI;
  var ANGLE_END = 2.25 * Math.PI;
  var COLOR_TRACK = '#2a2a3e';
  var COLOR_PURPLE = '#8B5CF6';
  var COLOR_TEAL = '#14B8A6';
  var COLOR_LABEL = '#e2e8f0';

  function CircularPot(options) {
    this.name = options.name;
    this.label = options.label || options.name;
    this.min = options.min || 0;
    this.max = options.max || 100;
    this.step = options.step || 1;
    this.value = options.value !== undefined ? options.value : this.min;
    this.onChange = options.onChange || null;
    this.color = options.color || COLOR_PURPLE;
    this.size = options.size || KNOB_SIZE;
    this.readonly = options.readonly || false;

    this._knob = null;
    this._container = null;
    this._build();
  }

  CircularPot.prototype._build = function () {
    var self = this;
    var knob = pureknob.createKnob(this.size, this.size);

    knob.setProperty('angleStart', ANGLE_START);
    knob.setProperty('angleEnd', ANGLE_END);
    knob.setProperty('colorBG', COLOR_TRACK);
    knob.setProperty('colorFG', this.color);
    knob.setProperty('colorLabel', COLOR_LABEL);
    knob.setProperty('trackWidth', 0.35);
    knob.setProperty('valMin', this._toInternal(this.min));
    knob.setProperty('valMax', this._toInternal(this.max));
    knob.setProperty('label', this.label);
    knob.setProperty('textScale', 0.8);
    knob.setProperty('readonly', this.readonly);
    knob.setProperty('fnValueToString', function (v) {
      return self._formatValue(self._fromInternal(v));
    });
    knob.setProperty('fnStringToValue', function (s) {
      return self._toInternal(parseFloat(s));
    });

    knob.setValue(this._toInternal(this.value));

    knob.addListener(function (_, rawVal) {
      var val = self._fromInternal(rawVal);
      self.value = val;
      if (self.onChange) {
        self.onChange(self.name, val);
      }
    });

    this._knob = knob;

    var wrapper = document.createElement('div');
    wrapper.className = 'circular-pot';
    wrapper.appendChild(knob.node());
    this._container = wrapper;
  };

  CircularPot.prototype._toInternal = function (val) {
    if (this.step < 1) {
      var precision = Math.ceil(-Math.log10(this.step));
      var multiplier = Math.pow(10, precision);
      return Math.round(val * multiplier);
    }
    return Math.round(val);
  };

  CircularPot.prototype._fromInternal = function (raw) {
    if (this.step < 1) {
      var precision = Math.ceil(-Math.log10(this.step));
      var multiplier = Math.pow(10, precision);
      return raw / multiplier;
    }
    return raw;
  };

  CircularPot.prototype._formatValue = function (val) {
    var absVal = Math.abs(val);
    if (absVal < 0.01) return val.toFixed(4);
    if (absVal < 1) return val.toFixed(3);
    if (absVal < 100) return val.toFixed(1);
    return Math.round(val).toString();
  };

  CircularPot.prototype.node = function () {
    return this._container;
  };

  CircularPot.prototype.setValue = function (val) {
    this.value = val;
    this._knob.setValue(this._toInternal(val));
  };

  CircularPot.prototype.setValueSilent = function (val) {
    this.value = val;
    this._knob.setValueFloating(this._toInternal(val));
  };

  CircularPot.prototype.setColor = function (color) {
    this.color = color;
    this._knob.setProperty('colorFG', color);
  };

  CircularPot.prototype.destroy = function () {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._knob = null;
    this._container = null;
  };

  root.CircularPot = CircularPot;
  root.CircularPot.COLOR_PURPLE = COLOR_PURPLE;
  root.CircularPot.COLOR_TEAL = COLOR_TEAL;

})(window);
