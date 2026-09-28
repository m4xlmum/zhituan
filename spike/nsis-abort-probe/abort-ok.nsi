; 对照组：同一个脚本，去掉 Abort。用来确认"退出码 2"确实来自 Abort，
; 而不是别的什么（比如 Abort 之外 NSIS 自身就会返回 2）。

Unicode true
Name "abort-ok"
OutFile "abort-ok.exe"
InstallDir "$TEMP\zhituan-abort-probe-ok"
RequestExecutionLevel user
SilentInstall silent

Section
  SetOutPath $INSTDIR
  DetailPrint "nothing to see here"
SectionEnd
