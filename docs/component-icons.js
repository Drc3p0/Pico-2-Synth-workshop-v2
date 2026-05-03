/**
 * component-icons.js
 * SVG icon library for hardware component types.
 * Supports: pot, ldr, button, touch_native, touch_mpr121, accel, keyboard
 * Used in workspace cards and hardware zone items for visual identification.
 */
(function (root) {
  "use strict";

  var ICONS = {
    pot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="4" x2="12" y2="1"/><line x1="12" y1="9" x2="12" y2="5" stroke-width="2"/></svg>',
    ldr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="7"/><line x1="3" y1="3" x2="7" y2="7"/><line x1="21" y1="3" x2="17" y2="7"/><line x1="3" y1="21" x2="7" y2="17"/><line x1="21" y1="21" x2="17" y2="17"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
    button: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="3"/><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" opacity="0.3"/></svg>',
    touch_native: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 8v8M8 12h8" stroke-width="2"/><text x="12" y="21" text-anchor="middle" font-size="4" fill="currentColor">GPIO</text></svg>',
    touch_mpr121: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="7" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><circle cx="17" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><text x="12" y="5" text-anchor="middle" font-size="3.5" fill="currentColor">I2C</text></svg>',
    accel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="14" height="14" rx="2"/><line x1="12" y1="8" x2="12" y2="16" stroke-width="2"/><line x1="8" y1="12" x2="16" y2="12" stroke-width="2"/><polygon points="12,6 14,10 10,10" fill="currentColor" opacity="0.5"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="2"/><rect x="4" y="8" width="3" height="5" rx="0.5"/><rect x="8" y="8" width="3" height="5" rx="0.5"/><rect x="12" y="8" width="3" height="5" rx="0.5"/><rect x="16" y="8" width="4" height="5" rx="0.5"/><rect x="4" y="14" width="16" height="2" rx="0.5"/></svg>'
  };

  /**
   * Retrieves SVG markup for a component type (falls back to pot icon if not found)
   * @param {string} type - Component type (pot, ldr, button, touch_native, touch_mpr121, accel, keyboard)
   * @returns {string} SVG markup string
   */
  function getIcon(type) {
    return ICONS[type] || ICONS.pot;
  }

  /**
   * Creates a DOM element containing a component icon.
   * Sets up sizing, flexbox alignment, and applies component-icon classes.
   * @param {string} type - Component type
   * @param {number} [size=24] - Icon size in pixels (width and height)
   * @returns {HTMLElement} Span element with inline SVG and styling
   */
  function createIconElement(type, size) {
    size = size || 24;
    var span = document.createElement('span');
    span.className = 'component-icon component-icon--' + type;
    span.innerHTML = getIcon(type);
    span.style.width = size + 'px';
    span.style.height = size + 'px';
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    return span;
  }

  root.ComponentIcons = {
    getIcon: getIcon,
    createIconElement: createIconElement,
    TYPES: Object.keys(ICONS)
  };

})(window);
