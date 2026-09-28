"""复现 electron-builder 卸载器的 un.atomicRMDir：把 $INSTDIR 里的每个条目
改名搬进一个临时目录，再搬回来。搬不动的那一个，就是让升级卡住的"占用中"文件。

只做改名（元数据操作），不改内容、不删除。搬出去之后无论成败都立刻搬回来。

用法：python lockprobe.py [要探测的安装目录]
"""

import os
import sys
import tempfile

root = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\poem\Desktop\zhituan"
# 暂存目录每次都取一个新的：固定名字的话，上一轮留下的同名目录会让 os.rename
# 以 winerror 183（文件已存在）失败，读起来像「这一项被占用」——假阳性，而且
# 骗得挺像（真占用的那一项也是 BUSY，只是 winerror 不同，很容易一起咽下去）。
stash = tempfile.mkdtemp(prefix="zhituan-lock-probe-")

busy = []
moved = 0


def probe(path: str, rel: str) -> None:
    global moved
    dst = os.path.join(stash, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.rename(path, dst)
    except OSError as e:
        print(f"BUSY   {rel}  ->  {e.strerror} (winerror={getattr(e, 'winerror', '?')})")
        busy.append(rel)
        return
    try:
        os.rename(dst, path)
        moved += 1
        print(f"ok     {rel}")
    except OSError as e:
        print(f"!!! 搬回失败 {rel}: {e}")
        busy.append(rel)
        return
    # 目录：搬回来后继续往里看（等价于模板里的递归）
    if os.path.isdir(path):
        for name in sorted(os.listdir(path)):
            probe(os.path.join(path, name), os.path.join(rel, name))


print(f"安装目录：{root}")
print(f"暂存目录：{stash}")
print("-" * 60)
try:
    entries = sorted(os.listdir(root))
except OSError as e:
    print(f"读不了目录：{e}")
    sys.exit(1)

for name in entries:
    probe(os.path.join(root, name), name)

print("-" * 60)
print(f"成功搬走又搬回：{moved} 项")
if busy:
    print(f"搬不动（被占用）：{len(busy)} 项")
    for b in busy:
        print(f"  - {b}")
else:
    print("全部可搬动 —— 此刻没有任何文件被占用")
