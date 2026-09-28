#!/usr/bin/env bash
# 真机升级验证：把 app.asar 用独占句柄按住，再跑新版安装包，看升级能不能做完、
# 文件有没有真的被换掉。
#
#     bash spike/nsis-abort-probe/e2e-upgrade.sh <新版安装包路径> [锁的上限秒数]
#
# 为什么要有这个脚本：手工跑一遍然后读「退出码 0」是**不可靠的**——退出码 0 可能
# 是「修好了」，也可能是「锁根本没赶上、走的还是顺利那条路」，甚至是「安装器退了
# 但文件没换」。三种情况退出码一模一样。所以这里把每一步都变成可断言的读数：
#
#   1) 升级前的指纹：注册表版本 + 主程序 / `app.asar` 的**字节数与 mtime**。
#      mtime 是关键——NSIS 的 `File` 保留源文件的 mtime，所以「文件真的换过了」
#      和「退出码 0 但文件还是旧的」一眼分得开（1.6.2 的载荷 mtime 是 11:18，
#      1.6.4 是 14:5x / 15:0x）。
#   2) **确认锁真的上了**：起锁之后立刻用 lockprobe.py 复查一遍，它复刻的正是旧
#      卸载器 un.atomicRMDir 的改名搬移。没读到 BUSY 就是测试无效，直接中止。
#   3) `/S --updated` 静默跑。**`--updated` 不能省**：只有带上它，新版安装器才会
#      把 `--updated` 转给旧卸载器，旧卸载器才会走那段「改名 → Abort」。不带的话
#      走的是普通卸载路径，本来就不会退 2，测了个寂寞。
#   4) 放锁的时机用**哨兵**控制（lockhold-until.py）：盯着安装日志，出现
#      `旧卸载器退出码` 才松手——那一刻旧卸载器已经失败、安装器正要开始清场。
#      按固定秒数押是押不准的，两种押错各有各的假象，见 Q73 坑①。
#   5) 升级后的指纹 + 安装日志（带时分秒）。

set -u

NEW_EXE=${1:?用法: e2e-upgrade.sh <新版安装包路径> [锁的上限秒数]}
HOLD_MAX=${2:-90}

INSTDIR_WIN='C:\Users\poem\Desktop\zhituan'
INSTDIR='/c/Users/poem/Desktop/zhituan'
LOG='/c/Users/poem/AppData/Local/Temp/zhituan-install.log'
LOG_WIN='C:\Users\poem\AppData\Local\Temp\zhituan-install.log'
PY='C:/Users/poem/.workbuddy/binaries/python/versions/3.13.12/python.exe'
HERE=$(cd "$(dirname "$0")" && pwd)

fingerprint() {
  local exe asar
  exe=$(stat -c '%s 字节  %y' "$INSTDIR/zhituan.exe" 2>/dev/null || echo '缺失')
  asar=$(stat -c '%s 字节  %y' "$INSTDIR/resources/app.asar" 2>/dev/null || echo '缺失')
  printf '  zhituan.exe   : %s\n' "$exe"
  printf '  app.asar      : %s\n' "$asar"
}

echo "########## 1. 升级前 ##########"
"$PY" "$HERE/installed-version.py" || { echo "当前没装着，先装一版旧的再跑"; exit 1; }
fingerprint

# 起跑前清掉可能的残留：重跑本脚本时，上一轮的安装器或应用会搅局
taskkill //F //IM zhituan.exe >/dev/null 2>&1
taskkill //F //IM "$(basename "$NEW_EXE")" >/dev/null 2>&1
# 截断而不是删：这份日志是安装器新建/追加的，截空即可；用 rm 会撞上工具侧的
# 批量删除守卫（同一条命令里删多了要人确认），凭空多一个失败点
: > "$LOG"

echo "########## 2. 上锁并复查 ##########"
"$PY" "$HERE/lockhold-until.py" "$INSTDIR_WIN\\resources\\app.asar" "$LOG_WIN" \
      '旧卸载器退出码' "$HOLD_MAX" >/tmp/zt-lockhold.out 2>&1 &
