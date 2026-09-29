; ============================================================================
; 纸团 —— 安装器 / 卸载器 扩展钩子
;
; 由 electron-builder.yml 的 nsis.include 引入（默认路径就是 build/installer.nsh，
; 这里显式写出来，免得以后有人改了 buildResources 就悄悄失效）。electron-builder
; 把它 !include 在生成脚本的最前面，而且**安装器与卸载器两次编译都会带上**，
; 所以每个宏都带了守卫。
;
; ----------------------------------------------------------------------------
; 这个文件存在的唯一理由：修掉
;     Failed to uninstall old application files. Please try running the
;     installer again.: 2
;
; 「: 2」是旧卸载器的退出码。链路是这样的：
;
;   新版安装器（installSection.nsh:52）
;     → uninstallOldVersion 把旧卸载器拷到 $PLUGINSDIR，用 /S 跑一遍
;       → 旧卸载器的 un.atomicRMDir 必须把 $INSTDIR 里**每一个**文件改名
;         挪进 $PLUGINSDIR\old-install；只要有一个改不动就
;         Abort `Can't rename ...`（uninstaller.nsh:179），进程以 2 退出
;     → 新版安装器的 handleUninstallResult 看到 $R0 != 0，
;        弹框 "$(uninstallFailed): 2"、SetErrorLevel 2、Quit
;
; 为什么改名会失败：本机的安装目录是 C:\Users\poem\Desktop\zhituan ——
; 一个被反复扫描的目录。百度网盘同步空间、Defender 的实时防护、资源管理器的
; 缩略图/索引器都会短时间持有 app.asar、*.dll、*.pak 的句柄，而改名要求
; 目录项独占，于是随机失败。这也解释了为什么「手动、晚一点、再跑一次」
; 有时候能成。
;
; 对策分四层，互相兜底：
;   0) customInit             .onInit 里、旧卸载器动手之前，先把「本次是升级、
;                             上一版装在哪个目录」记下来。**这个判断只能在这里做**：
;                             旧卸载器跑完会删掉卸载登记项（uninstaller.nsh 结尾的
;                             DeleteRegKey），等第 2 层再读就什么都没有了。
;   1) customCheckAppRunning  旧卸载器动手之前，先把还在跑的纸团收干净，
;                             并留出时间让句柄落定；**然后问一句「这一版的文件
;                             删得掉吗」**，删不掉就一个字节都不动、如实报错停下。
;                             原生逻辑只按 $INSTDIR 前缀匹配找进程、静默分支给的
;                             等待也太短，而且它没有「先问再动手」这一步。
;   2) customUnInstallCheck   万一旧卸载器还是失败了，**不让升级中断**：把残留
;                             清掉，然后照常继续覆盖安装。旧卸载器的行为我们改
;                             不了，能改的是「它失败之后怎么办」。
;   3) customRemoveFiles      我们自己这一版的卸载器不再走会 Abort 的改名搬移，
;                             改成「先收进程、再带重试地直接删」，删不净时照旧
;                             报 2（但**安装器不能指望这个 2**，见那个宏）。
;
; ----------------------------------------------------------------------------
; 这条链路上最花钱的一课，写在最显眼的地方：**旧卸载器的退出码不可信**。
;
; 这个文件原先的第 2 层是拿 `$R0 != 0`（旧卸载器的退出码）当门闸的，而那扇门
; 从来没开过：真机上连着三次升级，安装日志里都是「旧卸载器退出码 0」，尽管
; $INSTDIR 里明明白白留着上一版的主程序与 app.asar。也就是说，那一层「万一失败
; 就清场」的兜底从来没跑过，用户拿到的一直是「注册表写着新版本、主程序还是旧版」
; 的混合安装——这正是「点了更新并重启，只会重启、并没有成功更新」。
;
; 那为什么退出码会是 0？本机上量不出一个能解释它的机制：把真实脚本编成探针
; （spike/nsis-abort-probe/hook-remove.nsi）之后，没被占的目录报 0、被独占句柄
; 按住 resources\app.asar 的目录报 2，通道本身是通的；而升级路径上那个
; quitSuccess（common.nsh:79-82，注释写着 "avoid exit code 2"）也不适用——
; electron-builder.yml 里 oneClick: false，ONE_CLICK 没有定义，那段代码根本
; 不在我们的路径上。**不去猜它了**：改用文件系统自己说话——「这一版的文件还能
; 不能删/能不能换」，是唯一一个既不需要信任子进程、又能提前问出口的判据。
;
; 于是第 0 层记「是不是升级」，第 1 层先探问、再决定要不要动手，第 2 层的门闸
; 也换成同一个判断。退出码只记进日志，不参与任何决定。
;
; 顺带把一条语言事实记在这儿，免得下一个人（或下一版的我）再踩：
; LogicLib 的 `==` 是**字符串**比较（展开成 StrCmp），`=` 才是数值比较（IntCmp）。
; 本文件里 `$ztUpgrading == "1"`、`$ztRc == "0"` 这类写法都是字符串比较——
; 也正因如此，`$ztHeld != ""`（判一段可能是路径的文本空不空）才是安全的；
; 写成 `= 0` 反而会把任何非数字文本都读成 0。
;
; 顺带记一份日志到 %TEMP%\zhituan-install.log：静默安装没有界面，
; 出了问题只能靠它说话。
; ============================================================================

