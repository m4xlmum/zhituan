"""读一眼本机装的纸团是哪个版本、装在哪。

真机验证升级用。PowerShell 在这个环境里 stdout 常常回不来，winreg 直接读最省事：

    python spike/nsis-abort-probe/installed-version.py

退出码 0 = 装着（版本号与目录打在 stdout）；1 = 没装。
顺带把 HKCU\\Software\\<APP_GUID> 底下的 InstallLocation 也读出来——升级后它应当
还是原来那个目录（`/S` 下不选目录，安装程序从这个键读回上次的位置）。
"""

import sys
import winreg

# UUID.v5(appId, ELECTRON_BUILDER_NS_UUID)，由 electron-builder 从 appId 推出，
# 两个版本同一把。见 docs/spike-findings.md 的 Q48。
APP_GUID = "3437b4c4-5fc0-5612-8fed-0aba488ce0e5"

UNINSTALL_KEY = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_GUID}"
INSTALL_KEY = rf"Software\{APP_GUID}"


def read(root, path: str, name: str) -> str | None:
    try:
        with winreg.OpenKey(root, path) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return str(value)
    except FileNotFoundError:
        return None
    except OSError:
        return None


def main() -> int:
    version = read(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY, "DisplayVersion")
    display = read(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY, "DisplayName")
    location = read(winreg.HKEY_CURRENT_USER, INSTALL_KEY, "InstallLocation")
    if version is None and display is None and location is None:
        print("未安装（HKCU 下没有纸团的卸载项）")
        return 1
    print(f"DisplayName   : {display}")
    print(f"DisplayVersion: {version}")
    print(f"InstallLocation: {location}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
