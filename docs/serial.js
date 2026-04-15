/**
 * Pico 2 Web Serial API Integration
 * Provides connect/disconnect, read/write, and JSON parsing for live Pico communication.
 */
(function () {
  "use strict";

  var port = null;
  var reader = null;
  var writer = null;
  var readableStreamClosed = null;
  var writableStreamClosed = null;
  var keepReading = false;
  var dataCallbacks = [];
  var statusCallbacks = [];
  var lineBuffer = "";

  // ---------- helpers ----------

  function setStatus(status, detail) {
    var info = { connected: status === "connected", status: status, detail: detail || "" };
    statusCallbacks.forEach(function (cb) {
      try {
        cb(info);
      } catch (e) {
        console.error("PicoSerial: status callback error", e);
      }
    });
  }

  function notifyData(parsed) {
    dataCallbacks.forEach(function (cb) {
      try {
        cb(parsed);
      } catch (e) {
        console.error("PicoSerial: data callback error", e);
      }
    });
  }

  function processLine(line) {
    line = line.trim();
    if (!line) return;
    try {
      var obj = JSON.parse(line);
      notifyData(obj);
    } catch (e) {
      // Not valid JSON — still forward as raw string so callers can decide
      notifyData({ _raw: line });
    }
  }

  // ---------- read loop ----------

  async function readLoop() {
    var decoder = new TextDecoderStream();
    readableStreamClosed = port.readable.pipeTo(decoder.writable);
    reader = decoder.readable.getReader();

    try {
      while (keepReading) {
        var result = await reader.read();
        if (result.done) break;
        var chunk = result.value;
        if (!chunk) continue;

        lineBuffer += chunk;
        var lines = lineBuffer.split("\n");
        // Keep the last partial segment in the buffer
        lineBuffer = lines.pop() || "";
        lines.forEach(processLine);
      }
    } catch (e) {
      if (keepReading) {
        console.error("PicoSerial: read error", e);
        setStatus("error", e.message);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
    }
  }

  // ---------- public API ----------

  async function connect(options) {
    if (port) {
      setStatus("connected", "Already connected");
      return true;
    }

    if (!("serial" in navigator)) {
      setStatus("error", "Web Serial API not supported in this browser");
      return false;
    }

    try {
      setStatus("connecting");

      var filters = (options && options.filters) || [
        { usbVendorId: 0x2e8a }, // Raspberry Pi
      ];

      port = await navigator.serial.requestPort({ filters: filters });

      await port.open({
        baudRate: (options && options.baudRate) || 115200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });

      keepReading = true;
      lineBuffer = "";

      // Start reading
      readLoop();

      // Prepare writer
      var encoder = new TextEncoderStream();
      writableStreamClosed = encoder.readable.pipeTo(port.writable);
      writer = encoder.writable.getWriter();

      setStatus("connected", "Serial port opened");
      return true;
    } catch (e) {
      port = null;
      writer = null;
      if (e.name === "NotFoundError") {
        setStatus("disconnected", "No port selected");
      } else {
        console.error("PicoSerial: connect error", e);
        setStatus("error", e.message);
      }
      return false;
    }
  }

  async function disconnect() {
    if (!port) {
      setStatus("disconnected");
      return;
    }

    keepReading = false;

    try {
      if (reader) {
        await reader.cancel();
        await readableStreamClosed.catch(function () {});
        reader = null;
      }
    } catch (_) {}

    try {
      if (writer) {
        await writer.close();
        await writableStreamClosed.catch(function () {});
        writer = null;
      }
    } catch (_) {}

    try {
      await port.close();
    } catch (_) {}

    port = null;
    lineBuffer = "";
    setStatus("disconnected", "Port closed");
  }

  function isConnected() {
    return port !== null && keepReading;
  }

  function onData(callback) {
    if (typeof callback === "function") {
      dataCallbacks.push(callback);
    }
  }

  function onStatus(callback) {
    if (typeof callback === "function") {
      statusCallbacks.push(callback);
    }
  }

  function offData(callback) {
    dataCallbacks = dataCallbacks.filter(function (cb) {
      return cb !== callback;
    });
  }

  function offStatus(callback) {
    statusCallbacks = statusCallbacks.filter(function (cb) {
      return cb !== callback;
    });
  }

  async function send(data) {
    if (!writer) {
      console.warn("PicoSerial: not connected, cannot send");
      return false;
    }
    try {
      await writer.write(data);
      return true;
    } catch (e) {
      console.error("PicoSerial: send error", e);
      setStatus("error", "Send failed: " + e.message);
      return false;
    }
  }

  // ---------- expose ----------

  window.PicoSerial = {
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    onData: onData,
    offData: offData,
    onStatus: onStatus,
    offStatus: offStatus,
    send: send,
  };
})();