!include "FileFunc.nsh"

!ifndef ZT_INSTALLER_GUARD
!define ZT_INSTALLER_GUARD

Var /GLOBAL ztTries     ; 重试计数
Var /GLOBAL ztRc        ; 子进程退出码
Var /GLOBAL ztKillText  ; taskkill 自己吐的那几行（多行文本）

; 下面这四个只有**安装器那一趟**用得到，所以只在没有 BUILD_UNINSTALLER 时声明。
; 不是洁癖：构建带 -WX（警告即错误），而 NSIS 的 6001「声明了没用到」正好咬这种
; 变量——真机上量过，卸载器那一趟会报
;     Warning 6001: Variable "ztUpgrading" not referenced or never set
; 然后整个构建以它失败。探针 spike/nsis-abort-probe/hook-compile-un.nsi 就是为
; 提前撞上这件事而存在的（它第一次跑就把这条抓出来了）。
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL ztUpgrading ; "1" = 本次是升级（注册表里有一个能自卸载的旧版）
  Var /GLOBAL ztOldDir    ; 旧版装在哪个目录（由它的 UninstallString 推出来）
  Var /GLOBAL ztUpVer     ; 旧版登记的版本号，只进日志
  Var /GLOBAL ztHeld      ; 探问结果：删不掉的文件清单（空 = 都删得掉）
!endif

; 让日志宏能内联写成 ${zt.Log} "..."（和 electron-builder 自己用的手法一致）
!define zt.Log `!insertmacro zt.LogMacro`

; 弹框也留一个可替换的口子。理由只有一个：**探针要能无头地跑到底**。
; 下面那个报错框故意不带 /SD（静默升级时它也必须弹出来，那正是这一层存在的
; 意思），于是在探针里它会停在一个没有人能点的模态框上，一直到超时。
; 探针在 !include 本文件之前把 zt.Alert 定义成自己的宏（写文件），就能跑完整条
; 路径并核对「停下来之前有没有动过用户的东西」。
!ifndef zt.Alert
  !define zt.Alert `MessageBox MB_OK|MB_ICONEXCLAMATION`
!endif

; ---------------------------------------------------------------------------
; zt.LogMacro —— 往 %TEMP%\zhituan-install.log 追加一行
;
; 时间用 ${GetTime}（FileFunc.nsh）取本地时间。**时分秒不能省**：这份日志是
; 静默安装唯一的输出，而「升级卡在哪一步」全靠它几行的先后；只记「日 月」的话，
; 拿它和墙钟、和目录里的文件时间戳对不上，诊断过一次就知道了（那一次最后是靠
; ${GetTime} 自己的探针 `spike/nsis-abort-probe/gettime.nsi` 才把变量落位钉准的）。
;
; ${GetTime} 按参数顺序落位：日 月 年 星期 时 分 秒。这里传的是 `$1 $0 $2 $3 $4 $5 $6`，
; 于是 $1=日、$0=月、$2=年、$4=时、$5=分、$6=秒，写成 `$2-$0-$1 $4:$5:$6` 正好是
; 2026-09-28 15:03:23——可排序，也能跟墙钟直接对。
;
; 它内部会用寄存器做临时指针，所以把 $0/$1/$2/$9 连同 $R0/$R1/$R2 一起压栈保护
; —— 调用点常常正拿着 $R0 里的卸载器退出码，而**日志消息里会引用它**
; （`${zt.Log} "旧卸载器退出码 $R0"`：$R0 是在 FileWrite 那一刻才展开的），
; 所以那几个 $R 一个都不能拿来存时间。写日志失败（%TEMP% 不可写之类）就安静
; 略过，绝不因为记日志把安装搞挂。
;
; **消息里能引用的只有 $R0/$R1/$R2 和具名全局变量，不能引用 $0/$1/$2/$9。**
; 压栈护住的是**调用点**的那几个变量，而本宏自己在 FileWrite 之前就用
; ${GetTime} 把 $1/$0/$2 写成了年月日（`${GetTime} "" "L" $1 $0 $2 ...`）：
; 消息里写 `$0` 打出来会是月份，不是你以为的那个值。要记一段临时文本（比如
; taskkill 吐的那几行）就先存进具名全局变量（ztKillText 就是这么来的）。
; ---------------------------------------------------------------------------
!macro zt.LogMacro MSG
  Push $0
  Push $1
  Push $2
  Push $9
  Push $R0
  Push $R1
  Push $R2
  ClearErrors
  ${GetTime} "" "L" $1 $0 $2 $3 $4 $5 $6
  FileOpen $9 "$TEMP\zhituan-install.log" a
  ${IfNot} ${Errors}
    FileSeek $9 0 END
    FileWrite $9 "$2-$0-$1 $4:$5:$6  ${MSG}$\r$\n"
    FileClose $9
  ${EndIf}
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $9
  Pop $2
  Pop $1
  Pop $0
