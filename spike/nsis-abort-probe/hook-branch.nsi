; 行为探针：把 customUnInstallCheck 的分支判据变成可复读的读数。
;
; 为什么需要它：这个宏的判据改过。原先只在「旧卸载器退出码 != 0」时清场，
; 内层还额外要求「$INSTDIR 下有 zhituan.exe」。两处都会漏：
;   · RMDir /r 是尽力而为的，被占住的那个文件删不掉、其余的照删不误 ——
;     一次失败的清场之后，留下的往往正是「resources\app.asar 还在、
;     主程序已经没了」，内层那条 zhituan.exe 判据于是看不见它；
;   · 而外层如果为了补救就整个去掉，全新安装（$R0 恒为 0，见
;     installUtil.nsh:152-153）又会走进来，把用户选中的、装着别的东西的
;     目录整个删掉。
; 所以现在是「外层认退出码、内层认两处指纹任一」。四种组合各跑一遍，
; 断言走的是哪一支 —— 这一件事读代码得不出来。
;
; 四种情形各占一节：customUnInstallCheck 里那些标签（zt_kill_unc1 之类）的
; 作用域是「所在的节」，同一个节里插它两次就是标签重名，编译直接不过。
;
; 编译运行：
;   makensis -WX -INPUTCHARSET UTF8 hook-branch.nsi
;   ./hook-branch.exe ; echo "退出码 $?"
;   cat "$TEMP/zt-probe-branch.txt"
;
; 退出码：0 = 四条断言全过，1 = 有不过的。

Unicode true

!define PRODUCT_NAME "纸团"
!define PRODUCT_FILENAME "zhituan"
; 故意不叫 zhituan.exe：zt.KillApp 会按这个名字 taskkill /F /T /IM，
; 而探针不该顺手把用户正开着的纸团杀掉。用一个必然不存在的名字，
; taskkill 立刻返回 128，KillApp 的日志与重试接线照样走到。
!define APP_EXECUTABLE_FILENAME "zt-branch-nosuch.exe"

OutFile "hook-branch.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "isupdated-stub.nsh"
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

!define OUT "$TEMP\zt-probe-branch.txt"
!define ROOT "$TEMP\zt-branch"

; $R7 = 有没有断言不过（0 全过 / 1 有过）
; $R6 只给下面几个宏当临时工
!macro Verdict TEXT
  FileOpen $R6 "${OUT}" a
  ${IfNot} ${Errors}
    FileSeek $R6 0 END
    FileWrite $R6 "${TEXT}$\r$\n"
    FileClose $R6
  ${EndIf}
!macroend

; 一个干净的安装目录，带 resources 子目录（app.asar 就住在那儿）
!macro Fixture DIR
  RMDir /r "${DIR}"
  CreateDirectory "${DIR}\resources"
!macroend

!macro WriteFixture PATH CONTENT
  FileOpen $R6 "${PATH}" w
  FileWrite $R6 "${CONTENT}"
  FileClose $R6
!macroend

Function .onInit
  StrCpy $R7 0
  Delete "${OUT}"
  Delete "$TEMP\zhituan-install.log"
  RMDir /r "${ROOT}"
FunctionEnd

; ─────────────────────────────────────────────────────────────────────────
; A：退出码 0、app.asar 还留着。
; 按设计**不该**替他动手 —— $R0 == 0 同时也是全新安装的样子（B 就是那一种），
; 而这个残留本该由**卸载器**自己报 2（见 customRemoveFiles）。报 0 就说明它
; 认为清干净了，轮到我们不该去猜。
; ─────────────────────────────────────────────────────────────────────────
Section "A"
  !insertmacro Fixture "${ROOT}\A"
  !insertmacro WriteFixture "${ROOT}\A\resources\app.asar" "stale"
  StrCpy $INSTDIR "${ROOT}\A"
  StrCpy $R0 0
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    !insertmacro Verdict "A 退出码0 + 残留 app.asar   : 没动     [对]"
  ${Else}
    !insertmacro Verdict "A 退出码0 + 残留 app.asar   : 清掉了   [错] 外层判据失效，全新安装会被误删"
    StrCpy $R7 1
  ${EndIf}
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; B：全新安装 —— 退出码 0、目录是用户自己选的、里面装着别人的东西。
; 一个字节都不能动。
; ─────────────────────────────────────────────────────────────────────────
Section "B"
  RMDir /r "${ROOT}\B"
  CreateDirectory "${ROOT}\B"
  !insertmacro WriteFixture "${ROOT}\B\somebody-elses.txt" "keep me"
  StrCpy $INSTDIR "${ROOT}\B"
  StrCpy $R0 0
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\somebody-elses.txt"
    !insertmacro Verdict "B 退出码0 + 别人的文件     : 没动     [对]"
  ${Else}
    !insertmacro Verdict "B 退出码0 + 别人的文件     : 删了     [错] 全新安装误删用户目录"
    StrCpy $R7 1
  ${EndIf}
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; C：退出码 2、主程序已经没了、只剩被占住的 app.asar。
; **这一条就是改判据要覆盖的那一种**：旧代码只看 zhituan.exe，看不见它。
; ─────────────────────────────────────────────────────────────────────────
Section "C"
  !insertmacro Fixture "${ROOT}\C"
  !insertmacro WriteFixture "${ROOT}\C\resources\app.asar" "stale"
  StrCpy $INSTDIR "${ROOT}\C"
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    !insertmacro Verdict "C 退出码2 + 只剩 app.asar    : 没动     [错] 内层判据漏了这一种"
    StrCpy $R7 1
  ${Else}
    !insertmacro Verdict "C 退出码2 + 只剩 app.asar    : 已清场   [对]"
  ${EndIf}
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; D：退出码 2、主程序还在（1.6.2 那种 Abort 之后的形态）。回归，行为不该变。
; ─────────────────────────────────────────────────────────────────────────
Section "D"
  !insertmacro Fixture "${ROOT}\D"
  !insertmacro WriteFixture "${ROOT}\D\${APP_EXECUTABLE_FILENAME}" "stale"
  StrCpy $INSTDIR "${ROOT}\D"
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro Verdict "D 退出码2 + 主程序还在      : 没动     [错] 回归失败"
    StrCpy $R7 1
  ${Else}
    !insertmacro Verdict "D 退出码2 + 主程序还在      : 已清场   [对]"
  ${EndIf}
SectionEnd

; 收尾：把「有没有不过的」当退出码交给调用方
Section "-总结"
  ${If} $R7 == 0
    !insertmacro Verdict "四条断言全过"
  ${EndIf}
  SetErrorLevel $R7
SectionEnd
