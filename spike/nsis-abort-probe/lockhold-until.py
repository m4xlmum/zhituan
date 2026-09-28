r"""按住一个文件的独占句柄，**直到哨兵出现**才松手。

`lockhold.py` 是按固定秒数按住的，而真机上那个秒数很难押准：

  · 押短了（第一次的 20 秒）——安装程序从启动到调用旧卸载器之间要空十几秒，
    锁在旧卸载器动手之前就过期了，于是读到「旧卸载器退出码 0」。**那不是修好了，
    是没量到**（Q73 坑①）。
  · 押长了——它会连后面「清场 → 覆盖」那一段一起挡住，于是撞上设计里的第三条路
    （清不掉 → 弹框说清原因），而静默模式下那个框会等人点，脚本就挂着不动了。

所以这里改成**按条件放锁**：盯住 `%TEMP%\zhituan-install.log`，一旦出现
`旧卸载器退出码` 就松手。那一刻恰好是「旧卸载器已经失败、安装器正要开始清场」，
于是要求的那个前提（旧卸载器撞上占用而失败）已经造出来了，而清场那几轮能正常做完。

另一个坑一并记下：这份日志走的是**系统 ANSI 代码页**（中文机器上是 GBK），按 UTF-8
去找是找不到的——「没量到」和「量错了」长得一样，见 `sentinel_seen`。

用法：

    python lockhold-until.py <文件路径> <哨兵文件> <要等的子串> [上限秒数]

上限秒数默认 90，到点无论有没有等到都松手，免得真出事时把文件一直占着。
成功按住并等到哨兵返回 0；CreateFile 失败返回 1；等到上限仍在等返回 2。
"""

import ctypes
import sys
import time
from ctypes import wintypes

GENERIC_READ = 0x80000000
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

_k32 = ctypes.WinDLL("kernel32", use_last_error=True)
_k32.CreateFileW.restype = wintypes.HANDLE
_k32.CreateFileW.argtypes = [
    wintypes.LPCWSTR,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_void_p,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.HANDLE,
]


def sentinel_seen(path: str, needle: str, note: list) -> bool:
    """日志里出现 `needle` 了吗。

    **按字节找，不假设编码。** 这份日志是 NSIS 的 `FileWrite` 写的，走的是
    **系统 ANSI 代码页**（中文机器上是 GBK），不是 UTF-8 ——第一版按 utf-8 解码后
    找 `旧卸载器退出码`，永远找不到，于是锁一直按到上限：安装器因此撞上「清不掉」
    那条路（弹框等人点），整跑看上去像产品坏了，其实是探针瞎了。
    教训与 Q73 坑①同族——**「没量到」比「量错了」更像结论**。

    note 用来回收诊断信息（只记一次，免得刷屏），因为「读不到文件」和
    「读到了但没有这个词」表现得一模一样：都是不匹配。
    """
    try:
        with open(path, "rb") as fh:
            blob = fh.read()
    except OSError as e:
        if not note:
            note.append(f"读不到日志（{e.strerror}）")
        return False
    if not note:
        note.append(f"首次读到 {len(blob)} 字节")
    for enc in ("utf-8", "gbk", "utf-16-le"):
        try:
            if needle.encode(enc) in blob:
                note.append(f"按 {enc} 命中")
                return True
        except UnicodeEncodeError:
            continue
    return False


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    path, sentry, needle = sys.argv[1], sys.argv[2], sys.argv[3]
    budget = float(sys.argv[4]) if len(sys.argv) > 4 else 90.0

    # dwShareMode = 0：独占。别人的打开会被拒，Rename/MoveFile 也会以
    # ERROR_SHARING_VIOLATION 失败——正是要的效果。
    handle = _k32.CreateFileW(
        path, GENERIC_READ, 0, None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, None
    )
    if handle == INVALID_HANDLE_VALUE:
        print(f"CreateFile 失败（错误 {ctypes.get_last_error()}）：{path}", flush=True)
        return 1

    print(f"已独占 {path}，等哨兵 {needle!r}（上限 {budget:g}s）", flush=True)
    deadline = time.monotonic() + budget
    waited = 0.0
    note: list = []
    try:
        while time.monotonic() < deadline:
            if sentinel_seen(sentry, needle, note):
                print(f"哨兵出现，{waited:.1f}s 后放锁（{note[-1]}）", flush=True)
                return 0
            time.sleep(0.1)
            waited += 0.1
        print(
            f"等到上限 {budget:g}s 也没等到哨兵，放锁"
            f"（诊断：{'; '.join(note) if note else '一次都没读成'}）",
            flush=True,
        )
        return 2
    finally:
        _k32.CloseHandle(handle)


if __name__ == "__main__":
    sys.exit(main())