!macroend

; ---------------------------------------------------------------------------
; zt.KillApp —— 强制收掉纸团（连同 Electron 的子进程），并等句柄落定
;
;   TAG  只用来给标签起名。NSIS 的标签作用域是「所在的函数/节」，而本宏会被
;        插进几个不同的函数/节里，所以每处插入都得换一个 TAG，否则标签重名。
;
; 判据是 taskkill 的退出码：128 = 本来就没有这个进程。收不干净就重试，
; 最多 24 次 × 0.5s = 12s —— 与原生逻辑「杀一次就往下走」不同，这里重点
; 不是发出杀伤指令，而是**确认它真的没了**。收尾再 Sleep 1.5s：进程退出
; 不等于内核里的文件对象立刻释放，尤其目录在桌面上、有同步盘正在读的时候。
;
; 收不掉也不 Abort：说明进程属于别的用户或权限更高，那交给第 2 层兜底，
; 同时留一条日志把原因写清楚。
;
; ---------------------------------------------------------------------------
; **这里绝不能带 /T。** 这一条是 1.6.6 修掉的那个「点了更新并重启，应用关了、
; 然后什么都没有」，值得写全，免得以后有人觉得「顺手带上 /T 更干净」。
;
; 现象：用户从应用里点更新，安装程序起来了（它的日志写了「安装前检测到纸团在
; 运行」），然后**就没有下文**——旧卸载器没跑、文件一个字节没换、`--force-run`
; 也到不了，应用被关了、没有人把它叫回来。
;
; 根因：应用是这样起安装程序的（src/main/services/updateService.ts 的
; spawnInstaller）：
;
;     spawn(安装包, ['/S','--updated','--force-run'], { detached: true, stdio: 'ignore' })
;
; `detached` 在 Windows 上只是 DETACHED_PROCESS 加一个新进程组——**父进程链
; 原封不动**，安装程序仍然是那个 `zhituan.exe` 的子进程。而 `taskkill /T` 的
; 语义是「连同**子进程树**一起结束」：这一句本意是收掉纸团（主进程 + 它的
; renderer/GPU 子进程），实际连**安装程序自己也在这棵树里**，于是它把自己
; 收走了。它死在发出杀伤指令的那一刻，所以再也没有下一行日志。
;
; 为什么 1.6.4 之前一直没露头：只在**应用自己在跑**的时候才会走到 zt.KillApp
; （应用没在跑时上面那句 taskkill 返回 128，StrCmp 已经跳到 done 了）。而
; 「应用自己在跑」恰好**只有应用内更新这一条路**——手动双击安装包时应用通常
; 已经关了，`customCheckAppRunning` 根本不会走到这儿。所以这条 bug 就专门
; 藏在「应用内更新」上，一次都没被手动安装碰到过。
;
; 为什么去掉 /T 不掉杀伤力：Electron 的子进程**全部**同名。主进程、renderer、
; GPU、utility 都是 `zhituan.exe`（带 --type=... 参数而已），`/IM` 按镜像名
; 匹配，一枚不带 /T 的 taskkill 照样把它们全收掉。这一点在真机上可以直接看：
; `tasklist` 里那十个 zhituan.exe 的镜像名一模一样。所以 /T 在这里本来就
; 是多余的，多余出来的那部分正好是把发起者自己也算进去。
;
; 为什么不顺手加一道 `/FI "PID ne $ztSelf"` 把自己排除掉（上游
; KILL_PROCESS 就是这么写的）：**实测这枚过滤器会毁掉 128**。本机量的读数
; （同一台机器、同一个 taskkill）：
;
;     进程在跑，不带 /FI      → 0
;     进程早没了，不带 /FI    → 128      ← 下面那个循环靠的就是这一枚
;     进程早没了，带 /FI      → 0        ← 信号没了
;
; 于是「已经收干净了」被读成「又杀了一个」，循环会白跑满 24 轮（约 26 秒）。
; 而这个宏在一轮升级里要被调三次（customCheckAppRunning 的 chk、
; customUnInstallCheck 的 unc1 / unc2），白等将近 80 秒。所以不加。
;
; 不加也安全：本项目的安装包镜像名恒为 `zhituan-<版本>-<架构>.exe`
; （electron-builder.yml 的 artifactName），而 APP_EXECUTABLE_FILENAME 是
; `zhituan.exe`——**撞不上**，所以这个宏天生杀不到自己。真正让它自杀的从来
; 不是撞名，是下面那个 /T。哪天要是把 artifactName 改成 zhituan.exe，那得
; 换一种自我排除的办法（不能是 /FI），这里会先炸出来。
;
; 探针：spike/nsis-abort-probe/kill-self.nsi —— 把「应用 → detached 子进程」
; 这个拓扑原样搭出来，跑的就是下面这个宏。改前：探针在宏里消失（没有 B 行、
; 进程表里也没了）；改后：探针活到写出 B 行，而假应用照旧被杀掉。
; ---------------------------------------------------------------------------
!macro zt.KillApp TAG
  StrCpy $ztTries 0
  zt_kill_${TAG}:
    IntOp $ztTries $ztTries + 1
    nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $ztRc
    ; taskkill 的原话（多行）。存进具名全局而不是 $0：$0 会被 zt.LogMacro 自己
    ; 的 ${GetTime} 覆盖成月份（见那个宏的说明）。它是**最后一次**那一轮的输出，
    ; 也正是最该看的那一轮。
    Pop $ztKillText
    StrCmp $ztRc "128" zt_kill_done_${TAG}          ; 已经没有这个进程了
    ${If} $ztRc == "0"
      ${zt.Log} "[${TAG}] 已强制结束，再确认一次（第 $ztTries 次）"
    ${Else}
      ${zt.Log} "[${TAG}] 收不掉（taskkill 返回 $ztRc），第 $ztTries 次重试"
    ${EndIf}
    Sleep 500
    IntCmp $ztTries 24 zt_kill_done_${TAG} zt_kill_${TAG} zt_kill_done_${TAG}
  zt_kill_done_${TAG}:
    ${If} $ztRc != "0"
    ${AndIf} $ztRc != "128"
      ${zt.Log} "[${TAG}] 没能收掉纸团（返回 $ztRc），改为继续安装"
      ; 把 taskkill 的原话一起记下来：它带着 Windows 给的原因（「拒绝访问」、
      ; 「该进程正在终止」之类），是这件事下次再发生时最有用的那一行。
      ; 它是多行的，接着上一行往下写；读到 "[TAG] taskkill 的原话" 就知道
      ; 后面这几行都是它的输出，不是新事件。
      ${zt.Log} "[${TAG}] taskkill 的原话：$\r$\n$ztKillText"
    ${EndIf}
    Sleep 1500
