; electron-builder 生成脚本的「形状」：探针只模拟必要的那几条。
;
; 为什么要单独一份：三个探针（hook-compile / preflight / hook-branch）都必须在
; **同样的 define 环境**下 !include build/installer.nsh，而这份环境里有两处
; 特别容易漏，漏了就会「探针过了、真机构建挂」：
;
;   1) **StdUtils 插件**。installer.nsh 第 1 层要用 ${StdUtils.ExecShellAsUser}
;      把应用叫回来，而它背后是插件调用 —— 插件调用在**编译期**就要求解析得到
;      .dll，所以探针也得像 electron-builder 那样 !addplugindir。NsisTarget.js
;      576-585 干的就是这件事：include StdUtils.nsh + addPluginDir(x86-unicode)。
;
;   2) **两个注册表键名**。它们是 multiUser.nsh:8-9 里的 `!define /ifndef`，
;      而 multiUser.nsh 在生成脚本里的位置**晚于** installer.nsh。这一点在这里
;      不影响结果（宏体是在插入期展开的，不是解析期），但顺序还是照真机摆：
;      万一以后有人把 customInit 改成解析期就要用到这几个键，这里会立刻编不过，
;      而不是等到真机上才发现。
;
; APP_EXECUTABLE_FILENAME 允许调用方先定义：zt.KillApp 会按这个名字 taskkill，
; 而探针绝不该顺手把用户正开着的纸团杀掉（真机量的读数：那个名字的进程一直有）。
; 于是探针都先把它改成必然不存在的名字，再 include 这个文件。

!ifndef APP_EXECUTABLE_FILENAME
  !define PRODUCT_FILENAME "zhituan"
  !define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"
!endif

; 与真机一致（installed-version.py 读出来的 UninstallString 里就是这个 GUID，
; HKCU\Software\<GUID> 与 HKCU\...\Uninstall\<GUID> 在本机都真实存在）——
; 所以 customInit 的读数能与真机对照，而不是对着一个假的键名自说自话。
!define APP_GUID "3437b4c4-5fc0-5612-8fed-0aba488ce0e5"
!define INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"

!addplugindir "C:\Users\poem\AppData\Local\electron-builder\Cache\nsis\nsis-resources-3.4.1\plugins\x86-unicode"
!include "E:\AIWork\1003开源摸鱼阅读软件\node_modules\app-builder-lib\templates\nsis\include\StdUtils.nsh"
