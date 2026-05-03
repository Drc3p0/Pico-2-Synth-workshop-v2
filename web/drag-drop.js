/**
 * WorkspaceManager - Drag-and-drop workspace for hardware parameter assignment
 * 
 * This module provides an IIFE-based drag-drop interface for assigning Pico synth parameters
 * and musical keys to physical hardware inputs (buttons, potentiometers, touch sensors, etc.)
 * with GPIO pin selection. Serves as a simpler alternative to hardware-zone.js.
 * 
 * Exported to window.WorkspaceManager with static properties:
 * - HW_TYPES: Hardware type definitions
 * - GPIO_*_PINS: Available pins for each hardware category
 * 
 * Depends on: CircularPot (circular-pot.js), ComponentIcons (component-icons.js)
 * @module drag-drop
 */
(function (root) {
  "use strict";

  // GPIO pins available for button hardware inputs (digital inputs)
  var GPIO_BUTTON_PINS = ["GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7"];
  
  // GPIO pins available for analog inputs (potentiometer, LDR via ADC)
  var GPIO_POT_PINS = ["GP26", "GP27", "GP28"];
  
  // GPIO pins available for capacitive touch sensing via Pico native touch inputs
  var GPIO_TOUCH_NATIVE_PINS = ["GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9", "GP10", "GP11", "GP12", "GP13"];
  
  // MPR121 I2C touch sensor channels: 48 total channels across 4 boards (12 channels per board)
  var GPIO_TOUCH_MPR121_CHANNELS = [];
  for (var i = 0; i < 48; i++) {
    var board = Math.floor(i / 12);
    var ch = i % 12;
    GPIO_TOUCH_MPR121_CHANNELS.push("MPR" + board + "#" + ch);
  }
  
  // Accelerometer X/Y axes (2-axis motion input, typically via I2C)
  var GPIO_ACCEL_AXES = ["X", "Y"];

  /**
   * Hardware type definitions
   * Each type includes: value (enum), label (UI display), icon (component icon name),
   * continuous (boolean: analog vs digital), pins (available GPIO options)
   */
  var HW_TYPES = [
    { value: "pot",          label: "Potentiometer",   icon: "pot",          continuous: true,  pins: GPIO_POT_PINS },
    { value: "ldr",          label: "LDR (Light)",     icon: "ldr",          continuous: true,  pins: GPIO_POT_PINS },
    { value: "button",       label: "Button",          icon: "button",       continuous: false, pins: GPIO_BUTTON_PINS },
    { value: "touch_native", label: "Touch (Pico GPIO)", icon: "touch_native", continuous: false, pins: GPIO_TOUCH_NATIVE_PINS },
    { value: "touch_mpr121", label: "Touch (MPR121 I2C)", icon: "touch_mpr121", continuous: false, pins: GPIO_TOUCH_MPR121_CHANNELS },
    { value: "accel",        label: "Accelerometer",   icon: "accel",        continuous: true,  pins: GPIO_ACCEL_AXES }
  ];

  /**
   * Find hardware type definition by value
   * @param {string} value - Hardware type value to look up
   * @returns {Object|null} Hardware type definition or null if not found
   */
  function getHwType(value) {
    for (var i = 0; i < HW_TYPES.length; i++) {
      if (HW_TYPES[i].value === value) return HW_TYPES[i];
    }
    return null;
  }

  /**
   * WorkspaceManager Constructor
   * Initializes the drag-drop workspace manager with optional callbacks
   * 
   * @param {Object} options - Configuration object
   * @param {Function} [options.onStateChange] - Callback fired when assignments change: function(state)
   * @param {Function} [options.getVoiceParams] - Callback to fetch synth parameter definitions: function() -> {paramName: {label, type, min, max, default, ...}, ...}
   * @param {Function} [options.getParamValue] - Get current parameter value: function(paramName) -> number
   * @param {Function} [options.setParamValue] - Set parameter value: function(paramName, value)
   * @param {Function} [options.getScaleKeys] - Get available scale keys for "all keys" assignment: function() -> [{index, label}, ...]
   */
  function WorkspaceManager(options) {
    this.workspaceEl = null; // DOM element containing param and key cards
    this.paletteEl = null; // DOM element containing draggable parameter/key palette
    this.splitterEl = null; // Resizable splitter between workspace and palette
    this.cards = {}; // {paramName: {name, hwType, gpio, el, pot, ...}} - parameter assignment cards
    this.keyCards = {}; // {'key-N' or 'all-keys': {id, keyIndex, allKeys, hwType, el, gpioAssignments, sweepMode}} - key assignment cards
    this.onStateChange = options.onStateChange || null; // Callback when state changes
    this.getVoiceParams = options.getVoiceParams || function () { return {}; }; // Get param definitions
    this.getParamValue = options.getParamValue || function () { return 0; }; // Get current param value
    this.setParamValue = options.setParamValue || function () {}; // Set param value
    this.getScaleKeys = options.getScaleKeys || function () { return []; }; // Get available scale keys

    // Track which GPIO pins are already assigned to prevent conflicts
    this._usedGPIO = {};
    this._dragData = null; // Temporary storage for drag event data
    this._splitterDragging = false; // Flag for active splitter resize
    this._splitterStartX = 0; // Mouse X position when splitter drag starts
    this._splitterStartWidth = 0; // Initial workspace width when splitter drag starts
  }

  /**
   * Initialize the workspace and palette UI elements
   * Attaches drag-drop listeners and renders empty state
   * 
   * @param {string} workspaceId - ID of the workspace container element
   * @param {string} paletteId - ID of the draggable palette element
   */
  WorkspaceManager.prototype.init = function (workspaceId, paletteId) {
    this.workspaceEl = document.getElementById(workspaceId);
    this.paletteEl = document.getElementById(paletteId);

    if (!this.workspaceEl || !this.paletteEl) return;

    this._setupDropZone(); // Enable drag-drop on workspace
    this._setupSplitter(); // Create and attach resizable splitter
    this._renderEmptyState(); // Show empty state message if no cards
  };

  /**
   * Setup workspace drop zone handlers
   * Enables drag-over highlighting and processes dropped parameter/key items
   * Parses JSON drag data (type + name/keyIndex) to route to appropriate add method
   */
  WorkspaceManager.prototype._setupDropZone = function () {
    var self = this;
    var ws = this.workspaceEl;

    // Highlight workspace when item dragged over
    ws.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      ws.classList.add('workspace-dragover');
    });

    // Remove highlight when drag leaves workspace
    ws.addEventListener('dragleave', function (e) {
      if (!ws.contains(e.relatedTarget)) {
        ws.classList.remove('workspace-dragover');
      }
    });

    // Handle drop: parse drag data and add appropriate card type
    ws.addEventListener('drop', function (e) {
      e.preventDefault();
      ws.classList.remove('workspace-dragover');

      var dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;

      try {
        var data = JSON.parse(dataStr);
        // Route to appropriate handler based on dragged item type
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

  /**
   * Setup resizable splitter between workspace and palette
   * Allows user to drag left/right to resize workspace width (250-800px bounds)
   * Splitter is inserted as preceding sibling of workspace in parent container
   */
  WorkspaceManager.prototype._setupSplitter = function () {
    var container = this.workspaceEl.parentElement;
    if (!container) return;

    var splitter = document.createElement('div');
    splitter.className = 'workspace-splitter';
    splitter.title = 'Drag to resize';
    this.splitterEl = splitter;

    var self = this;

    // Start drag: capture initial position and width
    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      self._splitterDragging = true;
      self._splitterStartX = e.clientX;
      self._splitterStartWidth = self.workspaceEl.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    // During drag: calculate new workspace width from mouse delta, respecting bounds
    document.addEventListener('mousemove', function (e) {
      if (!self._splitterDragging) return;
      var delta = e.clientX - self._splitterStartX;
      var newWidth = Math.max(250, Math.min(800, self._splitterStartWidth - delta));
      self.workspaceEl.style.width = newWidth + 'px';
      self.workspaceEl.style.minWidth = newWidth + 'px';
    });

    // End drag: cleanup cursor and selection state
    document.addEventListener('mouseup', function () {
      if (self._splitterDragging) {
        self._splitterDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    container.insertBefore(splitter, this.workspaceEl);
  };

  /**
   * Render empty state message when no parameter or key cards exist
   * Message prompts user to drag items from palette
   */
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

  /**
   * Remove empty state message from workspace
   */
  WorkspaceManager.prototype._clearEmptyState = function () {
    var empty = this.workspaceEl.querySelector('.workspace-empty');
    if (empty) empty.parentNode.removeChild(empty);
  };

  /**
   * Add a parameter assignment card to the workspace
   * Creates UI to select hardware type and GPIO pin, optionally includes knob for continuous params
   * Syncs external checkbox UI and fires state change callback
   * 
   * @param {string} paramName - Parameter name to add (must exist in getVoiceParams() result)
   */
  WorkspaceManager.prototype.addParamCard = function (paramName) {
    if (this.cards[paramName]) return; // Prevent duplicate cards for same param
    this._clearEmptyState();

    var params = this.getVoiceParams();
    var paramDef = params[paramName];
    if (!paramDef) return;

    var card = this._buildParamCard(paramName, paramDef);
    this.workspaceEl.appendChild(card.el);
    this.cards[paramName] = card;

    this._syncCheckbox(paramName, true); // Check external checkbox to reflect card added
    this._fireStateChange();
  };

  /**
   * Remove a parameter assignment card from the workspace
   * Frees GPIO pins and destroys CircularPot knob if attached
   * 
   * @param {string} paramName - Parameter name to remove
   */
  WorkspaceManager.prototype.removeParamCard = function (paramName) {
    var card = this.cards[paramName];
    if (!card) return;

    // Free up GPIO pin from _usedGPIO tracking
    if (card.gpio) {
      delete this._usedGPIO[card.gpio];
    }
    // Remove card element from DOM
    if (card.el && card.el.parentNode) {
      card.el.parentNode.removeChild(card.el);
    }
    // Destroy CircularPot instance if present
    if (card.pot) {
      card.pot.destroy();
    }
    delete this.cards[paramName];

    this._syncCheckbox(paramName, false); // Uncheck external checkbox to reflect removal
    this._renderEmptyState();
    this._fireStateChange();
  };

  /**
   * Build parameter card UI with hardware type selector, GPIO selector, and optional knob
   * Card object shape: {name, hwType, gpio, el, pot, _iconSpan, _gpioSelect}
   * 
   * For continuous parameters, includes a CircularPot knob showing current value.
   * For trigger parameters, only discrete hardware types (buttons, touch) are offered.
   * GPIO selector auto-populates when hardware type selected, skipping already-used pins.
   * 
   * @param {string} paramName - Parameter name
   * @param {Object} paramDef - Parameter definition {label, type:'continuous'|'trigger', min, max, default}
   * @returns {Object} Card object with el (DOM element) and references to UI controls
   */
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

    // Filter hardware types: exclude continuous types for trigger parameters
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

    // When hardware type changes, update icon and repopulate GPIO options
    hwSelect.addEventListener('change', function () {
      var hwType = getHwType(hwSelect.value);
      card.hwType = hwSelect.value || null;
      self._updateCardIcon(card, hwSelect.value);
      self._populateGPIO(gpioSelect, hwType, card);
      self._fireStateChange();
    });

    // When GPIO pin selected, track it in _usedGPIO to prevent conflicts
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

    // For continuous parameters, add a CircularPot knob for live adjustment
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

  /**
   * Calculate appropriate step size for CircularPot based on parameter range
   * Smaller ranges get finer granularity to allow precise adjustment
   * 
   * @param {number} min - Parameter minimum value
   * @param {number} max - Parameter maximum value
   * @returns {number} Step size (0.0001 for small ranges up to 1 for large)
   */
  WorkspaceManager.prototype._stepForRange = function (min, max) {
    var range = max - min;
    if (range <= 0.1) return 0.0001;
    if (range <= 1) return 0.001;
    if (range <= 10) return 0.01;
    if (range <= 100) return 0.1;
    return 1;
  };

  /**
   * Update card header icon based on selected hardware type
   * Icon comes from ComponentIcons library by icon name
   * 
   * @param {Object} card - Card object with _iconSpan reference
   * @param {string} hwTypeValue - Hardware type value to show icon for
   */
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

  /**
   * Populate GPIO selector dropdown with available pins for hardware type
   * Auto-selects first available (unused) pin and tracks it in _usedGPIO
   * Marks already-used pins as disabled
   * Clears old GPIO assignment when repopulating
   * 
   * @param {HTMLSelectElement} gpioSelect - GPIO <select> element to populate
   * @param {Object} hwType - Hardware type definition with pins array
   * @param {Object} card - Card object to track gpio assignment
   */
  WorkspaceManager.prototype._populateGPIO = function (gpioSelect, hwType, card) {
    // Free previously assigned pin
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
    
    // Build dropdown: populate all pins, disable those already assigned
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

    // Auto-select first available pin
    for (var j = 0; j < pins.length; j++) {
      if (!this._usedGPIO[pins[j]]) {
        gpioSelect.value = pins[j];
        card.gpio = pins[j];
        this._usedGPIO[pins[j]] = card.name;
        break;
      }
    }
  };

  /**
   * Add a single key assignment card to the workspace
   * Allows assigning discrete hardware inputs (buttons/touch) to a musical key
   * For continuous hardware, uses sweep mode (0.0-1.0 maps to scale range)
   * 
   * @param {number} keyIndex - MIDI note index for this key
   */
  WorkspaceManager.prototype.addKeyCard = function (keyIndex) {
    var cardId = 'key-' + keyIndex;
    if (this.keyCards[cardId]) return; // Prevent duplicate cards for same key
    this._clearEmptyState();

    var card = this._buildKeyCard(keyIndex, false);
    this.workspaceEl.appendChild(card.el);
    this.keyCards[cardId] = card;
    this._fireStateChange();
  };

  /**
   * Add an "all keys" card to the workspace
   * Assigns a continuous hardware input (pot, LDR, accel) to sweep the full scale
   * Single GPIO pin controls entire key range
   */
  WorkspaceManager.prototype.addAllKeysCard = function () {
    var cardId = 'all-keys';
    if (this.keyCards[cardId]) return; // Prevent duplicate all-keys card
    this._clearEmptyState();

    var card = this._buildKeyCard(null, true);
    this.workspaceEl.appendChild(card.el);
    this.keyCards[cardId] = card;
    this._fireStateChange();
  };

  /**
   * Remove a key card from the workspace
   * Frees all GPIO pins assigned to this key
   * 
   * @param {string} cardId - Card ID ('key-N' or 'all-keys')
   */
  WorkspaceManager.prototype.removeKeyCard = function (cardId) {
    var card = this.keyCards[cardId];
    if (!card) return;

    // Free up all GPIO pins assigned to this card
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

  /**
   * Build key card UI for single key or all-keys assignment
   * Creates hardware type selector and dynamic config area
   * 
   * Card object shape for keys: {id, keyIndex, allKeys, hwType, el, gpioAssignments, sweepMode}
   * - For continuous hw (pot/ldr/accel): sweepMode=true, single GPIO, 0.0-1.0 maps to scale
   * - For discrete hw (button/touch): sweepMode=false, one GPIO per key, each button triggers one note
   * 
   * @param {number|null} keyIndex - MIDI note index (null for "all keys")
   * @param {boolean} allKeys - True for all-keys card, false for single key
   * @returns {Object} Card object with el (DOM element) and config controls
   */
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

    // Populate all hardware types for key cards (no filtering like param cards)
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

    // When hardware type changes, regenerate config UI for that hardware type
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

  /**
   * Render dynamic config UI based on hardware type and continuous vs discrete mode
   * 
   * For continuous hardware (pot/ldr/accel):
   *   - sweepMode=true: single GPIO pin, 0.0-1.0 normalized input maps to scale range
   *   - One control: select which pin drives the sweep
   * 
   * For discrete hardware (button/touch):
   *   - sweepMode=false: one GPIO pin per key (or per all-keys entry)
   *   - Multiple controls: one pin selector per scale key (e.g., 12 selectors for 12-tone scale)
   *   - Each button/touch pad assigned to its own GPIO, triggers one specific note
   */
  WorkspaceManager.prototype._renderKeyConfig = function (card) {
    var self = this;
    var area = card._configArea;
    area.innerHTML = '';

    // Clear old GPIO assignments
    for (var pin in card.gpioAssignments) {
      delete this._usedGPIO[pin];
    }
    card.gpioAssignments = {};
    card.sweepMode = false;

    if (!card.hwType) return;

    var hwt = getHwType(card.hwType);
    if (!hwt) return;

    // SWEEP MODE: Continuous hardware (pot, LDR, accel)
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

      // Populate available pins for continuous input
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

      // Auto-select first available pin
      for (var j = 0; j < hwt.pins.length; j++) {
        if (!self._usedGPIO[hwt.pins[j]]) {
          gpioSelect.value = hwt.pins[j];
          card.gpioAssignments[hwt.pins[j]] = card.id;
          self._usedGPIO[hwt.pins[j]] = card.id;
          break;
        }
      }

      // When pin changed, update tracking and fire state change
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
      // DISCRETE MODE: Digital hardware (button, touch)
      // Generate one GPIO selector per scale key
      var keyCount = card.allKeys ? this.getScaleKeys().length : 1;
      var keys = card.allKeys ? this.getScaleKeys() : [{ index: card.keyIndex, label: 'Key ' + card.keyIndex }];

      // Create a closure for each key to maintain unique event handlers
      for (var k = 0; k < keys.length; k++) {
        (function (keyInfo, idx) {
          var row = document.createElement('div');
          row.className = 'workspace-card-gpio-row';

          var label = document.createElement('label');
          label.textContent = keyInfo.label + ':';
          label.className = 'workspace-key-label';

          var gpioSelect = document.createElement('select');
          gpioSelect.className = 'workspace-gpio-select workspace-gpio-select--sm';

          // Populate available pins for this key
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

          // Auto-select first available pin for this key
          for (var aj = 0; aj < hwt.pins.length; aj++) {
            if (!self._usedGPIO[hwt.pins[aj]]) {
              gpioSelect.value = hwt.pins[aj];
              card.gpioAssignments[hwt.pins[aj]] = card.id + ':' + idx;
              self._usedGPIO[hwt.pins[aj]] = card.id + ':' + idx;
              break;
            }
          }

          // When pin changed for this key, update tracking and fire state change
          gpioSelect.addEventListener('change', function () {
            // Remove old pin for this key
            for (var p in card.gpioAssignments) {
              if (card.gpioAssignments[p] === card.id + ':' + idx) {
                delete self._usedGPIO[p];
                delete card.gpioAssignments[p];
              }
            }
            // Assign new pin to this key
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

  /**
   * Sync external checkbox UI with workspace card state
   * Used to couple workspace cards with palette checkboxes
   * 
   * @param {string} paramName - Parameter name
   * @param {boolean} active - True to check, false to uncheck
   */
  WorkspaceManager.prototype._syncCheckbox = function (paramName, active) {
    var cb = document.getElementById('ws-check-' + paramName);
    if (cb) cb.checked = active;
  };

  /**
   * Fire the onStateChange callback if registered
   * Aggregates current state and passes to callback
   */
  WorkspaceManager.prototype._fireStateChange = function () {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  };

  /**
   * Get current state object with all parameter and key assignments
   * Aggregates all cards, their hardware assignments, and GPIO usage tracking
   * 
   * @returns {Object} State object with structure:
   *   {
   *     params: {paramName: {hwType, gpio, adjustable: true}, ...},
   *     keys: {cardId: {hwType, allKeys, keyIndex, sweepMode, gpioAssignments}, ...},
   *     usedGPIO: {pin: assignmentId, ...}
   *   }
   */
  WorkspaceManager.prototype.getState = function () {
    var paramAssignments = {};
    // Aggregate all parameter cards with their hardware/GPIO assignment
    for (var pName in this.cards) {
      var card = this.cards[pName];
      paramAssignments[pName] = {
        hwType: card.hwType,
        gpio: card.gpio,
        adjustable: true
      };
    }

    var keyAssignments = {};
    // Aggregate all key cards with their mode and GPIO assignments
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

  /**
   * Clear all cards and reset workspace to empty state
   * Destroys all CircularPot instances and DOM elements
   */
  WorkspaceManager.prototype.clear = function () {
    // Clean up param cards
    for (var pName in this.cards) {
      if (this.cards[pName].pot) this.cards[pName].pot.destroy();
      if (this.cards[pName].el && this.cards[pName].el.parentNode) {
        this.cards[pName].el.parentNode.removeChild(this.cards[pName].el);
      }
    }
    // Clean up key cards
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

  /**
   * Update CircularPot knob value for a parameter card
   * Called when external state changes (e.g., synth parameter value updated)
   * 
   * @param {string} paramName - Parameter name
   * @param {number} value - New knob value
   */
  WorkspaceManager.prototype.updateKnobValue = function (paramName, value) {
    var card = this.cards[paramName];
    if (card && card.pot) {
      card.pot.setValue(value);
    }
  };

  // Export WorkspaceManager to window and attach static GPIO pin constants
  root.WorkspaceManager = WorkspaceManager;
  root.WorkspaceManager.HW_TYPES = HW_TYPES;
  root.WorkspaceManager.GPIO_BUTTON_PINS = GPIO_BUTTON_PINS;
  root.WorkspaceManager.GPIO_POT_PINS = GPIO_POT_PINS;
  root.WorkspaceManager.GPIO_TOUCH_NATIVE_PINS = GPIO_TOUCH_NATIVE_PINS;
  root.WorkspaceManager.GPIO_TOUCH_MPR121_CHANNELS = GPIO_TOUCH_MPR121_CHANNELS;

})(window);
