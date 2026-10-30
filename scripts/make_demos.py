#!/usr/bin/env python3
"""Draw short stick-figure loops and encode them as tiny WebM and MP4 files."""
import math
import os
import shutil
import subprocess
import struct

W, H = 320, 240
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "demos")
FRAMES = 32
FPS = 8

BG = (244, 247, 246)
INK = (19, 78, 74)
TEAL = (15, 94, 90)
SKIN = (243, 213, 196)
SAFFRON = (224, 122, 61)
FLOOR = (215, 228, 226)
SCARF = (232, 165, 152)


def blank():
    return bytearray(BG * W * H)


def set_px(buf, x, y, color):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        buf[i : i + 3] = bytes(color)


def disc(buf, cx, cy, r, color):
    r2 = r * r
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                set_px(buf, x, y, color)


def line(buf, x0, y0, x1, y1, color, thick=5):
    steps = int(max(abs(x1 - x0), abs(y1 - y0), 1))
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        y = y0 + (y1 - y0) * i / steps
        disc(buf, x, y, thick / 2, color)


def rect(buf, x, y, w, h, color):
    for yy in range(int(y), int(y + h)):
        for xx in range(int(x), int(x + w)):
            set_px(buf, xx, yy, color)


def phone(buf, x, y):
    rect(buf, x, y, 16, 28, SAFFRON)
    rect(buf, x + 6, y + 4, 4, 4, (255, 244, 230))


def floor(buf):
    rect(buf, 36, 200, 248, 8, FLOOR)


def stick(buf, x, y, pose, scarf=False):
    # pose: dy, arm, leg spread
    disc(buf, x, y, 12, SKIN)
    disc(buf, x, y, 12, TEAL) if False else None
    line(buf, x, y + 12, x, y + 46, INK, 6)
    line(buf, x, y + 22, x - pose.get("al", 22), y + 40, INK, 5)
    line(buf, x, y + 22, x + pose.get("ar", 18), y + 36, INK, 5)
    line(buf, x, y + 46, x - pose.get("ll", 16), y + 86, INK, 6)
    line(buf, x, y + 46, x + pose.get("lr", 16), y + 86, INK, 6)
    phone(buf, x + 8, y + 20)
    if scarf:
        line(buf, x - 16, y + 24, x + 28, y + 24, SCARF, 4)


def write_ppm(path, buf):
    with open(path, "wb") as f:
        f.write(f"P6\n{W} {H}\n255\n".encode())
        f.write(buf)


def scene_cmj(i):
    buf = blank()
    floor(buf)
    phase = i / FRAMES
    if phase < 0.25:
        y, crouch = 108, 0
    elif phase < 0.4:
        y, crouch = 118, 1
    elif phase < 0.7:
        y, crouch = 108 - 70 * math.sin((phase - 0.4) / 0.3 * math.pi), 0
    else:
        y, crouch = 108, 0
    pose = {"ll": 22 if crouch else 14, "lr": 22 if crouch else 14, "al": 26, "ar": 20}
    stick(buf, 150, y, pose, scarf=True)
    return buf


def scene_repeat(i):
    buf = blank()
    floor(buf)
    hop = abs(math.sin(i / FRAMES * math.pi * 4)) * 36
    stick(buf, 150, 108 - hop, {"ll": 14, "lr": 14}, scarf=True)
    return buf


def scene_balance(i):
    buf = blank()
    floor(buf)
    sway = math.sin(i / FRAMES * math.pi * 2) * 10
    stick(buf, 156 + sway, 108, {"ll": 6, "lr": -8, "al": 20, "ar": 24}, scarf=False)
    return buf


def scene_situp(i):
    buf = blank()
    floor(buf)
    lift = (math.sin(i / FRAMES * math.pi * 2) + 1) / 2
    x = 70
    y = 150
    disc(buf, x, y - 10 - 20 * lift, 11, SKIN)
    line(buf, x + 10, y - 8 - 16 * lift, x + 70, y, INK, 6)
    line(buf, x + 70, y, x + 110, y - 10, INK, 6)
    phone(buf, x + 30, y - 24 - 10 * lift)
    return buf


def scene_react(i):
    buf = blank()
    phase = (i % 16) / 16
    go = phase > 0.55
    rect(buf, 70, 40, 180, 140, (31, 122, 77) if go else TEAL)
    disc(buf, 160, 110, 28, (255, 255, 255) if go else (244, 247, 246))
    # a finger dot, not a face
    disc(buf, 160 + (0 if not go else 0), 168 if not go else 120, 10, SAFFRON)
    return buf


def scene_step(i):
    buf = blank()
    floor(buf)
    rect(buf, 40, 168, 70, 32, (196, 214, 210))
    up = math.sin(i / FRAMES * math.pi * 2) > 0
    stick(buf, 150, 78 if up else 108, {"ll": 10, "lr": 18}, scarf=False)
    if i > 24:
        disc(buf, 200, 70, 18, (40, 20, 20))
        disc(buf, 200, 70, 8, SAFFRON)
    return buf


def scene_sprint(i):
    buf = blank()
    floor(buf)
    line(buf, 30, 190, 30, 210, SAFFRON, 4)
    line(buf, 290, 190, 290, 210, SAFFRON, 4)
    x = 50 + (i / (FRAMES - 1)) * 180
    lean = {"ll": 28, "lr": 8, "al": 30, "ar": 10}
    stick(buf, x, 100, lean, scarf=False)
    return buf


def scene_shuttle(i):
    buf = blank()
    floor(buf)
    line(buf, 40, 188, 40, 210, SAFFRON, 5)
    line(buf, 280, 188, 280, 210, SAFFRON, 5)
    t = (i / FRAMES) * 2
    if t < 1:
        x = 60 + t * 200
    else:
        x = 260 - (t - 1) * 200
    stick(buf, x, 104, {"ll": 20, "lr": 12, "al": 24, "ar": 12}, scarf=False)
    return buf


SCENES = {
    "cmj": scene_cmj,
    "repeat": scene_repeat,
    "balance": scene_balance,
    "situp": scene_situp,
    "react": scene_react,
    "step": scene_step,
    "sprint": scene_sprint,
    "shuttle": scene_shuttle,
}


def encode(folder, stem):
    webm = os.path.join(OUT, f"{stem}.webm")
    mp4 = os.path.join(OUT, f"{stem}.mp4")
    subprocess.check_call(
        [
            "ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(folder, "%03d.ppm"),
            "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", webm,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.check_call(
        [
            "ffmpeg", "-y", "-framerate", str(FPS), "-i", os.path.join(folder, "%03d.ppm"),
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "33", "-movflags", "+faststart", mp4,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, "_frames")
    for stem, fn in SCENES.items():
        if os.path.isdir(tmp):
            shutil.rmtree(tmp)
        os.makedirs(tmp)
        for i in range(FRAMES):
            write_ppm(os.path.join(tmp, f"{i:03d}.ppm"), fn(i))
        encode(tmp, stem)
        webm = os.path.getsize(os.path.join(OUT, f"{stem}.webm"))
        mp4 = os.path.getsize(os.path.join(OUT, f"{stem}.mp4"))
        print(f"{stem}: webm {webm} mp4 {mp4}")
        if webm > 1_000_000 or mp4 > 1_000_000:
            raise SystemExit(f"{stem} is over 1 MB")
    shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
