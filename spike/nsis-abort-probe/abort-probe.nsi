; 验证一条推断：NSIS 脚本里 Abort 之后，进程退出码是不是 2。
;
; 背景：electron-builder 生成的卸载器，在"升级"路径上会把 $INSTDIR 里每个文件
; 搬进 $PLUGINSDIR\old-install；只要有一个文件搬不动（被占用），就
;     Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
; 而装机端 handleUninstallResult 看到非零退出码，就弹
;     "Failed to uninstall old application files. Please try running the installer again.: <码>"
; 报错里那个数字是不是 2、来源是不是这里的 Abort，这个脚本给出答案。
;
; 编译：  <nsis>/Bin/makensis.exe abort-probe.nsi
; 运行：  abort-probe.exe /S   ; 然后看 %ERRORLEVEL%
;         abort-probe-ok.exe /S ; 对照组，正常结束

Unicode true
Name "abort-probe"
OutFile "abort-probe.exe"
InstallDir "$TEMP\zhituan-abort-probe"
RequestExecutionLevel user
SilentInstall silent

Section
  SetOutPath $INSTDIR
  Abort "boom"
SectionEnd
