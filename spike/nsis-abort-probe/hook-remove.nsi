; 行为探针：验 customRemoveFiles 在「删不净」时有没有如实报 2。
;
; 为什么需要它：customRemoveFiles 换掉的是 uninstaller.nsh 里那段
; `Abort "Can't rename ..."` 的改名搬移。原版靠 Abort 给出退出码 2，安装器
; 据此走「旧卸载器失败」那条清场路（customUnInstallCheck）。换成安静地
; RMDir /r 之后，退出码默认就是 0，而 0 的语义是「目录清干净了」——安装器
; 于是把新文件直接铺上去，被占住的那个（多半正是 resources\app.asar）留在
; 原地，用户拿到一份「注册表写着新版本、app.asar 还是旧的」的混合安装。
; 所以这个宏末尾那句 SetErrorLevel 2 是整条链子的关节，必须有探针盯着它。
;
; 反过来也要验：**删干净时不能报 2**，否则每一次正常升级都会走一遍
; 二十多秒的清场重试。
;
; 用法（夹具由外面备好，因为「锁」得在探针起来之前就按上）：
;
;   FIX="$TEMP/zt-remove"
;   rm -rf "$FIX"; mkdir -p "$FIX/resources"; echo stale > "$FIX/resources/app.asar"
;
;   # 对照（不上锁 → 期望退出码 0）
;   ./hook-remove.exe; echo "解锁退出码 $?"
;
;   # 病态（上锁 → 期望退出码 2）
;   ( python lockhold.py "$FIX/resources/app.asar" 30 & )
;   ./hook-remove.exe; echo "上锁退出码 $?"
;
; 读数另记在 $TEMP\zt-probe-remove.txt（退出码才是主判据 —— SetErrorLevel
; 一被写进去就没法在脚本里读回来了，只能留给调用方看）。

Unicode true

!define PRODUCT_NAME "纸团"
!define PRODUCT_FILENAME "zhituan"
!define APP_EXECUTABLE_FILENAME "zt-remove-nosuch.exe"   ; 同上，别误杀真进程

OutFile "hook-remove.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "isupdated-stub.nsh"
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

!define OUT "$TEMP\zt-probe-remove.txt"

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
  StrCpy $INSTDIR "$TEMP\zt-remove"

  ; 夹具没备好（外面忘了建、或上次跑完被清掉了）就自己建一个 —— 这样
  ; 「对照」那一遍可以直接跑，「上锁」那一遍则一定要外面先建好再上锁。
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    CreateDirectory "$INSTDIR\resources"
    FileOpen $R6 "$INSTDIR\resources\app.asar" w
    FileWrite $R6 "stale"
    FileClose $R6
    !insertmacro Verdict "夹具是探针自己建的（外面没备）"
  ${Else}
    !insertmacro Verdict "夹具来自外面（上锁那一遍就该是这样）"
  ${EndIf}

  !insertmacro customRemoveFiles

  ${If} ${FileExists} "$INSTDIR\*.*"
    !insertmacro Verdict "删后：目录里还剩东西 → 期望退出码 2（被占用）"
  ${Else}
    !insertmacro Verdict "删后：目录已清空 → 期望退出码 0（正常）"
  ${EndIf}
SectionEnd
