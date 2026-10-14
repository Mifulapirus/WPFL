import os
import re
import shutil

# PlatformIO post-build script — runs after a successful firmware compile.
# Copies the built firmware.bin to the project root directory and names it:
#
#   wpfl-arena-led-<MAJOR>.<MINOR>.<PATCH>.<BUILD>.bin
#
# e.g.  wpfl-arena-led-0.1.0.125.bin
#
# This makes it easy to drag-and-drop the latest binary into the OTA
# upload page without digging inside .pio/build/.
Import("env")  # noqa: F821 — injected by SCons/PlatformIO


def _read_version(src_dir):
    """Return (major, minor, patch, build) from the auto-generated version_build.h."""
    header = os.path.join(src_dir, "version_build.h")
    values = {"MAJOR": 0, "MINOR": 0, "PATCH": 0, "BUILD": 0}
    if os.path.exists(header):
        with open(header, "r") as f:
            content = f.read()
        for key in values:
            m = re.search(r"#define\s+FW_VERSION_{}\s+(\d+)".format(key), content)
            if m:
                values[key] = int(m.group(1))
        # BUILD is stored under FW_BUILD_NUMBER
        m = re.search(r"#define\s+FW_BUILD_NUMBER\s+(\d+)", content)
        if m:
            values["BUILD"] = int(m.group(1))
    return values["MAJOR"], values["MINOR"], values["PATCH"], values["BUILD"]


def copy_firmware(source, target, env):  # noqa: ARG001
    project_dir = env.subst("$PROJECT_DIR")
    build_dir   = env.subst("$BUILD_DIR")        # .pio/build/<env>/
    src_dir     = env.subst("$PROJECT_SRC_DIR")

    src_bin = os.path.join(build_dir, "firmware.bin")
    if not os.path.exists(src_bin):
        print("[copy_firmware] WARNING: firmware.bin not found at", src_bin)
        return

    major, minor, patch, build = _read_version(src_dir)
    version_str = "{}.{}.{}.{}".format(major, minor, patch, build)
    # Only the Rotato (ESP32-C3) build keeps the plain name; other boards get a
    # suffix so their image can never be mistaken for it and OTA-flashed.
    suffix      = "" if env["PIOENV"] == "arena-led" else "-" + env["PIOENV"]
    dest_name   = "wpfl-arena-led-{}{}.bin".format(version_str, suffix)
    bin_dir     = os.path.join(project_dir, "bin")
    os.makedirs(bin_dir, exist_ok=True)
    dest_path   = os.path.join(bin_dir, dest_name)

    shutil.copy2(src_bin, dest_path)
    print("\n[copy_firmware] {} -> {}\n".format(src_bin, dest_path))


env.AddPostAction("$BUILD_DIR/firmware.bin", copy_firmware)  # noqa: F821
