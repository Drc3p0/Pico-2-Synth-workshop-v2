(function (root) {
  "use strict";

  var NEXT_Z = 100;
  var ITEM_ID = 0;

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

  function getHwType(val) {
    for (var i = 0; i < HW_TYPES.length; i++) {
      if (HW_TYPES[i].value === val) return HW_TYPES[i];
    }
    return null;
  }

  var SCALE_OPTIONS = [
    ["chromatic","Chromatic"],["pentatonic_major","Pentatonic Maj"],
    ["pentatonic_minor","Pentatonic Min"],["blues_major","Blues Maj"],
    ["blues_minor","Blues Min"],["dorian","Dorian"],
    ["mixolydian","Mixolydian"],["harmonic_minor","Harmonic Min"]
  ];

  var ARP_OPTIONS = [["up","Up"],["down","Down"],["updown","Up-Down"],["random","Random"]];

  function HardwareZone(options) {
    this.containerEl = null;
    this.zoneEl = null;
    this.resizeHandleEl = null;
    this.items = {};
    this.bus = options.bus;
    this.onStateChange = options.onStateChange || function(){};
    this.getVoiceParams = options.getVoiceParams || function(){ return {}; };
    this.getParamValue = options.getParamValue || function(){ return 0; };
    this.setParamValue = options.setParamValue || function(){};
    this.getControlValue = options.getControlValue || function(){ return null; };
    this.setControlValue = options.setControlValue || function(){};
    this.onKeyPress = options.onKeyPress || function(){};
    this.onKeyRelease = options.onKeyRelease || function(){};
    this.getScaleKeys = options.getScaleKeys || function(){ return []; };
    this.usedGPIO = {};
    this._minHeight = 300;
    this._resizing = false;
    this._resizeStartY = 0;
    this._resizeStartH = 0;
  }

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

  HardwareZone.prototype._setupResizeHandle = function () {
    var self = this;
    var handle = document.createElement("div");
    handle.className = "hw-zone-resize-handle";
    this.containerEl.appendChild(handle);
    this.resizeHandleEl = handle;

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

  HardwareZone.prototype._updateHeight = function () {
    var contentH = this._computeBoundingHeight();
    var h = Math.max(this._minHeight, contentH + 40);
    this.zoneEl.style.minHeight = h + "px";
  };

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

  HardwareZone.prototype.addItem = function (opts) {
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

  HardwareZone.prototype.removeItem = function (id) {
    var item = this.items[id];
    if (!item) return;
    for (var i = 0; i < item._busSubs.length; i++) item._busSubs[i]();
    if (item._pot) item._pot.destroy();
    if (item._potY) item._potY.destroy();
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

  HardwareZone.prototype._clearEmpty = function () {
    var empty = this.zoneEl.querySelector(".hw-zone-empty");
    if (empty) empty.parentNode.removeChild(empty);
  };

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

    var body = document.createElement("div");
    body.className = "hw-item-body";
    item._bodyEl = body;
    el.appendChild(body);

    if (item.hwType) {
      hwSelect.value = item.hwType;
      this._populateGPIO(gpioSelect, item);
      this._updateItemVisual(item);
    } else if (item.kind === "control") {
      this._updateItemVisual(item);
    }

    return el;
  };

  HardwareZone.prototype._itemLabel = function (item) {
    if (item.kind === "param") {
      if (!item.paramName) return "Unassigned";
      var params = this.getVoiceParams();
      var def = params[item.paramName];
      return def ? def.label : item.paramName;
    }
    if (item.kind === "key") return "Key " + item.keyIndex;
    if (item.kind === "keys") return "Keyboard (Scale)";
    if (item.kind === "control") return item.label || item.controlName;
    if (item.kind === "waveform") return "Waveform / OLED";
    return "Item";
  };

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

  HardwareZone.prototype._populateGPIO = function (gpioSelect, item) {
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
    for (var j = 0; j < pins.length; j++) {
      if (!this.usedGPIO[pins[j]]) {
        gpioSelect.value = pins[j];
        item.gpio = pins[j];
        this.usedGPIO[pins[j]] = item.id;
        break;
      }
    }
  };

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

  HardwareZone.prototype._populateParamSelect = function (selectEl, currentParam) {
    selectEl.innerHTML = "";
    var params = this.getVoiceParams();
    var usedParams = {};
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

  HardwareZone.prototype._refreshAllParamSelects = function (skipItemId) {
    for (var id in this.items) {
      if (id === skipItemId) continue;
      var it = this.items[id];
      if (it.kind !== "param" || !it._paramSelect) continue;
      this._populateParamSelect(it._paramSelect, it.paramName);
    }
  };

  HardwareZone.prototype.refreshParamSelectors = function () {
    for (var id in this.items) {
      var item = this.items[id];
      if (item.kind !== "param" || !item._paramSelect) continue;
      var prev = item.paramName;
      this._populateParamSelect(item._paramSelect, prev);
      var params = this.getVoiceParams();
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

  HardwareZone.prototype._updateItemVisual = function (item) {
    var body = item._bodyEl;
    if (!body) return;
    body.innerHTML = "";
    if (item._pot) { item._pot.destroy(); item._pot = null; }
    for (var i = 0; i < item._busSubs.length; i++) item._busSubs[i]();
    item._busSubs = [];

    if (item.kind === "control") {
      this._renderControlVisual(item, body);
      return;
    }

    if (!item.hwType) return;
    var hwt = getHwType(item.hwType);
    if (!hwt) return;

    item.el.className = "hw-zone-item hw-zone-item--" + item.kind + " hw-zone-item--" + item.hwType;

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

    if (item.paramName) {
      var unsub = this.bus.subscribe("param:" + item.paramName, function (v) {
        pot.setValue(v);
      });
      item._busSubs.push(unsub);
    }
  };

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

  HardwareZone.prototype._renderAccelVisual = function (item, body) {
    var self = this;
    var params = this.getVoiceParams();
    var def = params[item.paramName] || {};
    var min = def.min !== undefined ? def.min : 0;
    var max = def.max !== undefined ? def.max : 1023;
    var val = this.getParamValue(item.paramName) || def.default || min;

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

    item._pot = potX;
    item._potY = potY;
  };

  HardwareZone.prototype._renderLedVisual = function (item, body) {
    var led = document.createElement("div");
    led.className = "hw-visual-led";

    var triggerSelect = document.createElement("select");
    triggerSelect.className = "hw-item-gpio-select";
    var noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Trigger: choose...";
    triggerSelect.appendChild(noneOpt);

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

  HardwareZone.prototype._renderControlVisual = function (item, body) {
    var self = this;
    var name = item.controlName;
    var hwType = item.hwType;
    var hwt = hwType ? getHwType(hwType) : null;

    if (hwt) {
      item.el.className = "hw-zone-item hw-zone-item--control hw-zone-item--" + hwType;
    }

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
          this._renderControlPerButton(item, body, hwt, options, name);
        } else {
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

    } else {
      var fallback = document.createElement("span");
      fallback.style.cssText = "font-size:0.65rem;color:var(--ws-text-dim)";
      fallback.textContent = name;
      body.appendChild(fallback);
    }
  };

  HardwareZone.prototype._renderControlPerButton = function (item, body, hwt, options, controlName) {
    var self = this;

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

  HardwareZone.prototype._renderKeySweepVisual = function (item, body) {
    var note = document.createElement("p");
    note.className = "hw-item-note";
    note.style.fontSize = "0.65rem";
    note.style.color = "#0D9488";
    note.style.margin = "4px 0";
    note.textContent = "Maps notes evenly across input range";
    body.appendChild(note);
  };

  HardwareZone.prototype._renderKeyDiscreteVisual = function (item, body) {
    var self = this;
    var keys = this.getScaleKeys();
    if (item.kind === "key") {
      keys = [{ index: item.keyIndex, label: "Key " + item.keyIndex }];
    }

    if (item.gpio && Array.isArray(item.gpio)) {
      for (var g = 0; g < item.gpio.length; g++) delete this.usedGPIO[item.gpio[g]];
    }
    item.gpio = [];

    var hwt = getHwType(item.hwType);
    if (!hwt) return;

    var mode = item.config.keyMode || "one_per_button";

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

  HardwareZone.prototype._fireChange = function () {
    this.onStateChange(this.getState());
  };

  HardwareZone.prototype.getState = function () {
    var layout = {};
    var bindings = {};
    var gpioAssignments = {};

    for (var id in this.items) {
      var it = this.items[id];
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

      if (it.hwType && it.gpio) {
        if (it.paramName) {
          bindings[it.paramName] = { mode: it.hwType, source: it.gpio, config: it.config };
        }
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

      if (it.hwType === "button" || it.hwType === "touch_native") {
        var gpioStr = it.gpio;
        var m = gpioStr.match(/^GP(\d+)$/);
        if (m) {
          var num = parseInt(m[1], 10);
          if (buttons.indexOf(num) === -1) buttons.push(num);
        }
      }
      if (it.hwType === "pot" || it.hwType === "ldr") {
        if (analog.indexOf(it.gpio) === -1) analog.push(it.gpio);
      }
      if (it.hwType === "touch_mpr121") { i2c = true; mpr121 = true; }
      if (it.hwType === "accel") { i2c = true; accelerometer = true; }
      if (it.hwType === "led") {
        led = true;
        var lm = (it.gpio || "").match(/^GP(\d+)$/);
        if (lm) {
          var lnum = parseInt(lm[1], 10);
          if (buttons.indexOf(lnum) === -1) buttons.push(lnum);
        }
      }
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

  root.HardwareZone = HardwareZone;
  root.HardwareZone.HW_TYPES = HW_TYPES;
})(window);
