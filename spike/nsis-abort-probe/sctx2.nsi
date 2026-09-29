; 只为量一件事：SHELL_CONTEXT 到底是不是「注册表根键别名」（不是宏）。
;   !ifdef SHELL_CONTEXT → 未定义；而 ReadRegStr ... SHELL_CONTEXT ... 能过 -WX
;   ⇒ 它是 NSIS 的根键 token。运行时它指向 SetShellVarContext 定的那个 hive，
;   默认 current（= HKCU）。build/installer.nsh 的 customInit 要靠它读旧版的
;   卸载登记项，所以必须在真机上确认一次它读到的是 HKCU 而不是空。
; 输出写到项目目录里（%TEMP% 下的 exe 在这台机器上不让执行）。
Unicode true
OutFile "sctx2.exe"
RequestExecutionLevel user
SilentInstall silent
Section
  ReadRegStr $0 SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\Uninstall\3437b4c4-5fc0-5612-8fed-0aba488ce0e5" "DisplayVersion"
  ReadRegStr $1 HKEY_CURRENT_USER "Software\Microsoft\Windows\CurrentVersion\Uninstall\3437b4c4-5fc0-5612-8fed-0aba488ce0e5" "DisplayVersion"
  FileOpen $9 "sctx2.txt" w
  FileWrite $9 "SHELL_CONTEXT=<$0>$\r$\nHKEY_CURRENT_USER=<$1>$\r$\n"
  FileClose $9
SectionEnd
