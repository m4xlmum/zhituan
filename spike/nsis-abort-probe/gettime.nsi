; 只为确认 ${GetTime}（FileFunc.nsh）在 "L" 模式下把什么写进了 $0..$6。
;
; 为什么需要：build/installer.nsh 往 %TEMP%\zhituan-install.log 里记的每行只有一个
; 「28 09」——没有时刻。诊断「升级到底卡在哪一步」时，那几行谁先谁后全靠猜，
; 也跟墙钟对不上。要改成带时分秒，就得先知道 $4/$5/$6 是不是时分秒，而不是照
; 着一份记不准的文档去写：写错了要重新构建一遍才知道。
;
;   makensis -WX -INPUTCHARSET UTF8 gettime.nsi && ./gettime.exe
;   cat "$TEMP\zt-gettime.txt"

Unicode true
OutFile "gettime.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Section "probe"
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  FileOpen $9 "$TEMP\zt-gettime.txt" w
  FileWrite $9 "$0=<$0>$\r$\n"
  FileWrite $9 "$1=<$1>$\r$\n"
  FileWrite $9 "$2=<$2>$\r$\n"
  FileWrite $9 "$3=<$3>$\r$\n"
  FileWrite $9 "$4=<$4>$\r$\n"
  FileWrite $9 "$5=<$5>$\r$\n"
  FileWrite $9 "$6=<$6>$\r$\n"
  FileClose $9
SectionEnd