!macroend

; ---------------------------------------------------------------------------
; zt.RmDirRetry —— 带重试地删掉一棵目录树
;
; 删完用 FileExists "$DIR\*.*" 复核；还有东西剩下（被占用）就等一秒再来，
; 最多 TRIES 次。宁可少删也绝不 Abort：这一步的语义是「尽力清场」，
; 紧接着就会把新版本覆盖上去，剩下的零碎文件不影响运行。
; ---------------------------------------------------------------------------
!macro zt.RmDirRetry TAG DIR TRIES
  StrCpy $ztTries 0
  zt_rm_${TAG}:
    IntOp $ztTries $ztTries + 1
    RMDir /r "${DIR}"
    ${IfNot} ${FileExists} "${DIR}\*.*"
      Goto zt_rm_done_${TAG}
    ${EndIf}
    ${zt.Log} "[${TAG}] ${DIR} 尚未删净，第 $ztTries 次重试"
    Sleep 1000
    IntCmp $ztTries ${TRIES} zt_rm_done_${TAG} zt_rm_${TAG} zt_rm_done_${TAG}
  zt_rm_done_${TAG}:
!macroend

; 下面两个宏只服务第 1 层，而第 1 层只在安装器那一趟存在（理由写在
; customCheckAppRunning 的说明里：卸载器那一趟里 $ztUpgrading 恒空）。定义也一并
; 圈进同一个守卫：卸载器那一趟要是有人误插它们，会当场报「宏不存在」而不是
; 悄悄引用了四个没声明的变量。
!ifndef BUILD_UNINSTALLER

