#!/usr/bin/env python3
"""Is the iPhone actually ready to run a UI test?

`devicectl list devices` prints the coredevice identifier, not the hardware UDID, and "connected" is
not enough: XCUITest needs Developer Mode on (Settings > Privacy & Security > Developer Mode, then a
restart). Prints a one-line status; exits 0 only when the device is usable.
"""
import json, subprocess, sys, tempfile, os

udid = sys.argv[1] if len(sys.argv) > 1 else "00008030-00126D913C51402E"
out = os.path.join(tempfile.gettempdir(), "assetly-devices.json")
subprocess.run(["xcrun", "devicectl", "list", "devices", "--json-output", out],
               capture_output=True, check=False)
try:
    devices = json.load(open(out))["result"]["devices"]
except Exception as e:
    print(f"cannot read the device list ({e})"); sys.exit(1)

for d in devices:
    if d.get("hardwareProperties", {}).get("udid") != udid:
        continue
    p, c = d.get("deviceProperties", {}), d.get("connectionProperties", {})
    dev_mode, tunnel = p.get("developerModeStatus"), c.get("tunnelState")
    print(f'{p.get("name")} - iOS {p.get("osVersionNumber")}, {tunnel}, '
          f'paired={c.get("pairingState")}, developer-mode={dev_mode}')
    sys.exit(0 if dev_mode == "enabled" and tunnel in ("connected", "available") else 1)

print("phone not visible")
sys.exit(1)
