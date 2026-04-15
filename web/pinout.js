/**
 * Pico 2 Dynamic SVG Pinout Generator
 * Renders a board diagram with component names displayed next to active pins.
 */
(function () {
  "use strict";

  // ---------- colour palette ----------
  var COLORS = {
    button:   "#E74C3C",  // bright red
    analog:   "#2ECC71",  // emerald green
    i2c:      "#3498DB",  // dodger blue
    audio:    "#F39C12",  // orange
    led:      "#9B59B6",  // purple
    power:    "#E91E63",  // pink
    gnd:      "#7F8C8D",  // gray
    inactive: "#BDC3C7",  // light gray
    board:    "#2D6A4F",  // PCB green
    boardEdge:"#1B4332",  // darker green edge
    chip:     "#1a1a1a",
    chipText: "#888",
    chipDot:  "#555",
    usb:      "#888",
    usbStroke:"#aaa",
    silkscreen:"#FFFFFFCC",
  };

  // ---------- canonical Pico 2 pin map ----------
  // Left side: physical pins 1-20, top to bottom
  var LEFT_PINS = [
    [1,  "GP0",    "gpio"],
    [2,  "GP1",    "gpio"],
    [3,  "GND",    "gnd"],
    [4,  "GP2",    "gpio"],
    [5,  "GP3",    "gpio"],
    [6,  "GP4",    "gpio"],
    [7,  "GP5",    "gpio"],
    [8,  "GND",    "gnd"],
    [9,  "GP6",    "gpio"],
    [10, "GP7",    "gpio"],
    [11, "GP8",    "gpio"],
    [12, "GP9",    "gpio"],
    [13, "GND",    "gnd"],
    [14, "GP10",   "gpio"],
    [15, "GP11",   "gpio"],
    [16, "GP12",   "gpio"],
    [17, "GP13",   "gpio"],
    [18, "GND",    "gnd"],
    [19, "GP14",   "gpio"],
    [20, "GP15",   "gpio"],
  ];

  // Right side: physical pins 40-21, top to bottom
  var RIGHT_PINS = [
    [40, "VBUS",     "power"],
    [39, "VSYS",     "power"],
    [38, "GND",      "gnd"],
    [37, "3V3_EN",   "system"],
    [36, "3V3",      "power"],
    [35, "ADC_VREF", "system"],
    [34, "GP28",     "gpio"],
    [33, "GND",      "gnd"],
    [32, "GP27",     "gpio"],
    [31, "GP26",     "gpio"],
    [30, "RUN",      "system"],
    [29, "GP22",     "gpio"],
    [28, "GND",      "gnd"],
    [27, "GP21",     "gpio"],
    [26, "GP20",     "gpio"],
    [25, "GP19",     "gpio"],
    [24, "GP18",     "gpio"],
    [23, "GND",      "gnd"],
    [22, "GP17",     "gpio"],
    [21, "GP16",     "gpio"],
  ];

  // ---------- helpers ----------

  function svgEl(tag, attrs, children) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, attrs[k]);
      });
    }
    if (typeof children === "string") {
      el.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(function (c) {
        if (c) el.appendChild(c);
      });
    }
    return el;
  }

  /**
   * Determine the highlight colour and descriptive label for a pin.
   * Returns { color, label } or null if inactive.
   */
  function pinInfo(gpioName, category, active) {
    if (!active) return null;

    var anyActive =
      (active.buttons && active.buttons.length) ||
      (active.analog && active.analog.length) ||
      active.i2c || active.audio || active.led ||
      active.oled || active.mpr121 || active.accelerometer;

    // GND — highlight if anything is active
    if (category === "gnd") {
      return anyActive ? { color: COLORS.gnd, label: "GND" } : null;
    }

    // Power rails
    if (gpioName === "VBUS") {
      return anyActive ? { color: COLORS.power, label: "VBUS (5V)" } : null;
    }
    if (gpioName === "3V3") {
      return anyActive ? { color: COLORS.power, label: "3V3 Out" } : null;
    }
    if (category === "power" || category === "system") {
      return null; // VSYS, 3V3_EN, ADC_VREF, RUN — not labelled
    }

    // Extract GP number
    var m = gpioName.match(/^GP(\d+)$/);
    if (!m) return null;
    var num = parseInt(m[1], 10);

    // Buttons GP0-GP7
    if (num >= 0 && num <= 7 && active.buttons) {
      for (var i = 0; i < active.buttons.length; i++) {
        if (active.buttons[i] === num) {
          return { color: COLORS.button, label: "Btn " + num };
        }
      }
    }

    // Analog / ADC GP26-28
    if (num >= 26 && num <= 28 && active.analog) {
      for (var j = 0; j < active.analog.length; j++) {
        if (active.analog[j] === gpioName) {
          var adcCh = num - 26;
          return { color: COLORS.analog, label: "Pot " + String.fromCharCode(65 + adcCh) + " (ADC" + adcCh + ")" };
        }
      }
    }

    // I2C GP16 (SDA) / GP17 (SCL)
    if ((num === 16 || num === 17) && active.i2c) {
      var role = num === 16 ? "SDA" : "SCL";
      var devices = [];
      if (active.oled) devices.push("OLED");
      if (active.mpr121) devices.push("MPR121");
      if (active.accelerometer) devices.push("Accel");
      var devStr = devices.length ? " (" + devices.join(", ") + ")" : "";
      return { color: COLORS.i2c, label: "I2C " + role + devStr };
    }

    // Audio PWM GP15
    if (num === 15 && active.audio) {
      return { color: COLORS.audio, label: "Speaker" };
    }

    // On-board LED GP25
    if (num === 25 && active.led) {
      return { color: COLORS.led, label: "LED" };
    }

    return null;
  }

  // ---------- rendering ----------

  function render(containerId, activeConnections) {
    var container = document.getElementById(containerId);
    if (!container) {
      console.error("PinoutGenerator: container #" + containerId + " not found");
      return;
    }
    container.innerHTML = "";

    // Layout constants
    var svgW = 860, svgH = 540;
    var boardW = 180, boardH = 460;
    var boardX = (svgW - boardW) / 2;
    var boardY = 50;
    var pinRows = 20;
    var pinSpacing = (boardH - 40) / (pinRows - 1); // vertical spacing between pin centres
    var pinStartY = boardY + 28; // first pin centre Y
    var pinW = 30, pinH = 8;
    var pinRadius = 2;
    var cornerR = 8;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + svgW + " " + svgH,
      xmlns: "http://www.w3.org/2000/svg",
      style: "width:100%;height:auto;display:block;",
    });

    // ---- defs: drop shadow ----
    var defs = svgEl("defs");
    var filter = svgEl("filter", { id: "boardShadow", x: "-5%", y: "-5%", width: "115%", height: "115%" });
    filter.appendChild(svgEl("feDropShadow", { dx: 3, dy: 3, stdDeviation: 4, "flood-color": "rgba(0,0,0,0.5)" }));
    defs.appendChild(filter);
    svg.appendChild(defs);

    // ---- background ----
    svg.appendChild(svgEl("rect", { width: svgW, height: svgH, fill: "#0F1117" }));

    // ---- board body ----
    // PCB board with slight rounded corners
    svg.appendChild(svgEl("rect", {
      x: boardX, y: boardY, width: boardW, height: boardH,
      rx: cornerR, fill: COLORS.board, stroke: COLORS.boardEdge,
      "stroke-width": 2, filter: "url(#boardShadow)",
    }));

    // ---- USB port at top ----
    var usbW = 44, usbH = 14;
    var usbX = boardX + boardW / 2 - usbW / 2;
    var usbY = boardY - 4;
    svg.appendChild(svgEl("rect", {
      x: usbX, y: usbY, width: usbW, height: usbH,
      rx: 3, fill: COLORS.usb, stroke: COLORS.usbStroke, "stroke-width": 1,
    }));
    svg.appendChild(svgEl("text", {
      x: boardX + boardW / 2, y: usbY + 10,
      "text-anchor": "middle", fill: "#CDD6F4", "font-size": "7",
      "font-family": "monospace", "font-weight": "bold",
    }, "USB-C"));

    // ---- RP2350 chip in centre ----
    var chipW = 52, chipH = 52;
    var chipX = boardX + boardW / 2 - chipW / 2;
    var chipY = boardY + boardH / 2 - chipH / 2 - 10;
    svg.appendChild(svgEl("rect", {
      x: chipX, y: chipY, width: chipW, height: chipH,
      rx: 3, fill: COLORS.chip, stroke: "#444", "stroke-width": 1,
    }));
    // orientation dot
    svg.appendChild(svgEl("circle", {
      cx: chipX + 9, cy: chipY + 9, r: 3, fill: COLORS.chipDot,
    }));
    // chip label
    svg.appendChild(svgEl("text", {
      x: boardX + boardW / 2, y: chipY + chipH / 2 + 4,
      "text-anchor": "middle", fill: COLORS.chipText, "font-size": "9",
      "font-family": "monospace", "font-weight": "bold",
    }, "RP2350"));

    // ---- Board silkscreen label ----
    svg.appendChild(svgEl("text", {
      x: boardX + boardW / 2, y: boardY + boardH - 16,
      "text-anchor": "middle", fill: COLORS.silkscreen, "font-size": "10",
      "font-family": "monospace", "font-weight": "bold",
    }, "Pico 2"));

    // ---- SWD debug pads at bottom ----
    var debugY = boardY + boardH - 36;
    for (var d = 0; d < 3; d++) {
      svg.appendChild(svgEl("circle", {
        cx: boardX + boardW / 2 - 12 + d * 12, cy: debugY,
        r: 3, fill: "#1B4332", stroke: "#FFD700", "stroke-width": 0.7,
      }));
    }
    svg.appendChild(svgEl("text", {
      x: boardX + boardW / 2, y: debugY + 11,
      "text-anchor": "middle", fill: COLORS.silkscreen, "font-size": "6",
      "font-family": "monospace",
    }, "SWD"));

    // ---- Pin holes along board edges (decorative, inside board) ----
    // We draw small gold-filled circles at each pin position on the board edge
    function drawBoardPinHoles(pins, side) {
      pins.forEach(function (_pin, idx) {
        var cy = pinStartY + idx * pinSpacing;
        var cx = side === "left" ? boardX + 8 : boardX + boardW - 8;
        svg.appendChild(svgEl("circle", {
          cx: cx, cy: cy, r: 3.5,
          fill: "#C0A050", stroke: "#A08030", "stroke-width": 0.5,
        }));
      });
    }
    drawBoardPinHoles(LEFT_PINS, "left");
    drawBoardPinHoles(RIGHT_PINS, "right");

    // ---- Draw pins and labels ----

    function drawPinRow(pins, side) {
      pins.forEach(function (pin, idx) {
        var pinNum = pin[0];
        var name = pin[1];
        var cat = pin[2];
        var info = pinInfo(name, cat, activeConnections);
        var isActive = info !== null;
        var fill = isActive ? info.color : COLORS.inactive;

        var cy = pinStartY + idx * pinSpacing;
        var py = cy - pinH / 2;
        var px, gpLabelX, gpAnchor, compLabelX, compAnchor;

        if (side === "left") {
          px = boardX - pinW;
          // GPIO name sits between the pin and the component label
          gpLabelX = px - 6;
          gpAnchor = "end";
          // Component name further out
          compLabelX = px - 6;
          compAnchor = "end";
        } else {
          px = boardX + boardW;
          gpLabelX = px + pinW + 6;
          gpAnchor = "start";
          compLabelX = px + pinW + 6;
          compAnchor = "start";
        }

        // Pin rectangle
        svg.appendChild(svgEl("rect", {
          x: px, y: py, width: pinW, height: pinH,
          rx: pinRadius, fill: fill,
          opacity: isActive ? 1 : 0.4,
        }));

        // Active glow ring
        if (isActive && cat !== "gnd") {
          svg.appendChild(svgEl("rect", {
            x: px - 1, y: py - 1, width: pinW + 2, height: pinH + 2,
            rx: pinRadius + 1, fill: "none",
            stroke: fill, "stroke-width": 1.5, opacity: 0.5,
          }));
        }

        // Pin number on the pin body
        svg.appendChild(svgEl("text", {
          x: px + pinW / 2, y: cy + 3,
          "text-anchor": "middle",
          fill: isActive ? "#fff" : "#4A5568",
          "font-size": "6.5", "font-weight": "bold", "font-family": "monospace",
        }, String(pinNum)));

        // GPIO name label (always shown, next to pin)
        var gpTextColor = isActive ? "#E2E8F0" : "#64748B";
        svg.appendChild(svgEl("text", {
          x: gpLabelX, y: cy + 3,
          "text-anchor": gpAnchor,
          fill: gpTextColor,
          "font-size": "9", "font-family": "monospace",
          "font-weight": isActive ? "bold" : "normal",
          opacity: isActive ? 1 : 0.6,
        }, name));

        // Component name label (only for active pins, further out)
        if (isActive && info.label) {
          var gpTextWidth = name.length * 5.8; // approximate monospace width at 9px
          var compX, compA;
          if (side === "left") {
            compX = gpLabelX - gpTextWidth - 6;
            compA = "end";
          } else {
            compX = gpLabelX + gpTextWidth + 6;
            compA = "start";
          }

          // Background pill for component label
          var labelText = info.label;
          var pillW = labelText.length * 6.2 + 12;
          var pillH = 14;
          var pillX = compA === "end" ? compX - pillW + 2 : compX - 4;
          var pillY = cy - pillH / 2;

          svg.appendChild(svgEl("rect", {
            x: pillX, y: pillY, width: pillW, height: pillH,
            rx: 3, fill: fill, opacity: 0.15,
          }));

          svg.appendChild(svgEl("text", {
            x: compA === "end" ? compX : compX,
            y: cy + 3,
            "text-anchor": compA,
            fill: fill,
            "font-size": "9", "font-weight": "bold", "font-family": "monospace",
          }, labelText));
        }
      });
    }

    drawPinRow(LEFT_PINS, "left");
    drawPinRow(RIGHT_PINS, "right");

    // ---- Title ----
    svg.appendChild(svgEl("text", {
      x: svgW / 2, y: 26,
      "text-anchor": "middle", fill: "#E2E8F0",
      "font-size": "16", "font-weight": "bold", "font-family": "monospace",
    }, "Raspberry Pi Pico 2 Pinout"));

    container.appendChild(svg);
  }

  // ---------- public API ----------
  window.PinoutGenerator = {
    render: render,
    COLORS: COLORS,
  };
})();
