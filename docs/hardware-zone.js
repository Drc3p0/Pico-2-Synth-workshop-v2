/**
 * HardwareZone Module
 * 
 * Manages the interactive "Active Hardware" zone where users drag synth parameters, keys, and controls
 * to assign them to physical hardware inputs/outputs. Supports: pots, LDRs, buttons, touch pads (native GPIO
 * and MPR121 I2C), accelerometers, LED indicators, and OLED displays. Each item is absolutely positioned,
 * draggable, and configurable for GPIO pin assignment. Publishes parameter changes and state updates via
 * an event bus. Prevents GPIO pin conflicts through usedGPIO tracking.
 */
(function (root) {
  "use strict";

  var NEXT_Z = 100;
  var ITEM_ID = 0;

  /**
   * HW_TYPES: Array of available hardware types, each with:
   * - value: identifier used in code ("pot", "ldr", "button", "touch_native", "touch_mpr121", "accel", "led", "oled")
   * - label: user-facing name
   * - continuous: true for analog/stepped controls, false for discrete on/off inputs
   * - pins: array of compatible GPIO labels (e.g. ["GP26","GP27","GP28"], ["X","Y"], ["I2C (GP16/17)"])
   */
  var HW_TYPES = [
    { value: "pot", label: "Potentiometer", continuous: true, pins: ["GP26","GP27","GP28"] },
    { value: "ldr", label: "LDR (Light)", continuous: true, pins: ["GP26","GP27","GP28"] },
    { value: "button", label: "Button", continuous: false, pins: ["GP0","GP1","GP2","GP3","GP4","GP5","GP6","GP7"] },
    { value: "touch_native", label: "Touch (Pico GPIO)", continuous: false, pins: ["GP0","GP1","GP2","GP3","GP4","GP5","GP6","GP7","GP8","GP9","GP10","GP11","GP12","GP13","GP14","GP18","GP19","GP20","GP21","GP22"] },
    { value: "touch_mpr121", label: "Touch (MPR121 I2C)", continuous: false, pins: (function(){ var a=[]; for(var i=0;i<12;i++) a.push("MPR#"+i); return a; })() },
    { value: "accel", label: "Accelerometer", continuous: true, pins: ["X","Y"] },
    { value: "led", label: "LED Indicator", continuous: false, pins: ["GP0","GP1","GP2","GP3","GP4","GP5","GP6","GP7","GP8","GP9","GP10","GP11","GP12","GP13","GP14","GP25"] },
    { value: "oled", label: "OLED Display", continuous: false, pins: ["I2C (GP16/17)"] }
  ];

  /**
   * Lookup helper: returns the full HW_TYPES object for a given value string, or null if not found.
   */
  function getHwType(val) {
    for (var i = 0; i < HW_TYPES.length; i++) {
      if (HW_TYPES[i].value === val) return HW_TYPES[i];
    }
    return null;
  }

  /**
   * SCALE_OPTIONS: [code_value, display_label] pairs for the "scale" control.
   * Users can assign a single hardware input to cycle through or directly select scales.
   */
  var SCALE_OPTIONS = [
    ["chromatic","Chromatic"],["pentatonic_major","Pentatonic Maj"],
    ["pentatonic_minor","Pentatonic Min"],["blues_major","Blues Maj"],
    ["blues_minor","Blues Min"],["dorian","Dorian"],
    ["mixolydian","Mixolydian"],["harmonic_minor","Harmonic Min"]
  ];

  /**
   * ARP_OPTIONS: [code_value, display_label] pairs for the "arp_pattern" control (arpeggiator mode).
   * Users can assign buttons to select between up, down, up-down, or random patterns.
   */
  var ARP_OPTIONS = [["up","Up"],["down","Down"],["updown","Up-Down"],["random","Random"]];

  /**
   * HardwareZone Constructor
   * @param {Object} options Configuration object with:
   *   - bus: EventBus for publishing/subscribing to param and control changes
   *   - onStateChange: callback when layout/bindings change
   *   - getVoiceParams, setParamValue, getParamValue: voice parameter accessors
   *   - getControlValue, setControlValue: control state accessors
   *   - onKeyPress, onKeyRelease: key event callbacks
   *   - getScaleKeys: returns array of {index, label} objects for keyboard scale
   */
  function HardwareZone(options) {
    this.containerEl = null;
    this.zoneEl = null;
    this.resizeHandleEl = null;
    this.items = {}; // {id: item} map
    this.bus = options.bus;
    this.onStateChange = options.onStateChange || function(){};
    this.getVoiceParams = options.getVoiceParams || function(){ return {}; };
    this.getParamValue = options.getParamValue || function(){ return 0; };
    this.setParamValue = options.setParamValue || function(){};
    this.getControlValue = options.getControlValue || function(){ return null; };
    this.setControlValue = options.setControlValue || function(){};
    this.onKeyPress = options.onKeyPress || function(){};
    this.onKeyRelease = options.onKeyRelease || function(){};
    this.getNoteName = options.getNoteName || null;
    this.getScaleKeys = options.getScaleKeys || function(){ return []; };
    this.usedGPIO = {}; // {gpio: itemId} map to prevent pin conflicts
    this._minHeight = 300;
    this._resizing = false;
    this._resizeStartY = 0;
    this._resizeStartH = 0;
  }

  /**
   * Initializes the hardware zone DOM and event handlers in a given container.
   * Creates the drop target area, resize handle, and empty state message.
   */
  HardwareZone.prototype.init = function (containerId) {
    this.containerEl = document.getElementById(containerId);
    if (!this.containerEl) return;

    this.zoneEl = document.createElement("div");
    this.zoneEl.className = "hw-zone";
    this.zoneEl.style.position = "relative";
    this.zoneEl.style.minHeight = this._minHeight + "px";
    this.containerEl.appendChild(this.zoneEl);

    this._setupDropTarget();
    this._setupResizeHandle();
    this._renderEmptyState();
  };

  /**
   * Sets up drag-over visual feedback and drop handling. Parses JSON drag data
   * (from parameter/key/control source panels) and calls _handleDrop.
   */
  HardwareZone.prototype._setupDropTarget = function () {
    var self = this;
    this.zoneEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      self.zoneEl.classList.add("hw-zone-dragover");
    });
    this.zoneEl.addEventListener("dragleave", function (e) {
      if (!self.zoneEl.contains(e.relatedTarget)) {
        self.zoneEl.classList.remove("hw-zone-dragover");
      }
    });
    this.zoneEl.addEventListener("drop", function (e) {
      e.preventDefault();
      self.zoneEl.classList.remove("hw-zone-dragover");
      var rect = self.zoneEl.getBoundingClientRect();
      var dropX = e.clientX - rect.left;
      var dropY = e.clientY - rect.top;
      var dataStr = e.dataTransfer.getData("text/plain");
      if (!dataStr) return;
      try {
        var data = JSON.parse(dataStr);
        self._handleDrop(data, dropX, dropY);
      } catch (ex) { }
    });
  };

  /**
   * Routes dropped data to addItem with appropriate kind and metadata.
   * Handles: param, key (single), all-keys (keyboard), control, waveform.
   */
  HardwareZone.prototype._handleDrop = function (data, x, y) {
    if (data.type === "param") {
      this.addItem({ kind: "param", paramName: data.name, x: x, y: y });
    } else if (data.type === "key") {
      this.addItem({ kind: "key", keyIndex: data.keyIndex, x: x, y: y });
    } else if (data.type === "all-keys") {
      this.addItem({ kind: "keys", x: x, y: y });
    } else if (data.type === "control") {
      this.addItem({ kind: "control", controlName: data.name, label: data.label, x: x, y: y });
    } else if (data.type === "waveform") {
      this.addItem({ kind: "waveform", x: x, y: y });
    }
  };

  /**
   * Creates and manages the resize handle at the bottom of the zone. Supports
   * mouse and touch dragging to adjust zone height. Min height enforced at 200px.
   */
  HardwareZone.prototype._setupResizeHandle = function () {
    var self = this;
    var handle = document.createElement("div");
    handle.className = "hw-zone-resize-handle";
    this.containerEl.appendChild(handle);
    this.resizeHandleEl = handle;

    // Mouse drag: track starting position and height, update on move
    handle.addEventListener("mousedown", function (e) {
      e.preventDefault();
      self._resizing = true;
      self._resizeStartY = e.clientY;
      self._resizeStartH = self.zoneEl.offsetHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", function (e) {
      if (!self._resizing) return;
      var dy = e.clientY - self._resizeStartY;
      var newH = Math.max(200, self._resizeStartH + dy);
      self._minHeight = newH;
      self._updateHeight();
    });
    document.addEventListener("mouseup", function () {
      if (self._resizing) {
        self._resizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });

    // Touch drag: same logic as mouse
    handle.addEventListener("touchstart", function (e) {
      e.preventDefault();
      self._resizing = true;
      self._resizeStartY = e.changedTouches[0].clientY;
      self._resizeStartH = self.zoneEl.offsetHeight;
    }, { passive: false });
    document.addEventListener("touchmove", function (e) {
      if (!self._resizing) return;
      var dy = e.changedTouches[0].clientY - self._resizeStartY;
      self._minHeight = Math.max(200, self._resizeStartH + dy);
      self._updateHeight();
    });
    document.addEventListener("touchend", function () {
      self._resizing = false;
    });
  };

  /**
   * Recalculates zone height: takes the max of _minHeight (manual resize) or
   * the computed bounding height of all items plus padding.
   */
  HardwareZone.prototype._updateHeight = function () {
    var contentH = this._computeBoundingHeight();
    var h = Math.max(this._minHeight, contentH + 40);
    this.zoneEl.style.minHeight = h + "px";
  };

  /**
   * Returns the maximum bottom-edge Y position of all items in the zone.
   * Used to auto-grow zone height to fit content.
   */
  HardwareZone.prototype._computeBoundingHeight = function () {
    var maxBottom = 0;
    for (var id in this.items) {
      var it = this.items[id];
      if (it.el) {
        var bottom = (it.y || 0) + (it.el.offsetHeight || 80);
        if (bottom > maxBottom) maxBottom = bottom;
      }
    }
    return maxBottom;
  };

  /**
   * Renders "empty state" message when zone has no items.
   * Removes it when items exist.
   */
  HardwareZone.prototype._renderEmptyState = function () {
    if (Object.keys(this.items).length > 0) {
      var empty = this.zoneEl.querySelector(".hw-zone-empty");
      if (empty) empty.parentNode.removeChild(empty);
      return;
    }
    if (!this.zoneEl.querySelector(".hw-zone-empty")) {
      var el = document.createElement("div");
      el.className = "hw-zone-empty";
      el.innerHTML = '<div class="hw-zone-empty-icon">&#8693;</div><p>Drag parameters, keys, or controls here to build your hardware layout</p>';
      this.zoneEl.appendChild(el);
    }
  };

  /**
   * Creates and adds a new item to the zone. Item shape:
   * {id, kind, paramName, keyIndex, controlName, label, hwType, gpio, x, y, width, height,
   *  binding, config, el, _pot, _busSubs}
   * 
   * Kind types: "param" (voice parameter), "key" (single key), "keys" (keyboard/scale),
   * "control" (scale/arp/tonality/etc.), "waveform" (OLED).
   * 
   * Prevents duplicate "param" items; returns existing item ID if param already exists.
   * Returns the new item ID.
   */
  HardwareZone.prototype.addItem = function (opts) {
    // Prevent duplicate param items
    if (opts.kind === "param" && opts.paramName) {
      for (var eid in this.items) {
        if (this.items[eid].paramName === opts.paramName) return eid;
      }
    }
    this._clearEmpty();
    var id = "hw-" + (++ITEM_ID);
    var item = {
      id: id,
      kind: opts.kind,
      paramName: opts.paramName || null,
      keyIndex: opts.keyIndex !== undefined ? opts.keyIndex : null,
      controlName: opts.controlName || null,
      label: opts.label || opts.paramName || opts.controlName || "Item",
      hwType: opts.hwType || null,
      gpio: opts.gpio || null,
      x: opts.x || 20,
      y: opts.y || 20,
      width: opts.width || null,
      height: opts.height || null,
      binding: null,
      config: opts.config || {},
      el: null,
      _pot: null,
      _busSubs: []
    };

    var el = this._renderItem(item);
    item.el = el;
    this.zoneEl.appendChild(el);
    this.items[id] = item;

    this._makeDraggableInZone(item);
    this._updateHeight();
    this._fireChange();
    return id;
  };

  /**
   * Removes an item from the zone. Cleans up:
   * - Bus subscriptions
   * - CircularPot instances
   * - GPIO pin reservations from usedGPIO
   * - DOM element
   */
  HardwareZone.prototype.removeItem = function (id) {
    var item = this.items[id];
    if (!item) return;
    // Unsubscribe from all bus events
    for (var i = 0; i < item._busSubs.length; i++) item._busSubs[i]();
    // Destroy pot visualizers
    if (item._pot) item._pot.destroy();
    if (item._potY) item._potY.destroy();
    // Free GPIO pins
    if (item.gpio) {
      if (Array.isArray(item.gpio)) {
        for (var g = 0; g < item.gpio.length; g++) delete this.usedGPIO[item.gpio[g]];
      } else {
        delete this.usedGPIO[item.gpio];
      }
    }
    if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el);
    delete this.items[id];
    this._renderEmptyState();
    this._updateHeight();
    this._fireChange();
  };

  /**
   * Removes the empty state placeholder.
   */
  HardwareZone.prototype._clearEmpty = function () {
    var empty = this.zoneEl.querySelector(".hw-zone-empty");
    if (empty) empty.parentNode.removeChild(empty);
  };

  /**
   * Renders the item DOM structure: header (title + remove button), hardware type selector,
   * GPIO selector, and body (for hardware-specific visuals).
   * 
   * If kind is "param", adds a param selector dropdown.
   */
  HardwareZone.prototype._renderItem = function (item) {
    var self = this;
    var el = document.createElement("div");
    el.className = "hw-zone-item hw-zone-item--" + item.kind;
    el.setAttribute("data-item-id", item.id);
    el.style.position = "absolute";
    el.style.left = item.x + "px";
    el.style.top = item.y + "px";
    el.style.zIndex = ++NEXT_Z;
    if (item.width) el.style.width = item.width + "px";

    // Header: item title and remove button
    var header = document.createElement("div");
    header.className = "hw-item-header";
    var titleEl = document.createElement("span");
    titleEl.className = "hw-item-title";
    titleEl.textContent = this._itemLabel(item);
    header.appendChild(titleEl);

    var removeBtn = document.createElement("button");
    removeBtn.className = "hw-item-remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      self.removeItem(item.id);
    });
    header.appendChild(removeBtn);
    el.appendChild(header);

    // Param selector (only for kind="param")
    if (item.kind === "param") {
      var paramRow = document.createElement("div");
      paramRow.className = "hw-item-config";
      var paramSelect = document.createElement("select");
      paramSelect.className = "hw-item-type-select hw-param-select";
      this._populateParamSelect(paramSelect, item.paramName);
      paramSelect.addEventListener("change", function () {
        item.paramName = paramSelect.value || null;
        item.label = self._itemLabel(item);
        titleEl.textContent = item.label;
        self._updateItemVisual(item);
        self._refreshAllParamSelects(item.id);
        self._fireChange();
      });
      paramRow.appendChild(paramSelect);
      el.appendChild(paramRow);
      item._paramSelect = paramSelect;
    }

    // Hardware type and GPIO selector
    var hwRow = document.createElement("div");
    hwRow.className = "hw-item-config";

    var hwSelect = document.createElement("select");
    hwSelect.className = "hw-item-type-select";
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Choose type...";
    hwSelect.appendChild(noneOpt);

    var allowedTypes = this._allowedTypes(item);
    for (var i = 0; i < allowedTypes.length; i++) {
      var opt = document.createElement("option");
      opt.value = allowedTypes[i].value;
      opt.textContent = allowedTypes[i].label;
      hwSelect.appendChild(opt);
    }

    var gpioSelect = document.createElement("select");
    gpioSelect.className = "hw-item-gpio-select";
    gpioSelect.style.display = "none";

    hwSelect.addEventListener("change", function () {
      item.hwType = hwSelect.value || null;
      self._populateGPIO(gpioSelect, item);
      self._updateItemVisual(item);
      self._refreshAllGPIOSelects(item.id);
      self._fireChange();
    });
    gpioSelect.addEventListener("change", function () {
      if (item.gpio && !Array.isArray(item.gpio)) delete self.usedGPIO[item.gpio];
      item.gpio = gpioSelect.value;
      if (item.gpio) self.usedGPIO[item.gpio] = item.id;
      self._refreshAllGPIOSelects(item.id);
      self._fireChange();
    });

    hwRow.appendChild(hwSelect);
    hwRow.appendChild(gpioSelect);
    el.appendChild(hwRow);

    // Body element for hardware-specific visuals (pots, buttons, etc.)
    var body = document.createElement("div");
    body.className = "hw-item-body";
    item._bodyEl = body;
    el.appendChild(body);

    // If already configured, populate and render
    if (item.hwType) {
      hwSelect.value = item.hwType;
      item.el = el;
      this._populateGPIO(gpioSelect, item);
      this._updateItemVisual(item);
    } else if (item.kind === "control") {
      item.el = el;
      this._updateItemVisual(item);
    }

    return el;
  };

  /**
   * Generates a display label for an item based on its kind and associated data.
   */
  HardwareZone.prototype._itemLabel = function (item) {
    if (item.kind === "param") {
      if (!item.paramName) return "Unassigned";
      var params = this.getVoiceParams();
      var def = params[item.paramName];
      return def ? def.label : item.paramName;
    }
    if (item.kind === "key") {
      var noteName = this.getNoteName ? this.getNoteName(item.keyIndex) : null;
      return noteName || ("Key " + item.keyIndex);
    }
    if (item.kind === "keys") return "Keyboard (Scale)";
    if (item.kind === "control") return item.label || item.controlName;
    if (item.kind === "waveform") return "Waveform / OLED";
    return "Item";
  };

  /**
   * Filters HW_TYPES to allowed hardware types for a given item kind.
   * Trigger params only allow discrete (non-continuous) types, excluding LED/OLED.
   * Controls and keyboard items exclude OLED (waveform has only OLED).
   */
  HardwareZone.prototype._allowedTypes = function (item) {
    if (item.kind === "waveform") {
      return [{ value: "oled", label: "OLED Display" }];
    }
    if (item.kind === "param") {
      var params = this.getVoiceParams();
      var def = params[item.paramName];
      if (def && def.type === "trigger") {
        return HW_TYPES.filter(function (t) { return !t.continuous && t.value !== "led" && t.value !== "oled"; });
      }
      return HW_TYPES.filter(function (t) { return t.value !== "oled"; });
    }
    if (item.kind === "key" || item.kind === "keys") {
      return HW_TYPES.filter(function (t) { return t.value !== "oled"; });
    }
    if (item.kind === "control") {
      return HW_TYPES.filter(function (t) { return t.value !== "oled"; });
    }
    return HW_TYPES;
  };

  /**
   * Populates GPIO select dropdown for a hardware type. Auto-selects the first available
   * (non-reserved) pin and marks used pins as disabled. Clears old GPIO reservation before reassigning.
   */
  HardwareZone.prototype._populateGPIO = function (gpioSelect, item) {
    // Free any previously assigned GPIO for this item
    if (item.gpio) {
      if (Array.isArray(item.gpio)) {
        for (var g = 0; g < item.gpio.length; g++) delete this.usedGPIO[item.gpio[g]];
      } else {
        delete this.usedGPIO[item.gpio];
      }
      item.gpio = null;
    }
    gpioSelect.innerHTML = "";
    var hwt = getHwType(item.hwType);
    if (!hwt) { gpioSelect.style.display = "none"; return; }
    gpioSelect.style.display = "";
    var pins = hwt.pins;
    // Build option list with (used) indicator for reserved pins
    for (var i = 0; i < pins.length; i++) {
      var opt = document.createElement("option");
      opt.value = pins[i];
      opt.textContent = pins[i];
      if (this.usedGPIO[pins[i]]) {
        opt.disabled = true;
        opt.textContent += " (used)";
      }
      gpioSelect.appendChild(opt);
    }
    // Auto-assign first available pin
    for (var j = 0; j < pins.length; j++) {
      if (!this.usedGPIO[pins[j]]) {
        gpioSelect.value = pins[j];
        item.gpio = pins[j];
        this.usedGPIO[pins[j]] = item.id;
        break;
      }
    }
  };

  /**
   * Updates all GPIO selectors except the one being edited to reflect new pin availability.
   * Disables pins now in use, re-enables formerly used pins.
   */
  HardwareZone.prototype._refreshAllGPIOSelects = function (skipItemId) {
    var self = this;
    for (var id in this.items) {
      if (id === skipItemId) continue;
      var it = this.items[id];
      var sel = it.el ? it.el.querySelector(".hw-item-gpio-select") : null;
      if (!sel || !it.hwType) continue;
      if (Array.isArray(it.gpio)) continue;
      var hwt = getHwType(it.hwType);
      if (!hwt) continue;
      var curVal = it.gpio;
      var opts = sel.querySelectorAll("option");
      for (var i = 0; i < opts.length; i++) {
        var pin = opts[i].value;
        if (pin === curVal) {
          opts[i].disabled = false;
          opts[i].textContent = pin;
        } else if (self.usedGPIO[pin]) {
          opts[i].disabled = true;
          opts[i].textContent = pin + " (used)";
        } else {
          opts[i].disabled = false;
          opts[i].textContent = pin;
        }
      }
    }
  };

  /**
   * Populates param selector dropdown with available voice parameters.
   * Marks parameters already assigned to other items as disabled.
   */
  HardwareZone.prototype._populateParamSelect = function (selectEl, currentParam) {
    selectEl.innerHTML = "";
    var params = this.getVoiceParams();
    var usedParams = {};
    // Collect already-assigned params (excluding current item)
    for (var id in this.items) {
      var it = this.items[id];
      if (it.kind === "param" && it.paramName && it.paramName !== currentParam) {
        usedParams[it.paramName] = true;
      }
    }
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Assign param...";
    selectEl.appendChild(noneOpt);
    for (var pName in params) {
      if (!params.hasOwnProperty(pName)) continue;
      var opt = document.createElement("option");
      opt.value = pName;
      opt.textContent = params[pName].label || pName;
      if (usedParams[pName]) {
        opt.disabled = true;
        opt.textContent += " (assigned)";
      }
      selectEl.appendChild(opt);
    }
    if (currentParam) selectEl.value = currentParam;
  };

  /**
   * Updates param selectors in all other items to reflect current assignments.
   */
  HardwareZone.prototype._refreshAllParamSelects = function (skipItemId) {
    for (var id in this.items) {
      if (id === skipItemId) continue;
      var it = this.items[id];
      if (it.kind !== "param" || !it._paramSelect) continue;
      this._populateParamSelect(it._paramSelect, it.paramName);
    }
  };

  /**
   * Public method: refreshes all param selectors (called when voice params list changes).
   * Updates labels and disables params that are no longer available.
   */
  HardwareZone.prototype.refreshParamSelectors = function () {
    for (var id in this.items) {
      var item = this.items[id];
      if (item.kind !== "param" || !item._paramSelect) continue;
      var prev = item.paramName;
      this._populateParamSelect(item._paramSelect, prev);
      var params = this.getVoiceParams();
      // Clear assignment if param no longer exists
      if (prev && !params[prev]) {
        item.paramName = null;
        item._paramSelect.value = "";
      }
      var titleEl = item.el.querySelector(".hw-item-title");
      if (titleEl) titleEl.textContent = this._itemLabel(item);
      this._updateItemVisual(item);
    }
    this._fireChange();
  };

  /**
   * Updates the visual representation of an item based on its hwType and kind.
   * Branches by hardware type (pot, accel, button, touch, led, oled) and item kind (param, key, keys, control).
   * Destroys old pots/subscriptions, creates new visual controls (CircularPot, buttons, etc.).
   */
  HardwareZone.prototype._updateItemVisual = function (item) {
    var body = item._bodyEl;
    if (!body) return;
    body.innerHTML = "";
    // Clean up old CircularPot instances
    if (item._pot) { item._pot.destroy(); item._pot = null; }
    // Unsubscribe from all bus events
    for (var i = 0; i < item._busSubs.length; i++) item._busSubs[i]();
    item._busSubs = [];

    // Controls (scale, arp_pattern, arp_speed, tonality, latch/arp/loop) don't need hwType
    if (item.kind === "control") {
      this._renderControlVisual(item, body);
      return;
    }

    if (!item.hwType) return;
    var hwt = getHwType(item.hwType);
    if (!hwt) return;

    // Add hardware type to CSS class for styling
    item.el.className = "hw-zone-item hw-zone-item--" + item.kind + " hw-zone-item--" + item.hwType;

    // Branch by hardware type and item kind
    if (item.hwType === "pot" || item.hwType === "ldr") {
      if (item.kind === "keys") {
        this._renderKeySweepVisual(item, body);
      } else {
        this._renderPotVisual(item, body);
      }
    } else if (item.hwType === "accel") {
      if (item.kind === "keys") {
        this._renderKeySweepVisual(item, body);
      } else {
        this._renderAccelVisual(item, body);
      }
    } else if (item.hwType === "button" || item.hwType === "touch_native" || item.hwType === "touch_mpr121") {
      if (item.kind === "keys") {
        this._renderKeyDiscreteVisual(item, body);
      } else if (item.hwType === "button") {
        this._renderButtonVisual(item, body);
      } else {
        this._renderTouchVisual(item, body);
      }
    } else if (item.hwType === "led") {
      this._renderLedVisual(item, body);
    } else if (item.hwType === "oled") {
      this._renderOledVisual(item, body);
    }
  };

  /**
   * Renders a CircularPot control for a continuous parameter (potentiometer, LDR, accelerometer).
   * Reads current param value, creates pot visual, syncs via bus and setParamValue callback.
   */
  HardwareZone.prototype._renderPotVisual = function (item, body) {
    var self = this;
    var params = this.getVoiceParams();
    var def = params[item.paramName] || {};
    var min = def.min !== undefined ? def.min : 0;
    var max = def.max !== undefined ? def.max : 1023;
    var val = this.getParamValue(item.paramName) || def.default || min;

    var potSize = 70;
    var pot = new CircularPot({
      name: item.paramName || item.id,
      label: "",
      min: min,
      max: max,
      step: (max - min) <= 10 ? 0.01 : ((max - min) <= 100 ? 0.1 : 1),
      value: val,
      color: "#14B8A6",
      size: potSize,
      onChange: function (name, v) {
        if (item.paramName) self.setParamValue(item.paramName, v);
        self.bus.publish("param:" + (item.paramName || item.id), v);
      }
    });
    body.appendChild(pot.node());
    item._pot = pot;

    // Subscribe to bus updates from other controls
    if (item.paramName) {
      var unsub = this.bus.subscribe("param:" + item.paramName, function (v) {
        pot.setValueSilent(v);
      });
      item._busSubs.push(unsub);
    }
  };

  /**
   * Renders a button control for discrete inputs. Toggles classes on mouse/touch down/up.
   * Publishes to bus and triggers onKeyPress/onKeyRelease for keyboard items.
   */
  HardwareZone.prototype._renderButtonVisual = function (item, body) {
    var self = this;
    var btn = document.createElement("div");
    btn.className = "hw-visual-button";
    btn.innerHTML = '<div class="hw-btn-cap"></div>';
    var pressed = false;
    btn.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      pressed = true;
      btn.classList.add("hw-btn-pressed");
      if (item.kind === "key" && item.keyIndex !== null) {
        self.onKeyPress(item.keyIndex);
      } else if (item.kind === "keys") {
        self.bus.publish("hw:button:" + item.id, 1);
      } else if (item.paramName) {
        self.setParamValue(item.paramName, 1);
        self.bus.publish("param:" + item.paramName, 1);
      }
    });
    document.addEventListener("mouseup", function () {
      if (!pressed) return;
      pressed = false;
      btn.classList.remove("hw-btn-pressed");
      if (item.kind === "key" && item.keyIndex !== null) {
        self.onKeyRelease(item.keyIndex);
      } else if (item.kind === "keys") {
        self.bus.publish("hw:button:" + item.id, 0);
      } else if (item.paramName) {
        var params = self.getVoiceParams();
        var def = params[item.paramName];
        if (def && def.type === "trigger") {
          self.setParamValue(item.paramName, 0);
        }
        self.bus.publish("param:" + item.paramName, 0);
      }
    });
    body.appendChild(btn);
  };

  /**
   * Renders a touch pad control (native GPIO or MPR121 I2C). Similar to button but with I2C/GPIO label.
   */
  HardwareZone.prototype._renderTouchVisual = function (item, body) {
    var self = this;
    var pad = document.createElement("div");
    pad.className = "hw-visual-touch";
    pad.textContent = item.hwType === "touch_mpr121" ? "I2C" : "GPIO";
    var active = false;
    pad.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      active = true;
      pad.classList.add("hw-touch-active");
      if (item.kind === "key" && item.keyIndex !== null) {
        self.onKeyPress(item.keyIndex);
      } else if (item.paramName) {
        self.setParamValue(item.paramName, 1);
        self.bus.publish("param:" + item.paramName, 1);
      }
      self.bus.publish("hw:" + item.hwType + ":" + item.id, 1);
    });
    document.addEventListener("mouseup", function () {
      if (!active) return;
      active = false;
      pad.classList.remove("hw-touch-active");
      if (item.kind === "key" && item.keyIndex !== null) {
        self.onKeyRelease(item.keyIndex);
      } else if (item.paramName) {
        var params = self.getVoiceParams();
        var def = params[item.paramName];
        if (def && def.type === "trigger") {
          self.setParamValue(item.paramName, 0);
        }
        self.bus.publish("param:" + item.paramName, 0);
      }
      self.bus.publish("hw:" + item.hwType + ":" + item.id, 0);
    });
    body.appendChild(pad);
  };

  /**
   * Renders an accelerometer control with separate X/Y CircularPots and sliders for dead zone / smoothing config.
   * Publishes separate hw:accel_x and hw:accel_y bus events for each axis.
   */
  HardwareZone.prototype._renderAccelVisual = function (item, body) {
    var self = this;
    var params = this.getVoiceParams();
    var def = params[item.paramName] || {};
    var min = def.min !== undefined ? def.min : 0;
    var max = def.max !== undefined ? def.max : 1023;
    var val = this.getParamValue(item.paramName) || def.default || min;

    // Initialize config defaults
    if (!item.config) item.config = {};
    if (item.config.deadZone === undefined) item.config.deadZone = 5;
    if (item.config.smoothing === undefined) item.config.smoothing = 25;

    // Layout: X and Y pots side by side
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center";

    var xLabel = document.createElement("div");
    xLabel.style.cssText = "font-size:0.55rem;color:var(--ws-text-dim);text-align:center";
    xLabel.textContent = "X";
    var yLabel = document.createElement("div");
    yLabel.style.cssText = "font-size:0.55rem;color:var(--ws-text-dim);text-align:center";
    yLabel.textContent = "Y";

    var potX = new CircularPot({
      name: (item.paramName || item.id) + "_x",
      label: "",
      min: min, max: max,
      step: (max - min) <= 10 ? 0.01 : ((max - min) <= 100 ? 0.1 : 1),
      value: val, color: "#14B8A6", size: 50,
      onChange: function (n, v) {
        if (item.paramName) self.setParamValue(item.paramName, v);
        self.bus.publish("hw:accel_x:" + item.id, v);
        self.bus.publish("param:" + (item.paramName || item.id), v);
      }
    });
    var potY = new CircularPot({
      name: (item.paramName || item.id) + "_y",
      label: "",
      min: min, max: max,
      step: (max - min) <= 10 ? 0.01 : ((max - min) <= 100 ? 0.1 : 1),
      value: val, color: "#8B5CF6", size: 50,
      onChange: function (n, v) {
        self.bus.publish("hw:accel_y:" + item.id, v);
      }
    });

    var xCol = document.createElement("div");
    xCol.style.cssText = "display:flex;flex-direction:column;align-items:center";
    xCol.appendChild(xLabel);
    xCol.appendChild(potX.node());

    var yCol = document.createElement("div");
    yCol.style.cssText = "display:flex;flex-direction:column;align-items:center";
    yCol.appendChild(yLabel);
    yCol.appendChild(potY.node());

    row.appendChild(xCol);
    row.appendChild(yCol);
    body.appendChild(row);

    // Filter controls: dead zone and smoothing sliders
    var filterRow = document.createElement("div");
    filterRow.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;margin-top:6px;font-size:0.6rem;color:var(--ws-text-dim)";

    var dzRow = document.createElement("div");
    dzRow.style.cssText = "display:flex;align-items:center;gap:6px";
    var dzLabel = document.createElement("span");
    dzLabel.textContent = "Dead Zone";
    dzLabel.style.minWidth = "60px";
    var dzSlider = document.createElement("input");
    dzSlider.type = "range";
    dzSlider.min = "0";
    dzSlider.max = "50";
    dzSlider.value = String(item.config.deadZone);
    dzSlider.style.cssText = "flex:1;height:14px;accent-color:#8B5CF6";
    var dzVal = document.createElement("span");
    dzVal.style.minWidth = "20px";
    dzVal.textContent = item.config.deadZone + "%";
    dzSlider.addEventListener("input", function () {
      item.config.deadZone = parseInt(dzSlider.value, 10);
      dzVal.textContent = dzSlider.value + "%";
      self._fireChange();
    });
    dzRow.appendChild(dzLabel);
    dzRow.appendChild(dzSlider);
    dzRow.appendChild(dzVal);

    var smRow = document.createElement("div");
    smRow.style.cssText = "display:flex;align-items:center;gap:6px";
    var smLabel = document.createElement("span");
    smLabel.textContent = "Smoothing";
    smLabel.style.minWidth = "60px";
    var smSlider = document.createElement("input");
    smSlider.type = "range";
    smSlider.min = "0";
    smSlider.max = "100";
    smSlider.value = String(item.config.smoothing);
    smSlider.style.cssText = "flex:1;height:14px;accent-color:#14B8A6";
    var smVal = document.createElement("span");
    smVal.style.minWidth = "20px";
    smVal.textContent = item.config.smoothing + "%";
    smSlider.addEventListener("input", function () {
      item.config.smoothing = parseInt(smSlider.value, 10);
      smVal.textContent = smSlider.value + "%";
      self._fireChange();
    });
    smRow.appendChild(smLabel);
    smRow.appendChild(smSlider);
    smRow.appendChild(smVal);

    filterRow.appendChild(dzRow);
    filterRow.appendChild(smRow);
    body.appendChild(filterRow);

    item._pot = potX;
    item._potX = potX;
    item._potY = potY;
  };

  /**
   * Renders an LED indicator selector. Allows choosing which param/control triggers the LED.
   */
  HardwareZone.prototype._renderLedVisual = function (item, body) {
    var led = document.createElement("div");
    led.className = "hw-visual-led";

    var triggerSelect = document.createElement("select");
    triggerSelect.className = "hw-item-gpio-select";
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Trigger: choose...";
    triggerSelect.appendChild(noneOpt);

    // List all other items as potential LED triggers
    for (var id in this.items) {
      if (id === item.id) continue;
      var other = this.items[id];
      var opt = document.createElement("option");
      opt.value = other.paramName || other.id;
      opt.textContent = this._itemLabel(other);
      triggerSelect.appendChild(opt);
    }

    triggerSelect.addEventListener("change", function () {
      item.config.trigger = triggerSelect.value;
    });

    body.appendChild(led);
    body.appendChild(triggerSelect);
  };

  /**
   * Renders an OLED display placeholder with I2C pin labels (GP16/17).
   */
  HardwareZone.prototype._renderOledVisual = function (item, body) {
    var screen = document.createElement("div");
    screen.className = "hw-visual-oled";
    screen.innerHTML = '<canvas class="hw-oled-canvas" width="128" height="64"></canvas><div class="hw-oled-label">OLED (I2C GP16/17)</div>';
    body.appendChild(screen);

    var pinRow = document.createElement("div");
    pinRow.className = "hw-item-config";
    var sda = document.createElement("span");
    sda.className = "hw-oled-pin";
    sda.textContent = "SDA: GP16";
    var scl = document.createElement("span");
    scl.className = "hw-oled-pin";
    scl.textContent = "SCL: GP17";
    pinRow.appendChild(sda);
    pinRow.appendChild(scl);
    body.appendChild(pinRow);
  };

  /**
   * Renders control visuals (scale, arp_pattern, arp_speed, tonality, latch/arp/loop).
   * Branches by hwType (continuous vs discrete) and control name to render appropriate UI.
   * 
   * For scale/arp_pattern: shows current value label, then branches:
   *   - pot/ldr/accel: CircularPot to select from options
   *   - button/touch: "cycle" (1 button cycles) or "each" (one button per option)
   *   - else: dropdown select
   * 
   * For arp_speed: BPM label + pot (continuous) or range slider (discrete)
   * For tonality: toggle between major/minor
   * For latch/arp/loop: toggle on/off
   */
  HardwareZone.prototype._renderControlVisual = function (item, body) {
    var self = this;
    var name = item.controlName;
    var hwType = item.hwType;
    var hwt = hwType ? getHwType(hwType) : null;

    if (hwt) {
      item.el.className = "hw-zone-item hw-zone-item--control hw-zone-item--" + hwType;
    }

    // Branch 1: scale and arp_pattern (multi-option selectors)
    if (name === "scale" || name === "arp_pattern") {
      var options = name === "scale" ? SCALE_OPTIONS : ARP_OPTIONS;
      var curVal = this.getControlValue(name);
      var curIdx = 0;
      for (var oi = 0; oi < options.length; oi++) {
        if (options[oi][0] === curVal) { curIdx = oi; break; }
      }

      var valLabel = document.createElement("div");
      valLabel.style.cssText = "font-size:0.7rem;color:var(--ws-teal);text-align:center;margin-bottom:4px;font-weight:600";
      valLabel.textContent = options[curIdx][1];

      var setByIndex = function (idx) {
        idx = Math.max(0, Math.min(options.length - 1, idx));
        self.setControlValue(name, options[idx][0]);
        valLabel.textContent = options[idx][1];
        return idx;
      };

      // Continuous HW: pot to select option by index
      if (hwType === "pot" || hwType === "ldr" || hwType === "accel") {
        var pot = new CircularPot({
          name: name,
          label: "",
          min: 0,
          max: options.length - 1,
          step: 1,
          value: curIdx,
          color: "#14B8A6",
          size: 70,
          onChange: function (n, v) {
            setByIndex(Math.round(v));
          }
        });
        body.appendChild(valLabel);
        body.appendChild(pot.node());
        item._pot = pot;

      // Discrete HW: button/touch with cycle or per-option mode
      } else if (hwType === "button" || hwType === "touch_native" || hwType === "touch_mpr121") {
        var mode = item.config.ctrlMode || "cycle";
        var modeRow = document.createElement("div");
        modeRow.className = "hw-item-config";
        var modeSelect = document.createElement("select");
        modeSelect.className = "hw-item-type-select";
        var optCycle = document.createElement("option");
        optCycle.value = "cycle"; optCycle.textContent = "Cycle (1 input)";
        var optEach = document.createElement("option");
        optEach.value = "each"; optEach.textContent = "One per option";
        modeSelect.appendChild(optCycle);
        modeSelect.appendChild(optEach);
        modeSelect.value = mode;
        modeSelect.addEventListener("change", function () {
          item.config.ctrlMode = modeSelect.value;
          self._updateItemVisual(item);
          self._fireChange();
        });
        modeRow.appendChild(modeSelect);
        body.appendChild(modeRow);

        if (mode === "each") {
          // One GPIO per option
          this._renderControlPerButton(item, body, hwt, options, name);
        } else {
          // Single button cycles through options
          body.appendChild(valLabel);
          var cycleState = { idx: curIdx };
          var btn = document.createElement("div");
          btn.className = "hw-visual-button";
          btn.innerHTML = '<div class="hw-btn-cap"></div>';
          btn.addEventListener("mousedown", function (e) {
            e.stopPropagation();
            btn.classList.add("hw-btn-pressed");
          });
          btn.addEventListener("mouseup", function () {
            btn.classList.remove("hw-btn-pressed");
            cycleState.idx = (cycleState.idx + 1) % options.length;
            setByIndex(cycleState.idx);
          });
          body.appendChild(btn);
        }

      // Fallback: dropdown select
      } else {
        body.appendChild(valLabel);
        var sel = document.createElement("select");
        sel.className = "hw-item-type-select";
        sel.style.width = "100%";
        for (var si = 0; si < options.length; si++) {
          var o = document.createElement("option");
          o.value = options[si][0]; o.textContent = options[si][1];
          sel.appendChild(o);
        }
        sel.value = options[curIdx][0];
        sel.addEventListener("change", function () {
          self.setControlValue(name, sel.value);
          for (var fi = 0; fi < options.length; fi++) {
            if (options[fi][0] === sel.value) { valLabel.textContent = options[fi][1]; break; }
          }
        });
        body.appendChild(sel);
      }

    // Branch 2: arp_speed (BPM control, 40-300)
    } else if (name === "arp_speed") {
      var bpmVal = this.getControlValue("arp_speed") || 120;
      var bpmLabel = document.createElement("div");
      bpmLabel.style.cssText = "font-size:0.7rem;color:var(--ws-teal);text-align:center;margin-bottom:4px;font-weight:600";
      bpmLabel.textContent = "BPM: " + bpmVal;

      if (hwType === "pot" || hwType === "ldr" || hwType === "accel") {
        var bpmPot = new CircularPot({
          name: "arp_speed",
          label: "",
          min: 40, max: 300, step: 1,
          value: bpmVal,
          color: "#14B8A6",
          size: 70,
          onChange: function (n, v) {
            var iv = Math.round(v);
            bpmLabel.textContent = "BPM: " + iv;
            self.setControlValue("arp_speed", iv);
          }
        });
        body.appendChild(bpmLabel);
        body.appendChild(bpmPot.node());
        item._pot = bpmPot;
      } else {
        body.appendChild(bpmLabel);
        var slider = document.createElement("input");
        slider.type = "range"; slider.min = "40"; slider.max = "300";
        slider.value = bpmVal; slider.className = "ctrl-range"; slider.style.width = "100%";
        slider.addEventListener("input", function () {
          bpmLabel.textContent = "BPM: " + slider.value;
          self.setControlValue("arp_speed", parseInt(slider.value, 10));
        });
        body.appendChild(slider);
      }

    // Branch 3: tonality (major/minor toggle)
    } else if (name === "tonality") {
      var tonVal = this.getControlValue("tonality") || "major";
      var tonLabel = document.createElement("div");
      tonLabel.style.cssText = "font-size:0.7rem;color:var(--ws-teal);text-align:center;margin-bottom:4px;font-weight:600";
      tonLabel.textContent = tonVal === "minor" ? "Minor" : "Major";

      if (hwType === "button" || hwType === "touch_native" || hwType === "touch_mpr121") {
        var tBtn = document.createElement("div");
        tBtn.className = "hw-visual-button";
        tBtn.innerHTML = '<div class="hw-btn-cap"></div>';
        tBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); tBtn.classList.add("hw-btn-pressed"); });
        tBtn.addEventListener("mouseup", function () {
          tBtn.classList.remove("hw-btn-pressed");
          var cur = self.getControlValue("tonality") || "major";
          var next = cur === "major" ? "minor" : "major";
          self.setControlValue("tonality", next);
          tonLabel.textContent = next === "minor" ? "Minor" : "Major";
        });
        body.appendChild(tonLabel);
        body.appendChild(tBtn);
      } else {
        var tbtn = document.createElement("button");
        tbtn.className = "btn btn-xs btn-toggle";
        tbtn.textContent = tonVal === "minor" ? "Minor" : "Major";
        tbtn.addEventListener("click", function (e) {
          e.stopPropagation();
          var cur = self.getControlValue("tonality") || "major";
          var next = cur === "major" ? "minor" : "major";
          self.setControlValue("tonality", next);
          tbtn.textContent = next === "minor" ? "Minor" : "Major";
        });
        body.appendChild(tbtn);
      }

    // Branch 4: latch, arp, loop (on/off toggle)
    } else if (name === "latch" || name === "arp" || name === "loop") {
      var togVal = this.getControlValue(name);
      var togLabel = document.createElement("div");
      togLabel.style.cssText = "font-size:0.7rem;color:var(--ws-teal);text-align:center;margin-bottom:4px;font-weight:600";
      togLabel.textContent = togVal ? "ON" : "OFF";

      var updateTogVisual = function (el, label, active) {
        label.textContent = active ? "ON" : "OFF";
        if (el.classList.contains("hw-visual-button")) {
          el.style.background = active ? "var(--ws-teal)" : "";
        } else {
          el.style.background = active ? "var(--ws-teal)" : "";
        }
      };

      if (hwType === "button" || hwType === "touch_native" || hwType === "touch_mpr121") {
        var togBtn = document.createElement("div");
        togBtn.className = "hw-visual-button";
        togBtn.innerHTML = '<div class="hw-btn-cap"></div>';
        if (togVal) togBtn.style.background = "var(--ws-teal)";
        togBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); togBtn.classList.add("hw-btn-pressed"); });
        togBtn.addEventListener("mouseup", function () {
          togBtn.classList.remove("hw-btn-pressed");
          var next = !self.getControlValue(name);
          self.setControlValue(name, next);
          updateTogVisual(togBtn, togLabel, next);
        });
        body.appendChild(togLabel);
        body.appendChild(togBtn);
      } else {
        var tog = document.createElement("button");
        tog.className = "btn btn-xs btn-toggle";
        tog.textContent = togVal ? "ON" : "OFF";
        tog.style.background = togVal ? "var(--ws-teal)" : "";
        tog.addEventListener("click", function (e) {
          e.stopPropagation();
          var next = !self.getControlValue(name);
          self.setControlValue(name, next);
          tog.textContent = next ? "ON" : "OFF";
          tog.style.background = next ? "var(--ws-teal)" : "";
        });
        body.appendChild(tog);
      }

    // Unknown control name
    } else {
      var fallback = document.createElement("span");
      fallback.style.cssText = "font-size:0.65rem;color:var(--ws-text-dim)";
      fallback.textContent = name;
      body.appendChild(fallback);
    }
  };

  /**
   * Renders a row of buttons, one per control option, each with its own GPIO pin assignment.
   * Used when control is on discrete HW in "each" mode (one button per scale option, etc.).
   */
  HardwareZone.prototype._renderControlPerButton = function (item, body, hwt, options, controlName) {
    var self = this;

    // Clear old GPIO assignments (array will be rebuilt)
    if (item.gpio && Array.isArray(item.gpio)) {
      for (var g = 0; g < item.gpio.length; g++) delete this.usedGPIO[item.gpio[g]];
    }
    item.gpio = [];

    var container = document.createElement("div");
    container.style.cssText = "display:flex;flex-direction:column;gap:3px;max-height:180px;overflow-y:auto;width:100%";

    for (var k = 0; k < options.length; k++) {
      (function (optVal, optLabel, idx) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:4px;font-size:0.65rem";

        var label = document.createElement("span");
        label.style.cssText = "color:#e2e8f0;min-width:50px;font-size:0.6rem";
        label.textContent = optLabel;

        var btn = document.createElement("div");
        btn.className = "hw-visual-button";
        btn.style.cssText = "width:28px;height:28px;border-radius:4px";
        btn.innerHTML = '<div class="hw-btn-cap" style="width:16px;height:16px"></div>';
        btn.addEventListener("mousedown", function (e) { e.stopPropagation(); btn.classList.add("hw-btn-pressed"); });
        btn.addEventListener("mouseup", function () {
          btn.classList.remove("hw-btn-pressed");
          self.setControlValue(controlName, optVal);
        });

        var gpioSel = document.createElement("select");
        gpioSel.className = "hw-item-gpio-select";
        gpioSel.style.fontSize = "0.6rem";
        for (var pi = 0; pi < hwt.pins.length; pi++) {
          var opt = document.createElement("option");
          opt.value = hwt.pins[pi]; opt.textContent = hwt.pins[pi];
          if (self.usedGPIO[hwt.pins[pi]]) { opt.disabled = true; opt.textContent += " (used)"; }
          gpioSel.appendChild(opt);
        }
        // Auto-assign first available pin
        for (var aj = 0; aj < hwt.pins.length; aj++) {
          if (!self.usedGPIO[hwt.pins[aj]]) {
            gpioSel.value = hwt.pins[aj];
            item.gpio.push(hwt.pins[aj]);
            self.usedGPIO[hwt.pins[aj]] = item.id + ":" + idx;
            break;
          }
        }
        gpioSel.addEventListener("change", function () {
          var oldPin = item.gpio[idx];
          if (oldPin) delete self.usedGPIO[oldPin];
          item.gpio[idx] = gpioSel.value;
          if (gpioSel.value) self.usedGPIO[gpioSel.value] = item.id + ":" + idx;
          self._fireChange();
        });

        row.appendChild(btn);
        row.appendChild(label);
        row.appendChild(gpioSel);
        container.appendChild(row);
      })(options[k][0], options[k][1], k);
    }

    body.appendChild(container);
  };

  /**
   * Renders note for keyboard items with continuous HW (pot/LDR/accel).
   * Indicates that notes are mapped evenly across the input range (no discrete button assignment).
   */
  HardwareZone.prototype._renderKeySweepVisual = function (item, body) {
    var note = document.createElement("p");
    note.className = "hw-item-note";
    note.style.fontSize = "0.65rem";
    note.style.color = "#0D9488";
    note.style.margin = "4px 0";
    note.textContent = "Maps notes evenly across input range";
    body.appendChild(note);
  };

  /**
   * Renders keyboard (scale keys) with discrete HW (button/touch).
   * Supports two modes:
   *   - "one_per_button": each key gets its own GPIO input (multiple rows)
   *   - "cycle": single GPIO cycles through scale keys
   */
  HardwareZone.prototype._renderKeyDiscreteVisual = function (item, body) {
    var self = this;
    var keys = this.getScaleKeys();
    if (item.kind === "key") {
      keys = [{ index: item.keyIndex, label: "Key " + item.keyIndex }];
    }

    // Clear old GPIO assignments
    if (item.gpio && Array.isArray(item.gpio)) {
      for (var g = 0; g < item.gpio.length; g++) delete this.usedGPIO[item.gpio[g]];
    }
    item.gpio = [];

    var hwt = getHwType(item.hwType);
    if (!hwt) return;

    var mode = item.config.keyMode || "one_per_button";

    // For "keys" (full keyboard) items, add mode selector
    if (item.kind === "keys") {
      var modeRow = document.createElement("div");
      modeRow.className = "hw-item-config";
      var modeSelect = document.createElement("select");
      modeSelect.className = "hw-item-type-select";
      var opt1 = document.createElement("option");
      opt1.value = "one_per_button";
      opt1.textContent = "One note per input";
      var opt2 = document.createElement("option");
      opt2.value = "cycle";
      opt2.textContent = "Cycle notes (1 input)";
      modeSelect.appendChild(opt1);
      modeSelect.appendChild(opt2);
      modeSelect.value = mode;
      modeSelect.addEventListener("change", function () {
        item.config.keyMode = modeSelect.value;
        self._updateItemVisual(item);
        self._fireChange();
      });
      modeRow.appendChild(modeSelect);
      body.appendChild(modeRow);
    }

    if (mode === "cycle") {
      this._renderKeyCycleSingle(item, body, hwt, keys);
    } else {
      this._renderKeyPerButton(item, body, hwt, keys);
    }

  };

  /**
   * Renders a single button that cycles through scale keys on each press.
   * Used for keyboard items with discrete HW in "cycle" mode.
   */
  HardwareZone.prototype._renderKeyCycleSingle = function (item, body, hwt, keys) {
    var self = this;
    var cycleState = { idx: 0 };

    var noteLabel = document.createElement("div");
    noteLabel.style.cssText = "font-size:0.7rem;color:var(--ws-teal);text-align:center;margin-bottom:4px;font-weight:600";
    noteLabel.textContent = keys.length ? keys[0].label : "---";

    var btn = document.createElement("div");
    btn.className = "hw-visual-button";
    btn.innerHTML = '<div class="hw-btn-cap"></div>';
    var pressed = false;
    btn.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      pressed = true;
      btn.classList.add("hw-btn-pressed");
      if (keys.length) {
        self.onKeyPress(keys[cycleState.idx].index);
      }
    });
    document.addEventListener("mouseup", function () {
      if (!pressed) return;
      pressed = false;
      btn.classList.remove("hw-btn-pressed");
      if (keys.length) {
        self.onKeyRelease(keys[cycleState.idx].index);
        cycleState.idx = (cycleState.idx + 1) % keys.length;
        noteLabel.textContent = keys[cycleState.idx].label;
      }
    });

    var gpioRow = document.createElement("div");
    gpioRow.className = "hw-item-config";
    var gpioSel = document.createElement("select");
    gpioSel.className = "hw-item-gpio-select";
    gpioSel.style.fontSize = "0.6rem";

    for (var pi = 0; pi < hwt.pins.length; pi++) {
      var opt = document.createElement("option");
      opt.value = hwt.pins[pi];
      opt.textContent = hwt.pins[pi];
      if (self.usedGPIO[hwt.pins[pi]]) {
        opt.disabled = true;
        opt.textContent += " (used)";
      }
      gpioSel.appendChild(opt);
    }

    // Auto-assign first available pin
    for (var aj = 0; aj < hwt.pins.length; aj++) {
      if (!self.usedGPIO[hwt.pins[aj]]) {
        gpioSel.value = hwt.pins[aj];
        item.gpio = [hwt.pins[aj]];
        self.usedGPIO[hwt.pins[aj]] = item.id + ":cycle";
        break;
      }
    }

    gpioSel.addEventListener("change", function () {
      if (item.gpio[0]) delete self.usedGPIO[item.gpio[0]];
      item.gpio = [gpioSel.value];
      if (gpioSel.value) self.usedGPIO[gpioSel.value] = item.id + ":cycle";
      self._fireChange();
    });

    body.appendChild(noteLabel);
    body.appendChild(btn);
    gpioRow.appendChild(gpioSel);
    body.appendChild(gpioRow);
  };

  /**
   * Renders one button per scale key, each with its own GPIO pin assignment.
   * Used for keyboard items with discrete HW in "one_per_button" mode.
   */
  HardwareZone.prototype._renderKeyPerButton = function (item, body, hwt, keys) {
    var self = this;

    var container = document.createElement("div");
    container.style.cssText = "display:flex;flex-direction:column;gap:3px;max-height:180px;overflow-y:auto;width:100%";

    for (var k = 0; k < keys.length; k++) {
      (function (keyInfo, idx) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:4px;font-size:0.65rem";

        var btn = document.createElement("div");
        btn.className = "hw-visual-button";
        btn.style.cssText = "width:28px;height:28px;border-radius:4px;flex-shrink:0";
        btn.innerHTML = '<div class="hw-btn-cap" style="width:16px;height:16px"></div>';
        var pressed = false;
        btn.addEventListener("mousedown", function (e) {
          e.stopPropagation();
          pressed = true;
          btn.classList.add("hw-btn-pressed");
          self.onKeyPress(keyInfo.index);
        });
        document.addEventListener("mouseup", function () {
          if (!pressed) return;
          pressed = false;
          btn.classList.remove("hw-btn-pressed");
          self.onKeyRelease(keyInfo.index);
        });

        var label = document.createElement("span");
        label.style.cssText = "color:#e2e8f0;min-width:30px";
        label.textContent = keyInfo.label;

        var gpioSel = document.createElement("select");
        gpioSel.className = "hw-item-gpio-select";
        gpioSel.style.fontSize = "0.6rem";

        for (var pi = 0; pi < hwt.pins.length; pi++) {
          var opt = document.createElement("option");
          opt.value = hwt.pins[pi];
          opt.textContent = hwt.pins[pi];
          if (self.usedGPIO[hwt.pins[pi]]) {
            opt.disabled = true;
            opt.textContent += " (used)";
          }
          gpioSel.appendChild(opt);
        }

        // Auto-assign first available pin for this key
        for (var aj = 0; aj < hwt.pins.length; aj++) {
          if (!self.usedGPIO[hwt.pins[aj]]) {
            gpioSel.value = hwt.pins[aj];
            item.gpio.push(hwt.pins[aj]);
            self.usedGPIO[hwt.pins[aj]] = item.id + ":" + idx;
            break;
          }
        }

        gpioSel.addEventListener("change", function () {
          var oldPin = item.gpio[idx];
          if (oldPin) delete self.usedGPIO[oldPin];
          item.gpio[idx] = gpioSel.value;
          if (gpioSel.value) self.usedGPIO[gpioSel.value] = item.id + ":" + idx;
          self._fireChange();
        });

        row.appendChild(btn);
        row.appendChild(label);
        row.appendChild(gpioSel);
        container.appendChild(row);
      })(keys[k], k);
    }

    body.appendChild(container);
  };

  /**
   * Makes an item draggable within the zone by its header. Updates x/y position
   * and z-index on drag. Supports both mouse and touch. Fires state change on drop.
   */
  HardwareZone.prototype._makeDraggableInZone = function (item) {
    var self = this;
    var header = item.el.querySelector(".hw-item-header");
    if (!header) return;
    var dragging = false;
    var startX = 0, startY = 0;

    header.style.cursor = "grab";
    header.addEventListener("mousedown", function (e) {
      if (e.target.classList.contains("hw-item-remove")) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      item.el.style.zIndex = ++NEXT_Z;
      header.style.cursor = "grabbing";
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      startX = e.clientX;
      startY = e.clientY;
      item.x = Math.max(0, (item.x || 0) + dx);
      item.y = Math.max(0, (item.y || 0) + dy);
      item.el.style.left = item.x + "px";
      item.el.style.top = item.y + "px";
      self._updateHeight();
    });
    document.addEventListener("mouseup", function () {
      if (dragging) {
        dragging = false;
        header.style.cursor = "grab";
        self._fireChange();
      }
    });

    // Touch drag: same as mouse
    header.addEventListener("touchstart", function (e) {
      if (e.target.classList.contains("hw-item-remove")) return;
      dragging = true;
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
      item.el.style.zIndex = ++NEXT_Z;
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
      item.x = Math.max(0, (item.x || 0) + dx);
      item.y = Math.max(0, (item.y || 0) + dy);
      item.el.style.left = item.x + "px";
      item.el.style.top = item.y + "px";
      self._updateHeight();
    });
    document.addEventListener("touchend", function () {
      if (dragging) { dragging = false; self._fireChange(); }
    });
  };

  /**
   * Fires onStateChange callback with current serialized state (layout, bindings, gpioAssignments, zoneMinHeight).
   */
  HardwareZone.prototype._fireChange = function () {
    this.onStateChange(this.getState());
  };

  /**
   * Serializes zone state for persistence. Returns:
   * - layout: {id: {...item data}}, one entry per item
   * - bindings: {paramName: {mode, source, config}}, param->hwType/GPIO mappings
   * - gpioAssignments: {gpio: itemId}, GPIO->item reverse lookup for pinout diagram
   * - zoneMinHeight: current zone height preference
   */
  HardwareZone.prototype.getState = function () {
    var layout = {};
    var bindings = {};
    var gpioAssignments = {};

    for (var id in this.items) {
      var it = this.items[id];
      // Serialize core item data (exclude transient UI properties)
      layout[id] = {
        kind: it.kind,
        paramName: it.paramName,
        keyIndex: it.keyIndex,
        controlName: it.controlName,
        label: it.label,
        hwType: it.hwType,
        gpio: it.gpio,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
        config: it.config
      };

      // Build bindings for params with hardware assignment
      if (it.hwType && it.gpio) {
        if (it.paramName) {
          bindings[it.paramName] = { mode: it.hwType, source: it.gpio, config: it.config };
        }
        // Track all GPIO pins for pinout visualization
        if (Array.isArray(it.gpio)) {
          for (var g = 0; g < it.gpio.length; g++) gpioAssignments[it.gpio[g]] = id;
        } else {
          gpioAssignments[it.gpio] = id;
        }
      }
    }

    return {
      layout: layout,
      bindings: bindings,
      gpioAssignments: gpioAssignments,
      zoneMinHeight: this._minHeight
    };
  };

  /**
   * Analyzes current hardware configuration to determine which ports/peripherals are active.
   * Used by the pinout diagram to show which GPIO, I2C, analog, audio, and special devices are in use.
   * Returns object with: buttons (array of GPIO numbers), analog (array of pins), i2c, led, oled, mpr121, accelerometer (booleans).
   */
  HardwareZone.prototype.getActiveConnections = function () {
    var buttons = [];
    var analog = [];
    var i2c = false;
    var led = false;
    var oled = false;
    var mpr121 = false;
    var accelerometer = false;

    for (var id in this.items) {
      var it = this.items[id];
      if (!it.hwType || !it.gpio) continue;

      // Collect button GPIO numbers for pinout diagram
      if (it.hwType === "button" || it.hwType === "touch_native") {
        var gpioList = Array.isArray(it.gpio) ? it.gpio : [it.gpio];
        for (var gi = 0; gi < gpioList.length; gi++) {
          var gpioStr = gpioList[gi];
          if (!gpioStr) continue;
          var m = gpioStr.match(/^GP(\d+)$/);
          if (m) {
            var num = parseInt(m[1], 10);
            if (buttons.indexOf(num) === -1) buttons.push(num);
          }
        }
      }
      // Collect analog pins (pot/LDR)
      if (it.hwType === "pot" || it.hwType === "ldr") {
        if (analog.indexOf(it.gpio) === -1) analog.push(it.gpio);
      }
      // Flag I2C devices
      if (it.hwType === "touch_mpr121") { i2c = true; mpr121 = true; }
      if (it.hwType === "accel") { i2c = true; accelerometer = true; }
      // Flag LED (with GPIO for blinking control)
      if (it.hwType === "led") {
        led = true;
        var lm = (it.gpio || "").match(/^GP(\d+)$/);
        if (lm) {
          var lnum = parseInt(lm[1], 10);
          if (buttons.indexOf(lnum) === -1) buttons.push(lnum);
        }
      }
      // Flag OLED display
      if (it.hwType === "oled") { i2c = true; oled = true; }
    }

    return {
      buttons: buttons.length ? buttons : null,
      analog: analog.length ? analog : null,
      i2c: i2c || null,
      audio: true,
      led: led,
      oled: oled,
      mpr121: mpr121,
      accelerometer: accelerometer
    };
  };

  /**
   * Restores zone to a previously saved state. Clears current items and recreates
   * them from savedState.layout, restoring positions, hardware assignments, and config.
   */
  HardwareZone.prototype.restoreLayout = function (savedState) {
    this.clear();
    if (!savedState || !savedState.layout) return;
    this._minHeight = savedState.zoneMinHeight || 300;
    this.zoneEl.style.minHeight = this._minHeight + "px";

    for (var id in savedState.layout) {
      var saved = savedState.layout[id];
      this.addItem({
        kind: saved.kind,
        paramName: saved.paramName,
        keyIndex: saved.keyIndex,
        controlName: saved.controlName,
        label: saved.label,
        hwType: saved.hwType,
        gpio: saved.gpio,
        x: saved.x,
        y: saved.y,
        width: saved.width,
        height: saved.height,
        config: saved.config
      });
    }
  };

  /**
   * Removes all items from zone. Cleans up subscriptions, pots, and GPIO reservations.
   */
  HardwareZone.prototype.clear = function () {
    for (var id in this.items) {
      var it = this.items[id];
      for (var i = 0; i < it._busSubs.length; i++) it._busSubs[i]();
      if (it._pot) it._pot.destroy();
      if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    }
    this.items = {};
    this.usedGPIO = {};
    this._renderEmptyState();
  };

  // Export constructor to window and attach HW_TYPES constant
  root.HardwareZone = HardwareZone;
  root.HardwareZone.HW_TYPES = HW_TYPES;
})(window);