; ---------------------------------------------------------------------------
; zt.AskDeletable —— 只问不删：「这个文件现在删得掉吗」
;
; 判据是一个不太起眼的事实：CreateFileW(path, DELETE, dwShareMode=0, …)
; **一个字节都不会删**，它只是申请 DELETE 权限、并要求现有句柄都允许删除共享
; ——而这正是 DeleteFile 与改名搬移的前提（share_delete 不给，改名就注定失败）。
; 所以它是一次非破坏性的试问：拿得到句柄 = 等一下删得掉，拿不到 = 有东西攥着它。
; 拿到之后立刻 CloseHandle，别把句柄留到自己手里。
;
; 返回类型写 i（32 位）：真机上量过（spike/nsis-abort-probe/candelete.nsi），
; 失败时它给的是 -1（INVALID_HANDLE_VALUE），能比对。**别去读 GetLastError**：
; 那几条读数在 System::Call 里全被插件残留带成 80，区分不了「被占用」与「权限
; 不够」——而这个宏本来也不需要区分，它只回答能不能删。
;
; 按得住的东西追加进 $ztHeld（具名全局，见 zt.Preflight），一行一个。
; ---------------------------------------------------------------------------
!macro zt.AskDeletable PATH
  StrCpy $0 "${PATH}"
  System::Call 'kernel32::CreateFileW(w r0, i 0x10000, i 0, p 0, i 3, i 0x80, p 0) i .r1'
  ${If} $1 == "-1"
    StrCpy $ztHeld "$ztHeld${PATH}$\r$\n"
  ${Else}
    System::Call 'kernel32::CloseHandle(i r1) i .r2'
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; zt.Preflight —— 动手之前先探问一遍，删不掉就一个字节都不动
;
; 为什么非要抢在动手之前问：旧卸载器一开跑就把文件改名搬进 $PLUGINSDIR 再删，
; 改不动就 Abort——而**已经搬走的那一半随它一起消失**（$PLUGINSDIR 是临时目录）。
; 也就是说，等发现「有文件被占用」的时候，用户的安装已经缺了一块。这正是
; 「点了更新并重启，只会重启、并没有成功更新」的来源：旧卸载器报 0（它自己不
; 觉得失败）、安装器照常往下铺新文件、被占住的那个没人管。
; 探问放在旧卸载器动手之前，代价是一次 CreateFileW，换来的是「拦下来的时候
; 用户的东西一个字节都没动」。
;
; 拦下之后要做三件事，缺一不可：
;   · 如实说清楚（说清是哪个目录、可能是什么占着、该怎么办）；
;   · **把应用叫回来**——用户是从应用里点的更新，应用进程已经被 zt.KillApp 收掉
;     了，这时候静悄悄退出，用户看到的就是「应用关了、然后什么都没有」；
;   · SetErrorLevel 2 再 Quit：失败要有失败的退出码，调用方和批处理看得到。
;
; 探问只覆盖「升级路径上真正被改名搬移、也真正最容易被占住」的那两个文件：
; 主程序与 resources\app.asar（其余 dll/pak 释放得早，且被占住也能正常覆盖）。
; 两个都不在（全新安装）时 $ztHeld 是空的，照常往下走。
;
; 重新拉起应用用 StdUtils.ExecShellAsUser：装完后模板自己拉起应用走的也是它
; （common.nsh:131、assistedInstaller.nsh:57），语义是「以当前交互用户的身份、
; 走 shell 打开」。这里还没到那一步——$launchLink 要到 installSection.nsh 后半段
; 才赋值——所以直接给主程序的完整路径。
; ---------------------------------------------------------------------------
!macro zt.Preflight TAG
  Push $0
  Push $1
  Push $2
  StrCpy $ztHeld ""
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro zt.AskDeletable "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    !insertmacro zt.AskDeletable "$INSTDIR\resources\app.asar"
  ${EndIf}
  ${If} $ztHeld != ""
    ${zt.Log} "[${TAG}] 动手前的探问：这些文件删不掉，一个字节都不动就停下——$\r$\n$ztHeld"
    ${zt.Alert} "升级没能开始。$\r$\n$\r$\n$INSTDIR 里有文件正被别的程序占着——多半是上一次没退干净的纸团，也可能是网盘同步、杀毒软件的实时扫描。这次没有改动任何文件，你的纸团还是原来那个样子。$\r$\n$\r$\n请先重启电脑，等桌面彻底起来之后，再点一次「更新并重启」。"
    ; 这一句必须在 Quit 之前：应用是用户点更新的那个东西，得还给他。
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${zt.Log} "[${TAG}] 动手前的探问：要替换的文件都删得掉（或者本来就不在），照常往下走"
  Pop $2
  Pop $1
  Pop $0
