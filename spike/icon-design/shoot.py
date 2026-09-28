# -*- coding: utf-8 -*-
"""
把 icons.py 产出的 SVG 栅格化成各档 PNG（透明底）。

用法：
    python shoot.py              # 全部方案，6 档
    python shoot.py A F          # 只出 A 和 F
    python shoot.py --board      # 顺带重出对比板

做法：**各档都从一张 256 渲染重采样得到**。
    Chrome 只负责把 256×256 画出来（每方案两个变体，共 16 次调用），16/32/48/64/128
    由 Python 做面积平均降采样 —— 比让 Chrome 直接渲染 16px 更平滑，也顺带绕开
    了下面这一串坑。

坑（全在 Chrome 无头这边，记全免得再摸一遍）：
  1. 直接截 SVG 文件不行。Chrome 打开独立 SVG 时按 SVG 的**固有尺寸**排版，
     icons.py 产的 SVG 只有 viewBox（512×512），开 256 的窗口就只截到左上角
     一块 —— 用户看到的「图标都是一半一半的」就是这么来的。
  2. 套 HTML 用 100vw/100vh 撑满也不行。实测 `--window-size` 只决定**输出 PNG
     的尺寸**，页面视口却是另一个值（innerWidth/innerHeight = 500×105）。
     于是 100vw = 500px，图被放大两倍，截出来还是残的。
  3. 图标写成**固定像素**、贴左上角，窗口开多大就出多大 —— 这是唯一可靠的一条。
     但 128 那一档仍然坏（内容只剩顶部 33 行，原因没查出来），所以现在只渲染
     256 这一档，其余全靠重采样。
  4. 包装页每次都得换文件名，否则 Chrome 命中 file:// 缓存，拿到上一次写进去的页面。
  5. profile 目录也得每次换。目录一旦存在，新起的 Chrome 会被「复用实例」——
     命令行被转发给还活着的那个，截图于是来自另一个实例的状态。
  6. `--screenshot` 只吃**绝对路径**；不给 `--user-data-dir` 是静默失败（退出码 0、
     不产文件）；前一个进程没退干净就起下一个同样静默不产文件 —— 每张之间留一拍、
     失败要重试。
  7. **中间物一概不删**。删除会被执行环境的 safe-delete 拦（每个用户请求累计额度
     只有 50 个文件），脚本会在半路被 SIGTERM，症状是「前半程正常、后半程全是旧
     文件」。渲染中间物全扔系统临时目录，交给系统自己清。
"""

import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import uuid
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SVGDIR = OUT / "svg"
PNGDIR = OUT / "png"

# 中间物扔系统临时目录：不污染项目，也不删（见坑 7）
WORK = Path(tempfile.gettempdir()) / "zhituan-icon-shots"

# 只渲染这一档，其余重采样（见坑 3）
RENDER = 256
# 大尺寸带折面，小尺寸纯剪影 —— 与对比板一致：48 已能看清折面，16/32 不行
BIG = (48, 64, 128, 256)
MINI = (16, 32)
SIZES = MINI + BIG

CHROME_CANDIDATES = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
)


def find_browser():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("没找到 Chrome / Edge")


PAGE_TMPL = """<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body {{ margin: 0; padding: 0; background: transparent; overflow: hidden; }}
  img {{ display: block; position: absolute; left: 0; top: 0;
         width: {px}px; height: {px}px; }}
</style></head><body><img src="{url}"></body></html>"""


# ———————————————————————————————————————————————— 渲染

def render(browser, name, work: Path):
    """把 out/svg/<name>.svg 渲成 RENDER×RENDER 的 PNG；失败返回 None"""
    svg = SVGDIR / f"{name}.svg"
    if not svg.exists():
        return None
    page = work / f"{name}-{uuid.uuid4().hex[:8]}.html"
    page.write_text(PAGE_TMPL.format(px=RENDER, url=svg.as_uri()), encoding="utf-8")
    out = work / f"{name}.png"
    cmd = [
        browser, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--hide-scrollbars", "--force-device-scale-factor=1",
        "--no-first-run", "--no-default-browser-check", "--disable-extensions",
        "--default-background-color=00000000",
        f"--user-data-dir={work / f'prof-{uuid.uuid4().hex[:8]}'}",
        "--virtual-time-budget=4000",
        f"--window-size={RENDER},{RENDER}",
        f"--screenshot={out}",           # 绝对路径，见坑 6
        page.as_uri(),
    ]
    for attempt in range(4):
        subprocess.run(cmd, capture_output=True)
        if out.exists() and out.stat().st_size > 0:
            return out
        time.sleep(1.0 + attempt * 0.5)
    return None


