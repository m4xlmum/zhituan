#!/usr/bin/env bash
# 第 1 层（zt.Preflight）的端到端断言：拦住的时候必须「什么都不动、如实说、把应用叫回来」，
# 放行的时候必须安静地一路走到底。
#
# 两组读数，一次跑完：
#   甲) 按住 fixture 里的 app.asar（探针自己按，不靠 lockhold.py 押秒数）
#        期望：退出码 2、弹框内容写进 alert.txt、没有走到最后、
#              fixture 里的文件一个不多一个不少一个不改、
#              日志里**没有**任何清场/重试行、relaunched.txt 出现（应用被叫回来了）
#   乙) /nolock 对照组（同一个 exe，只是不按锁）
#        期望：退出码 0、没弹框、走到最后、fixture 照样没被动过
#        这一组的作用是把「拦下」归因给那把锁，而不是归因给探针本身哪一步坏了。
#
# 为什么断言「一个字节都不动」用的是**期望清单**而不是前后快照：fixture 是探针
# 自己在运行时建的（CreateDirectory + FileOpen），外面没有插进去快照的时机。
# 好在探针建的东西是确定的，于是「跑完之后的清单与内容」本身就能当判据：
# 少一个文件 = 被删或被改名搬走（旧卸载器的 atomicRMDir 就是搬走），
# 多一个文件 = 被写了，内容变了 = 被改了。三种都抓得住。
#
# 用法：
#   ./preflight.sh              # 编译（如果缺可执行文件）并两组都跑
#   ./preflight.sh --no-build   # 只跑
#
# 退出码：0 = 两组断言全过，1 = 有不过的。

set -u
cd "$(dirname "$0")"

MAKENSIS="${MAKENSIS:-/c/Users/poem/AppData/Local/electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe}"

fail=0
ok()  { printf '  [对] %s\n' "$*"; }
bad() { printf '  [错] %s\n' "$*"; fail=1; }

if [ "${1:-}" != "--no-build" ]; then
  for nsi in pf-app preflight; do
    "$MAKENSIS" -WX -INPUTCHARSET UTF8 "$nsi.nsi" >/dev/null || { echo "编译 $nsi.nsi 失败"; exit 1; }
  done
  echo "编译通过：pf-app.exe / preflight.exe"
fi

# MSYS 会把以 / 开头的参数当路径去转换（/nolock → C:/…/nolock），探针就再也看不见
# 它了——第一版的对照组就是这么「没量到」的（看着是产品没修好，其实是探针瞎了）。
export MSYS_NO_PATHCONV=1

# 一趟 = 一次运行 + 全部断言。$1 = 名字；$2 = 期望退出码；其余 = 传给探针的参数
run_round() {
  local name="$1" expect_code="$2"; shift 2
  rm -rf pf-fixture
  rm -f "$TEMP/zt-preflight-alert.txt" "$TEMP/zt-preflight-reached-end.txt" "$TEMP/zhituan-install.log"
  ./preflight.exe "$@" >/dev/null 2>&1
  local code=$?
  echo
  echo "── $name ──────────────────────────────────────"
  if [ "$code" = "$expect_code" ]; then ok "退出码 $code（期望 $expect_code）"
  else bad "退出码 $code（期望 $expect_code）"; fi

  python check_round.py "$expect_code" || bad "见上：check_round.py 报了不过的条目"
}

run_round "甲）按住 app.asar：应当拦下" 2
run_round "乙）/nolock 对照组：应当放行" 0 /nolock

echo
if [ "$fail" = 0 ]; then echo "两组断言全过"; exit 0; else echo "有断言不过"; exit 1; fi
