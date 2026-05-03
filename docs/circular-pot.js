/**
 * circular-pot.js
 * Wrapper around pureknob.js providing a consistent circular potentiometer UI component.
 * Handles value scaling for fractional steps, formatting, silent value updates,
 * and color theming. Silent updates prevent feedback loops when monitor data arrives.
 */
(function (root) {
  "use strict";

  var KNOB_SIZE = 70;
  var ANGLE_START = 0.75 * Math.PI;
  var ANGLE_END = 2.25 * Math.PI;
  var COLOR_TRACK = '#2a2a3e';
  var COLOR_PURPLE = '#8B5CF6';
  var COLOR_TEAL = '#14B8A6';
  var COLOR_LABEL = '#e2e8f0';

  /**
   * CircularPot constructor
   * @param {Object} options - Configuration object
   * @param {string} options.name - Parameter name
   * @param {string} [options.label] - Display label (defaults to name)
   * @param {number} [options.min=0] - Minimum parameter value
   * @param {number} [options.max=100] - Maximum parameter value
   * @param {number} [options.step=1] - Minimum step size (can be fractional)
   * @param {number} [options.value] - Initial value
   * @param {Function} [options.onChange] - Callback on user change
   * @param {string} [options.color] - Knob color (defaults to purple)
   * @param {number} [options.size=70] - Knob size in pixels
   * @param {boolean} [options.readonly=false] - If true, knob is non-interactive
   */
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

  /**
   * Build the pureknob instance with pureknob configuration and value converters
   * @private
   */
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

  /**
   * Convert parameter value to integer for pureknob (handles fractional steps).
   * For step < 1, multiplies by 10^precision to store as integer.
   * Example: value=0.5 with step=0.1 -> multiply by 10 -> 5
   * @private
   * @param {number} val - Parameter value
   * @returns {number} Integer value suitable for pureknob
   */
  CircularPot.prototype._toInternal = function (val) {
    if (this.step < 1) {
      var precision = Math.ceil(-Math.log10(this.step));
      var multiplier = Math.pow(10, precision);
      return Math.round(val * multiplier);
    }
    return Math.round(val);
  };

  /**
   * Convert pureknob integer back to parameter value (inverse of _toInternal).
   * For step < 1, divides by 10^precision to restore original scale.
   * @private
   * @param {number} raw - Integer value from pureknob
   * @returns {number} Parameter value in original scale
   */
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

  /**
   * Gets the DOM node for insertion into the page
   * @returns {HTMLElement} Container div
   */
  CircularPot.prototype.node = function () {
    return this._container;
  };

  /**
   * Set value and trigger onChange callback
   * @param {number} val - New parameter value
   */
  CircularPot.prototype.setValue = function (val) {
    this.value = val;
    this._knob.setValue(this._toInternal(val));
  };

  /**
   * Silent value update: Sets value without triggering onChange callback.
   * Used by monitor data updates to prevent feedback loops when hardware values
   * arrive and sync the UI without broadcasting change events.
   * @param {number} val - New parameter value
   */
  CircularPot.prototype.setValueSilent = function (val) {
    this.value = val;
    this._knob.setValueFloating(this._toInternal(val));
  };

  /**
   * Change the knob foreground color
   * @param {string} color - CSS color string
   */
  CircularPot.prototype.setColor = function (color) {
    this.color = color;
    this._knob.setProperty('colorFG', color);
  };

  /**
   * Cleanup: Removes DOM node and nullifies references
   */
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
