; 行为探针：验「安装程序会不会在 customCheckAppRunning 里把自己杀掉」。
;
; ---------------------------------------------------------------------------
; 为什么要有这一支：真机上「应用内点更新并重启」的现象是
; 「应用关了，然后什么都没有」。安装器自己的日志
; （%TEMP%\zhituan-install.log）停在
;
;     安装前检测到纸团在运行（taskkill 返回 0）
;
; 这一行，而它自己的 $PLUGINSDIR 里连 old-uninstaller.exe 都没被拷出来
; ——就是说安装程序死在 customCheckAppRunning 里，死在 zt.KillApp 那一句
; `taskkill /F /T /IM zhituan.exe` 上。
;
; 原因不是它杀不动别人，是**它把整棵子树一起点了，而自己就在那棵树里**：
; 安装程序是应用用 spawn(..., { detached: true }) 起的子进程（detached 只改
; 进程组，父进程链还在），/T 收的正是子进程，于是这一句把自己也收走。
; 后果是后面全都不发生：旧卸载器不跑、文件不换、`--force-run` 也到不了，
; 没有人把应用叫回来——用户看到的就是「关了、然后什么都没有」。
;
; ---------------------------------------------------------------------------
; 这个探针把那个拓扑一字不差地搬下来：
;
;     zt-fakeapp.exe        ← node.exe 改名，镜像名 == APP_EXECUTABLE_FILENAME
;       └── kill-self.exe   ← 本探针，被 detached 起起来，镜像名与「应用」不同
;
; 探针里跑的是**生产的宏**（!include build/installer.nsh，调 customCheckAppRunning
; 本身，不是它的复制品），所以它盯得住以后有人把 /T 加回来。
;
; 读数（$TEMP\zt-probe-killself.txt，一行一步，用追加写）：
;
;     A 起点        进宏之前
;     B 活下来了    customCheckAppRunning 走完，探针还在
;
; **判据是 B 在不在**：
;   · 没有 B = 探针在 zt.KillApp 里被自己杀了 —— 复现了那个 bug；
;   · 有 B    = 它活着走完了那个宏。
; 另一半（假应用有没有真的被杀掉）由 kill-self.sh 用 tasklist 查：修的是 /T，
; 不能把杀伤力一起削掉，那一条也得盯着，否则「什么都不杀」也能骗过 B。
;
; 夹具与启动顺序都在 kill-self.sh 里，探针自己不建夹具。
;
; SPDX-License-Identifier: GPL-2.0-or-later

Unicode true

!define PRODUCT_NAME "纸团"
!define PRODUCT_FILENAME "zhituan"
; **别用真名字**：探针里的 taskkill 会真的杀掉这个名字的进程
!define APP_EXECUTABLE_FILENAME "zt-fakeapp.exe"

OutFile "kill-self.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

!define OUT "$TEMP\zt-probe-killself.txt"

!macro Verdict TEXT
  FileOpen $R6 "${OUT}" a
  ${IfNot} ${Errors}
    FileSeek $R6 0 END
    FileWrite $R6 "${TEXT}$\r$\n"
    FileClose $R6
  ${EndIf}
!macroend

Section "probe"
  Delete "${OUT}"
  !insertmacro Verdict "A 起点：TEMP=$TEMP"

  ; 生产宏，原样跑。修好之后它应该在「检测到在运行 → 强杀 → 确认收干净」之后
  ; 正常返回，而不是把探针自己一起收走
  !insertmacro customCheckAppRunning

  !insertmacro Verdict "B 活下来了：customCheckAppRunning 走完，探针还在"

  ; 停一会儿再退。**这一停是判据的一部分**：不留它的话，探针「正常走完自己退出」
  ; 与「被自己杀掉」在进程表上长得一模一样（都是没了），外面就只剩 B 行一个信号。
  ; 停留之后再写一行 C，于是「B 与 C 都在」本身就是「它活着走完了全程」的自证，
  ; 不必依赖外面掐着秒表去查进程表（那样查出来的 0 分不清「退出」与「被杀」）。
  Sleep 8000
  !insertmacro Verdict "C 收场：Sleep 走完，探针是自己退出的"
SectionEnd
