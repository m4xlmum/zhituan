#!/usr/bin/env bash
# kill-self.nsi 的夹具与裁判：验「安装程序会不会在 customCheckAppRunning 里把自己杀掉」。
#
#     bash spike/nsis-abort-probe/kill-self.sh
#
# 探针本身只写 A/B 两行读数，这个脚本负责把拓扑搭出来、把两条判据都量掉。
#
# 期望读数：
#   修前 → 只有 A，没有 B（探针在 zt.KillApp 的 taskkill /F /T 里被自己杀了）
#   修后 → A 与 B 都在，且假应用 zt-fakeapp.exe 已经不在
#
# 三件事在脚本里各有一处，都不是装饰：
#
#   1. TEMP/TMP 被指到夹具目录。安装器/探针的 ${zt.Log} 写的是
#      `$TEMP\zhituan-install.log`——**那正是用户那份真机证据的路径**
#      （今天 11:26 / 11:32 两次失败的现场就在里面）。试验绝不能往里追加。
#
#   2. 假应用是 node.exe 的**拷贝**，名字改成 zt-fakeapp.exe。不是符号链接、
#      不改真进程名：taskkill 认的是镜像名，只有真拷贝才骗得过它。
#
#   3. 假应用用与应用同样的方式起探针（detached + unref）。detached 在 Windows
#      上只改进程组、不改父进程链——那个 bug 的全部关节就在这里，不能省。

set -u

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
NODE='C:/Users/poem/.workbuddy/binaries/node/versions/22.22.2-3/node.exe'
MAKENSIS='/c/Users/poem/AppData/Local/electron-builder/Cache/nsis/nsis-3.0.4.1/Bin/makensis.exe'
FAKE='zt-fakeapp.exe'
PROBE='kill-self.exe'

FIX="$TEMP/zt-killself"
rm -rf "$FIX" 2>/dev/null
mkdir -p "$FIX/tmp" "$FIX/re"

echo "########## 0. 清场（上一轮可能的残留）##########"
taskkill //F //IM "$FAKE" >/dev/null 2>&1
taskkill //F //IM "$PROBE" >/dev/null 2>&1
sleep 0.5
echo "  ok"

echo "########## 1. 编译探针 ##########"
cd "$HERE" || exit 1
MSYS_NO_PATHCONV=1 "$MAKENSIS" -INPUTCHARSET UTF8 kill-self.nsi 2>&1 | grep -E 'Output:|Error|error' || true
[ -f "$HERE/$PROBE" ] || { echo "  !! 没编出 $PROBE"; exit 1; }
echo "  ok：$HERE/$PROBE"

echo "########## 2. 搭夹具 ##########"
cp "$NODE" "$FIX/$FAKE" || { echo "  !! 拷 node 失败"; exit 1; }
cp "$HERE/fake-app.js" "$FIX/fake-app.js"
FIX_W=$(cygpath -w "$FIX")
TMPDIR_W=$(cygpath -w "$FIX/tmp")
PROBE_W=$(cygpath -w "$HERE/$PROBE")
echo "  夹具    : $FIX_W"
echo "  假应用  : $FAKE（node.exe 的拷贝，镜像名 = APP_EXECUTABLE_FILENAME）"
echo "  TEMP    : $TMPDIR_W（真机那份 zhituan-install.log 不会被碰）"

# 记一下真机日志的指纹，跑完再核一遍——这一条本身就是「没污染证据」的证明
REAL_LOG="$TEMP/zhituan-install.log"
BEFORE=$(stat -c '%s %y' "$REAL_LOG" 2>/dev/null || echo '缺失')
echo "  真机日志跑前: $BEFORE"

echo "########## 3. 起假应用（它再 detached 起探针）##########"
# 关键：TEMP/TMP 只对这条链上的进程生效。
# `//S` 不是笔误：MSYS 会把单独的 `/S` 当成路径改写成 `S:/`（第一版就是这么
# 悄悄丢了参数的），`//S` 才会原样交给子进程。`${Silent}` 靠它——没有它
# customCheckAppRunning 会走「弹框问用户」那条分支。
TEMP="$TMPDIR_W" TMP="$TMPDIR_W" "$FIX/$FAKE" "$FIX/fake-app.js" "$PROBE_W" //S \
  > "$FIX/re/fake-app.out" 2>&1 &
