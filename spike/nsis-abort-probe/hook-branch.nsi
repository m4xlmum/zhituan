; 行为探针：把 customUnInstallCheck（第 2 层）的**门闸**与清场行为变成可复读的读数。
;
; 判据换过两次，这里记清楚为什么现在的门闸是 $ztUpgrading：
;
;   · 最早只看「旧卸载器退出码 != 0」。真机上这扇门从来没开过——安装日志里连着
;     三次升级都是「旧卸载器退出码 0」，而 $INSTDIR 里明明白白留着上一版的主程序
;     与 app.asar（详见 build/installer.nsh 文件头）。于是这一层「万一失败就清场」
;     的兜底一次都没跑，用户拿到的是「注册表写着新版本、文件还是旧版本」的混合安装。
;   · 但也不能因此把门闸整个去掉：全新安装时（没有旧卸载器）用户完全可能挑一个
;     已存在、装着别的东西的目录，那里面一个字节都不能动。
;   · 于是改成「本次是不是升级」——customInit 在 .onInit 里从卸载登记项读出来的
;     那个事实；内层再认**两处指纹任一**（主程序 / resources\app.asar）：RMDir /r
;     是尽力而为的，失败之后留下的往往正是「app.asar 还在、主程序已经没了」那一形态。
;
; A–E 各一个情形（customUnInstallCheck / zt.Preflight 里那些标签的作用域是「所在的
; 节」，同一节里插同一个宏两次就是标签重名，编译直接不过）。D 自己按住 app.asar，
; 量的是这一版**最重要的行为改动**：清不掉也继续，不再 Abort/Quit。E 反过来量
; 第 1 层的健康路径：没被占住时必须安静放行——一套只会拦人的探问同样能让升级
; 永远升不上去。
;
; 编译运行：
;   makensis -WX -INPUTCHARSET UTF8 hook-branch.nsi
;   ./hook-branch.exe ; echo "退出码 $?"
;   cat "$TEMP/zt-probe-branch.txt"      （GBK；用 python 读更省事）
;
; 退出码：7 = 断言全过。特意不用 0 —— 老代码在这条路上要么 SetErrorLevel 2、
; 要么直接 Quit（Quit 之后进程退出码是 0），7 能把「提前收场」和「全过」分开。
; 其它值 = 有断言不过（1）或探针自己出了别的事。

Unicode true
OutFile "hook-branch.exe"
RequestExecutionLevel user
SilentInstall silent

; 主程序名换成必然不存在的那一个：zt.KillApp 会 taskkill /F /IM <这个名字>，
; 探针不该顺手把用户正开着的纸团杀掉（真机上这个进程一直都在）。
!define APP_EXECUTABLE_FILENAME "zt-branch-nosuch.exe"

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "isupdated-stub.nsh"
!include "eb-shape.nsh"
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

  ; ── 第 0 层的真机读数：customInit 真去读这台机器的注册表 ────────────────
  ; 这一段不进 $R7：它是**读数**，判据是「这台机器上装着 1.6.7」这一事实。
  ; 只有一条算断言：读到的版本号或者「装在哪」得有落点，否则说明那两处注册表
  ; 读取整个没走通（$ztUpgrading 会是 "0"，第 1 层的探问就永远不会触发）。
  !insertmacro customInit
  !insertmacro Verdict "读数：customInit → ztUpgrading=<$ztUpgrading> ztUpVer=<$ztUpVer> ztOldDir=<$ztOldDir>"
  ${If} $ztUpgrading == "1"
  ${AndIf} $ztOldDir != ""
    !insertmacro Verdict "0 层 真机：认出本机装着旧版、也问出了它的目录  [对]"
  ${Else}
    !insertmacro Verdict "0 层 真机：没认出旧版（本机若确实没装过，这一条会翻过来，属预期）  [错]"
    StrCpy $R7 1
  ${EndIf}
FunctionEnd