LOCK_PID=$!
sleep 1.5
cat /tmp/zt-lockhold.out

# 锁的证明分两条，缺一条都不算数：
#   ① 再开一次必须被拒（错误 32 = ERROR_SHARING_VIOLATION）——直接证明「独占」；
#   ② lockprobe 复刻旧卸载器的改名搬移，必须改不动这个目录。
# 只做 ② 不够：改名失败的原因不止占用一种（曾经有个固定名字的暂存目录，上一轮
# 留下同名项，于是 winerror 183「文件已存在」也报成 BUSY，看着一模一样）。
echo "  --- 锁的证明①：再开一次，必须被拒 ---"
"$PY" "$HERE/lockhold.py" "$INSTDIR_WIN\\resources\\app.asar" 0.5 >/tmp/zt-reopen.out 2>&1
cat /tmp/zt-reopen.out
if grep -q '已独占' /tmp/zt-reopen.out; then
  echo "  !! 第二次独占居然成功了 —— 锁没上住，这次的读数无效。中止。"
  kill $LOCK_PID 2>/dev/null; wait $LOCK_PID 2>/dev/null; exit 1
fi
grep -q '错误 32' /tmp/zt-reopen.out \
  && echo "  ok：被拒，错误 32 = ERROR_SHARING_VIOLATION" \
  || echo "  !! 被拒了但原因不是 32，看上面那行，先弄清是什么挡住的"

echo "  --- 锁的证明②：旧卸载器那条改名路必须走不通 ---"
PROBE=$("$PY" "$HERE/lockprobe.py" "$INSTDIR_WIN" 2>&1)
printf '%s\n' "$PROBE" | grep -E 'BUSY|搬不动|全部可搬动'
# 注意报出来的会是 **resources 这个目录**搬不动，不是 resources\app.asar：
# 目录里有一个文件被独占，改名整个目录就会被拒（winerror 5）——这正是旧卸载器
# 会撞上的那一下，所以判据认目录那一行。
if ! printf '%s\n' "$PROBE" | grep -qE 'BUSY +resources(\\| |$)'; then
  echo "  !! resources 没被报占用 —— 锁没上住，这次的读数无效。中止。"
  kill $LOCK_PID 2>/dev/null; wait $LOCK_PID 2>/dev/null; exit 1
fi
echo "  ok：resources 搬不动 —— 等价于旧卸载器动手时会撞上它"

echo "########## 3. 跑安装包（/S --updated）##########"
START=$(date +%s)
MSYS_NO_PATHCONV=1 timeout 180 "$NEW_EXE" /S --updated
RC=$?
WALL=$(( $(date +%s) - START ))
echo "  退出码 $RC"
echo "  墙钟 ${WALL} 秒"
[ "$RC" = 124 ] && echo "  （124 = 超时被杀：多半是弹了等点击的框，见下面的日志）"

echo "########## 4. 锁的结果 ##########"
wait $LOCK_PID 2>/dev/null
echo "  锁的上限内等到哨兵了吗，退出码 $?（0=等到了，2=到上限才放，1=没上住）"
cat /tmp/zt-lockhold.out

echo "########## 5. 升级后 ##########"
"$PY" "$HERE/installed-version.py"
fingerprint
echo "  --- $LOG ---"
cat "$LOG" 2>/dev/null || echo "  (没有日志)"
echo "  --- 残留进程 ---"
LEFT=$(tasklist 2>/dev/null | grep -iE 'zhituan-1.6|lockhold' || true)
if [ -n "$LEFT" ]; then
  printf '%s\n' "$LEFT"
  taskkill //F //IM "$(basename "$NEW_EXE")" >/dev/null 2>&1
  echo "  （已收掉残留的安装器）"
else
  echo "  (无)"
fi
echo "########## 完 ##########"
