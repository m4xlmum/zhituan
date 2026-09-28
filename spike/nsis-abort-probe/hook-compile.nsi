; 只为验证 build/installer.nsh 能否编译通过、各钩子能否插进正确的函数/节。
; 真正跑起来的行为在别的探针里验，这里只求 makensis 不报错。
; 编译（注意 -INPUTCHARSET UTF8，且 !include 必须用反斜杠）：
;   makensis -INPUTCHARSET UTF8 hook-compile.nsi
;
; 模拟 electron-builder 生成脚本的形状：这些 define 在正式构建里由 NsisTarget
; 从 electron-builder.yml 推导（PRODUCT_FILENAME 取 win.executableName = zhituan）。

Unicode true

!define PRODUCT_NAME "纸团"
!define PRODUCT_FILENAME "zhituan"
!define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"

OutFile "hook-compile.exe"
RequestExecutionLevel user

!include "LogicLib.nsh"
; 真实构建里 ${isUpdated} 由 NsisTarget 注入；探针里用形状一致的替身
!include "isupdated-stub.nsh"

; 正式构建里这个 !include 由 electron-builder 放在生成脚本最前面
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

Section "install"
  ; installSection.nsh 在这两处插入 CHECK_APP_RUNNING，最终落到 customCheckAppRunning
  !insertmacro customCheckAppRunning
  ; installUtil.nsh 的 handleUninstallResult 在 SHELL_CONTEXT 分支插入它
  StrCpy $R0 2
  !insertmacro customUnInstallCheck
SectionEnd

; 卸载器那一侧：un.checkAppRunning / 卸载节
Function .onInit
  WriteUninstaller "hook-compile-uninst.exe"
FunctionEnd

Function un.onInit
  !insertmacro customCheckAppRunning
FunctionEnd

Section "un.Uninstall"
  !insertmacro customRemoveFiles
SectionEnd