FAKE_PID=$!
sleep 2
cat "$FIX/re/fake-app.out"

echo "########## 4. 等探针的读数 ##########"
VERDICT="$FIX/tmp/zt-probe-killself.txt"
for _ in $(seq 1 60); do
  [ -f "$VERDICT" ] && grep -q '^C ' "$VERDICT" && break
  sleep 0.5
done

echo "  --- $VERDICT ---"
if [ -f "$VERDICT" ]; then
  sed 's/^/  /' "$VERDICT"
else
  echo "  (文件都没建出来)"
fi

echo "########## 5. 判据 ##########"
# grep -c 在计数为 0 时是「打印 0 **并且**返回 1」，所以写 `|| echo 0` 会让它
# 吐两行、把变量变成 "0\n0"——第一版就是这样把结论行判成了 `??`。只留它自己
# 打印的那个 0，文件不存在时才补一个。
count_in() { # 文件 模式
  if [ -f "$1" ]; then grep -c "$2" "$1" || true; else echo 0; fi
}
count_proc() { # 镜像名
  tasklist //FI "IMAGENAME eq $1" //FO CSV //NH 2>/dev/null | grep -ci "$1" || true
}
A_LINE=$(count_in "$VERDICT" '^A ')
B_LINE=$(count_in "$VERDICT" '^B ')
C_LINE=$(count_in "$VERDICT" '^C ')
ALIVE_FAKE=$(count_proc "$FAKE")
ALIVE_PROBE=$(count_proc "$PROBE")

echo "  A 行（进宏之前）        : $A_LINE   —— 必须 1"
echo "  B 行（宏走完还活着）    : $B_LINE   —— 修前 0；修后必须 1"
echo "  C 行（Sleep 后自己退出）: $C_LINE   —— 修前 0；修后必须 1"
echo "  假应用进程还在吗        : $ALIVE_FAKE   —— 必须 0（杀伤力不能一起削掉）"
echo "  探针进程还在吗          : $ALIVE_PROBE   —— 仅供参考：探针最后会自己退出，"
echo "                            所以这一格是 0 也可能是「走完了」，判据只认 B/C 两行"

echo "  --- 探针自己的安装日志（落在夹具的 TEMP 里）---"
cat "$FIX/tmp/zhituan-install.log" 2>/dev/null | sed 's/^/  /' || echo "  (没有日志)"

echo "  --- 真机日志有没有被动过 ---"
AFTER=$(stat -c '%s %y' "$REAL_LOG" 2>/dev/null || echo '缺失')
echo "  跑前: $BEFORE"
echo "  跑后: $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "  ok：一字未动" || echo "  !! 被改动了，这轮读数作废"

echo "########## 6. 结论 ##########"
if [ "$A_LINE" = "1" ] && [ "$B_LINE" = "1" ] && [ "$C_LINE" = "1" ] && [ "$ALIVE_FAKE" = "0" ]; then
  echo "  PASS：探针活着走完 customCheckAppRunning 并自己退出，假应用已被杀掉"
elif [ "$A_LINE" = "1" ] && [ "$B_LINE" = "0" ]; then
  echo "  FAIL：探针死在 customCheckAppRunning 里 —— 复现了「安装程序自杀」"
else
  echo "  ??：读数不完整，先看上面"
fi

echo "########## 7. 收场 ##########"
taskkill //F //IM "$FAKE" >/dev/null 2>&1
taskkill //F //IM "$PROBE" >/dev/null 2>&1
kill "$FAKE_PID" 2>/dev/null
wait "$FAKE_PID" 2>/dev/null
echo "  已收掉假应用与探针（夹具留在 $FIX_W，里面是读数与日志）"
echo "########## 完 ##########"