!macroend

!endif ; BUILD_UNINSTALLER（zt.AskDeletable / zt.Preflight 只属于安装器那一趟）

; ---------------------------------------------------------------------------
; customInit —— 记下「本次是不是升级」「上一版装在哪儿」
;   （.onInit 里、initMultiUser 之后、旧卸载器动手之前跑）
;
; 为什么非要这么早：旧卸载器跑完会删掉自己的卸载登记项（uninstaller.nsh 结尾的
; DeleteRegKey），等第 2 层 customUnInstallCheck 再想读「上一版是谁、装在哪」，
; 就什么都没有了。而第 2 层的门闸恰恰需要这个判断。
;
; 判据是**卸载登记项在不在**（${UNINSTALL_REGISTRY_KEY} 的 UninstallString）：
; 有，说明这台机器上有个能自己卸载的旧版，本次是升级；没有就是全新安装。
; 全新安装时用户完全可能挑一个已存在、装着别的东西的目录——那种目录一个字节
; 都不能动，所以第 2 层必须能把全新安装整个排除在外，靠的就是 $ztUpgrading。
;
; SHELL_CONTEXT 是 NSIS 的**根键别名**，不是宏（`!ifdef SHELL_CONTEXT` 是假；
; 真机上试过：把它当根键读，读得到 HKCU 里的值，见 spike/nsis-abort-probe/sctx2.nsi）。
; 运行时它等于当前 shell 变量上下文，而 NSIS 的默认上下文就是 current，本项目
; 又是 per-user 构建（electron-builder.yml: perMachine: false）——所以它读到的
; 是 HKCU，和 electron-builder 自己写登记项时用的根键完全一致。后面那次
; HKEY_CURRENT_USER 只是兜底，读不到（比如以后改成 per-machine）也不影响：
; $ztUpgrading 自然是 "0"，第 1 层的探问跳过，行为退回改之前的样子。
;
; $ztOldDir 取 ${INSTALL_REGISTRY_KEY} 的 InstallLocation（electron-builder 在
; include/installer.nsh:104 写的，也正是它自己决定 $INSTDIR 时读的那个值，
; 见 multiUser.nsh:26），读不到就退回当时的 $INSTDIR。它和 $ztUpVer 都只进日志：
; 升级再出问题时，「注册表说上一版装在哪、是哪个版本」是最省事的两份现场证据。
; ---------------------------------------------------------------------------
!macro customInit
  StrCpy $ztUpgrading "0"
  StrCpy $ztOldDir "$INSTDIR"
  StrCpy $ztUpVer ""

  StrCpy $0 ""
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $0 == ""
    ClearErrors
    ReadRegStr $0 HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${EndIf}

  ${If} $0 != ""
    StrCpy $ztUpgrading "1"
    ReadRegStr $ztUpVer SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ReadRegStr $ztOldDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $ztOldDir == ""
      StrCpy $ztOldDir "$INSTDIR"
    ${EndIf}
    ${zt.Log} "本次是升级：上一版登记为 $ztUpVer，装在 $ztOldDir；本次要装的目录是 $INSTDIR"
  ${Else}
    ${zt.Log} "本次是全新安装（注册表里没有旧的卸载登记项）"
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; customCheckAppRunning —— 取代原生的「找进程 → 弹框 → 杀」那一整套
; （allowOnlyOneInstallerInstance.nsh 里由 CHECK_APP_RUNNING 调用）
;
; 原生那套有两个毛病：FIND_PROCESS/KILL_PROCESS 在 PowerShell 可用时是按
; 「路径前缀等于 $INSTDIR」筛的，容错很低；静默升级分支只 Sleep 1000 就动手。
; 这里改成按镜像名 taskkill，并且**确认收干净**。
;
; 交互式安装时保留一个询问框，和原生体验对齐；静默安装（也就是应用内
; 「更新并重启」走的那条路）不打搅用户，直接收 —— 那个进程本来就是要退的。
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
  ; 不带 /F 的 taskkill 只投递关闭请求，顺便当探测器用：
  ; 返回 128 说明本来就没在跑，那就什么都不用做。
  ; **这一句不能加 /FI**：加了之后「没在跑」就不再是 128 了（见 zt.KillApp
  ; 里那张读数表），这一跳会失效，于是应用明明没开着也会被记成「检测到在运行」。
  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $ztRc
  Pop $0
  StrCmp $ztRc "128" zt_chk_none

  ${zt.Log} "安装前检测到纸团在运行（taskkill 返回 $ztRc）"

  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "纸团 正在运行，继续安装前需要先关闭它。$\r$\n$\r$\n点「确定」现在关闭并继续。" \
      /SD IDOK IDOK zt_chk_confirmed
    ${zt.Log} "用户在提示框里选择了取消，安装中止"
    Quit
    zt_chk_confirmed:
  ${EndIf}

  !insertmacro zt.KillApp chk
  Goto zt_chk_done

  zt_chk_none:
    ${zt.Log} "安装前没有检测到纸团在运行"

  zt_chk_done:
    ; 第 1 层：探问「要替换的那两个文件删得掉吗」。抢在旧卸载器动手之前——
    ; 一旦开工，被占住的文件会连累搬走的那一半一起没掉（见 zt.Preflight）。
    ; $ztUpgrading 由 customInit 在 .onInit 里置好（全新安装恒为 "0"）。
    ;
    ; 为什么全新安装不问：这一层与第 2 层守的都是**旧卸载器**那一段的破坏性
    ; （它改名搬移，改不动就 Abort，搬走的一半随 $PLUGINSDIR 消失）。没有旧版时
    ; uninstallOldVersion 读完注册表就直接返回，$INSTDIR 一个字节都不动，没有
    ; 需要抢在谁前面拦的东西。于是「不是升级」时跳过，也让全新安装的路径与改
    ; 之前**完全一致**。
    ;
    ; 这一段整个**只在安装器那一趟编译里存在**。卸载器那一趟也会把本宏插进
    ; un.checkAppRunning（uninstaller.nsh 的 un.checkAppRunning 调它），但那一趟
    ; 里 customInit 不会跑（installer.nsi 把它放在 !ifndef BUILD_UNINSTALLER 那一支），
    ; 而且 $ztUpgrading/$ztHeld 与 zt.Preflight 本身也都圈在同一个守卫里——留着
    ; 引用只会换来一句 6001「声明了没用到」，而构建带 -WX，那种警告会把构建打掉。
    ; 探针 spike/nsis-abort-probe/hook-compile-un.nsi 就是为提前撞上这件事而存在的。
    !ifndef BUILD_UNINSTALLER
      ${If} $ztUpgrading == "1"
        !insertmacro zt.Preflight chk
      ${Else}
        ${zt.Log} "本次不是升级，跳过动手前的探问（没有旧卸载器要抢在它前面）"
      ${EndIf}
    !endif
