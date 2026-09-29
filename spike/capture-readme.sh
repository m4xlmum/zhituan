#!/usr/bin/env bash
# README 那三张成品图的**原图**：把每一张按它该有的那条命令抓一遍，
# 再复制成 readme-assets.js 认得的规范名。
#
# 为什么要有这个脚本：原图与命令的对应关系原先只存在于我上一次敲过的终端历史里，
# 而「这张图是哪条命令跑出来的」正是 README 那句话（「四张都是真实渲染的截图，
# 没有任何手绘或摆拍」）能不能站住的地方。写下来之后，任何人跑一遍都能得到同一批原图。
#
# 两条容易搞混的尺寸规矩：
#   * 界面底板（chrome*）抓的是**整扇窗** 1280×720，且**必须带 --alpha**——
#     它是垫在网页之上的那一层，正文区要透明，否则叠出来是一块灰底。
#   * 页面（home-*、settings）抓的是**正文区** 1232×676（--body），不是整扇窗。
#     抓整扇窗再塞进正文区那个矩形，图会被压扁（1280/720 与 1232/676 不是同一个比例），
#     而那在成品图上只是「看着有点扁」，很难认出来是哪个数字错了。
#
# 界面底板**只有一份**（1.5.1 起）：主题只管起始页，顶栏与右栏不再跟着换皮，
# 于是 --theme night / --theme crt-green 抓出来的界面与不带 --theme 的一模一样。
# 这里曾经有 chrome-night.png 与 chrome-crt-green.png 两张 —— 那是同一个像素的两份副本，
# 名不同、内容相同，读图的人会以为自己在看两态（见 readme-assets.js 里那段说明）。
#
# 用法：bash spike/capture-readme.sh     （无头，不弹窗）
set -u
# ELECTRON_RUN_AS_NODE 会让 electron 二进制**退化成纯 Node**：脚本照样"跑完"，
# 但 ipcMain 是 undefined，一张图都抓不到。本机的 WorkBuddy 宿主环境就带着它，
# 当时八个探针全废、脚本却一路打印正常。这个脚本要的是真的 Electron，显式清掉。
unset ELECTRON_RUN_AS_NODE
cd "$(dirname "$0")/.." || exit 1
OUT=spike/out/readme
mkdir -p "$OUT"
# 无头渲染的额外开关。真机上留空即可；容器/沙箱里 GPU 进程会当场崩
# （`FATAL: GPU process isn't usable. Goodbye.`），那时需要
# `PROBE_FLAGS="--no-sandbox --in-process-gpu"` 这类开关才跑得起来。
# 刻意不写死：写死会连渲染后端一起钉住，而这里的图是要跟真机一致的。
PROBE_FLAGS="${PROBE_FLAGS:-}"
probe () { timeout 120 npx electron $PROBE_FLAGS spike/preview.js "$@" --out "$OUT"; }
FAILED=0
# 这一轮的起跑线。源图必须比它新，才算"这次真的抓到了"——
# cp 对着一张旧图也会成功，于是"复制成功"本身什么都不能说明。
MARK="$OUT/.run-start"
touch "$MARK"
cp_ () {
  if [ ! -f "$OUT/$1" ] || [ "$OUT/$1" -ot "$MARK" ]; then
    printf '!! 源图没更新（这次没抓到）：%s\n' "$1" >&2
    FAILED=$((FAILED + 1))
    return
  fi
  if cp "$OUT/$1" "$OUT/$2"; then
    printf '%-26s ← %s\n' "$2" "$1"
  else
    # 复制失败必须当场算数：不记下来的话，目录里留着的就是**上一次**那张旧图，
    # 而旧图和新鲜图在文件名上长得一模一样（这次就撞上过一回）。
    printf '!! 复制失败：%s ← %s\n' "$2" "$1" >&2
    FAILED=$((FAILED + 1))
  fi
}

echo "===== 界面底板：整扇窗 1280×720，正文区透明 ====="
probe --alpha --width 1280 --height 720
probe --alpha --bg 0 --width 1280 --height 720
cp_ preview-default-1280x720.png       chrome.png
cp_ preview-default-1280x720-bg0.png   chrome-bg0.png

echo "===== 页面：按正文区 1232×676 渲染，叠进去是 1:1 ====="
probe --home --body --theme paper --width 1280 --height 720
probe --home --body --theme night --width 1280 --height 720
probe --home --body --theme crt-green --width 1280 --height 720
probe --settings --body --width 1280 --height 720
cp_ home-paper-1232x676.png     home-paper.png
cp_ home-night-1232x676.png     home-night.png
cp_ home-crt-green-1232x676.png home-crt-green.png
cp_ settings-1232x676.png       settings.png

echo "===== 弹出面板：真实窗口尺寸 320×420，1:1 ====="
# 面板有五张（历史 / 书签 / 缩放 / 标签页 / 排版），README 里露的是历史那一张
probe --popover --kind history --width 320 --height 420
cp_ popover-history-320x420.png popover.png

echo "===== 悬浮球：40px 的球放大 5 倍，带透明通道 ====="
# --ball-zoom 5 而不是「抓一张大的」：球在自己那扇窗里是铺满的（40px 的窗里 40px 的球），
# 而球面上那枚图形是**固定 18px**——窗给到 200px，球跟着变成 200px，图形却还是 18px，
# 于是抓出来是一颗大球上趴着一个芝麻。把图形也放 5 倍（18→90）之后，
# 90/200 与真机的 18/40 都是 0.45，这张图才是那个球的等比放大，而不是一颗畸形的球。
probe --collapsed --alpha --width 200 --height 200 --ball-zoom 5
cp_ preview-collapsed-200x200-zoom5.png ball.png

echo "===== 成品名那一批（看时间戳，全该是刚刚） ====="
ls -la "$OUT"/chrome.png "$OUT"/chrome-bg0.png "$OUT"/home-paper.png "$OUT"/home-night.png \
       "$OUT"/home-crt-green.png "$OUT"/settings.png "$OUT"/popover.png "$OUT"/ball.png |
  awk '{print $5, $6, $7, $8, $9}'

rm -f "$MARK"
if [ "$FAILED" -ne 0 ]; then
  echo "有 $FAILED 张没抓到或没复制成——上面那些成品名里混着旧图，别拿去发 README。" >&2
  exit 1
fi
echo "OK：8 张全部换成这一轮抓的原图。"
