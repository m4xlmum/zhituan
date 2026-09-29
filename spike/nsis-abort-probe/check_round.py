r"""preflight.sh 的断言部分：一趟跑完之后的读数都在这儿判。

判据都在注释里写清楚了「为什么这么判」，因为这一层最怕的就是「看着过了、
其实什么都没量到」——那件事在这个 spike 目录里已经发生过两次（见 lockhold-until.py
的文档：按秒数押锁押短了、按 UTF-8 找 GBK 的日志），两次都长成「修好了」的样子。

用法：python check_round.py <期望退出码>
分组：
  "2" = 甲组（按住 app.asar，应当拦下）
  其它 = 乙组（/nolock 对照组，应当放行）

退出码 0 = 全过；1 = 有不过的。
"""

import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(ROOT, "pf-fixture")
TEMP = os.environ.get("TEMP") or os.environ.get("TMP")
ALERT = os.path.join(TEMP, "zt-preflight-alert.txt")
REACHED = os.path.join(TEMP, "zt-preflight-reached-end.txt")
LOG = os.path.join(TEMP, "zhituan-install.log")

failures = []


def check(cond: bool, label: str, detail: str = "") -> None:
    print(f"  [{'对' if cond else '错'}] {label}{'' if cond else '  ' + detail}")
    if not cond:
        failures.append(label)


def gbk(path: str) -> str:
    """日志与弹框内容都是 NSIS 用系统 ANSI 代码页写的（中文机器上是 GBK）。"""
    with open(path, "rb") as fh:
        return fh.read().decode("gbk", "replace")


def read_bytes(path: str) -> bytes | None:
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError:
        return None


def listing() -> dict[str, bytes]:
    got: dict[str, bytes] = {}
    for dirpath, _dirnames, filenames in os.walk(FIXTURE):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, FIXTURE).replace(os.sep, "/")
            got[rel] = read_bytes(full) or b""
    return got


def main() -> int:
    blocked = sys.argv[1] == "2"

    # ── 弹框 ────────────────────────────────────────────────────────────────
    # 静默安装里唯一的出口就是那个框（故意不带 /SD）；探针把它换成了写文件，
    # 正是为了能在这儿读到它写了什么。
    if blocked:
        if os.path.exists(ALERT):
            text = gbk(ALERT)
            missing = [w for w in ("升级没能开始", "正被别的程序占着", "重启电脑", "更新并重启") if w not in text]
            check(not missing, "弹框写了，而且把该说的都说了", f"少了 {missing}")
            check("一个字节" in text or "没有改动任何文件" in text,
                  "弹框说清了「这次没有改动任何文件」", f"原文：{text[:80]!r}")
        else:
            check(False, "该弹框却没有 alert.txt", "拦下就必须说出来，不能静默退出")
    else:
        check(not os.path.exists(ALERT), "对照组没弹框", "放行时不该打扰用户")

    # ── 走到最后了吗 ────────────────────────────────────────────────────────
    # 探针在 customCheckAppRunning **之后**才写这张字条，所以它存在 = 没被拦下。
    if blocked:
        check(not os.path.exists(REACHED), "没有走到「该拦没拦」那一行",
              "拦下之后仍然走完了整节：说明探问没生效")
    else:
        check(os.path.exists(REACHED), "一路走到最后（探问放行）",
              "对照组都没走完，说明探针本身坏了，不是产品的问题")

    # ── fixture：一个不多、一个不少、内容一样 ───────────────────────────────
    # 内容按 **GBK** 读：探针里的 FileWrite 走的是系统 ANSI 代码页（中文机器上是
    # GBK），和那份安装日志一个来源。第一版按 UTF-8 比，于是两条断言全红——
    # 而红的是「探针瞎了」，不是产品坏了（这一课在本目录已经上过两次）。
    expect_content = {
        "sentinel.txt": "探针的哨兵：跑完之后我还得在，内容也得原样",
        "resources/app.asar": "上一版的 app.asar（探针造的）",
    }
    got = listing()
    for rel, want in expect_content.items():
        blob = got.get(rel)
        if blob is None:
            check(False, f"fixture 里还有 {rel}", "被删了，或者被改名搬走了（旧卸载器的 atomicRMDir 就是搬走）")
        else:
            check(blob.decode("gbk", "replace") == want, f"{rel} 的内容原样",
                  f"现在是 {blob[:60]!r}")
    check("zt-pf-app.exe" in got, "fixture 里的主程序还在", "被删了")
    if blocked:
        check("relaunched.txt" in got, "应用被叫回来了（relaunched.txt 是它自己写的）",
              "没叫回来：用户会看到「应用关了、然后什么都没有」")
    else:
        check("relaunched.txt" not in got, "放行时不叫应用（那一步只属于拦下那一条路）",
              "放行也把应用叫回来了，说明探针在做不该做的事")
    extra = sorted(set(got) - set(expect_content) - {"zt-pf-app.exe", "relaunched.txt"})
    check(not extra, "fixture 里没有多出来的东西", f"多出了 {extra}")

    # ── 日志：该出现的出现，不该出现的一个都没有 ────────────────────────────
    if os.path.exists(LOG):
        text = gbk(LOG)
        check("动手前的探问" in text, "日志里有「动手前的探问」这一行")
        if blocked:
            check("删不掉" in text and "app.asar" in text,
                  "日志里把按住的那个文件点了名", "只说了「删不掉」但没说是哪个文件不好查")
            # 这一条是「一个字节都不动」在日志上的对应物：探问一旦拦下就 Quit，
            # 后面那些清场动作（第 2 层的）根本没有机会写进来。
            noise = [w for w in ("强制清场", "已清空", "重试", "没能收掉") if w in text]
            check(not noise, "日志里没有任何清场/重试行", f"出现了 {noise}：探问之外还动了手")
        else:
            check("照常往下走" in text, "对照组日志里写了「照常往下走」")
        # 两层证据：这一趟真的读到了本机的注册表（installer.nsh 第 0 层）。
        check("本次是升级" in text, "customInit 认出本机装着旧版（第 0 层的真机读数）",
              "没有这一行说明读注册表那一步没走通")
    else:
        check(False, "安装日志存在", "没有日志就什么都对不上")

    print()
    if failures:
        print(f"不过的条目：{failures}")
        return 1
    print("这一趟的断言全过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
