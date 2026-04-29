(function (root) {
  "use strict";

  var NEXT_Z = 100;
  var ITEM_ID = 0;

  var HW_TYPES = [
    { value: "pot", label: "Potentiometer", continuous: true, pins: ["GP26","GP27","GP28"] },
    { value: "ldr", label: "LDR (Light)", continuous: true, pins: ["GP26","GP27","GP28"] },
    { value: "button", label: "Button", continuous: false, pins: ["GP0","GP1","GP2","GP3","GP4","GP5","GP6","GP7"] },
    { value: "touch_native", label: "Touch (Pico GPIO)", continuous: false, pins: ["GP2","GP3","GP4","GP5","GP6","GP7","GP8","GP9","GP10","GP11","GP12","GP13"] },
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
      self._fireChange();
    });
    gpioSelect.addEventListener("change", function () {
      if (item.gpio && !Array.isArray(item.gpio)) delete self.usedGPIO[item.gpio];
      item.gpio = gpioSelect.value;
      if (item.gpio) self.usedGPIO[item.gpio] = item.id;
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
    }

    return el;
  };

  HardwareZone.prototype._itemLabel = function (item) {
    if (item.kind === "param") {
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
    if (item.gpio && !Array.isArray(item.gpio)) {
      delete this.usedGPIO[item.gpio];
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

  HardwareZone.prototype._updateItemVisual = function (item) {
    var body = item._bodyEl;
    if (!body) return;
    body.innerHTML = "";
    if (item._pot) { item._pot.destroy(); item._pot = null; }
    for (var i = 0; i < item._busSubs.length; i++) item._busSubs[i]();
    item._busSubs = [];

    if (!item.hwType) return;
    var hwt = getHwType(item.hwType);
    if (!hwt) return;

    item.el.className = "hw-zone-item hw-zone-item--" + item.kind + " hw-zone-item--" + item.hwType;

    if (item.hwType === "pot" || item.hwType === "ldr") {
      this._renderPotVisual(item, body);
    } else if (item.hwType === "button") {
      this._renderButtonVisual(item, body);
    } else if (item.hwType === "touch_native" || item.hwType === "touch_mpr121") {
      this._renderTouchVisual(item, body);
    } else if (item.hwType === "accel") {
      this._renderAccelVisual(item, body);
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
      if (item.paramName) self.bus.publish("param:" + item.paramName, 1);
      self.bus.publish("hw:button:" + item.id, 1);
    });
    document.addEventListener("mouseup", function () {
      if (!pressed) return;
      pressed = false;
      btn.classList.remove("hw-btn-pressed");
      if (item.paramName) self.bus.publish("param:" + item.paramName, 0);
      self.bus.publish("hw:button:" + item.id, 0);
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
      self.bus.publish("hw:" + item.hwType + ":" + item.id, 1);
    });
    document.addEventListener("mouseup", function () {
      if (!active) return;
      active = false;
      pad.classList.remove("hw-touch-active");
      self.bus.publish("hw:" + item.hwType + ":" + item.id, 0);
    });
    body.appendChild(pad);
  };

  HardwareZone.prototype._renderAccelVisual = function (item, body) {
    var div = document.createElement("div");
    div.className = "hw-visual-accel";
    div.innerHTML = '<div class="hw-accel-ball"></div>';
    body.appendChild(div);
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
