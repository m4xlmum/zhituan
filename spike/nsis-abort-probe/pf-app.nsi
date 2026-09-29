; 探针用的「假应用」：被 ShellExecute 拉起来之后，在**自己所在的目录**留一张字条。
;
; 用途：证明 zt.Preflight（installer.nsh 第 1 层）在拦下升级之后真的把应用叫回来了
; —— 用户是从应用里点的更新，那一刻应用刚被 zt.KillApp 收掉，静悄悄退出的话他
; 看到的就是「应用关了、然后什么都没有」（1.6.6 之前那一版就是那样）。
;
; 字条写在 $EXEDIR 而不是固定路径：这样它同时证明了**拉起来的是那个目录里的那一份**，
; 而不是随便什么东西。
Unicode true
OutFile "pf-app.exe"
RequestExecutionLevel user
SilentInstall silent

Section
  FileOpen $9 "$EXEDIR\relaunched.txt" w
  FileWrite $9 "我是 pf-app.exe：被 ShellExecute 从 $EXEDIR 拉起来了。$\r$\n"
  FileWrite $9 "（这张字条出现在这里 = zt.Preflight 拦下升级之后确实把应用叫了回来：$EXEFILE）$\r$\n"
  FileClose $9
SectionEnd
