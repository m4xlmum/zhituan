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
; 对策分三层，互相兜底：
;   1) customCheckAppRunning  旧卸载器动手之前，先把还在跑的纸团收干净，
;                             并留出时间让句柄落定。原生逻辑只按 $INSTDIR
;                             前缀匹配找进程、静默分支给的等待也太短。
;   2) customUnInstallCheck   万一还是失败，**不让升级中断**：把残留清掉，
;                             然后照常继续覆盖安装。这一层才是把「随机失败」
;                             变成「必成」的那层——旧卸载器的行为我们改不了，
;                             能改的是「它失败之后怎么办」。
;   3) customRemoveFiles      我们自己这一版的卸载器不再走会 Abort 的改名搬移，
;                             改成「先收进程、再带重试地直接删」。**删不干净时
;                             照旧以非 0 退出**——这一句不能省，理由见那个宏。
;
; 顺带记一份日志到 %TEMP%\zhituan-install.log：静默安装没有界面，
; 出了问题只能靠它说话。
; ============================================================================

!include "FileFunc.nsh"

!ifndef ZT_INSTALLER_GUARD
!define ZT_INSTALLER_GUARD

Var /GLOBAL ztTries     ; 重试计数
Var /GLOBAL ztRc        ; 子进程退出码

; 让日志宏能内联写成 ${zt.Log} "..."（和 electron-builder 自己用的手法一致）
!define zt.Log `!insertmacro zt.LogMacro`

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
    Pop $0
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
      ${zt.Log} "[${TAG}] 没能收掉纸团（返回 $ztRc，多为权限不足），改为继续安装"
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
!macroend

; ---------------------------------------------------------------------------
; customUnInstallCheck —— 把「旧卸载器失败」从致命错误降级为「清场后继续」
; （取代 installUtil.nsh 的 handleUninstallResult 里的
;   MessageBox + SetErrorLevel 2 + Quit，见该文件 108-134 行）
;
; **外层判据是退出码，内层判据是残留。** 两个都要有：
;
; · 外层 `$R0 != 0` 不能去掉，它守的是**全新安装**。uninstallOldVersion 一开始
;   就把 $R0 置 0（installUtil.nsh:152-153），找不到旧版就提前返回、$R0 仍是 0；
;   而 handleUninstallResult 在**每一次**安装之后都会跑（installSection.nsh:53）。
;   于是全新安装也会走到这里，而用户在全新安装时完全可能选一个**已存在、装着
;   别的东西**的目录——那里面一个字节都不能动。把「旧卸载器自报失败」当作唯一
;   入口，恰好也把全新安装整个排除在外了。
;
; · 内层不能只看「$INSTDIR 下有 zhituan.exe」。RMDir /r 是**尽力而为**的：被占住
;   的那个文件删不掉，其余的照删不误——包括 zhituan.exe。所以一次失败的清场之后，
;   留下来的往往正是「resources\app.asar 还在、主程序已经没了」这种形态，而它
;   恰恰是最需要被认出来的那一种。改认**两处指纹任一**：主程序，或 app.asar。
;
; 末尾 ClearErrors：我们提前 Return 走了，绕过了原生那句 IfErrors，得把
; 错误标志清掉，免得影响后面的步骤。
; ---------------------------------------------------------------------------
!macro customUnInstallCheck
  ; $R0 里是旧卸载器的退出码。这一段会调下面几个宏，而它们都会写寄存器，
  ; 所以先把它压栈护住，收尾再放回去。
  Push $R0
  ${zt.Log} "旧卸载器退出码 $R0"
  ${If} $R0 != "0"
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
      ; 还是清不掉就不能装作没事。接着往下走的话，File 解压会把新文件铺在
      ; 旧文件旁边，被占住的那几个（多半正是 app.asar）留在原地——用户拿到
      ; 的是一份「注册表写着新版本、app.asar 还是旧的」的混合安装，比直接失败
      ; 更难查，而且下一次检查更新会再来一遍。这里如实停下，并把该做什么说清楚。
      ; 这个框**故意不带 /SD**：静默升级下它照样要弹出来（当初用户看到的那条
      ; 「应用关了、然后什么都没有」，正是「静默 + 什么都不说」的后果）。
      ${If} ${FileExists} "$INSTDIR\*.*"
        ${zt.Log} "清不掉 $INSTDIR，停下并如实报错"
        MessageBox MB_OK|MB_ICONEXCLAMATION \
          "升级没能替换掉旧文件：$\r$\n$INSTDIR 里有文件正被别的程序占用。$\r$\n$\r$\n关闭网盘同步、杀毒软件实时扫描这类程序（或暂时暂停它们），再运行一次安装程序即可。"
        SetErrorLevel 2
        Quit
      ${EndIf}
      ${zt.Log} "$INSTDIR 已清空，继续覆盖安装"
    ${Else}
      ${zt.Log} "$INSTDIR 下没有上一版的残留（主程序与 resources\app.asar 都不在），不动它，直接继续安装"
    ${EndIf}
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
; **删不干净时必须以非 0 退出，这一句不能省。** 原版那段的行为是
; `Abort "Can't rename ..."`——NSIS 的 Abort 会把退出码置 2，安装器据此
; 走「旧卸载器失败」那条路（customUnInstallCheck）。换成安静地删之后，
; 退出码就默认是 0，而 0 的语义是「目录清干净了」：安装器于是把新文件直接
; 铺上去，被占住的那几个（多半正是 resources\app.asar）留在原地，用户拿到的
; 是一份「注册表写着新版本、app.asar 还是旧的」的混合安装——比失败更难查，
; 而且下一次检查更新会原样再来一遍。所以这里把信号还回去：还剩东西就报 2。
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
      ${zt.Log} "[unrm] $INSTDIR 没删净，按原约定报 2，交给安装器清场"
      SetErrorLevel 2
    ${Else}
      ${zt.Log} "[unrm] $INSTDIR 没删净（普通卸载，不改退出码，留几个文件）"
    ${EndIf}
  ${EndIf}
!macroend

!endif ; ZT_INSTALLER_GUARD