!macroend

; ---------------------------------------------------------------------------
; customUnInstallCheck —— 旧卸载器失败之后的兜底：清场，然后**继续**安装
; （取代 installUtil.nsh 的 handleUninstallResult 里的
;   MessageBox + SetErrorLevel 2 + Quit，见该文件 108-134 行）
;
; **门闸是「本次是不是升级」（$ztUpgrading），不是旧卸载器的退出码。**
; 这个文件原先拿 `$R0 != 0` 当门闸，而那扇门从来没开过：真机上连着三次升级，
; 日志里都是「旧卸载器退出码 0」，尽管 $INSTDIR 里明明白白留着上一版的主程序
; 与 app.asar（见文件头）。于是这一层「万一失败就清场」的兜底一次都没跑过，
; 用户一直拿到「注册表写着新版本、主程序还是旧版」的混合安装。现在退出码只写
; 进日志，判断改靠 customInit 记下的那个事实。
;
; 为什么还要有这一层：第 1 层的探问与动手之间有窗口——探问时说删得掉，旧卸载器
; 开跑的那一刻有东西插进来（同步盘、杀软实时扫描），一样会失败。第 1 层拦不住
; 的，由这一层收拾。
;
; 为什么清不掉也**不再** Quit：此刻旧卸载器已经把文件搬走了一半（$PLUGINSDIR
; 里的那一半随它一起消失），Abort 会把用户留在「装了一半」上，比继续装更糟。
; 继续把新文件铺上去，剩下没换掉的那几个（多半正是 app.asar）由**应用自己**
; 如实报出来——应用比安装程序更能把这件事说清楚（它一边读得到注册表登记的
; 版本号，一边读得到自己的版本，见 README 的更新那一节）。所以这里不再挡第二次。
;
; 内层判据是**两处指纹任一**：主程序，或 resources\app.asar。不能只看主程序——
; RMDir /r 是尽力而为的，被占住的那个删不掉、其余的照删不误，所以一次失败的
; 清场之后留下的往往正是「app.asar 还在、主程序已经没了」这种形态，而它恰恰
; 是最需要被认出来的那一种。
;
; 末尾 ClearErrors：我们提前 Return 走了（handleUninstallResult 里紧跟一条
; Return），绕过了原生那句 IfErrors，得把错误标志清掉，免得影响后面的步骤。
; ---------------------------------------------------------------------------
!macro customUnInstallCheck
  ; $R0 里是旧卸载器的退出码。这一段会调下面几个宏，而它们都会写寄存器，
  ; 所以先把它压栈护住、收尾再放回去——只为不破坏 handleUninstallResult 的
  ; 上下文，本层已经不拿它做任何判断了。
  Push $R0
  ${zt.Log} "旧卸载器退出码 $R0（只作记录，不参与判断）"
  ${If} $ztUpgrading == "1"
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${OrIf} ${FileExists} "$INSTDIR\resources\app.asar"
      ${zt.Log} "旧卸载器没能清干净 $INSTDIR，改为强制清场后继续覆盖安装"
      !insertmacro zt.KillApp unc1
      !insertmacro zt.RmDirRetry unc1 "$INSTDIR" 12
      ; 还没清掉，说明有东西一直攥着：多半是同步盘或杀软在扫这个目录。
      ; 再收一次进程、再给一轮时间——真机上的占用大多是几百毫秒的事，
      ; 两轮一共二十多秒足够跨过去。
      ${If} ${FileExists} "$INSTDIR\*.*"
        ${zt.Log} "$INSTDIR 仍被占用，第二轮重试"
        !insertmacro zt.KillApp unc2
        !insertmacro zt.RmDirRetry unc2 "$INSTDIR" 12
      ${EndIf}
      ; 两轮之后还是清不净也不再挡：理由见上面那段注释。这一版之后由应用自己
      ; 把「文件没换掉」如实说出来，而不是让安装程序在这里留下一个装了一半的摊子。
      ${If} ${FileExists} "$INSTDIR\*.*"
        ${zt.Log} "清不掉 $INSTDIR（第 1 层没拦住、这里也没清掉），仍继续覆盖安装，剩下的交给应用自己报"
      ${Else}
        ${zt.Log} "$INSTDIR 已清空，继续覆盖安装"
      ${EndIf}
    ${Else}
      ${zt.Log} "$INSTDIR 下没有上一版的残留（主程序与 resources\app.asar 都不在），不动它，直接继续安装"
    ${EndIf}
  ${Else}
    ${zt.Log} "本次不是升级，不动 $INSTDIR，直接继续安装"
  ${EndIf}
  Pop $R0
  ClearErrors
