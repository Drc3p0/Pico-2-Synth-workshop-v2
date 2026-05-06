"""
Serial protocol contract test for Pico 2 Synth Workshop.
Run: python3 tests/serial-test.py

Requires: Pico connected via USB, web serial NOT connected.
Tests the firmware's serial command handling.
"""

import serial
import json
import time
import sys

PORT = "/dev/cu.usbmodem101"
BAUD = 115200

def find_port():
    import glob
    ports = glob.glob("/dev/cu.usbmodem*")
    if ports:
        return ports[0]
    return None

def run_tests():
    port = find_port()
    if not port:
        print("ERROR: No Pico USB serial port found. Is it plugged in?")
        print("       Make sure web serial is disconnected.")
        sys.exit(1)

    print("Connecting to", port)
    try:
        ser = serial.Serial(port, BAUD, timeout=2)
    except serial.SerialException as e:
        print("ERROR: Cannot open port:", e)
        print("       Disconnect web serial first.")
        sys.exit(1)

    time.sleep(1)
    # Flush buffered monitoring data
    ser.read(ser.in_waiting or 1)
    time.sleep(0.5)
    ser.read(ser.in_waiting or 1)

    passed = 0
    failed = 0

    def send_and_wait(cmd_obj, expect_resp, timeout=3):
        ser.read(ser.in_waiting or 1)
        ser.write((json.dumps(cmd_obj) + "\n").encode())
        end = time.time() + timeout
        while time.time() < end:
            data = ser.read(ser.in_waiting or 1)
            if data:
                text = data.decode("utf-8", errors="replace")
                for line in text.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        if obj.get("resp") == expect_resp:
                            return obj
                    except json.JSONDecodeError:
                        continue
            time.sleep(0.05)
        return None

    def test(name, fn):
        nonlocal passed, failed
        try:
            fn()
            passed += 1
            print("  PASS:", name)
        except AssertionError as e:
            failed += 1
            print("  FAIL:", name, "-", e)

    print("\n=== Serial Protocol Tests ===")

    def test_ping():
        resp = send_and_wait({"cmd": "ping"}, "pong")
        assert resp is not None, "No pong response within 3s"
        assert resp.get("version") == "2.0", "Wrong version: " + str(resp.get("version"))

    test("Ping responds with pong and version", test_ping)

    def test_get_config():
        resp = send_and_wait({"cmd": "get_config"}, "config")
        assert resp is not None, "No config response within 3s"
        assert "data" in resp, "Response missing 'data' field"
        data = resp["data"]
        assert "voice" in data, "Config missing 'voice'"
        assert "button_pins" in data, "Config missing 'button_pins'"

    test("get_config returns valid config", test_get_config)

    def test_put_config():
        test_config = {
            "voice": "eighties_dystopia",
            "button_pins": ["GP0"],
            "key_map": {"button_0": 0},
            "scale": [0, 2, 4, 7, 9],
            "octave": 3,
        }
        resp = send_and_wait({"cmd": "put_config", "data": test_config}, "ok")
        assert resp is not None, "No ok response to put_config within 3s"

    test("put_config responds with ok", test_put_config)

    def test_put_config_persists():
        resp = send_and_wait({"cmd": "get_config"}, "config")
        assert resp is not None, "No config response"
        data = resp["data"]
        assert data.get("key_map") == {"button_0": 0}, (
            "key_map not persisted in RAM: " + str(data.get("key_map"))
        )

    test("put_config persists in RAM", test_put_config_persists)

    def test_save():
        resp = send_and_wait({"cmd": "save"}, "saved")
        assert resp is not None, "No saved response (filesystem may be read-only)"

    test("save writes to flash", test_save)

    def test_bad_json():
        ser.read(ser.in_waiting or 1)
        ser.write(b"this is not json\n")
        end = time.time() + 2
        while time.time() < end:
            data = ser.read(ser.in_waiting or 1)
            if data:
                text = data.decode("utf-8", errors="replace")
                for line in text.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        if obj.get("resp") == "error":
                            return
                    except json.JSONDecodeError:
                        continue
            time.sleep(0.05)
        assert False, "No error response for bad JSON"

    test("Bad JSON returns error response", test_bad_json)

    def test_unknown_cmd():
        resp = send_and_wait({"cmd": "nonexistent"}, "error")
        assert resp is not None, "No error response for unknown command"

    test("Unknown command returns error", test_unknown_cmd)

    ser.close()

    print("\n---")
    print("Results: {} passed, {} failed".format(passed, failed))
    if failed > 0:
        sys.exit(1)
    else:
        print("All serial contracts verified.")


if __name__ == "__main__":
    run_tests()
