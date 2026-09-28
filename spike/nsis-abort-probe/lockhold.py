"""按住一个文件的独占句柄若干秒。

用途：**确定性地**复现「升级时报 Failed to uninstall old application files ... : 2」。

原理见 build/installer.nsh 顶部那段：旧卸载器的 un.atomicRMDir 要逐个把
$INSTDIR 下的文件 Rename 走（app-builder-lib/templates/nsis/uninstaller.nsh:70），
其中一个改不动就 Abort，退出码 2。真机上这个「改不动」来自百度网盘同步空间 /
Defender 实时防护 / 资源管理器缩略图这类短时占用，出现得很随机；这里用
dwShareMode=0 的独占句柄把它变成必然。

用法：
    python lockhold.py <文件路径> [秒数] [延迟秒数]

    文件路径   例如 C:\\Users\\poem\\Desktop\\zhituan\\resources\\app.asar
    秒数       持有多少秒，默认 6
    延迟秒数   先等这么久再上锁，默认 0。装安装程序之前先起本脚本时用得上。

成功持有返回 0；CreateFile 失败返回 1（通常是文件不存在）。

注意：独占句柄会挡住**所有**打开动作，连正在运行的纸团都读不了这个文件，
所以别在需要应用正常运行时用它。
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


def hold(path: str, seconds: float, delay: float) -> int:
    if delay > 0:
        time.sleep(delay)
    # dwShareMode = 0：独占。别人的打开会被拒，Rename/MoveFile 也会以
    # ERROR_SHARING_VIOLATION 失败——正是要的效果。
    handle = _k32.CreateFileW(
        path, GENERIC_READ, 0, None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, None
    )
    if handle == INVALID_HANDLE_VALUE:
        print(f"CreateFile 失败（错误 {ctypes.get_last_error()}）：{path}")
        return 1
    print(f"已独占 {path}，持续 {seconds}s", flush=True)
    try:
        time.sleep(seconds)
    finally:
        _k32.CloseHandle(handle)
    print("已释放", flush=True)
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
    delay = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    return hold(path, seconds, delay)


if __name__ == "__main__":
    sys.exit(main())