!macroend

; ---------------------------------------------------------------------------
; customRemoveFiles —— 我们自己这一版卸载器的删文件步骤
;
; 定义了这个宏，uninstaller.nsh 里那段 isUpdated 的 atomicRMDir / Abort
; 整块就被替换掉了（164-188 行）。于是从这一版开始：
;   · 升级时旧版卸载器不再因为一个句柄就 Abort（改名搬移会半途而废，
;     搬走的文件在 $PLUGINSDIR 里、随进程一起没，等于把安装毁掉一半）；
;   · 下一版安装器调用本版卸载器时，走的是「收进程 → 带重试地直接删」。
;
; 删不干净时报 2，是**把信号还回去**，不是让安装器据此做判断——这两件事这一版
; 起分开了，值得写清楚。原版那段的行为是 `Abort "Can't rename ..."`，NSIS 的
; Abort 会把退出码置 2；而安装器那一侧现在的门闸已经换成「本次是不是升级」
; （customUnInstallCheck，理由见文件头），退出码只进日志。所以报 2 的意义变成了：
; 「这是卸载没做干净」这个事实得留在进程边界上——批处理、企业静默部署脚本、
; 以及以后可能出现的别的调用方都看得到它，而不是被我们悄悄改成 0（0 的语义是
; 「目录清干净了」，那是说谎）。
;
; 只在升级时报（${isUpdated}）：普通卸载走的是另一条路，它没有人来接这个
; 退出码，报错了只会让「卸载没卸干净」这件事变得没有落点——那一种留个日志
; 就够了。
; ---------------------------------------------------------------------------
!macro customRemoveFiles
  !insertmacro zt.KillApp unrm
  ; 不能删掉自己当前所在的目录
  SetOutPath $TEMP
  !insertmacro zt.RmDirRetry unrm "$INSTDIR" 12
  ${If} ${FileExists} "$INSTDIR\*.*"
    ${If} ${isUpdated}
      ${zt.Log} "[unrm] $INSTDIR 没删净，按原约定报 2；剩下的交给下一版安装器自己清"
      SetErrorLevel 2
    ${Else}
      ${zt.Log} "[unrm] $INSTDIR 没删净（普通卸载，不改退出码，留几个文件）"
    ${EndIf}
  ${EndIf}
!macroend

!endif ; ZT_INSTALLER_GUARD
