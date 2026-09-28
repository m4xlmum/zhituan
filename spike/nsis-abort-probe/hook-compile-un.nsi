; 卸载器那一次编译的形状：electron-builder 会用 -DBUILD_UNINSTALLER 把同一份脚本
; 再编一遍生成 Uninstall zhituan.exe。这一次编译里 installUtil.nsh 不参与，
; 因此 customUnInstallCheck 根本不会被插入——凡是只在它里面用到的 Var / 标签，
; 在这一趟就都是「声明了没用」，而构建是带 --WX 的（警告即错误）。
; 这一支探针就是为了提前撞上那种警告。
;
;   makensis -WX -INPUTCHARSET UTF8 hook-compile-un.nsi

Unicode true

!define PRODUCT_NAME "纸团"
!define PRODUCT_FILENAME "zhituan"
!define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"
!define BUILD_UNINSTALLER

OutFile "hook-compile-un.exe"
RequestExecutionLevel user

!include "LogicLib.nsh"
; 真实构建里 ${isUpdated} 由 NsisTarget 注入；探针里用形状一致的替身
!include "isupdated-stub.nsh"
!include "E:\AIWork\1003开源摸鱼阅读软件\build\installer.nsh"

Section "install"
  ; 这一趟编译只为了生成卸载器，正式构建里这个节由模板自己填
SectionEnd

Function .onInit
  WriteUninstaller "hook-compile-un-uninst.exe"
FunctionEnd

; 真身里它叫 un.checkAppRunning，由卸载节的 `${IfNot} ${Silent}` 调用
Function un.onInit
  !insertmacro customCheckAppRunning
FunctionEnd

Section "un.Uninstall"
  !insertmacro customRemoveFiles
SectionEnd
