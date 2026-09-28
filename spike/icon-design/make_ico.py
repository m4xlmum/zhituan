# -*- coding: utf-8 -*-
"""
把选定的方案打成 Windows 用的图标文件。

用法：
    python make_ico.py A          # 方案 A
    python make_ico.py E --dry    # 只看会写到哪儿，不落盘

产出三处（与 electron-builder.yml、src/main/index.ts 里的引用一一对应）：
    build/icon.ico        6 档，安装包与 exe 的图标
    build/icon.png        256，构建链里其他地方的备用位图
    resources/tray.ico    16/32/48，托盘图标

ICO 用 PNG 内嵌（Vista 以后的格式），所以这里是纯打包，不需要额外依赖 ——
不引 Pillow 就是为了这一步哪怕在干净环境里也能跑。
"""

import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out")

ICO_SIZES = (16, 32, 48, 64, 128, 256)
TRAY_SIZES = (16, 32, 48)


def write_ico(pairs, path):
    """pairs: [(边长, PNG 字节)] —— 按 ICO 目录项打包"""
    n = len(pairs)
    header = struct.pack("<HHH", 0, 1, n)
    entries = b""
    body = b""
    offset = 6 + 16 * n
    for size, blob in pairs:
        dim = 0 if size >= 256 else size  # 256 在目录项里写 0
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        body += blob
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(header + entries + body)
    return len(header + entries + body)


def take(sid, size):
    p = os.path.join(OUT, "png", f"{sid}-{size}.png")
    if not os.path.exists(p):
        raise SystemExit(f"缺 {p} —— 先跑 shoot.py 生成各档 PNG")
    with open(p, "rb") as f:
        return f.read()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    if not args:
        raise SystemExit("用法：python make_ico.py <方案ID>，例如 A / E")

    sid = args[0].upper()
    targets = [
        ("build/icon.ico", ICO_SIZES),
        ("resources/tray.ico", TRAY_SIZES),
    ]

    for rel, sizes in targets:
        path = os.path.join(ROOT, rel.replace("/", os.sep))
        if dry:
            print(f"[dry] {rel}  <- {sid} 的 {'/'.join(map(str, sizes))}")
            continue
        total = write_ico([(s, take(sid, s)) for s in sizes], path)
        print(f"{rel:24} {total / 1024:7.1f} KB   {'/'.join(map(str, sizes))}")

    png_src = os.path.join(OUT, "png", f"{sid}-256.png")
    png_dst = os.path.join(ROOT, "build", "icon.png")
    if dry:
        print(f"[dry] build/icon.png      <- {sid}-256.png")
    else:
        import shutil

        shutil.copyfile(png_src, png_dst)
        print(f"{'build/icon.png':24} {os.path.getsize(png_dst) / 1024:7.1f} KB   256")

    print(f"\n已用方案 {sid} 更新图标。改完记得重新打包（npm run build:win）。")


if __name__ == "__main__":
    main()
