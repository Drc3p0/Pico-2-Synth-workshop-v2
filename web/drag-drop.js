(function (root) {
  "use strict";

  var GPIO_BUTTON_PINS = ["GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7"];
  var GPIO_POT_PINS = ["GP26", "GP27", "GP28"];
  var GPIO_TOUCH_NATIVE_PINS = ["GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9", "GP10", "GP11", "GP12", "GP13"];
  var GPIO_TOUCH_MPR121_CHANNELS = [];
  for (var i = 0; i < 48; i++) {
    var board = Math.floor(i / 12);
    var ch = i % 12;
    GPIO_TOUCH_MPR121_CHANNELS.push("MPR" + board + "#" + ch);
  }
  var GPIO_ACCEL_AXES = ["X", "Y"];

  var HW_TYPES = [
    { value: "pot",          label: "Potentiometer",   icon: "pot",          continuous: true,  pins: GPIO_POT_PINS },
    { value: "ldr",          label: "LDR (Light)",     icon: "ldr",          continuous: true,  pins: GPIO_POT_PINS },
    { value: "button",       label: "Button",          icon: "button",       continuous: false, pins: GPIO_BUTTON_PINS },
    { value: "touch_native", label: "Touch (Pico GPIO)", icon: "touch_native", continuous: false, pins: GPIO_TOUCH_NATIVE_PINS },
    { value: "touch_mpr121", label: "Touch (MPR121 I2C)", icon: "touch_mpr121", continuous: false, pins: GPIO_TOUCH_MPR121_CHANNELS },
    { value: "accel",        label: "Accelerometer",   icon: "accel",        continuous: true,  pins: GPIO_ACCEL_AXES }
  ];

  function getHwType(value) {
    for (var i = 0; i < HW_TYPES.length; i++) {
      if (HW_TYPES[i].value === value) return HW_TYPES[i];
    }
    return null;
  }

  function WorkspaceManager(options) {
    this.workspaceEl = null;
    this.paletteEl = null;
    this.splitterEl = null;
    this.cards = {};
    this.keyCards = {};
    this.onStateChange = options.onStateChange || null;
    this.getVoiceParams = options.getVoiceParams || function () { return {}; };
    this.getParamValue = options.getParamValue || function () { return 0; };
    this.setParamValue = options.setParamValue || function () {};
    this.getScaleKeys = options.getScaleKeys || function () { return []; };

    this._usedGPIO = {};
    this._dragData = null;
    this._splitterDragging = false;
    this._splitterStartX = 0;
    this._splitterStartWidth = 0;
  }

  WorkspaceManager.prototype.init = function (workspaceId, paletteId) {
    this.workspaceEl = document.getElementById(workspaceId);
    this.paletteEl = document.getElementById(paletteId);

    if (!this.workspaceEl || !this.paletteEl) return;

    this._setupDropZone();
    this._setupSplitter();
    this._renderEmptyState();
  };

  WorkspaceManager.prototype._setupDropZone = function () {
    var self = this;
    var ws = this.workspaceEl;

    ws.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      ws.classList.add('workspace-dragover');
    });

    ws.addEventListener('dragleave', function (e) {
      if (!ws.contains(e.relatedTarget)) {
        ws.classList.remove('workspace-dragover');
      }
    });

    ws.addEventListener('drop', function (e) {
      e.preventDefault();
      ws.classList.remove('workspace-dragover');

      var dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;

      try {
        var data = JSON.parse(dataStr);
        if (data.type === 'param') {
          self.addParamCard(data.name);
        } else if (data.type === 'key') {
          self.addKeyCard(data.keyIndex);
        } else if (data.type === 'all-keys') {
          self.addAllKeysCard();
        }
      } catch (ex) { }
    });
  };

  WorkspaceManager.prototype._setupSplitter = function () {
    var container = this.workspaceEl.parentElement;
    if (!container) return;

    var splitter = document.createElement('div');
    splitter.className = 'workspace-splitter';
    splitter.title = 'Drag to resize';
    this.splitterEl = splitter;

    var self = this;

    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      self._splitterDragging = true;
      self._splitterStartX = e.clientX;
      self._splitterStartWidth = self.workspaceEl.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function (e) {
      if (!self._splitterDragging) return;
      var delta = e.clientX - self._splitterStartX;
      var newWidth = Math.max(250, Math.min(800, self._splitterStartWidth - delta));
      self.workspaceEl.style.width = newWidth + 'px';
      self.workspaceEl.style.minWidth = newWidth + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (self._splitterDragging) {
        self._splitterDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    container.insertBefore(splitter, this.workspaceEl);
  };

  WorkspaceManager.prototype._renderEmptyState = function () {
    if (Object.keys(this.cards).length === 0 && Object.keys(this.keyCards).length === 0) {
      var existing = this.workspaceEl.querySelector('.workspace-empty');
      if (!existing) {
        var emptyEl = document.createElement('div');
        emptyEl.className = 'workspace-empty';
        emptyEl.innerHTML = '<div class="workspace-empty-icon">&#8693;</div><p>Drag parameters or keys here to make them adjustable</p>';
        this.workspaceEl.appendChild(emptyEl);
      }
    }
  };

  WorkspaceManager.prototype._clearEmptyState = function () {
    var empty = this.workspaceEl.querySelector('.workspace-empty');
    if (empty) empty.parentNode.removeChild(empty);
  };

  WorkspaceManager.prototype.addParamCard = function (paramName) {
    if (this.cards[paramName]) return;
    this._clearEmptyState();

    var params = this.getVoiceParams();
    var paramDef = params[paramName];
    if (!paramDef) return;

    var card = this._buildParamCard(paramName, paramDef);
    this.workspaceEl.appendChild(card.el);
    this.cards[paramName] = card;

    this._syncCheckbox(paramName, true);
    this._fireStateChange();
  };

  WorkspaceManager.prototype.removeParamCard = function (paramName) {
    var card = this.cards[paramName];
    if (!card) return;

    if (card.gpio) {
      delete this._usedGPIO[card.gpio];
    }
    if (card.el && card.el.parentNode) {
      card.el.parentNode.removeChild(card.el);
    }
    if (card.pot) {
      card.pot.destroy();
    }
    delete this.cards[paramName];

    this._syncCheckbox(paramName, false);
    this._renderEmptyState();
    this._fireStateChange();
  };

  WorkspaceManager.prototype._buildParamCard = function (paramName, paramDef) {
    var self = this;
    var card = { name: paramName, hwType: null, gpio: null, el: null, pot: null };

    var el = document.createElement('div');
    el.className = 'workspace-card';
    el.setAttribute('data-param', paramName);

    var header = document.createElement('div');
    header.className = 'workspace-card-header';

    var iconSpan = document.createElement('span');
    iconSpan.className = 'workspace-card-icon';
    card._iconSpan = iconSpan;

    var titleSpan = document.createElement('span');
    titleSpan.className = 'workspace-card-title';
    titleSpan.textContent = paramDef.label || paramName;

    var removeBtn = document.createElement('button');
    removeBtn.className = 'workspace-card-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove from workspace';
    removeBtn.addEventListener('click', function () {
      self.removeParamCard(paramName);
    });

    header.appendChild(iconSpan);
    header.appendChild(titleSpan);
    header.appendChild(removeBtn);
    el.appendChild(header);

    var hwRow = document.createElement('div');
    hwRow.className = 'workspace-card-hw';

    var hwLabel = document.createElement('label');
    hwLabel.textContent = 'Hardware:';

    var hwSelect = document.createElement('select');
    hwSelect.className = 'workspace-hw-select';

    var noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Choose type...';
    hwSelect.appendChild(noneOpt);

    for (var i = 0; i < HW_TYPES.length; i++) {
      var hwt = HW_TYPES[i];
      if (paramDef.type === 'trigger' && hwt.continuous) continue;
      var opt = document.createElement('option');
      opt.value = hwt.value;
      opt.textContent = hwt.label;
      hwSelect.appendChild(opt);
    }

    var gpioSelect = document.createElement('select');
    gpioSelect.className = 'workspace-gpio-select';
    gpioSelect.style.display = 'none';
    card._gpioSelect = gpioSelect;

    hwSelect.addEventListener('change', function () {
      var hwType = getHwType(hwSelect.value);
      card.hwType = hwSelect.value || null;
      self._updateCardIcon(card, hwSelect.value);
      self._populateGPIO(gpioSelect, hwType, card);
      self._fireStateChange();
    });

    gpioSelect.addEventListener('change', function () {
      if (card.gpio) delete self._usedGPIO[card.gpio];
      card.gpio = gpioSelect.value;
      if (card.gpio) self._usedGPIO[card.gpio] = paramName;
      self._fireStateChange();
    });

    hwRow.appendChild(hwLabel);
    hwRow.appendChild(hwSelect);
    hwRow.appendChild(gpioSelect);
    el.appendChild(hwRow);

    if (paramDef.type === 'continuous') {
      var potDiv = document.createElement('div');
      potDiv.className = 'workspace-card-knob';
      var currentVal = this.getParamValue(paramName);
      var pot = new CircularPot({
        name: paramName,
        label: '',
        min: paramDef.min,
        max: paramDef.max,
        step: self._stepForRange(paramDef.min, paramDef.max),
        value: currentVal !== undefined ? currentVal : paramDef.default,
        color: CircularPot.COLOR_TEAL,
        size: 56,
        onChange: function (name, val) {
          self.setParamValue(name, val);
          self._fireStateChange();
        }
      });
      potDiv.appendChild(pot.node());
      el.appendChild(potDiv);
      card.pot = pot;
    }

    card.el = el;
    return card;
  };

  WorkspaceManager.prototype._stepForRange = function (min, max) {
    var range = max - min;
    if (range <= 0.1) return 0.0001;
    if (range <= 1) return 0.001;
    if (range <= 10) return 0.01;
    if (range <= 100) return 0.1;
    return 1;
  };

  WorkspaceManager.prototype._updateCardIcon = function (card, hwTypeValue) {
    if (!card._iconSpan) return;
    if (!hwTypeValue) {
      card._iconSpan.innerHTML = '';
      return;
    }
    var hwt = getHwType(hwTypeValue);
    if (hwt) {
      card._iconSpan.innerHTML = '';
      card._iconSpan.appendChild(ComponentIcons.createIconElement(hwt.icon, 20));
    }
  };

  WorkspaceManager.prototype._populateGPIO = function (gpioSelect, hwType, card) {
    if (card.gpio) {
      delete this._usedGPIO[card.gpio];
      card.gpio = null;
    }
    gpioSelect.innerHTML = '';

    if (!hwType) {
      gpioSelect.style.display = 'none';
      return;
    }

    gpioSelect.style.display = '';
    var pins = hwType.pins;
    for (var i = 0; i < pins.length; i++) {
      var opt = document.createElement('option');
      opt.value = pins[i];
      opt.textContent = pins[i];
      if (this._usedGPIO[pins[i]]) {
        opt.disabled = true;
        opt.textContent += ' (in use)';
      }
      gpioSelect.appendChild(opt);
    }

    for (var j = 0; j < pins.length; j++) {
      if (!this._usedGPIO[pins[j]]) {
        gpioSelect.value = pins[j];
        card.gpio = pins[j];
        this._usedGPIO[pins[j]] = card.name;
        break;
      }
    }
  };

  WorkspaceManager.prototype.addKeyCard = function (keyIndex) {
    var cardId = 'key-' + keyIndex;
    if (this.keyCards[cardId]) return;
    this._clearEmptyState();

    var card = this._buildKeyCard(keyIndex, false);
    this.workspaceEl.appendChild(card.el);
    this.keyCards[cardId] = card;
    this._fireStateChange();
  };

  WorkspaceManager.prototype.addAllKeysCard = function () {
    var cardId = 'all-keys';
    if (this.keyCards[cardId]) return;
    this._clearEmptyState();

    var card = this._buildKeyCard(null, true);
    this.workspaceEl.appendChild(card.el);
    this.keyCards[cardId] = card;
    this._fireStateChange();
  };

  WorkspaceManager.prototype.removeKeyCard = function (cardId) {
    var card = this.keyCards[cardId];
    if (!card) return;

    if (card.gpioAssignments) {
      for (var pin in card.gpioAssignments) {
        delete this._usedGPIO[pin];
      }
    }
    if (card.el && card.el.parentNode) {
      card.el.parentNode.removeChild(card.el);
    }
    delete this.keyCards[cardId];
    this._renderEmptyState();
    this._fireStateChange();
  };

  WorkspaceManager.prototype._buildKeyCard = function (keyIndex, allKeys) {
    var self = this;
    var cardId = allKeys ? 'all-keys' : ('key-' + keyIndex);
    var card = { id: cardId, keyIndex: keyIndex, allKeys: allKeys, hwType: null, el: null, gpioAssignments: {}, sweepMode: false };

    var el = document.createElement('div');
    el.className = 'workspace-card workspace-card--keys';

    var header = document.createElement('div');
    header.className = 'workspace-card-header';

    var iconSpan = document.createElement('span');
    iconSpan.className = 'workspace-card-icon';
    iconSpan.appendChild(ComponentIcons.createIconElement('keyboard', 20));

    var titleSpan = document.createElement('span');
    titleSpan.className = 'workspace-card-title';
    titleSpan.textContent = allKeys ? 'All Keys (Scale)' : ('Key ' + keyIndex);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'workspace-card-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', function () {
      self.removeKeyCard(cardId);
    });

    header.appendChild(iconSpan);
    header.appendChild(titleSpan);
    header.appendChild(removeBtn);
    el.appendChild(header);

    var hwRow = document.createElement('div');
    hwRow.className = 'workspace-card-hw';

    var hwLabel = document.createElement('label');
    hwLabel.textContent = 'Input:';

    var hwSelect = document.createElement('select');
    hwSelect.className = 'workspace-hw-select';

    var noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Choose type...';
    hwSelect.appendChild(noneOpt);

    for (var i = 0; i < HW_TYPES.length; i++) {
      var opt = document.createElement('option');
      opt.value = HW_TYPES[i].value;
      opt.textContent = HW_TYPES[i].label;
      hwSelect.appendChild(opt);
    }

    var configArea = document.createElement('div');
    configArea.className = 'workspace-card-config';
    card._configArea = configArea;
    card._iconSpan = iconSpan;

    hwSelect.addEventListener('change', function () {
      card.hwType = hwSelect.value || null;
      self._updateCardIcon(card, hwSelect.value);
      self._renderKeyConfig(card);
      self._fireStateChange();
    });

    hwRow.appendChild(hwLabel);
    hwRow.appendChild(hwSelect);
    el.appendChild(hwRow);
    el.appendChild(configArea);

    card.el = el;
    return card;
  };

  WorkspaceManager.prototype._renderKeyConfig = function (card) {
    var self = this;
    var area = card._configArea;
    area.innerHTML = '';

    for (var pin in card.gpioAssignments) {
      delete this._usedGPIO[pin];
    }
    card.gpioAssignments = {};
    card.sweepMode = false;

    if (!card.hwType) return;

    var hwt = getHwType(card.hwType);
    if (!hwt) return;

    if (hwt.continuous) {
      card.sweepMode = true;

      var sweepNote = document.createElement('p');
      sweepNote.className = 'workspace-card-note';
      sweepNote.textContent = 'Sweeps through scale notes as value changes (0.0 = first note, 1.0 = last note)';
      area.appendChild(sweepNote);

      var gpioRow = document.createElement('div');
      gpioRow.className = 'workspace-card-gpio-row';
      var gpioLabel = document.createElement('label');
      gpioLabel.textContent = 'Pin:';
      var gpioSelect = document.createElement('select');
      gpioSelect.className = 'workspace-gpio-select';

      for (var i = 0; i < hwt.pins.length; i++) {
        var opt = document.createElement('option');
        opt.value = hwt.pins[i];
        opt.textContent = hwt.pins[i];
        if (self._usedGPIO[hwt.pins[i]]) {
          opt.disabled = true;
          opt.textContent += ' (in use)';
        }
        gpioSelect.appendChild(opt);
      }

      // Auto-select first available
      for (var j = 0; j < hwt.pins.length; j++) {
        if (!self._usedGPIO[hwt.pins[j]]) {
          gpioSelect.value = hwt.pins[j];
          card.gpioAssignments[hwt.pins[j]] = card.id;
          self._usedGPIO[hwt.pins[j]] = card.id;
          break;
        }
      }

      gpioSelect.addEventListener('change', function () {
        for (var p in card.gpioAssignments) { delete self._usedGPIO[p]; }
        card.gpioAssignments = {};
        card.gpioAssignments[gpioSelect.value] = card.id;
        self._usedGPIO[gpioSelect.value] = card.id;
        self._fireStateChange();
      });

      gpioRow.appendChild(gpioLabel);
      gpioRow.appendChild(gpioSelect);
      area.appendChild(gpioRow);
    } else {
      var keyCount = card.allKeys ? this.getScaleKeys().length : 1;
      var keys = card.allKeys ? this.getScaleKeys() : [{ index: card.keyIndex, label: 'Key ' + card.keyIndex }];

      for (var k = 0; k < keys.length; k++) {
        (function (keyInfo, idx) {
          var row = document.createElement('div');
          row.className = 'workspace-card-gpio-row';

          var label = document.createElement('label');
          label.textContent = keyInfo.label + ':';
          label.className = 'workspace-key-label';

          var gpioSelect = document.createElement('select');
          gpioSelect.className = 'workspace-gpio-select workspace-gpio-select--sm';

          for (var pi = 0; pi < hwt.pins.length; pi++) {
            var opt = document.createElement('option');
            opt.value = hwt.pins[pi];
            opt.textContent = hwt.pins[pi];
            if (self._usedGPIO[hwt.pins[pi]]) {
              opt.disabled = true;
              opt.textContent += ' (in use)';
            }
            gpioSelect.appendChild(opt);
          }

          for (var aj = 0; aj < hwt.pins.length; aj++) {
            if (!self._usedGPIO[hwt.pins[aj]]) {
              gpioSelect.value = hwt.pins[aj];
              card.gpioAssignments[hwt.pins[aj]] = card.id + ':' + idx;
              self._usedGPIO[hwt.pins[aj]] = card.id + ':' + idx;
              break;
            }
          }

          gpioSelect.addEventListener('change', function () {
            for (var p in card.gpioAssignments) {
              if (card.gpioAssignments[p] === card.id + ':' + idx) {
                delete self._usedGPIO[p];
                delete card.gpioAssignments[p];
              }
            }
            card.gpioAssignments[gpioSelect.value] = card.id + ':' + idx;
            self._usedGPIO[gpioSelect.value] = card.id + ':' + idx;
            self._fireStateChange();
          });

          row.appendChild(label);
          row.appendChild(gpioSelect);
          area.appendChild(row);
        })(keys[k], k);
      }
    }
  };

  WorkspaceManager.prototype._syncCheckbox = function (paramName, active) {
    var cb = document.getElementById('ws-check-' + paramName);
    if (cb) cb.checked = active;
  };

  WorkspaceManager.prototype._fireStateChange = function () {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  };

  WorkspaceManager.prototype.getState = function () {
    var paramAssignments = {};
    for (var pName in this.cards) {
      var card = this.cards[pName];
      paramAssignments[pName] = {
        hwType: card.hwType,
        gpio: card.gpio,
        adjustable: true
      };
    }

    var keyAssignments = {};
    for (var kId in this.keyCards) {
      var kCard = this.keyCards[kId];
      keyAssignments[kId] = {
        hwType: kCard.hwType,
        allKeys: kCard.allKeys,
        keyIndex: kCard.keyIndex,
        sweepMode: kCard.sweepMode,
        gpioAssignments: Object.assign({}, kCard.gpioAssignments)
      };
    }

    return {
      params: paramAssignments,
      keys: keyAssignments,
      usedGPIO: Object.assign({}, this._usedGPIO)
    };
  };

  WorkspaceManager.prototype.clear = function () {
    for (var pName in this.cards) {
      if (this.cards[pName].pot) this.cards[pName].pot.destroy();
      if (this.cards[pName].el && this.cards[pName].el.parentNode) {
        this.cards[pName].el.parentNode.removeChild(this.cards[pName].el);
      }
    }
    for (var kId in this.keyCards) {
      if (this.keyCards[kId].el && this.keyCards[kId].el.parentNode) {
        this.keyCards[kId].el.parentNode.removeChild(this.keyCards[kId].el);
      }
    }
    this.cards = {};
    this.keyCards = {};
    this._usedGPIO = {};
    this._renderEmptyState();
  };

  WorkspaceManager.prototype.updateKnobValue = function (paramName, value) {
    var card = this.cards[paramName];
    if (card && card.pot) {
      card.pot.setValue(value);
    }
  };

  root.WorkspaceManager = WorkspaceManager;
  root.WorkspaceManager.HW_TYPES = HW_TYPES;
  root.WorkspaceManager.GPIO_BUTTON_PINS = GPIO_BUTTON_PINS;
  root.WorkspaceManager.GPIO_POT_PINS = GPIO_POT_PINS;
  root.WorkspaceManager.GPIO_TOUCH_NATIVE_PINS = GPIO_TOUCH_NATIVE_PINS;
  root.WorkspaceManager.GPIO_TOUCH_MPR121_CHANNELS = GPIO_TOUCH_MPR121_CHANNELS;

})(window);
