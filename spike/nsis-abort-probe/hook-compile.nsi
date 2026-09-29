; 只为验证 build/installer.nsh 能否编译通过、各钩子能否插进正确的函数/节。
; 真正跑起来的行为在别的探针里验（preflight.sh / hook-branch.nsi），这里只求
; makensis 不报错，而且**两趟编译都要过**：安装器这一趟（本文件）与卸载器那一趟
; （hook-compile-un.nsi）插的宏不一样，漏掉哪一趟都可能把警告攒到真机构建上。
; 构建是带 -WX 的，警告即错误，所以用同样的开关编。
;
;   makensis -WX -INPUTCHARSET UTF8 hook-compile.nsi
;
; 各 define 与插件的来路见 eb-shape.nsh。

Unicode true
OutFile "hook-compile.exe"
RequestExecutionLevel user

!include "LogicLib.nsh"
!include "isupdated-stub.nsh"
!include "eb-shape.nsh"

; 正式构建里这个 !include 由 electron-builder 放在生成脚本最前面
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

; .onInit 的顺序照 installer.nsi:67-81 摆：check64BitAndSetRegView → 单实例 →
; initMultiUser → customInit。customInit 必须在 initMultiUser **之后**（它读
; $INSTDIR，也拿它当 $ztOldDir 的兜底），并且必须在旧卸载器动手**之前**——
; 它要读的那个卸载登记项会被旧卸载器删掉。
Function .onInit
  !insertmacro customInit
  WriteUninstaller "hook-compile-uninst.exe"
FunctionEnd

Section "install"
  ; installSection.nsh:30-38 在这里插 CHECK_APP_RUNNING，最终落到
  ; customCheckAppRunning（里面现在还有第 1 层的探问）
  !insertmacro customCheckAppRunning
  ; installUtil.nsh 的 handleUninstallResult 在 SHELL_CONTEXT 分支插它
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
SectionEnd

; 卸载器那一侧插的是 customCheckAppRunning；这里也插一遍，为的是让它的标签与
; 变量在「函数里」这一种作用域下也过一遍编译（un.checkAppRunning 就是函数）。
Function un.onInit
  !insertmacro customCheckAppRunning
FunctionEnd

Section "un.Uninstall"
  !insertmacro customRemoveFiles
SectionEnd