# ———————————————————————————————————————————————— PNG 读写（纯标准库）

def read_png(path: Path):
    """解成 [(r,g,b,a), …] 的二维列表"""
    d = path.read_bytes()
    pos, idat, hdr = 8, b"", None
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        if typ == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", d[pos + 8:pos + 21])
        elif typ == b"IDAT":
            idat += d[pos + 8:pos + 8 + ln]
        elif typ == b"IEND":
            break
        pos += 12 + ln
    w, h, _bd, ctype, _c, _f, _i = hdr
    bpp = 4 if ctype == 6 else 3
    stride = w * bpp
    raw = zlib.decompress(idat)

    rows, prev, i = [], bytearray(stride), 0
    for _y in range(h):
        ft = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        if ft == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b, c = prev[x], prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        if bpp == 4:
            rows.append([tuple(line[k:k + 4]) for k in range(0, stride, 4)])
        else:
            rows.append([(line[k], line[k + 1], line[k + 2], 255)
                         for k in range(0, stride, 3)])
        prev = line
    return w, h, rows


def write_png(path: Path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(v for px in r for v in px) for r in rows)

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def resample(src, sw, sh, n):
    """面积平均降采样。按 alpha 预乘再加权，边缘才不会渗黑。"""
    dst = []
    for j in range(n):
        y0, y1 = j * sh / n, (j + 1) * sh / n
        row = []
        for i in range(n):
            x0, x1 = i * sw / n, (i + 1) * sw / n
            ar = ag = ab = aa = wsum = 0.0
            for sy in range(int(y0), min(int(math.ceil(y1)), sh)):
                wy = min(y1, sy + 1) - max(y0, sy)
                if wy <= 0:
                    continue
                sr = src[sy]
                for sx in range(int(x0), min(int(math.ceil(x1)), sw)):
                    wx = min(x1, sx + 1) - max(x0, sx)
                    if wx <= 0:
                        continue
                    w = wx * wy
                    r, g, b, a = sr[sx]
                    ar += r * a * w
                    ag += g * a * w
                    ab += b * a * w
                    aa += a * w
                    wsum += w
            if aa > 0:
                row.append((round(ar / aa), round(ag / aa), round(ab / aa),
                            round(aa / wsum)))
            else:
                row.append((0, 0, 0, 0))
        dst.append(row)
    return dst


# ———————————————————————————————————————————————— 主流程

def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    want_board = "--board" in sys.argv

    browser = find_browser()
    PNGDIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    sids = [s.upper() for s in argv] or sorted(
        p.stem for p in SVGDIR.glob("*.svg") if "-mini" not in p.stem
    )

    bad = []
    for sid in sids:
        srcs = {}
        for variant in ("", "-mini"):
            name = f"{sid}{variant}"
            png = render(browser, name, WORK)
            if png is None:
                bad.append(f"{sid}{variant}（Chrome 没产文件）")
            srcs[variant] = png

        for size in SIZES:
            variant = "" if size in BIG else "-mini"
            src = srcs[variant]
            if src is None:
                continue
            sw, sh, img = read_png(src)
            out = PNGDIR / f"{sid}-{size}.png"
            write_png(out, size, size, resample(img, sw, sh, size))

        line = "  ".join(f"{s:>3}" for s in SIZES)
        sizes = "  ".join(
            f"{os.path.getsize(PNGDIR / f'{sid}-{s}.png') / 1024:>5.1f}K"
            for s in SIZES if (PNGDIR / f"{sid}-{s}.png").exists()
        )
        print(f"{sid:<3} {line}\n    {sizes}")

    if want_board:
        board = OUT / "board.png"
        cmd = [
            browser, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run",
            f"--user-data-dir={WORK / f'prof-board-{uuid.uuid4().hex[:8]}'}",
            "--virtual-time-budget=4000",
            "--window-size=1240,3200",
            f"--screenshot={board}",
            (OUT / "board.html").as_uri(),
        ]
        for _ in range(3):
            subprocess.run(cmd, capture_output=True)
            if board.exists():
                break
            time.sleep(1.5)
        print(f"\n对比板 -> board.png  {board.stat().st_size / 1024:.0f} KB"
              if board.exists() else "\n对比板没出")

    if bad:
        print("\n没成的：")
        for b in bad:
            print("  " + b)
    print(f"\n产物 -> out/png/{len(sids)} 套 × {len(SIZES)} 档")


if __name__ == "__main__":
    main()