; ─────────────────────────────────────────────────────────────────────────
; A：全新安装（$ztUpgrading = "0"），目录里装着别人的东西，也留着上一版的残留。
; 一个字节都不能动 —— 这正是「门闸不能用退出码」的那个约束：全新安装时
; 退出码同样是 0，两者靠退出码分不开。
; ─────────────────────────────────────────────────────────────────────────
Section "A"
  !insertmacro Fixture "${ROOT}\A"
  !insertmacro WriteFixture "${ROOT}\A\somebody-elses.txt" "keep me"
  !insertmacro WriteFixture "${ROOT}\A\resources\app.asar" "stale"
  !insertmacro WriteFixture "${ROOT}\A\${APP_EXECUTABLE_FILENAME}" "stale"
  StrCpy $INSTDIR "${ROOT}\A"
  StrCpy $ztUpgrading "0"
  StrCpy $R0 0
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\somebody-elses.txt"
  ${AndIf} ${FileExists} "$INSTDIR\resources\app.asar"
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro Verdict "A 全新安装 + 目录里有主程序与 app.asar : 没动     [对]"
  ${Else}
    !insertmacro Verdict "A 全新安装 + 目录里有主程序与 app.asar : 动了     [错] 全新安装会误删用户目录"
    StrCpy $R7 1
  ${EndIf}
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; B：升级，只剩被占住的 app.asar 那种形态（主程序已经没了）。
; **这一条就是要覆盖的那一种**：上一版的判据只认主程序，看不见它。
; ─────────────────────────────────────────────────────────────────────────
Section "B"
  !insertmacro Fixture "${ROOT}\B"
  !insertmacro WriteFixture "${ROOT}\B\resources\app.asar" "stale"
  !insertmacro WriteFixture "${ROOT}\B\decoy.txt" "should be cleaned"
  StrCpy $INSTDIR "${ROOT}\B"
  StrCpy $ztUpgrading "1"
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\*.*"
    !insertmacro Verdict "B 升级 + 只剩 app.asar              : 没清静   [错]"
    StrCpy $R7 1
  ${Else}
    !insertmacro Verdict "B 升级 + 只剩 app.asar              : 已清场   [对]"
  ${EndIf}
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; C：升级，主程序还在（1.6.2 那次 Abort 之后的形态）。回归，行为不该变。
; ─────────────────────────────────────────────────────────────────────────
Section "C"
  !insertmacro Fixture "${ROOT}\C"
  !insertmacro WriteFixture "${ROOT}\C\${APP_EXECUTABLE_FILENAME}" "stale"
  StrCpy $INSTDIR "${ROOT}\C"
  StrCpy $ztUpgrading "1"
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro Verdict "C 升级 + 主程序还在                  : 没动     [错] 回归失败"
    StrCpy $R7 1
  ${Else}
    !insertmacro Verdict "C 升级 + 主程序还在                  : 已清场   [对]"
  ${EndIf}
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; D：升级，app.asar 被按住 —— 清不掉的那一种。
; 老代码在这里弹框 + SetErrorLevel 2 + Quit，把用户留在「装了一半」上；
; 这一版必须**继续**：能删的删掉，删不掉的留着，让安装照常往下走，
; 然后把「没换掉」这件事交给应用自己去说（见 README 的更新那一节）。
;
; 锁是探针自己按的：dwShareMode=0 的独占句柄，和 zt.AskDeletable 用的是同一个
; 调用，区别只在于这一次**不关**句柄。这样不需要外部 lockhold.py 押时间，
; 也顺便证明了一件事：AskDeletable 判为「删不掉」的，正是 RmDirRetry 删不掉的
; 那一个 —— 第 1 层问得准不准，就靠这条侧证。
; ─────────────────────────────────────────────────────────────────────────
Section "D"
  !insertmacro Fixture "${ROOT}\D"
  !insertmacro WriteFixture "${ROOT}\D\resources\app.asar" "stale"
  !insertmacro WriteFixture "${ROOT}\D\decoy.txt" "cleanup should eat me"
  System::Call 'kernel32::CreateFileW(w "${ROOT}\D\resources\app.asar", i 0x80000000, i 0, p 0, i 3, i 0x80, p 0) i .r5'
  StrCpy $INSTDIR "${ROOT}\D"
  StrCpy $ztUpgrading "1"
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
  ; 能走到下一行本身就是一条断言：老代码在这里就收场了。
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    !insertmacro Verdict "D 升级 + app.asar 被按住：文件留着    [对]"
  ${Else}
    !insertmacro Verdict "D 升级 + app.asar 被按住：竟然删掉了 [错] 锁没按上，这条读数不作数"
    StrCpy $R7 1
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\decoy.txt"
    !insertmacro Verdict "D 同样的清场照做（decoy 被删）        [对]"
  ${Else}
    !insertmacro Verdict "D 同样的清场照做（decoy 被删）        [错] 没删，说明清场那一段没跑"
    StrCpy $R7 1
  ${EndIf}
  !insertmacro Verdict "D 清不掉也继续（没有 Quit、没有弹框） [对] 见退出码"
SectionEnd

; ─────────────────────────────────────────────────────────────────────────
; E：第 1 层的**健康路径** —— 要替换的两个文件都在、都删得掉，探问必须安静放行。
; 这一节和 D 是一对：D 证明了「被按住时删不掉」，E 证明了「没被按住时不会误报」。
; 缺了 E，一套只会拦人的探问也能全绿——那正好是最坏的结果：升级永远升不上去。
;
; 读到这里的 $ztHeld 必须是空的。它非空的话 zt.Preflight 会在里面弹框 + Quit，
; 于是下面两行 Verdict **根本不会出现在日志里**——「少了一行」就是这条读数。
; ─────────────────────────────────────────────────────────────────────────
Section "E"
  !insertmacro Fixture "${ROOT}\E"
  !insertmacro WriteFixture "${ROOT}\E\resources\app.asar" "healthy, not held"
  !insertmacro WriteFixture "${ROOT}\E\${APP_EXECUTABLE_FILENAME}" "healthy, not held"
  StrCpy $INSTDIR "${ROOT}\E"
  StrCpy $ztHeld ""
  !insertmacro zt.Preflight chk
  ${If} $ztHeld == ""
    !insertmacro Verdict "E 升级 + 两个文件都删得掉：放行（ztHeld 空）[对]"
  ${Else}
    !insertmacro Verdict "E 升级 + 两个文件都删得掉：误报成删不掉     [错] 那升级会被自己拦住"
    StrCpy $R7 1
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    !insertmacro Verdict "E 探问只问不删（app.asar 仍在）          [对]"
  ${Else}
    !insertmacro Verdict "E 探问只问不删（app.asar 仍在）          [错] 探问自己删了东西"
    StrCpy $R7 1
  ${EndIf}
SectionEnd

; 收尾：把「有没有不过的」当退出码交给调用方（7 = 全过，见文件头）
Section "-总结"
  ${If} $R7 == 0
    !insertmacro Verdict "全部断言通过（退出码 7）"
    SetErrorLevel 7
  ${Else}
    !insertmacro Verdict "有断言不过（退出码 1）"
    SetErrorLevel 1
  ${EndIf}
SectionEnd
