"""校验 electron-builder 的 latest.yml 与安装包是否对得上。

    python verify-release.py <构建输出目录>

对三件事：version 是不是期望的、size 与 sha512 是不是**实际算出来的**那个。
本机没有 PyYAML，所以用正则读——latest.yml 的结构是 electron-builder 自己
生成的，只有那几行，正则够了。

退出码 0 = 三项全对。
"""

import base64
import hashlib
import os
import re
import sys

EXPECT_VERSION = "1.6.4"


def main() -> int:
    d = sys.argv[1] if len(sys.argv) > 1 else "."
    yml = open(os.path.join(d, "latest.yml"), encoding="utf-8").read()
    ver = re.search(r"^version:\s*(\S+)", yml, re.M).group(1)
    url = re.search(r"^\s*-\s*url:\s*(\S+)", yml, re.M).group(1)
    size = int(re.search(r"^\s*size:\s*(\d+)", yml, re.M).group(1))
    sha = re.search(r"^\s*sha512:\s*(\S+)", yml, re.M).group(1)

    path = os.path.join(d, url)
    actual_size = os.path.getsize(path)
    digest = hashlib.sha512()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(blk)
    actual_sha = base64.b64encode(digest.digest()).decode()

    ok = True
    for label, want, got in (
        ("version", EXPECT_VERSION, ver),
        ("size", str(actual_size), str(size)),
        ("sha512", actual_sha, sha),
    ):
        same = want == got
        ok = ok and same
        print(f"{label:<9}: {'ok' if same else 'MISMATCH'}")
        if not same:
            print(f"           yml    = {got}")
            print(f"           实际    = {want}")
    print(f"file     : {url}  ({actual_size} 字节)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
