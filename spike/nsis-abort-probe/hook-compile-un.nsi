; 卸载器那一次编译的形状：electron-builder 会用 -DBUILD_UNINSTALLER 把同一份脚本
; 再编一遍生成 Uninstall zhituan.exe。这一趟里：
;
;   · installUtil.nsh 不参与，所以 customUnInstallCheck **根本不会被插入**——
;     凡是只在它里面用到的 Var 在这一趟就是「声明了没用」，而构建带 -WX
;     （警告即错误），那种警告会把整个构建打掉；
;   · customInit 也不会被插入（installer.nsi 把它放在 !ifndef BUILD_UNINSTALLER
;     那一支里），所以这一趟里 $ztUpgrading 恒为空 —— 第 1 层的探问在这里天然
;     不生效，正是设计要的：卸载器那一趟没有人要抢在旧卸载器前面。
;   · un.checkAppRunning 会插 customCheckAppRunning：这一段确实进了卸载器，所以
;     它用到的每一个东西都必须能在这趟编译里成立。第 1 层的探问（zt.Preflight、
;     zt.AskDeletable、StdUtils、$ztHeld）因此在 installer.nsh 里被
;     !ifndef BUILD_UNINSTALLER 整个圈了出去——这一支探针正是为了提前撞上那种
;     「卸载器那一趟编译不过」的问题而存在的（它第一次跑就把 6001 抓出来了）。
;
;   makensis -WX -INPUTCHARSET UTF8 hook-compile-un.nsi

Unicode true
!define BUILD_UNINSTALLER

OutFile "hook-compile-un.exe"
RequestExecutionLevel user

!include "LogicLib.nsh"
!include "isupdated-stub.nsh"
!include "eb-shape.nsh"
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
