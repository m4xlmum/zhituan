; 行为探针：第 1 层 zt.Preflight 在「要替换的文件被占住」时必须做到四件事，
; 而且**一个字节都不许动用户的东西**。四件事，逐条都要有读数：
;
;   1) 如实报错停下 —— 退出码 2（SetErrorLevel 2 + Quit）；
;   2) 把话说出口 —— 静默安装里唯一的出口是弹框，探针把 zt.Alert 换成写文件
;      （installer.nsh 里留的那个口子就是为这个：不然探针会停在一个没有人能点
;      的模态框上，一路挂到超时，「没量到」和「量错了」长得一样）；
;   3) 把应用叫回来 —— 用 fixture 里那份真 exe（pf-app.exe）验证；
;   4) 什么都不动 —— fixture 里的文件内容与目录清单跑完必须一模一样。
;
; 走的是**真的** customCheckAppRunning（含 .onInit 里真的 customInit，它真读这台
; 机器的注册表），只有 $INSTDIR 与主程序名换成探针目录，免得碰到用户桌面上的
; 那份安装。fixture 里那个 app.asar 由**探针自己**按住（dwShareMode=0 的独占句柄，
; 和 zt.AskDeletable 用的是同一个调用，区别只是这一次不关句柄）——不需要外部
; 的 lockhold.py，也就不需要押时间。
;
; 编译运行（fixture 的前后对照由 preflight.sh 做）：
;   makensis -WX -INPUTCHARSET UTF8 pf-app.nsi
;   makensis -WX -INPUTCHARSET UTF8 preflight.nsi
;   ./preflight.sh

Unicode true
OutFile "preflight.exe"
RequestExecutionLevel user
SilentInstall silent

; 主程序名换成必然不存在的那一个：zt.KillApp 会 taskkill /F /IM <这个名字>，
; 绝不能让它撞上用户正开着的纸团（真机上那个名字的进程一直都在）。
!define APP_EXECUTABLE_FILENAME "zt-pf-app.exe"

!define PF_DIR "E:\AIWork\1003开源摸鱼阅读软件\spike\nsis-abort-probe\pf-fixture"
!define PF_APP "E:\AIWork\1003开源摸鱼阅读软件\spike\nsis-abort-probe\pf-app.exe"
!define PF_ALERT "$TEMP\zt-preflight-alert.txt"
!define PF_REACHED "$TEMP\zt-preflight-reached-end.txt"

; 把弹框换成写文件。**必须在 !include installer.nsh 之前**：那个文件里是
; !ifndef zt.Alert，先定义才轮得到我们这一份。
!macro PfAlert MSG
  Push $9
  FileOpen $9 "${PF_ALERT}" w
  FileWrite $9 "${MSG}$\r$\n"
  FileClose $9
  Pop $9
!macroend
!define zt.Alert `!insertmacro PfAlert`

!include "LogicLib.nsh"
!include "isupdated-stub.nsh"
!include "eb-shape.nsh"
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

Function .onInit
  Delete "${PF_ALERT}"
  Delete "${PF_REACHED}"
  Delete "$TEMP\zhituan-install.log"
FunctionEnd

Section "preflight"
  ; ── fixture：一个干净的探针目录 ─────────────────────────────────────────
  ; 主程序是真 exe（用来观察「被叫回来了没有」），app.asar 是要被按住的那一个，
  ; sentinel.txt 是「一个字节都没动」的哨兵。
  RMDir /r "${PF_DIR}"
  CreateDirectory "${PF_DIR}\resources"
  CopyFiles /SILENT "${PF_APP}" "${PF_DIR}\${APP_EXECUTABLE_FILENAME}"
  FileOpen $9 "${PF_DIR}\resources\app.asar" w
  FileWrite $9 "上一版的 app.asar（探针造的）"
  FileClose $9
  FileOpen $9 "${PF_DIR}\sentinel.txt" w
  FileWrite $9 "探针的哨兵：跑完之后我还得在，内容也得原样"
  FileClose $9

  ; ── 按住 app.asar：不关句柄，于是它删不掉也搬不动 ──────────────────────
  ; 返回句柄丢进 $R5，故意不 CloseHandle —— 探针进程退出时内核自然回收。
  ;
  ; /nolock 是**对照组**：不按锁时同一个探针必须一路走到底（探问放行 → 记下
  ; 「走到了最后」→ 退出码 0、不弹框）。两组读数一比，「拦下」这件事才归因给
  ; 那把锁，而不是归因给探针本身哪一步坏了。
  ClearErrors
  StrCpy $R6 "0"
  ${GetParameters} $R0
  ${GetOptions} $R0 "/nolock" $R1
  ${IfNot} ${Errors}
    StrCpy $R6 "1"
  ${EndIf}
  ${If} $R6 == "0"
    System::Call 'kernel32::CreateFileW(w "${PF_DIR}\resources\app.asar", i 0x80000000, i 0, p 0, i 3, i 0x80, p 0) i .r5'
  ${EndIf}

  StrCpy $INSTDIR "${PF_DIR}"
  ; 真的 customInit：读本机注册表，把「本次是升级」记下来（本机装着 1.6.7）。
  !insertmacro customInit
  ; 真的第 1 层。$ztUpgrading == "1" 才会走到 zt.Preflight。
  !insertmacro customCheckAppRunning

  ; 能执行到这儿，就说明探问没有拦下来 —— 记一张字条，让 preflight.sh 看得见。
  FileOpen $9 "${PF_REACHED}" w
  FileWrite $9 "走到这里说明 zt.Preflight 没有拦下（探针应当到不了这一行）$\r$\n"
  FileClose $9
SectionEnd
