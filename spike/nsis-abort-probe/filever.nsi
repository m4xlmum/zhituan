; 量两件事，都是为了写 build/installer.nsh 里那句「装完之后核对」。
;
;   1) ${GetFileVersion}（FileFunc.nsh）读 PE 版本资源，返回的字符串是什么格式——
;      是 "1.6.6" 还是 "1.6.6.0"？安装程序里能拿来比的是 ${VERSION}
;      （electron-builder 从 package.json 传进来的，只有三段 "1.6.8"），格式对不上
;      就没法用等号比，所以必须先量清楚，而不是照着文档猜。
;   2) 本机装着的那个 zhituan.exe 是哪个版本。注册表说 1.6.7，而它的时间戳是 11:59
;      （1.6.6 打包的时刻）——若版本资源也读出 1.6.6，那「升级从来没换掉主程序、
;      用户看到的只是旧版重启」这个诊断就多了一条独立证据。
;
;   makensis -WX -INPUTCHARSET UTF8 filever.nsi && ./filever.exe
;   cat "$TEMP\zt-filever.txt"

Unicode true
OutFile "filever.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Section "probe"
  FileOpen $9 "$TEMP\zt-filever.txt" w
  FileWrite $9 "--- \${GetFileVersion} 的返回格式 ---$\r$\n"

  ${GetFileVersion} "C:\Users\poem\Desktop\zhituan\zhituan.exe" $1
  FileWrite $9 "装着的那份（注册表说 1.6.7）  = <$1>$\r$\n"

  ${GetFileVersion} "E:\AIWork\1003开源摸鱼阅读软件\release\1.6.6\zhituan.exe" $1
  FileWrite $9 "release\1.6.6\zhituan.exe（参照） = <$1>$\r$\n"

  ${GetFileVersion} "C:\Users\poem\Desktop\zhituan\Uninstall zhituan.exe" $1
  FileWrite $9 "卸载器 Uninstall zhituan.exe       = <$1>$\r$\n"

  FileWrite $9 "$\r$\n--- 不存在的文件会返回什么（要能在核对时认出来）---$\r$\n"
  ${GetFileVersion} "C:\Users\poem\Desktop\zhituan\nosuch.exe" $1
  FileWrite $9 "不存在的 exe = <$1>$\r$\n"

  FileWrite $9 "$\r$\n--- \${GetSize} 的返回（默认单位）---$\r$\n"
  ${GetSize} "C:\Users\poem\Desktop\zhituan\resources\app.asar" "" $2 $3 $4
  FileWrite $9 "桌面版 app.asar：$2 / $3 / $4$\r$\n"
  ${GetSize} "C:\Users\poem\Desktop\zhituan\resources\app.asar" "B" $2 $3 $4
  FileWrite $9 "桌面版 app.asar（选项 B）：$2 / $3 / $4$\r$\n"

  ; ${GetTime} 读**文件**：$0..$6 是什么？zt.Log 里已经量过「当前时间」是
  ; $1=年 $0=月 $2=日 $4=时 $5=分 $6=秒（那一行写的是 $2-$0-$1 $4:$5:$6），
  ; 这里量的是「传一个文件路径进去」时同一组变量是不是那个文件的修改时间——
  ; 装完之后的核对要靠它比对 app.asar 有没有被换掉。
  FileWrite $9 "$\r$\n--- \${GetTime} 读文件（桌面版 app.asar 的 mtime 是 11:59）---$\r$\n"
  ${GetTime} "C:\Users\poem\Desktop\zhituan\resources\app.asar" "L" $2 $3 $4 $5 $6 $7 $8
  FileWrite $9 "L: 2=<$2> 3=<$3> 4=<$4> 5=<$5> 6=<$6> 7=<$7> 8=<$8>$\r$\n"
  ${GetTime} "C:\Users\poem\Desktop\zhituan\resources\app.asar" "U" $2 $3 $4 $5 $6 $7 $8
  FileWrite $9 "U: 2=<$2> 3=<$3> 4=<$4> 5=<$5> 6=<$6> 7=<$7> 8=<$8>$\r$\n"
  ${GetTime} "C:\Users\poem\Desktop\zhituan\resources\app.asar" "LAC" $2 $3 $4 $5 $6 $7 $8
  FileWrite $9 "LAC: 2=<$2> 3=<$3> 4=<$4> 5=<$5> 6=<$6> 7=<$7> 8=<$8>$\r$\n"
  ${GetTime} "C:\Users\poem\Desktop\zhituan\nosuch.bin" "L" $2 $3 $4 $5 $6 $7 $8
  FileWrite $9 "L 不存在: 2=<$2> 3=<$3> 4=<$4> 5=<$5> 6=<$6> 7=<$7> 8=<$8>$\r$\n"

  FileWrite $9 "$\r$\n--- \${GetSize} 再试几种写法 ---$\r$\n"
  ${GetSize} "C:\Users\poem\Desktop\zhituan\resources\app.asar" "/S=0" $2 $3 $4
  FileWrite $9 "/S=0：$2 / $3 / $4$\r$\n"
  FileClose $9
SectionEnd
