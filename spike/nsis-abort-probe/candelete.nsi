; 量一个探针：**不删任何东西**，只问「这个文件能不能被删掉」。
;
; 为什么要它：installer.nsh 现在只能在旧卸载器**已经动过手之后**才发现「有文件被占着」，
; 那时旧版已经缺了一块。要在动手之前就确定地判断，就得有一个只读的问法：
; CreateFileW(path, DELETE, dwShareMode=0, OPEN_EXISTING) —— 请求 DELETE 访问，
; 要求现有句柄都允许删除共享（这正是 DeleteFile 的前提），而它本身**不删**任何东西，
; 关掉句柄即可。顺带用 GetLastError 区分「有人在用」(32 SHARING_VIOLATION) 与
; 「权限/别的毛病」(5 之类)：只有前者才值得拦下升级并让用户重启。
;
; 要量的四件事：
;   a) 没被占的文件        —— 期望「能删」
;   b) 被独占句柄按住的文件 —— 期望「不能删 + 错误 32」（lockhold.py 制造）
;   c) 正在运行的 exe 的镜像 —— Windows 对镜像允许 share_delete，期望仍是「能删」，
;      即「只是开着」不该触发拦截（安装程序此前已经杀过进程，这一条是反向对照）
;   d) 不存在的文件        —— 期望「不能删 + 错误 2」，写法上不误判
;   e) 顺便量：返回类型写 i（32 位）与 p（指针）时，INVALID_HANDLE_VALUE 各是什么模样，
;      NSIS 里到底该写 `$R1 == -1` 还是别的。这是必须先量后写的那种事。
;
; 用法（b 那条要一边按住一边跑）：
;   python lockhold.py "$TEMP\zt-cd\held.bin" 20 0 &
;   ./candelete.exe
;   cat "$TEMP\zt-candelete.txt"

Unicode true
OutFile "candelete.exe"
RequestExecutionLevel user
SilentInstall silent

!include "LogicLib.nsh"

!define FIXDIR "$TEMP\zt-cd"
!define SPEC_ASAR "C:\Users\poem\Desktop\zhituan\resources\app.asar"
!define SPEC_RUNEXE "E:\AIWork\1003开源摸鱼阅读软件\node_modules\electron\dist\electron.exe"

Var /GLOBAL out

; 用 i（32 位）拿返回值
Function AskI
  ; $0 = 待问的路径；回来 $1 = 1 能删 / 0 不能，$2 = GetLastError
  System::Call 'kernel32::CreateFileW(w r0, i 0x10000, i 0, p 0, i 3, i 0x80, p 0) i .r1'
  StrCmp $1 -1 0 askI_ok
    System::Call 'kernel32::GetLastError() i .r2'
    StrCpy $1 0
    Return
  askI_ok:
    StrCpy $2 0
    System::Call 'kernel32::CloseHandle(i r1) i .r3'
    StrCpy $1 1
FunctionEnd

; 用 p（指针）拿返回值
Function AskP
  System::Call 'kernel32::CreateFileW(w r0, i 0x10000, i 0, p 0, i 3, i 0x80, p 0) p .r1'
  StrCmp $1 -1 0 askP_ok
    System::Call 'kernel32::GetLastError() i .r2'
    StrCpy $1 0
    Return
  askP_ok:
    StrCpy $2 0
    System::Call 'kernel32::CloseHandle(p r1) i .r3'
    StrCpy $1 1
FunctionEnd

Section "probe"
  FileOpen $out "$TEMP\zt-candelete.txt" w

  ; a) 没被占的文件
  CreateDirectory "${FIXDIR}"
  FileOpen $9 "${FIXDIR}\free.bin" w
  FileWrite $9 "x"
  FileClose $9
  StrCpy $0 "${FIXDIR}\free.bin"
  Call AskI
  FileWrite $out "a) 没被占 free.bin        : 能删=<$1> err=<$2>$\r$\n"

  ; b) 被独占句柄按住的文件（由 lockhold.py 从外面按住）
  StrCpy $0 "${FIXDIR}\held.bin"
  Call AskI
  FileWrite $out "b) 被独占的 held.bin      : 能删=<$1> err=<$2>$\r$\n"

  ; c) 正在运行的 exe 的镜像（只读地问，不碰它）
  StrCpy $0 "${SPEC_RUNEXE}"
  Call AskI
  FileWrite $out "c) 在跑的 electron.exe    : 能删=<$1> err=<$2>$\r$\n"

  ; c2) 真机上那份 app.asar（被那个卡住的进程攥着的那个）
  StrCpy $0 "${SPEC_ASAR}"
  Call AskI
  FileWrite $out "c2) 桌面版的 app.asar     : 能删=<$1> err=<$2>$\r$\n"

  ; d) 不存在的文件
  StrCpy $0 "${FIXDIR}\nosuch.bin"
  Call AskI
  FileWrite $out "d) 不存在的 nosuch.bin    : 能删=<$1> err=<$2>$\r$\n"

  ; e) 两种返回类型下 INVALID_HANDLE_VALUE 的模样（内联调用，结果直接写 $1）
  System::Call 'kernel32::CreateFileW(w "${FIXDIR}\nosuch.bin", i 0x10000, i 0, p 0, i 3, i 0x80, p 0) i .r1'
  FileWrite $out "e) 返回写 i、文件不存在时 = <$1>$\r$\n"
  System::Call 'kernel32::CreateFileW(w "${FIXDIR}\nosuch.bin", i 0x10000, i 0, p 0, i 3, i 0x80, p 0) p .r1'
  FileWrite $out "e) 返回写 p、文件不存在时 = <$1>$\r$\n"
  System::Call 'kernel32::CreateFileW(w "${FIXDIR}\free.bin", i 0x10000, i 0, p 0, i 3, i 0x80, p 0) i .r1'
  FileWrite $out "e) 返回写 i、能打开时     = <$1>$\r$\n"

  ; 指针型那一路也走一遍：既量出能打开时的模样，也顺带证明它可用
  StrCpy $0 "${FIXDIR}\free.bin"
  Call AskP
  FileWrite $out "e) AskP 能打开时          : 能删=<$1> err=<$2>$\r$\n"
  StrCpy $0 "${FIXDIR}\nosuch.bin"
  Call AskP
  FileWrite $out "e) AskP 不存在时          : 能删=<$1> err=<$2>$\r$\n"

  FileClose $out
SectionEnd
