# Spike 结论：Windows 透明窗口合成行为

在 Windows 11（1920×1080，scaleFactor=1）上用 Electron 44.4.3 实测得出。
脚本在 `spike/` 下，一个主题一份，运行 `npx electron spike/<名字>.js` 可在本机复现
——`index.js` 会自行截屏并比对像素，不依赖肉眼观察；`resize.js` / `window-max.js` /
`vieworder.js` / `fullscreen.js` / `fullscreen-cycles.js` 只断言次序与几何，
隐藏窗口里取不到快照（见 Q20）。

Q1–Q17 决定了 `src/main/services/windowSurface.ts` 的实现方式；
Q18 起是「悬浮球图标 · 16:9 边缘缩放 · 最大化与还原 · 视频全屏联动」这一版
量出来的，决定了 `windowController.ts`、`tabManager.ts` 与 `chrome/ChromeApp.vue`
的做法；Q26–Q28 来自「收起即暂停音视频」那一版；**Q29–Q33 来自「主题管到整个界面」
那一版，量的大多是探针环境自身的脾气（而不是产品行为）——它们不影响 `src/`，
但每一条都决定了下一次写探针时该怎么写**（那一版的前提「主题管到整个界面」已在
1.5.1 被收回，主题如今只落在起始页上；这几条讲的是怎么写探针，与边界无关）；**Q34–Q36 来自「自动检查更新」那一版，
量的不是界面而是网络这条路，以及这台机器自己的脾气**；**Q37 来自「起始页与系统设置
不再当标签页」那一版，是一条纯粹的观测方法：想知道一页被要求打开的是哪个地址，
监听必须挂在这一页出生那一刻**；**Q38 来自「设置那颗键搬到顶栏左上角」那一版，量的是探针自己的一次翻车——模板字符串里的一个反引号**。
**Q39–Q40 来自「起始页按栏目分节、加上离线阅读」那一版，量的是怎么在**不弹出一个
系统对话框**的前提下把那条路验掉，以及一次载入期语法错误在终端上是什么样子**；
**Q41 来自「起始页点了没反应」那一版：界面层让回去时该落在哪儿——一条次序上的错，
表现却是整块正文点不动、而顶栏与右栏照常**；**Q42–Q45 与它同一版，量的是探针自己
在那条路上的三处翻车：把被测的那一步改成反面、一个在屏外窗口上只可能误触发的开关、
以及「那一点归谁」该问在哪一点上**。
**Q46–Q47 来自「整体透明度滑块一松手就跳回 100%」那一版：前者是产品自己的一条线——
配置改了要广播给界面，而广播只挂在一条 IPC 上；后者是探针在这一版里摔的一跤——
Vue 的重画在微任务里，派事件那一个任务里读到的显示值是上一帧的**。
**Q48 来自「更新压成两下」那一版，量的不是本机行为而是 electron-builder 的安装器模板：
assisted installer（`oneClick: false`）要静默装完还把应用叫回来，命令行里到底缺哪一枚不行**。
**Q49 来自「切到起始页 / 设置时顶栏那个名字跟着变」那一版，量的是「此刻」与「刚才」的分别：
快照里那几个字段说的全是此刻，而顶栏那一格要写的是刚才**。
**Q50 来自「点设置的时候标签页这一块完全不变」那一版，量的是那枚让位的下拉按钮：
「点身子进网页、点箭头展开清单」这两件事，一枚 `<button>` 装不装得下**。
**Q51–Q57 来自「PDF 自己渲染」那一版**：Q51 是那个把方案逼出来的读数（内置阅读器那张纸
连一个透明像素都做不出来），Q52–Q53 是键控那两条只能靠测量才能定的界线（「有没有纸」
的 0.35，以及纸与墨各自的零点），Q54 是自渲染要的那条资源通道，Q55 是 pdf.js 在这个
环境里三条「不给就静默失败」的硬要求，Q56 是缩放为什么只能从 devicePixelRatio 认出来，
Q57 是探针自己摔的两跤（应用目录与一条 junction）。
**Q58–Q60 来自「离线阅读的正文可以单独淡下去」那一版**：Q58 是那件把实现逼着换掉的事
（`removeInsertedCSS` 对 user origin 注入的表**撤不掉也不报错**），Q59 是这一页该怎么量
（黑字透明底上只有「贴白纸」那一份量得出来），Q60 是探针认出那一屏的方式——未打包时
「`file:` 开头」认出来的是界面层自己。
**Q61 来自「主题的边界收回起始页」那一版（1.5.1）**：它量的是**文档之间有没有继承路径**
——没有，每份文档各自是 `:root`，于是「主题只管起始页」这条边界就是「别的文档不写
`data-theme`」这一件事本身，而越界（1.0.0 起主题铺满整个界面、1.4.0 又进了 PDF 的墨色）
的修法是删掉那几处写入，不是在各处加判断。
**Q62 来自「阅读透明度改调那张纸」那一版（1.5.2）**：它量的是**「纸」还在不在位图里**
——不在了。键控把每一页的纸写成 alpha 0、把墨归成同一个近黑，于是「把纸补回来」这件事
根本不用重算位图，一块 CSS 底色就够，而滑块因此**碰不到字**（这是「字不可能跟着淡」的根，
不是一处小心）。
**Q63 来自这一问「EPUB 这类格式能不能导入」**（`spike/epub-import.js`）：它量的是**平台认不认**——不认，三种都不认。
但把它拆成四件事（会不会变成下载、能不能只靠内置 zlib 解包、解出来的正文渲染与注入落不落得下去、
以及正文得不得良构）之后，「已经通了」与「还没做」的边界才落得下来：前三件都是现成的，
没做的只有分章、目录、进度那些**产品工作**。顺带量到一条协议上的必答题——`.xhtml` 走 XML 解析器，
非良构就整页变解析错误。这一条也是改名之后接着量的：它不改变任何已有实现，
改变的是 README 里「EPUB 暂不支持」那句话的**下半句**该怎么写。
**Q65、Q66 来自「用方案 A 把 EPUB 读起来」这一次实现**（`spike/book-page.js` 与 `spike/book-open.js`）：
Q65 量的是**「章节住进我们自己的阅读页」这个模型立不立得住**——它把「注入时要不要改写书里的
选择器」这件事答掉了（**不用**：书的 `body { }` 照样命中 Shadow DOM 里那个 body 元素），
也把「字实心、纸渐显」在 EPUB 上做不做得成答掉了（**做得成**：两个透明度档下不透明像素
占比逐位相同）。Q66 量的是**这条链路真的接通了没有**：一本用 `zipfile` 造的真 EPUB，经真的
`services/bookReader.ts` 与真的构建产物 `book.html`，走完打开、解析、清洗、注入、翻章、
量像素。它也顺手记下探针自己在这一趟摔的两跤——`<link>` 的异步与 Vue 的更新时机，
两处都**看起来像产品没做出来**。
**Q67 来自「这条链路在真 app 上接通了没有」那一问**（`spike/live-app.js` 的 A13）：
它量到的是一条**漏接的分支**——`kind` 判成了 `'book'`，视图里加载的却仍是那个 `.epub`
本身。Q66 照不出它，因为那一支探针自己手工拼好了阅读页地址再交给窗口，正好跳过了
`create()` 里那一步。于是判据写成「按地址逐字认那一屏**是**书页，**且**场上没有任何
一屏加载的正是那个 `.epub`」——**「接上了」与「接对了」是两件事**，而它们坏起来
是同一种症状。

**Q73 来自「升级时报 `Failed to uninstall old application files … : 2`」那一版，量的又是
electron-builder 的 NSIS 模板而不是本机行为**：旧卸载器靠「逐个改名搬移」清目录，只要一个
文件改不动就 `Abort`（退出码 2），新版安装器见到非 0 便弹框退出——而本机的安装目录恰好落在
桌面上，有同步盘与杀软在扫，于是这条失败出现得随机。修法因此不在「让改名成功」，在**换掉
失败之后的那一步**。

## 结论

| # | 问题 | 结果 | 影响 |
|---|---|---|---|
| Q1 | `WebContentsView` 不设背景色 | **不透明，绘制为纯白** | 每个视图都必须调用 `setBackgroundColor('#00000000')` |
| Q2 | 设置 `#00000000` 后 | **像素级完全透明**（与桌面基线差值 0） | 透明方案成立 |
| Q3 | `transparent:true` 窗口上 `setOpacity(0.5)` | **正常混合**，实测与理论值总偏差 1 | 两条合成路径**可以**共存 |
| Q4 | `setShape()` 与 `transparent:true` | **完美共存**，裁掉区域与桌面基线差值 0 | `setShape` 可作为命中区域的主策略 |
| Q5 | `resizable:false` 下程序化 `setBounds` | 生效 | 无需开启用户缩放也能改窗口矩形（开启用户缩放会破坏透明） |
| Q6 | `minimize()` → `restore()` | 透明度保持 | 仍需 reassert 以应对 DPI 切换 |
| Q7 | `setShape` / `setOpacity` / `setIgnoreMouseEvents` / `setFocusable` / `setSkipTaskbar` / `setContentProtection` / `contentView.addChildView` / `view.setVisible` | 全部可用 | 无 API 缺失 |
| Q8 | 在 `'closed'` 事件里读 `win.id` / `win.getBounds()` | **抛 `Object has been destroyed`** | 窗口销毁后才触发 `'closed'`，此时只有 `win.isDestroyed()` 还能读；id 要在建窗口时就记下来。见 `spike/destroyed.js` |
| Q9 | 往自家页面（起始页 / 系统设置）注入「背景透明」 | **写在 `html, body` 上的底色被抹掉**，透明窗口里露出桌面 | 注入的是 user origin，层叠顺序里压过作者样式表（`!important` 也压得过）。底板因此要另画一层（起始页 `.page`、系统设置 `.layout`），且自家页面根本不该被注入网页样式。见 `spike/ownpage-bg.js` |
| Q10 | 子组件根元素带父组件的作用域属性，父组件里一条 `.类名[data-v-父]` 的规则会不会落到子组件头上 | **会**。`variant` 的值被当类名用（`cards` / `terminal`），正好撞上当时那套世界根元素的类名，主题菜单于是被整页排版规则排了一遍：标识被挤成两行、菜单横跨整幅页眉 | 给子组件传形态用属性（`data-variant`）而不是类名。逐条 `matches` 查串味：`spike/which-rules.js` |
| Q11 | 在 `show: false` 的窗口里连续改状态再 `capturePage()` | **抓到的是上一帧**（截图与同一时刻 DOM 对不上） | 隐藏窗口的合成帧晚一拍。抓图前先等两帧 `requestAnimationFrame`，并丢弃一次抓取。见 `spike/preview.js` 的 `shoot()` |
| Q12 | 顶栏标签条放不下时 `display: none` 让位 | **会抖**：藏起来之后量出来是 0，于是又判成「放得下」→ 显示 → 又放不下（`display: none` 的元素量不出宽度是必然的，由此推出的来回翻是推演——无头抓图抓不到这种帧间抖动，能抓到的只是「测出来的几何对不对」） | 让位时用 `position: absolute; visibility: hidden`：离开流（不占宽度、不挤走后面的按钮）但仍能量出自然宽度。「容量」与「需求」两把尺子在两态下都成立。见 `chrome/TabStrip.vue`，验证用 `spike/preview.js --tabs N --resize WxH` |
| Q13 | 整条标签条 `visibility: hidden` 之后，里面当前那一格的关闭键还画不画 | **照画**。`visibility` 可继承，但后代能把它改回去，而 `.tab.on .x` 正写着 `visibility: visible`——于是让位状态下，下拉按钮右边凭空多一个孤零零的 ✕（还能被 Tab 键选中，按一下就关掉标签页）。更糟的是这一项当时**报的是 false 也看不出来**：`getComputedStyle(x).visibility` 只看这一格自己的值，祖先被隐藏它照样说 visible | 露出关闭键的两条规则挂在「显示中」这一态上（`.strip[data-fits='true'] .tab.on .x`）。度量改用 `checkVisibility({ visibilityProperty: true })`，它把祖先算进去——**比像素比对可靠**：这个 ✕ 在整窗截图里只有几个像素，是靠放大裁图才看出来的 |

| Q14 | `setInterval(16)` 在 Windows 上实际多久触发一次 | **p50 30.15ms**（p90 31.4）。间隔被向上取整到系统时钟滴答（约 15.6ms）的整数倍，16 成了两个滴答。`setInterval(8)` 得到 p50 **15.09ms**（一个滴答），已是 `setInterval` 在这里能给的极限 | 拖动窗口的循环取 `DRAG_TICK_MS = 8`。这不是「越小越流畅」，而是「不小于滴答就翻倍」——原先那条约 33Hz 的拖动就是这么来的。见 `spike/dragTicks.js` |
| Q15 | 拖动循环里每帧 `win.setPosition` 一次要花多久 | 隐藏窗口上 p50 **2.55ms**、p90 6.0ms、max 11.1ms（**下界**：真实拖动时窗口还要参与合成，只会更慢） | 一个 15.1ms 的滴答里这笔开销占得不小，因此每帧那次 `win.getBounds()` 往返被去掉：位置按按下时的锚点**绝对**算，上一次请求过的位置记在锚点里自比。绝对算法另有一个好处——平台卡住过一次也不会越拖越偏 |
| Q16 | 一条栏声明 `-webkit-app-region: drag`、子元素再声明 `no-drag`，只要**剩下**空白像素就还能拖吗 | **不能**。一个子元素若铺满整条栏（顶栏中间是 `flex: 1 1 auto` 的标签条，右栏里是撑满的功能栈），可拖区域就只剩几像素的内边距——用户的结论是「只能拖悬浮球」，而这件事从 CSS 上读不出来、从截图上也看不出来 | 整套 `-webkit-app-region` 取消，改成显式规则：**按在控件（按钮 / 输入 / 滑块 / `data-drag-ignore`）上是操作，按在别处都是拖窗口**。可拖区域不再随版面变化悄悄消失。验证：`spike/preview.js --drag-probe`——逐个位置派发合成 `pointerdown`/`pointerup` 并读拖动计数（合成事件不产生 `click`，因此按在按钮上没有副作用） |
| Q17 | 在 `:root` 上定义 `--surface: rgb(255 255 255 / var(--alpha))`，再把 `--alpha` 写在某个下层元素上，那个元素拿到的是不是半透明底色 | **不是**。自定义属性里的 `var()` 是在**声明它的那个元素**上完成替换的：`:root` 上算出来的已经是一个定值颜色（按当时的 `--alpha`），之后只是把这个结果继承下去。实测：下层 `--zhituan-alpha` 读到 0.35，顶栏实测底色仍是 `rgb(255, 255, 255)`——滑块在动，画面纹丝不动 | `--zhituan-alpha` 改写到 `document.documentElement`（与令牌同层），ChromeApp 与 PopoverApp 各写自己那份文档。`spike/preview.js --bg 0.35` 的 `surfaces` 盯着这一对关系：`bar` 应当带上这个 alpha，`ink`（字与图标）必须是不带 alpha 的实色——拉到 0 也要看得见、点得到 |

| Q18 | 对一个**已经在场的**子视图再 `addChildView()` 一次，会多插一份，还是把它挪到最上层 | **挪到最上层**：`win.contentView.children` 的个数不变，次序变了。抬上 / 让回交替十次，个数与次序都不漂。第二个参数给 0 就是挪到最底下，同一套语义 | 「把界面层抬到网页之上」不必新建视图，就是再 `addChildView` 一次。最大化时右上角那一小块、光标进边带时的左/下手柄都用它；让回则是 `addChildView(chrome, 0)` 送回原位（见 Q41）。见 `spike/vieworder.js` |
| Q19 | 两个铺满窗口的 `WebContentsView` 叠在一起，上面那层若在 CSS 里写 `pointer-events: none`，点击能落到下面那层吗 | **不能**。子视图是原生视图不是 DOM，指针事件只投给最上面那一层，`pointer-events` 在这里完全没有参与 | 「铺一张透明的整窗浮层、只在控件处设 auto」这条画法在这里根本不成立——浮层一铺，整块网页就点不动了。改为**把界面层缩到右上角一小块**（80×48 的 `.float`），别处的指针本来就不经界面。左/下那条 8px 缩放手柄带同理，只能靠「光标进带时抬起界面层」，代价是抬起之前那一条上的点击归网页 |
| Q20 | 在 `show: false` 的窗口里 `view.webContents.capturePage()` | **抛 `UnknownVizError`**——没有合成器，也就没有帧 | 与 Q11 是同一件事的两个面（那边抓得到但晚一帧，前提是窗口被合成过）。因此这一版的探针只断言次序与几何，不报像素；`spike/fullscreen.js` 里的窗口从头到尾不显示 |
| Q21 | 一个**从未显示过**的窗口里，网页连续进出 HTML 全屏能走几趟 | **只走得了一趟。**第二趟起 `requestFullscreen()` 会把 `document.fullscreenElement` 置上，但 `enter-html-full-screen` 再也不来，`exitFullscreen()` 也退不回去。把变量一样一样摘出来之后：**不是**透明 / `resizable:false` / `frame:false` 这些窗口配置，**不是** `disableHtmlFullscreenWindowResize`，**不是**在回调里重排子视图次序，**把回调里的动作 `setImmediate` 推迟一个 tick 也救不回来**；一扇最小窗口（`plain`）三趟干净，所以也**不是**「一个进程只容得下一趟」 | 能在回调里把它弄坏的是**两件事**：在那个回调里 `view.setBounds()` 改页面视图尺寸，以及窗口没被真正合成（`shown` 那一支能撑到第三趟）。产品必然要做那一下 `setBounds`——窗口尺寸变了正文矩形就得跟着变，否则视频停在旧矩形上——因此这是**环境的脾气、不是产品的毛病**，没有在 `src/` 里加补丁。真机上要看的是「再按一次视频的全屏键能不能退出来」。见 `spike/fullscreen-cycles.js`，七支变体一次一支跑 |
| Q22 | `disableHtmlFullscreenWindowResize: true` 到底改变了什么 | **量得出，而且差别正是我们要接管这一摊的理由**：不带它时 Chromium 自己把窗口铺到**整块显示器**（本机 `0,0,1920,1080`，任务栏一起盖住）；带上它，窗口一动不动。工作区是 `0,0,1920,1032` | 那 48px 就是「Chromium 与 `WindowController` 两边同时动手」会跳的那一下。这个开关不是可选项。判据见 `spike/fullscreen.js control`：起一扇**不在任何全屏流程里**的对照窗口，同样禁用/不禁用各试一遍 |
| Q23 | 在从未显示过的窗口里 `executeJavaScript('document.exitFullscreen()')` | **那个 promise 永不落地**——退出全屏本身照样发生（`leave-html-full-screen` 到了、窗口也还原了），但等着它的那次 `executeJavaScript` 会一直挂着 | 探针页面里两处入口都写成 fire-and-forget，失败塞进 `window.zhituanErr`，轮询去读，而不是 `await` 那个 promise；`waitUntil` 替代固定延时。产品侧本来就不等（`TabManager.exitPageFullscreen()` 只 `.catch(() => {})`） |
| Q24 | 在从未显示过的窗口里走完一趟全屏，之后这个进程里再 `loadURL('file://…')` | **`ERR_FAILED (-2)`**。对照窗口若建在那趟全屏**之后**，它连页面都载不进来 | 探针里的对照窗口必须在任何全屏流程**之前**就建好并载入（`spike/fullscreen.js control` 就是这么改的）。同属 Q21 那一类环境症状，不用改产品 |
| Q25 | 一次 `setBounds()` 能不能把窗口正好摆成当前显示器的 `workArea` | **能**，读回与 `workArea` 逐字段相等（`0,0,1920,1032`）；隐藏窗口上同样成立 | 最大化不必分几步摆，一次到位即可——`windowController.setMaximized()` 就是这么做的，摆完照既有习惯**读回实测矩形**存进 `expandedBounds`。见 `spike/resize.js` 与 `spike/window-max.js` |
| Q26 | 窗口收起成球（或最小化、藏进托盘）之后，网页里正在播的 `<video>` / `<audio>` 会不会自己停 | **不会**。`setVisible(false)` 只是不合成，`setAudioMuted(true)` 只是听不见——`paused` 仍是 `false`，进度照走。这是用户报的那个毛病：收起来听着没动静，回来发现片子已经跑掉一截 | 隐藏态要**真的暂停**，得在页面里做 DOM 操作（`el.pause()`）。只有我们按下去的才恢复：动过的当场打一枚展开属性 `__zhituanPaused`（不是 `data-` 属性，不给页面自己的选择器添麻烦），恢复时只挑带这枚记号的。页面上用户自己按过暂停的，前后都不动它。见 `spike/media-pause.js` |
| Q27 | 顶层的 `document.querySelectorAll` 能够到跨源 iframe 里的播放器吗 | **够不到**（不透明源的 `contentWindow.document` 直接抛），但主进程**够得到**：`webContents.mainFrame.framesInSubtree` 给出 `WebFrameMain[]`，逐个 `frame.executeJavaScript()` 就跑进了人家自己的上下文里 | 「连嵌入播放器一起暂停」只能走这条路。`data:` iframe 与真实网站里的 `<iframe src="https://…">` 在这一点上同类，因此探针用一个 `data:` iframe 就能把这条验证做实 |
| Q28 | 隐藏的页面里，`setInterval` 还能按时上报状态吗 | **不能**：被节流到约 1 秒一次（再久还会更稀），于是「等不到回复」会**伪装成「没暂停」**——一个刚好会把被测对象判成通过的假象 | 探针页面之间改用**一问一答**（父页面 `postMessage({ask:'state'})` 问，iframe 答），消息投递不受节流影响；等待一律走 `waitUntil` 轮询而不是固定延时。产品侧不受影响（暂停是主进程推过去的，不依赖页面里的定时器） |
| Q29 | 假设「`show: false` 的窗口里 `requestAnimationFrame` 根本不触发」，这个假设成立吗 | **不成立**。隐藏窗口里 1 秒跑到 **48 帧**（时钟 1012ms）——被节流到 50Hz 上下，但一直在跑。对照：同一扇窗里 `setInterval(16)` 500ms 触发 32 次，也是偏慢的 | 隐藏窗口里 `rAF` 可以用来对齐帧，但不能假定「两帧 = 33ms」，更不能假定它一定到。探针里那套 `Promise.race([两帧 rAF, setTimeout(500)])` 因此留着——不是因为 rAF 不来，而是因为它来的快慢不由我们定。见 `spike/preview.js` / `spike/readme-assets.js` 的 `shoot()` |
| Q30 | 主进程里一次没人接的 promise 拒绝、或定时器回调里抛出的同步异常，会把进程带走吗 | **都不会**。前者只打一条 `UnhandledPromiseRejectionWarning` 就过去了；后者**连一行都不打**，进程照常活着（2 秒后照样走到收尾） | 「探针挂了」在终端上可能表现为**什么都没有**：不是崩溃、不是报错，而是停在那里。所以探针必须自己装 `process.on('unhandledRejection')`（打一条 `[FAIL]` 再 `app.exit(1)`），并尽量走看门狗；否则失败会伪装成「还在跑」——那比报错难查得多。见 `spike/theme-chrome.js` / `tray-reveal.js` 开头那一段 |
| Q31 | 带透明通道的像素在 canvas 里往返一趟还剩什么 | **`putImageData` 写进去的 `rgba(255,0,0,0)` 读回来就是 `[0,0,0,0]`**（全透明像素的颜色当场没了，底色是预乘存储）；PNG 往返保持这个结果；**WebP 往返更狠**：`[255,0,0,1]` 变成 `[0,0,0,1]`，`[255,0,0,128]` 偏成 `[251,2,4,128]` | 别拿 `canvas → WebP` 这条路去产**带 alpha** 的素材：alpha 接近 0 的像素会丢色，画面上就是一圈黑边或灰边。README 那几张成品图没踩到，是因为它们在排版页里已经被合成为不透明的一帧（桌面底是画在页面里的），编码时没有任何 alpha 可丢。要产带透明的图就用 PNG |
| Q32 | 构建产物里 `themes.css` 这一份样式表叫什么名字 | **不叫 `themes.css`**。它在 `out/renderer/assets/` 里叫 `useTheme-<哈希>.css`——名字来自「把它拉进依赖图的那个模块」，后面挂内容哈希。同理 `tokens.css` → `useConfig-<哈希>.css`，`base.css` → `useBackgroundAlpha-<哈希>.css`。五份文档引的是**同一份** chunk | 判断「某份文档拿到了哪几条样式表」，要读产物 HTML 里 `<link>` 的顺序（它保住了源文件里的先后），**不要按源文件名去 `assets/` 里 grep**：那样一条都搜不到，而「一条也没搜到」极容易被读成「样式表没生效」。见 `spike/theme-chrome.js` 读的是 `out/renderer/*.html` |
| Q33 | 系统设置那一页的按钮与输入框，颜色是从哪儿来的 | **从 UA 样式表来**：那一页的 `settings.html` 不加载 `base.css`（它只引 `themes.css` + `tokens.css` + `settings.css`），于是没有人给它 `color: inherit`，`button` 拿到的是系统默认的 `buttontext`（黑） | 暗夜下探针量出来是 **1.18:1**——黑底黑字，整页控件像没画出来。`settings.css` 因此自己写了 `button, input { color: inherit }`。这一条之所以值得记：它**不会**在浅色主题下露头，也不是「样式没生效」，而是「少了一条谁都没写过的规则」。（`spike/theme-chrome.js` 的 Q9，如今量的是「五个分栏的字都压得住自己的底」，
最紧的一处 5.38:1。那一条原本量的是「三套主题下都读得出来」，而 1.5.1 起设置页
只落在纸白那一份上——判据从「三套各自达标」变成「三套入参下逐条相同」，
参数换了、这一课没变） |

| Q34 | Electron 的 `ClientRequest` 有 `setTimeout()` 吗（node 的 `http.ClientRequest` 有） | **没有**——`req.setTimeout` 不是函数。探针里那只「接下连接、一个字也不回」的假服务器因此是靠**自己挂的 `setTimeout` + `req.abort()`** 收场的，实测 15008ms 落地 | 查询与下载各挂一个定时器，两处语义不同：查是**整体** 15 秒（`UPDATE_CHECK_TIMEOUT_MS`）；下是「**多久没有新数据**」60 秒（`UPDATE_STALL_MS`，每收到一块就重置一次）——111MB 在慢网下线几分钟是正常的，不能给下载设总时长上限。见 `spike/update-check.js` 的 Q7 |
| Q35 | 一个**没有窗口**的 Electron 进程里，`net.request` 走得通吗 | **走得通**。探针从头到尾不建 `BrowserWindow`（也就不必担心抢焦点），`app.whenReady()` 之后直接发请求，本机那只假 GitHub 与真的 `api.github.com` 都照常应答 | 「只有主进程才验得了」的东西可以写成无头探针，不必把用户的应用拉起来——`spike/update-check.js` 因此能在几秒内跑完十三问，不需要 IPC、不需要渲染进程，配置写在临时目录。另：喂给它的 `latest.yml` 用的是 `release/latest.yml` 那一份**真构建产物**，不是手写的样例 |
| Q36 | 这台机器上「连不连得上 GitHub」是由什么决定的 | **两套网络栈走了两条路**。`session.resolveProxy()` 报 `DIRECT`（Windows 系统代理关着：`ProxyEnable=0`、`ProxyServer` 为空），于是 Chromium 与 node 都直连；而 `curl` 连的是 `127.0.0.1`（实测 `remote_ip=127.0.0.1`，本机 7897 端口上那个代理），所以 curl 通、进程内不通。同一支探针连着跑：`api.github.com` 一直 200，`github.com` 六次都在 170ms 上下回来，也见过连着几分钟 20 秒不回 | 「查不到更新」在这台机器上会真的发生，而且**安静地失败**——设置页里写着「检查失败：网络不通」，窗口里一条提示都不冒。要让它稳，得把本地代理写进 Windows 的系统代理设置（或让它接管整机流量）。`spike/update-check.js --net` 那一问因此记 **SKIP 而不是 FAIL**：网络上时通时不通，那一问红了未必是代码的问题 |
| Q37 | `tabs.create()` 返回之后再给那个 `webContents` 挂 `did-start-navigation`，头一发还收得到吗 | **收不到，而且失败的样子有两种。**`create()` 里是**同步** `loadURL()`，等它返回再挂监听，第一发事件早已派发完。真跑起来：`douyin.com`（会 301 到 `www.`）量到的是**重定向之后**那一发 `https://www.douyin.com/`，看起来还像个合理答案；`google.com`（只有那一发）四秒后 `getURL()` 仍是空串 | 「这一页被要求打开的是哪个地址」只能靠 `app.on('web-contents-created')` + 在**出生那一刻**挂监听来问（第一份 `webContents` 一建出来就挂上，比任何 `create()` 都早），按 `webContents.id` 存下第一发主框架非 `about:blank` 的地址。这条也顺带说明：量到的若是「重定向之后」的地址，读数**不会报错**，只会悄悄换成一个看着更正常的域名——这种错最难发现。见 `spike/own-screens.js` 的 `firstNav` 与 Q9 |

| Q38 | 在一个**模板字符串**里（`preview.js` 发给渲染进程执行的 `MEASURE`）写注释时顺手用了反引号，会发生什么 | **整个模板提前收尾**，剩下的半段变成主进程里跑的代码，于是 Electron 报 `App threw an error during load` + `TypeError: Cannot read properties of undefined (reading 'on')`，行号指向源码里那一段（那时候它已经是一句注释了），而**渲染进程一个字的报告都没有**。更费时间的是它挂住的样子：`npx electron …` 七分钟没有任何输出，最后是 `tasklist /V` 看见一个标题为 `Electron` 的窗口才认出「它弹了个错误对话框在等人点」 | 探针里那几段发给页面的脚本都是模板字符串（`MEASURE` / `PAGE_MEASURE` / `POPOVER_MEASURE`），里面写注释提到选择器时别用反引号——`.icon.on` 这样写就行。这一条也是 Q30 的另一面：**「挂住」有两种样子**，一种是一个字都不打，一种是弹一个没人看得见的模态框；探针之外那套 `unhandledRejection` + 看门狗对后者没办法。见 `preview.js` 里 `MEASURE` 顶上那段警告 |

| Q39 | 主进程里 `require('electron').dialog.showOpenDialog` 能被换掉吗？换掉之后，被测的那份代码走的究竟是替身还是真的那个 | **能换，而且走的就是替身**。赋值后两个引用相等（`dialog.showOpenDialog === 替身`），属性可写可配置。关键在于被测代码那一侧的引用方式：esbuild 以 `external: ['electron']` 打出来的 CJS 把外部 ESM 引用编译成 `var import_electron = require("electron")` + 调用处写 `import_electron.dialog.showOpenDialog(...)`——**每次调用都重新查一遍属性**，而不是开头取一次存进局部变量。因此换掉之后真的走替身（这一点是 grep 一份临时打包产物确认的，不是推的） | 「弹系统选文件框」这条路可以在无头探针里验完整：换掉 `dialog`，断言 `tabManager.create` 收到的是 `file://` 绝对 URL、回来的是文件名数组、取消时返回空数组且一张标签都不开。但**换的动作必须自己断言成立**（赋值后比一次引用），换不上就照实报「否」——真的那个对话框会弹出来，而没人去按它，探针会一直挂着（这条与 Q30 同源）。见 `spike/home-sections.js` 的 Q10 |
| Q40 | 一个探针脚本在**载入期**就抛了语法错误（`Identifier 'x' has already been declared`），`npx electron spike/…js` 表现出来是什么样 | **什么都不发生**：终端一个字都不打，进程既不退出也不建窗口——它就一直待在那儿。这一条与本机既有的 Q30、Q38 合起来是同一件事的第三种面孔：**「挂住」可以是一个字不打的沉默（Q30）、一个没人看得见的模态框（Q38），也可以是一次连报错都还没轮到的载入失败**。对照：把同一份文件交给 `node --check`，两秒内就把行号与那对重名的标识符指出来了 | 探针一律跑在 `timeout <秒数> npx electron …` 下——载入期报错时没有「退出的时机」可等，只有超时能收场（跑挂的那一次留下了一个撑满两分钟、没有窗口的 Electron 进程，还得按 PID 逐个认出来）。改完探针先跑一遍 `node --check spike/<名>.js`：语法错在这一步就挡住了，根本轮不到 Electron 去沉默 |
| Q41 | 界面层抬上去之后再让回去，**只把当前那一屏重新加到最上层**够不够 | **不够，而且代价就是用户报的那条毛病**。`addChildView` 一次只动一个视图：让回之后界面层退居第二，**其余每一屏都还沉在它下面**。界面层是整窗大的一层，正文区那一块在它上面是空档——原生命中测试只认最上面那个画着的视图（Q19），于是那些屏整块点不动。抬升只要发生过一次（最大化，或光标贴到窗口边框那一下——`EdgeWatcher` 的 8px 带）就会一直如此；而切屏只是翻显隐、不再抬次序（`TabManager.activate`），所以「点顶栏那颗键回起始页之后，页面上点了没反应，顶栏与右栏却照常好用」正是它的样子 | 让回 = `addChildView(chrome, 0)`，一步送回它原本住的地方（`create()` 里第一个加进来）——这一条对**所有**屏成立，不必逐屏去追。原先那套「抬当前那一屏」连同 `TabManager.raiseActive()` 一并删掉。验证：`spike/window-max.js` 的 Q3c/Q3d（后出现的那一屏也得在界面层之上）、`spike/live-app.js` 的 A9（真 app 里点回起始页，正文区那一点必须归起始页） |

| Q42 | 探针给 `win.contentView.addChildView` 挂的替身写成 `(view) => rawAdd(view)`，把第二个参数丢了——被测的那一步会变成什么 | **变成它的反面。**让回那一步是 `addChildView(chrome, 0)`（送回最底下），丢掉 index 就成了「抬到最上面」：于是真身上已经修好的毛病，报告里照样是「A9 不是——那一点归界面层」，而那条记录里三次移位全是「到最上面」。**探针亲手把被测的代码改成了它的反面，顺手把证据也改了** | 替身必须**原样转交它不认识的参数**（`(view, index) => rawAdd(view, index)`）。这一条与 Q39 同源：替身只要与真身差一丝，量的就不是产品。`spike/live-app.js` 的移位记录因此把「到最上面 / 回最底下」分开记——两种都记成一样，就分不出修好没有 |
| Q43 | 窗口停在屏幕外时，`stealth.autoCollapse` 开着会怎样 | **只可能误触发。**自动收起要的是「真光标在窗口里待过」（`WindowLeaveWatcher.armed` 只在光标进过窗口之后才置上），而屏外的窗口真光标永远进不去；唯一能把它置上的是**拖动**——拖动按绝对算法跟着真光标走，窗口被拽到光标底下，光标就此进了窗口，`hideDelayMs` 一到便收起。原先 `spike/home-layer.js` 的 M14 正是拖动那一步，于是从 M14 起窗口已经是 `collapsed`，M15–M19 量的全是一扇收起的窗口（叠着的可见视图是空的），六条全红而产品没有毛病 | 探针里把这个开关关掉，并在文件头写明理由；收起 / 展开这条路本身另有 M4、M7 直接叫 `controller.collapse()` / `expand()`，走同一条状态机，与它无关。拖动那一步的按下与松开也一并收进同一个同步块（与 `window-max.js` 的 Q6 同一手）——否则窗口会被拽到屏幕上 |
| Q44 | 窗口从没 `show()` 过时，`win.isVisible()` 是什么 | **恒为 false。**于是 `isOnScreen()` 也是 false，`toggleFromTray()` 两次都走「藏起来」那一支——第二次点托盘图标叫不回来，之后每一步量的都是一扇藏着的窗口 | 探针自己记一本「屏幕上有过这扇窗吗」的账（`show` / `showInactive` / `hide` / `isVisible` 四处换成探针的布尔量），控制器那一套判断照旧是真的。`spike/home-layer.js` 的 M17–M19 就是这么转绿的 |
| Q45 | 断言「那一点归谁」之前，要先问清楚什么 | 两件，都摔过。**问的是哪一点**：最大化时界面层只剩右上角一小块，正文正中间那一点压根不在它里面，拿「该归界面层」去问正中间，必然得到「不是」（M12）。**那一刻有没有可比的对象**：起手（M0）还没有任何网页，整扇窗只有界面层，它接走那一点是对的，拿「该归网页」去问它同样必然「不是」 | 判据要按这一刻的真身写：最大化时**分两点问**（那一小块归界面层、正中间归网页，M12 / M12b），还没有可比对象的那一步只记一笔、不断言（`expect` 给 null）。这与 Q41 是一件事的两面——那条讲产品的次序错，这条讲探针问错了地方也会一样红 |

| Q46 | 「配置改了要告诉界面」这件事，广播挂在发起写入的那一条 IPC 上够不够 | **不够，而且这就是用户报的那条毛病。**原先只有 `INVOKE.configPatch` 那一条路广播 `config:changed`，而整体透明度走的是另一条：右栏那条滑块 → `win.setOpacity` → `WindowController.setOpacity()` → `config.set(...)`，它只发 `window:state`。`ConfigStore.subscribe()` 一直在、写得也对，但**订阅者是 0**——于是界面手里那份配置镜像停在挂载时读到的值（默认 100%）。实测（修之前）：拖动中配置已是 0.4、窗口确实 40%，**松手那一帧滑块显示 100%**。设置页里改同一条也会跳，只是那儿改完不松手 | 广播改挂在 `ConfigStore` 的订阅上（`src/main/index.ts` 里一句 `config.subscribe(...)`），**谁改的都算**：configPatch、setOpacity、setChrome、updateService.ignore、persistExpandedBounds、lastSession 全在这一句之下，不必逐条去补——补一条就还有下一条要走这条老路。`configPatch` 那个 handler 从此只留窗口那一侧的副作用。验证：`spike/live-app.js` A10（合成拖动）/ A11（不碰界面，直接调 `win.setOpacity(0.55)`，滑块也得跟着到 55%）、`spike/preview.js --drag-opacity 40` |
| Q47 | 在派发 `input` 的那个任务里，紧接着读那一格渲染出来的文字，读到的是哪一帧 | **上一帧。**Vue 的重画在微任务里，而 `dispatchEvent` 是同步的——同一个 `executeJavaScript` 任务里读 `.value`、读元素高度这类**渲染结果**，拿到的是改动之前的值。摔的样子：拖动中那一次读出来 100%（配置已经是 0.4），于是「修正起效了没有」被自己的读数判红 | 写与读分成两次 `executeJavaScript`，中间等一次冲刷（`live-app.js` A10 与 `preview.js` 的 `--drag-opacity` 里都是 `await wait(50)` 再读）。它与 Q11（隐藏窗口抓图晚一帧）同属一类：**要读的是画出来的东西，就得让画先画完**。只读状态（`config.window.opacity` 这种由主进程给的值）不受影响，那个不是渲染结果 |
| Q48 | assisted installer（`oneClick: false`）上，`安装包.exe /S --updated` 够不够让它在装完之后**把应用启动回来** | **不够，而且症状是静默的：装完了，没有人回来。**electron-builder 的 `templates/nsis/installSection.nsh` 里「装完启动应用」这一段分两支：`!ifdef ONE_CLICK` 那一支的判据是 `${Silent}`（静默就重启，所以 oneClick 的安装包天生全自动）；我们这一支（assisted）的判据是 `${isForceRun} ${andIf} ${Silent}`——**静默之外还要求 `--force-run`**。少了它，`/S` 让向导不出现、`--updated` 让旧实例自己退掉，然后安装程序一声不响地退出，「全自动」断在最后一步：用户点的是「更新并重启」，回来的是空桌面 | 三枚参数一起用，一枚都不能少（`src/main/services/updateService.ts` 的 `SILENT_INSTALL_ARGS`）：`/S`（不走向导）、`--updated`（这是升级：容忍还有一个实例在跑、跳过桌面快捷方式重建）、`--force-run`（装完启动应用）。**装到哪儿不归我们管**——`/S` 下不选目录，安装程序从 `HKCU\Software\<APP_GUID>\InstallLocation` 读回上次那个目录（`APP_GUID` = `UUID.v5(appId, ELECTRON_BUILDER_NS_UUID)`，`include/installer.nsh` 写、`multiUser.nsh` 读回 `$INSTDIR`），本机实测该键为 `8a1898f1-95fb-5c4a-9689-1796e9580e72` → `C:\Users\poem\Desktop\zhituan`，即用户当初选的目录，升级不会多出一份。验证：`spike/update-check.js` Q10 断言 spawn 的参数**逐字**等于这三枚——少了 `--force-run` 那一遍，Q10 当场红 |
| Q49 | 顶栏那一格写着「当前这张网页」，而界面手里的快照有没有「当前这张网页」 | **停在自家那两屏上时没有——三个字段说的全是「此刻」。**`TabsStatePayload` 里 `tabs` 是此刻开着的网页、`activeTabId` 是此刻正看着的那张（停在自家两屏上是 **null**）、`screen` 是此刻停在哪一屏，一个「刚才」都没有。于是顶栏唯一那点跟着网页走的字（地址栏开关上的域名）在那种时刻只剩屏名可写，切进去那一格就变成「起始页」「系统设置」——读起来像多了一个叫「系统设置」的标签页（用户报的正是这条）。实测（修之前，`preview.js --screen settings`）：`{"停在哪一屏":"settings","开关上写着":"系统设置","写的是屏名":true}` | 把真身**本来就有**的那个事实放进快照：`TabManager.lastGuestId`（`leaveScreen` 回的就是它）加进 `TabsStatePayload`，界面只投影、不另攒一份「上一次是什么」——副本迟早与真身对不上（托盘菜单进去、主进程关掉那张网页、`lastSession` 恢复，界面那份副本一个都跟不上）。修后同一读数：三个状态（不在屏上 / 起始页 / 设置）全是 `juejin.cn`，`--click-screen` 五个来回每一步也读到同一个域名；而「此刻在哪一屏」仍旧由左上角那颗键的高亮说（`SCREEN_KEYS` 照旧）。一张网页都没有时（全关光了，落回起始页）那一格一个字都不写，只剩放大镜（`--no-tabs`，判据在 `TopBar` 的 `siteLabel`） |
| Q50 | 让位后那一枚按钮要「点身子＝进那张网页、点箭头＝展开清单」，一枚 `<button>` 里装得下吗 | **装不下，而且两样东西会一起坏。**`<button>` 的内容模型不许再套 `<button>`，而箭头必须是一枚真的按钮——只有真的可点元素才拿得到「只展开清单、不进网页」这一下（靠的是 `@click.stop`）。于是身子只能做成 `role="button"` 的盒子，可它一旦是 `<div>`，两处「只有按钮才有的待遇」当场不管它了：`base.css` 的全局重置（`button { cursor: pointer }`）不再给它手型光标；`useWindowDrag` 的免拖名单（`INTERACTIVE = 'button, input, …, [data-drag-ignore]'`）不再认它——按住它会把窗口一起拖走 | `<div role="button" data-drag-ignore tabindex="0">` 里装一枚 `<button class="caret">`：cursor 自己写、`data-drag-ignore` 自己声明、键盘自己收（`@keydown.enter` / `@keydown.space.prevent`，与点它同一条路）。同一笔账先前已经在标签格那枚 ✕ 上算过一次（那里也是 div 套 button）。另外**锚点取整枚而不是箭头那 16px**：面板按 `anchorRect` 摆在按钮下方，挂在箭头上会让整块面板跟着右移，看着像从按钮右边缘长出来的。验证：`preview.js --click-fallback` 数假桥记下的 `openPopover` 次数——改之前按身子也会弹一次清单，改之后按身子 0 次、按箭头恰好 1 次，且停在设置上按身子回到原来那张网页（`FALLBACK_OK`） |
| Q51 | 把 Chromium 内置 PDF 阅读器那一张白纸变透明，办得到吗 | **办不到：那张纸一个像素都不归页面管（实测 0/120000）。**400×300 的离屏窗里数：白纸矩形 `[67,59]–[332,191]` 占 29%、阅读器自己的底色 `#282828` 有 58144 个像素、**透明像素 0**。注入与页面注入同一份的 `html, body { background: transparent !important }` 之后**一个像素都不差**；`filter: invert(1)` 倒**落到了**插件上（像素大改）——但反色变不出透明；能算出 alpha 的 SVG 滤镜（`feColorMatrix` 亮度→alpha，先在一张普通 HTML 页上验证有效：绿→(92,92,92)、白→透明）在 PDF 表面上**什么都不改** | 那张纸是 PDFium 直接画在插件表面上的，既不经过页面的样式、也不经过它的合成——除非换掉渲染者，「透明底 + 只剩字」没有别的入口。于是换成 pdf.js（Apache-2.0，与 GPL-2.0-or-later 相容）自己画进 canvas（Q52 起）。同一台量具顺手量了 TXT：59600/60000 透明、400 个深色像素——**TXT 天生就是这个样子**，所以这一版动的只有 PDF。实现落在 `src/renderer/src/pdf/PdfApp.vue` 与 `src/renderer/pdf.html`（第三张自家页面，同一个 preload）；PDF 不再开成 `file:` 标签页交给内置阅读器（`src/main/ipc/registerFileIpc.ts`） |
| Q52 | 「这一页有没有一张画出来的纸」这条界线取在哪儿（它只在一件事上说话：画上的那些像素以深色为主时） | **取在 0.35，落在量出来的空档里；原来的 0.8 差 5 个点就翻车。**六份素材实测「画上的像素占整页的比例」：纯文字 2.6% / 中文 3.8% / 一块彩色插图 17.9% / 一块白纸 28% / **带页边距的深底 45.4%** / 整页深底 84.9%。浅色占多数时这条界线根本用不上——实测把一块白纸（28%）分别在界线 0.35 与 0.2 下各跑一遍，**逐项读数完全相同**（透明 561598 / 中间 16962 / 均 alpha 3.4），因为零点两边都算成 1；它只在「以深色为主」时说话，而那时只有两种解释：那是一张深纸，或者那是字／插图——字铺不满三分之一页（排满的正文 4–8%）。**0.8 那一档下，那张 45.4% 的深底页被判成「没有纸」**：`spike/pdf-render.js render slab auto` 读数 透明 317036（53.8%）、**墨色 261524、均 alpha 102.9**——整块深底（一页的 44.4%）留成一块实心墨，浅色的字被压在下面（alpha 只剩 7%），一个字都读不出来；改成 0.35 之后同一页：透明 560570（95.2%）、墨色 17990、均 alpha 5.3 | `src/renderer/src/pdf/keying.ts` 的 `PAPER_SHARE = 0.35`，余地全写在那一格的注释里（28% 与 45.4% 之间，而且**往低处偏**：漏判一张深纸是整页读不了，把一块大插图当成深纸只是那张插图消失——彩色本来就明写了要放弃）。这一档没有万全的界线（一页上「纸」与「大块深色」本来就是同一个东西），认错了按右下角那枚键手动顶掉。素材 `slab`（带页边距的深底）就为它造的，`spike/pdf-scheme.js` 的 Q5 一路量到它 |
| Q53 | 自渲染这一页，「纸」与「墨」各自的零点落在哪儿 | **纸取中位数，墨得在实心像素里量。**四条判据逐条都有来历：①透明背景只对**没画纸**的页面有效（纯文字页 563362 个透明像素，而真画了白矩形的页面它一点用没有）；②`keep = 1 - 亮度` 会把「不是纯黑」的深纸留下一层 6.7% 的灰雾（实测 meanAlpha 18.5、整页只透出 11%），所以要以纸为零点；③「有没有纸」与「哪一面是纸」是两个问题，混成一个会把正文整个抹掉（实测 median 16 被当成深纸 → 只剩 7321 个像素，界线见 Q52）；④纸那一头定成中位数之后，**墨那一头也得跟着定**：正文极少是纯黑（这一版素材印出来全是 #111，亮度 0.067），`(P-L)/P` 只给出 0.933——字是 93% 的墨，桌面上那 6.7% 从笔画里透出来，与 ② 是同一个数、同一个毛病，只是换到了另一头。做法是在**实心像素（alpha ≥ 128）**里取最暗（或最亮）的 0.5% 当墨那一头，据此把量程拉到 1 | 全在 `src/renderer/src/pdf/keying.ts`，那份文件头四条判据逐条带着这些数。**「实心像素」这一条是踩出来的**：一开始与判纸合用同一份直方图，而纯文字页只画了 2.6% 的像素、「最暗的 0.5%」只有几十个，被半透明的那条裙边占了（a=8 附近 #111 的 RGB 是 premultiply 反算出来的，会算成 `(0,0,0)`）→ 量程算成 1、字停在 **238/255**（93%，正好又是那层 6.7% 的纱）；只收 alpha ≥ 128 之后同一页 253/255、深底那几份 255/255（`spike/pdf-scheme.js` 的 Q3a/Q4 断言 ≥ 250，改之前六份里 plain 与 cjk 当场红）。整页最深的墨也没比纸深多少（不到四分之一量程）时不拉量程：那一页没有「墨」可谈，放大只会把底纹与噪点变成字（`INK_SPAN_FLOOR = 0.25`） |
| Q54 | 阅读页在 `file:` 下，怎么取到那本书与 pdf.js 要的四样资源 | **主进程开一条自己的协议，页面只拿一串 token。**从 `file:` 页面 `fetch('file:///…')` 是被挡死的（file 来源不透明，CORS 过不去），而 pdf.js 的 cMap / 标准字体 / wasm / iccs 全是运行时按需 fetch 的。于是 `zhituan-pdf://doc/<token>`（支持 Range：`0-99` / `100-199` / `-50` 三种写法都实测 206 + `Content-Range` 正确 + 逐字节相同）＋ `zhituan-pdf://asset/<目录>/<文件>`（四样资源取得到：cmap 43366 字节；wasm 104852 字节、魔术字 `0061736d`、内容类型 `application/wasm`——pdf.js 走 `instantiateStreaming`，这一条写错会当场拒收）。两条「不许」也验了：`..` 穿目录 400、白名单外的目录 404、不认识的 token 404 | 协议注册必须在 `app ready` **之前**（特权只能在那之前声明），落在 `src/main/services/pdfReader.ts` 的 `registerPdfScheme()`，由 `index.ts` 在模块体里调用。**路径不出主进程**：页面手上只有一次性 token，既不知道这本书在哪儿，也不能顺着协议去要别的文件——README 里那条「只显示文件名」说的是显示，这里是连内部也不外传。打包时 pdfjs-dist 只留 cmaps/standard_fonts/wasm/iccs 四层，其余在 `electron-builder.yml` 里 negate 掉 |
| Q55 | pdf.js 6（6.3.289）在这个环境里有哪几条「不给就静默失败」的硬要求 | **三条，一条比一条安静。**①`RenderParameters` 里必须**显式给 `canvasContext`、并把 `canvas` 写成 `null`**（两者只认一个）：pdf.js 自己取上下文时写的是 `getContext('2d', { alpha: false })`——那会开出一张**不透明**的画布，在透明窗口里就是白底，这一页的全部意义当场没了。②worker 必须走 `?worker&inline`（打成一个 blob）：`file:` 文档 `new Worker()` 一个 `file:` 脚本会被当成跨来源挡掉（来源不透明），因此 pdf.html 的 CSP 里要有 `worker-src blob:`。③`getContext` 的**选项只认第一次**：同一个画布上谁先取谁定规矩，`willReadFrequently` 会被先到的那一次（不带选项的）当场废掉——没有它 Chromium 把画布放到 GPU 上，每页一次全屏 `getImageData` 就成了昂贵的回读，控制台还会抱怨一句。另有两条不吭声的：`PDFDocumentProxy` 上没有 `destroy()`（长在 loading task 上，收摊要关的是它），`useWorkerFetch` 对我们这条自定义协议为 false（cMaps/wasm 由主线程取——也正因此那条协议要 `corsEnabled`） | 前三条都写在 `src/renderer/src/pdf/PdfApp.vue` 的注释里（`canvas: null` / worker 那个 import / 上下文在 `onMounted` 里抢在最前面取）。第③条是探针先踩的：探针为了读像素早一步 `getContext('2d')`，页面自己那次带选项的调用当场失效、警告立刻出现——**修在产品里**（上下文改为 `onMounted` 里先取），探针也跟着改成只在画布画过之后（`width > 1`）才去读 |
| Q56 | 右栏那条缩放改的是什么，页面怎么知道该重排 | **改的是 devicePixelRatio，而且 `resize` 一次都不发。**实测 `wc.zoomLevel = 1`（1.2 倍）之后：dpr 1 → 1.2000000476837158、`clientWidth` 从 784 掉到 653、窗口与文档的 resize 事件 **0 次**。于是页面只能从 dpr 认出缩放：`z = 现在的 dpr / 第一次画成时的 dpr`，宽度写成 `clientWidth * z`，画布按 `cssW * dpr` 开设备像素——放大是**重新排版**，不是把画面拉大（`spike/pdf-scheme.js` Q6：画布宽 640 → 768 即 ×1.200、CSS 宽不变、`--zhituan-zoom` 1 → 1.2、正文区出现横向滚动） | `src/renderer/src/pdf/PdfApp.vue`：dpr 变了不发事件，标准做法是拿一条「正好等于当前 dpr」的媒体查询听变化（`matchMedia('(resolution: …dppx)')`），每变一次再重新注册一条——查询串里的数值要跟着走。右下角那条浮层的每一处尺寸都按 `--zhituan-zoom` 除回去（CSS 值四则里的 `calc(12px / 1.2)`；不用 `transform: scale()` 反着缩，那会把圆角与 1px 的边一起拉花） |
| Q57 | 这一支探针自己摔的两跤（都不在 `src/` 里，但下一次写探针会再遇到） | **① `app.getAppPath()` 是「传给 electron 的那个路径」。**`electron spike/pdf-scheme.js` 让应用目录变成 `spike/`，于是按它去找的 pdfjs-dist 资源全 404。**②一条 junction 能让 `rm -rf` 走进仓库。**探针把「应用目录」摆在 gitignore 的 `spike/out/pdf-stage` 下，里面有一条 `node_modules` junction 指回仓库；一次 `rm -rf spike/out/pdf-stage` **顺着它进了仓库**，把真的 `node_modules/.bin` 与 `electron/dist` 删掉一批（代价是重装一遍 + `node node_modules/electron/install.js`，事后用一份扫全部包入口的清单验完整） | ①的解法是**把自己重开一次**：外层只摆目录（package.json + node_modules junction + `probe.cjs`），再 `electron <stage>` 重开，里层才是量东西的那一个——应用目录于是长得像真的，而渲染产物按 `rendererUrl` 的 `../renderer/` 摆在 `<stage>/main/renderer`（esbuild 的 `outbase` 取 `src`，模块正好落在 `<stage>/main/services`）。②的解法是摆目录那一步**永不删**（`fs.rmSync` 也不行）：逐层 `mkdir` 覆盖着写，旧哈希的文件留着无害。这一版还学到一个更贵的：**主进程里抛异常，Electron 不会退出**——它只是不再往下走，变成一个没有窗口、也永远不结束的进程（探针被埋过一次：摆目录 EPERM 之后挂在那儿等人去杀），因此凡是「一失手就再也回不来」的地方都走一句 `fatal()` |

| Q58 | `insertCSS` 注进去的样式，`removeInsertedCSS` 撤得掉吗 | **分来源：默认来源撤得掉，`cssOrigin: 'user'` 撤不掉——而且不报错。**五遍实测（`spike/css-remove.js`，每一遍都在注入后与撤掉后各读一次页面自己算出来的值）：①默认来源 `0.4 → 1`；②user 来源 `0.4 → 0.4`；③user 来源 + `!important` `0.4 → 0.4`；④同一页上先插过一张别的 user 表再撤 `0.4 → 0.4`；⑤撤掉之后再插一条 `0.7 → 0.7`。也就是说 **user origin 那一支的撤除是空的**，promise 照常 resolve，页面纹丝不动 | 离线阅读透明度在 **TXT 那一半**上原本就这么写：注入 `html{opacity:.4!important}`（user origin，为了压过页面自己的 `!important`），拉回 100% 时撤掉。于是「淡得下去、回不来」——而且它安静得只有量像素才看得见：`live-app.js` 的 A12 读到「撤掉了、可页面算出 0.4、合成后的像素也是 0.4」。改用 **CSSOM 上的一条行内声明**（`documentElement.style.setProperty('opacity', v, 'important')` / 回 1 时 `removeProperty`）：自己写的自己删得掉，行内 `!important` 比页面样式表里的任何同属性声明都强，而且 **CSP 管不到 CSSOM 写的属性**（它只管从标记里解析出来的样式与 `<style>` 元素），本机那些自带 CSP 的 HTML 也照淡。见 [architecture.md](architecture.md) 第 20 条 |
| Q59 | 一页是**黑字 + 全透明底**时，量它的透明度该量哪一种底 | **只有「贴在白纸上」那一份量得出来；「贴在黑桌上」那一份恒为 0、什么也证明不了。**这一页的字是黑的（亮度 0）、底是透明的（alpha 0），于是 `黑上 = 亮度 × alpha` 无论透明度是多少都是 0（幅恒为 0），而 `白上 = 亮度 × alpha + 255 × (1 − alpha)` 在 100% 时是 0–255、在 40% 时是 153–255——**幅 255 → 102，正好是 0.4 倍**。于是判据取「幅」而不是绝对值（整体乘一个数，幅就按同一个数缩，与底是什么颜色无关），并要求两种底都算、只要有**一种**量得出来就算数 | `live-app.js` 的 A12 用它把「淡下去」与「回得来」各验一遍（255 → 102 → 255）。它也是「同一屏上两种坏法分得开」的前提：幅本身分不清是**没撤掉**还是**没重画**，因此每一次抓图旁边都另读一份**页面自己算出来的 `opacity`**——两个数一起看才知道该往哪边查（Q58 就是这么定位到的）。同理，改值之后要等过合成那一帧再抓（A12 等 600ms），它和 Q11、Q47 是一件事的不同面孔 |
| Q60 | 在**未打包**的 app 里，怎么认出探针自己新开的那一屏 | **按 `file:` 前缀认不出来。**未打包时界面层自己那几份文档（`index.html`、`home.html`、`pdf.html`）也是用 `loadFile` 从磁盘取的，地址同样是 `file:` 开头——于是「`win.contentView.children` 里第一个 `file:` 的孩子」拿到的是**整扇窗那么大的界面层**：三个读数一模一样，看上去像「淡了也没淡」，其实一次都没量到那本书（尺寸 1013×570，正是界面层） | 按**整条地址逐字认**：`v.webContents.getURL() === 地址`（那句地址由探针自己 `pathToFileURL` 造出来，与它喂给 `tabs.create` 的是同一个值）。顺带把「走一遍非 ASCII 文件名」这件事带上（书名里带括号与汉字，`file:` 那条百分号编码的路也就真的走过一遍）。它与 Q42–Q45 同类：**探针认错对象时，红的不是产品** |
| Q61 | 五份渲染进程文档之间有继承路径吗——「主题只管起始页」这条边界靠什么成立 | **没有继承路径，每份文档各自是 `:root`。**五份文档（`index.html` / `home.html` / `popover.html` / `settings.html` / `pdf.html`）引的是**同一份** `themes.css`（产物里叫 `useTheme-<哈希>.css`，见 Q32），但 `data-theme` / `data-world` 是写在**文档自己那个 `<html>` 上**的，而文档之间跨 `WebContentsView`、跨 `loadFile`，既没有继承、也没有广播——**这份样式表在某份文档里是哪一套，只由「那份文档自己写没写这两个属性」决定**。实测（`spike/theme-chrome.js` 的 Q2/Q7）：把 `ui.homeTheme` 依次摆成纸白 / 暗夜 / 磷绿，界面 / 面板 / 设置 / PDF 四份文档的读数**逐条相同**，而起始页那三套两两不同；探针另打的那组 `PAINT` 更直白——三套入参下顶栏与右栏都是 `rgb(255, 255, 255)`、设置页底都是 `rgb(246, 247, 249)`、PDF 墨都是 `#15181d`，只有起始页底在动（`rgb(249, 250, 251) → rgb(18, 21, 28) → rgb(5, 11, 7)`） | `dataset.theme` / `dataset.world` 在 `src/renderer` 里只出现在 `composables/useTheme.ts`，而它只被 `home/HomeApp.vue` 调用——**1.5.1 的边界就是这一处调用**，不是任何开关或白名单。同一个机制在 `--zhituan-alpha`（背景透明度）上早就用过：`useBackgroundAlpha.ts` 同样各文档自己写，弹出面板那份里还留着一句注释说它不继承。反过来说，1.0.0 能让主题管到整个界面、1.4.0 又把它扩到 PDF 那一页的墨色，靠的都是**每份文档各写一遍**——越界之所以会发生，正因为那条边界的实现是「到处都写」而不是「一处写、别处继承」。于是 1.5.1 的修法是**删掉那几处写入**（`ChromeApp.vue` / `PopoverApp.vue` / `SettingsApp.vue` / `PdfApp.vue`），而不是在各处加判断——**要证明一条边界没被跨过，判据是「那几份文档三套入参下读数相同」，不是「它们各自算出来的是纸白」**（后者写死一个颜色也能过） |
| Q62 | 右栏那条「阅读透明度」要淡的是**纸**——那张纸还在位图里吗，要把它调出来是不是得重算一遍画面 | **不在了。**键控那一趟（Q51–Q53）把纸写成了 alpha 0、把墨**归成同一个近黑**，因此一页画布上只剩墨：实测（`spike/pdf-scheme.js` 的 Q9）滑块从全透到全实走一遍，`readPage` 数出来的 `darkInk` / `lightInk` **逐次相同**，画布元素的 `opacity` 恒是 1，动的只有元素底色那条 `rgba()` 的 alpha（0 → 0.6 → 1 → 0） | 于是一块**普通的 CSS 底色**就是把纸补回来的全部——合成器做的，画布里的字节一个都不变（`getImageData` 读回来与不淡时逐字节相同），拖动才能跟手；而「**字不跟着淡**」不是小心写对的地方，是**结构上做不到**：滑块碰得到元素底色，碰不到位图里的墨。选它而不选「把 alpha 乘进键控那一趟」也是这个道理——后者要整页重算 50–100ms（Q51 记过这个数），一条滑块拖不动。反过来说，**同一个值落两处**（PDF 落纸、TXT 落整页 `opacity`）之所以必须分开写，是因为 TXT 那一页的纸是 Chromium 画的、我们碰不到，而注入一张带 alpha 的用户样式表**撤不回来**（Q58）——这一条是平台给的，不是选择 |
| Q63 | EPUB / MOBI / AZW3 能不能「导入」——Chromium 认不认这三种格式，要读它们是不是非得自己写一套排版 | （`spike/epub-import.js`）**Chromium 一个都不认：它进的是下载那一路。**把 `file:///…/sample.epub` 交给视图，`will-download` 到场（`mime` 是 `application/epub`、存成 `sample.epub`），而 `loadURL` 当场以 `ERR_FAILED (-2)` 结束——这一页从来没进过渲染器。地址栏那条路也拦不住：`file:` 在 `@shared/url` 的 `HAS_SCHEME` 白名单里，把路径粘进去走的是同一条。**但解出来的正文是另一回事**：EPUB 就是个 ZIP、正文就是 XHTML，`node:zlib` 一把解完（5 条、0ms），解出来的章节当一页加载拿到的是 `application/xhtml+xml`，渲染得起来，现有那两条注入也**原样落得下去**——注入前 `body` 底色算出 `rgb(255, 255, 255)`、**透明像素占比 0**（那张纸是 EPUB 自己的 CSS 画的，`margin-top: 48px` 证明它的样式表真加载了）；`insertCSS('html, body { background: transparent !important }', { cssOrigin: 'user' })` 之后占比 **0.97**，「在黑上的幅」从 238 掉到 17——**纸没了、字还在**。带 CSP 的那一份读数与此逐个相同：user 来源的 `!important` 在层叠里压得过作者来源的 `!important`，而 CSP 根本不管 CSSOM（Q58 那条路选对了）。对照一页同字的 `.txt`：占比 0.99 | 于是「读 EPUB」这件事**平台层面已经通了**。选文件框现在不列它是对的（列了会让人选中一本、然后看着它变成一次下载），但要支持它**既不必写排版引擎，也不必添第四个运行时依赖**——解包与渲染都是现成的。真正没做的是产品那一层：分章、目录、进度、字号；外加一条协议上的必答题——`.xhtml` 在 Chromium 里走的是 **XML 解析器**，正文非良构就整页变解析错误（实测 `parsererror` 为真、整页只剩 4 个字），而 EPUB 3 要求正文良构，因此要做就得先把每一章洗一遍。MOBI / AZW3 不在这一条里：它们既不是 ZIP 也不是 XHTML，没有一条能共用的路——除非先解成 EPUB 再进来 |
| Q64 | 写一支探针时会踩到的三件事——都不影响 `src/`，但每一条都决定下一次该怎么写 | （`spike/epub-import.js` 一次撞齐）**① 销毁窗口会让 app 走进退出流程。**量完第 1 条就把那扇窗 `destroy()`，而下一扇还没建——Electron 见「窗口全关」即进入退出（默认行为），此后每一次 `loadURL` 都返回 `ERR_FAILED (-2)`，读起来像「`.xhtml` 加载不了」，其实与那个文件毫无关系。一条空的 `app.on('window-all-closed', () => {})` 就好。**② 隐藏窗口里 `capturePage()` 不给 alpha。**`show: false` 的普通窗口取回来的图 alpha 全是 255，于是连**确定会透明**的那一页 `.txt` 都读成「透明像素占比 0」——看上去像「注入没生效」。要量「纸在不在」，窗口必须 `show: true` 且 `transparent: true`（Q20 同一族；`preview.js` 的 `--alpha` 就是这件事）。**③ `app.whenReady().then(async () => …)` 里的异常不会带走进程。**它是没人接的拒绝，进程就那么挂着、终端一片空白、退出码也不像错，读起来像「探针跑得慢」。若外面还套了一层 `\| grep`，管道按块缓冲，被 `timeout` 杀掉时缓冲全丢，连「跑到哪儿了」都看不到。因此探针一律：兜底 `unhandledRejection` / `uncaughtException`、加一道看门狗、**日志落文件而不是穿管道** | 三条同属「探针认错对象」那一族（与 Q42–Q45、Q57 同类）：红的不是产品。第 ① 条尤其值得记——它的症状（此后每一次导航都失败）与「这个格式不支持」长得**一模一样**，本次正是认出它才没把一个探针的坑写成一条产品结论；第 ② 条则说明「判据读计算样式还是读像素」这件事本身也要先量一遍：计算样式说 `transparent` 时，画布上那张白纸可能照样在 |
| Q65 | 章节不住在自己那一份文档里，而是住进**我们自己的阅读页**（方案 A）——这个模型立不立得住：书里的选择器还命不命中、纸能不能归我们画 | （`spike/book-page.js`）**立得住，而且两件都成。**先摆一个对照组：章节当**独立文档**加载时，`document.contentType` 是 `text/html`（协议按 `text/html` 送、绕开了 XML 解析器）、`parsererror` 为假、相对地址 `../images/dot.svg` 由 URL 自己解析成功（`naturalWidth: 4`）。再把它注入我们自己的页面：`createElement('body')` 摆进 Shadow DOM 之后，书里那条 `body { margin-top: 48px; font-size: 20px }` **照样命中**——读回来就是 `margin-top: 48px`、`font-size: 20px`；换成 `div` 或 `html` 就只剩 UA 默认值（`0px` / `16px`）。我们那条 `html, body { background-color: transparent !important }` 排在书的样式表**之后**注入，书的 `#ffffff` 纸被收掉（算出来 `rgba(0, 0, 0, 0)`），而 `p { color: #112233 }` 照旧生效（`rgb(17, 34, 51)`）。纸归我们画的两个读数：纸全透一档**全透占比 0.9836**、不透明 0.0055、平均 alpha 2.7（对照 Q63 的 0.97）；**纸 0.5 一档全透 0、平均 alpha 129.3，而不透明占比仍是 0.0055——一个像素都没变** | 「章节进自家页」这条路**不用改写书里的选择器**（第 1 条把「要不要在注入时把 `body` 映射成别的容器」这个问题直接答掉了），于是这条路只剩下「相对地址得自己改写」一件必须做的事——因为注入之后 URL 的基准变成了我们那一页的地址（`book.html`），书里写的 `../images/x.png` 会解析到我们自己的目录去。而第 3 条那一对读数把「**字实心、纸渐显**」在 EPUB 上钉死了：两个透明度档下不透明像素占比逐位相同，说明滑块碰得到纸、碰不到字——与 PDF 那一页（Q62）落在同一个语义上，而这一页的纸是**我们自己的一块元素**，不涉及位图，也不涉及那张撤不回来的用户样式表（Q58） |
| Q66 | 这条链路真的接通了没有——一本真 EPUB、真的 `services/bookReader.ts`、真的构建产物 `out/renderer/book.html` 从头走一遍 | （`spike/book-open.js`；样本由 `spike/make-test-epub.py` 用 `zipfile` 造）**通了。**协议那一段：`.xhtml` 回 `text/html; charset=utf-8`（不是 `application/xhtml+xml`），`.css` / `.svg` / `image/svg+xml` 各归各位，带空格与中文名的条目（`OEBPS/images/我 的.svg`）拿得到（那条请求是 `%E6%88%91%20%E7%9A%84.svg`），`../../../../etc/hosts` 与书里没有的条目都是 **404**（点段被 URL 归一化掉了，落回书内再查不到）。页面那一段：书名与目录从 `nav.xhtml` 读出来（`第一章 纸 · 1/2`），`linear="no"` 的附录**没有**进章节表，目录三条的缩进分别是 22px / 36px / 22px（**嵌套层级是对的**）；章内两组 <img> 都加载成功、书的 `margin-top: 48px` / `font-size: 20px` / `p` 的颜色全部生效、书在 body 上的 `#fff` 已收掉；正文里那枚 `<script>` 与 `onload=` 一个都没留下（阴影里 script 数 0、残留事件属性 0，页面上那两个记号都是 `undefined`）。**故意写成非良构**的那一章（`<p>` 不闭合）照样读出 1665 个字的正文、`残留的事件属性数` 仍是 0——那条「`.xhtml` 按 text/html 送」的逃生口确实救了它。像素那一段：纸全透 0.9263、纸 0.5 时 0、**不透明占比 0.035 两档逐位相同**。**探针自己在这趟又摔两跤**：① `<link>` 是**异步**的，注入完立刻读计算样式读到的是 UA 默认值（body `margin-top` 是 8px 而不是书里写的 48px），差点据此写出「书里的 body 规则命中不了 Shadow DOM、得改写选择器」这个**与真相相反**的结论；② Vue 的 DOM 更新在**下一个 tick**，点完「目录」当场读 `.toc__item` 得到空数组，而紧接着那句 `items[1]` 又点到了第一章底下那个**嵌套锚点**（nav 里第三条 `a` 才是第二章），于是读数一动不动 | 第 ① 条是 Q65 那条结论的**前提**：如果量早一步，模型就会被判成「不成立」，而实现里会多出一整套没必要的选择器改写。第 ② 条与它同族——**探针的错看起来像产品没做出来**（一次像「目录没做出来」，一次像「翻章坏了」），这正是 Q64 那一族要继续记下去的原因。至于链路本身：解包（`node:zlib`）→ 协议 → `DOMParser` 解 OPF / nav → 清洗 → 改写地址 → 注入 Shadow DOM → 翻章 → 量像素，全在一条真的通路上跑过，**运行时依赖仍是 3 个** |
| Q67 | 把 `kind` 判成 `'book'`，就等于「这本 EPUB 读得起来」了吗 | （`spike/live-app.js` 的 A13，在**真身上**走真 `tabs.create`）**不等于——判定与加载是两件事，而漏掉后一件的症状与「这本书是坏的」一模一样。**`create()` 里 `kind` 判完，视图要加载什么由另一条分支（`viewUrl`）决定：PDF 那条一直在（`pdfReaderUrl`），EPUB 这条**没接**。于是开一本 `.epub` 走完 `tabs.create` 之后，`TabEntry.kind` 是 `'book'`、`kind` 该管的两件事也都对（进标签条、带 preload），**视图里加载的却是那个 `file:///…/x.epub` 本身**——而 Chromium 对这种格式只会把它变成一次下载（Q63 量过：`will-download` 到场、导航以 `ERR_FAILED(-2)` 收场），用户看到的是「没反应」或者一次下载。**上一跑（Q66）照不出来**：那一支探针用真的 `bookReader.ts`、真的 `book.html`，但它**自己拼好阅读页地址再喂给窗口**，恰好绕过了 `create()` 里那一步 | `src/main/services/tabManager.ts` 的 `create()`：与 `kind === 'pdf'` 并列补一条 `'book'` 分支（解析不出路径时与 PDF 同一条退路：退回普通网页打开）。判据因此不能是「开没开出一张新标签页」——那张页两种情况下都开着。写成两条一起看：**按整条地址逐字认**那一屏是 `book.html?doc=…`（认法与 Q60 同族），**并且**场上没有任何一屏加载的正是那个 `.epub`。这一条与 Q42–Q45、Q57、Q64 同族：**红的不是产品，是探针认错了对象**——只不过这次认错的是「探针自己替产品走了一步」，而真身上那一步才是会坏的那一步 |
| Q68 | 探针起重真主进程时，只把 `userData` 指到临时目录，挡得住改名搬迁吗 | （现场是一次 `live-app.js` 的跑动）**挡不住——而这一条动的是用户的真数据。**`migrateLegacyUserData()` 判的是 **`app.getPath('appData')`** 底下的 `moyu-reader` / `zhituan` 两个目录，它读的**不是** userData。于是探针每跑一次（它只改 userData）都会在用户的真 `%APPDATA%` 上做一次整目录搬运。实测那次之后 `%APPDATA%\zhituan` 被建了出来，里面只有 **4 个条目**：`ball-icon.json` 与 `bookmarks.json` 与 `moyu-reader` 里的**逐字节相同**（是副本）、`Cache` 是 0 字节空壳、**`config.json` 与 `history.json` 一个都没有**——拷贝中途失败，而异常被那句「一律不抛」吞掉，日志又落在临时目录里，所以表面上什么也看不见（`stat` 的创建时间把那一刻钉死在 19:23:54，正是那一跑）。真正的代价不是那半份副本，是**搬迁的判据**：「新目录还没建起来」——而它一旦存在，**下一次启动不再重试**，用户会以为配置、书签、站点与登录态全丢了，而且再也不会自己回来 | 两头都要改。**探针那一侧**：`live-app.js` / `book-tab.js` **同时** `app.setPath('appData', TEMP)` 与 `setPath('userData', TEMP)`——两道隔离缺一不可（`spike/env-pitfalls.js` 的文件头记了第 5 条）。**产品那一侧**：把搬迁做成两步——先 `cpSync` 到 `zhituan.migrating`，成功了再 `renameSync` 到正式名字（`src/main/index.ts`）。改名是原子的，于是「新目录存在」重新等于「搬迁已完整做完」：失败就什么都不留，下一次启动自动重试。判据也顺手变成一句可执行的：**跑完探针之后 `%APPDATA%` 里不多出任何东西**（`book-tab.js` 那一跑前后各列一次目录，修前多出 `zhituan`、修后不多出） |
| Q69 | 自家的 EPUB 阅读页拿得到 `window.zhituan` 吗 | （`spike/book-tab.js` 的 T4，在真身上）**拿不到——而症状是「控件拖不动」，不是报错。**`src/preload/index.ts` 那份白名单（`OWN_PAGES`）列了 `index.html` / `home.html` / `popover.html` / `settings.html` / `pdf.html`，**没有 `book.html`**。于是这一页上 `window.zhituan` 是 `undefined`：纸的透明度永远读到默认值 1（纸全透）、排版三项一个都传不进 Shadow DOM、`zhituan.book.remember` 一调就抛——而那个异常落在 `void show(…)` 里，只是一条没人接的拒绝，屏幕上安安静静。实测把那一跑的两个读数摆在一起就看得见：`getComputedStyle` 回来的 **字号 16px / 行距 normal / 左留白 0px**（连书里写死的 `font-size: 20px` 都没生效，见下一条），而在书页里直接执行 `window.zhituan.config.patch(…)` 当场抛 `Script failed to execute` | 白名单加 `/book.html`（`src/preload/index.ts`）。这一条与 Q67 同族，而且正是**同一支探针**抓的：两处都是「上一轮的探针自己替产品走了一步」——Q66 用 `spike/book-probe-preload.cjs` 自己造了一座桥（只暴露 `__probeSetOpacity`），于是「真桥给不给这一页」这件事从来没被问过；Q67 是自己拼好阅读页地址、绕过了 `create()`；这一条是自己造桥、绕过了白名单。教训要落在**判据**上：这一条不是量出来的，是**调出来的**——T4 直接调 `window.zhituan.config.patch(…)`，桥不在就当场抛，红得没有余地 |
| Q70 | `font-size: var(--x) !important` 在 `--x` 没设的时候会怎样 | （`spike/book-tab.js` 的 T4 第一跑）**整条声明作废，而 `!important` 还是会赢——于是连书自己写的排版一起被压掉。**`var()` 取不到兜底值属于 *invalid at computed-value time*：该属性退回 unset（字号变继承来的 16px、行距变 `normal`、padding 变 0），但**那条 `!important` 仍然压过书里 `body { font-size: 20px; line-height: 1.2 }` 的普通声明**。于是「我们还没准备好」这件事，被用户看见的样子是「这本书的排版坏了」——比不加这一层还糟。而配置是**异步**回来的（`useConfig` 先 `get()` 再填充），页面挂载那一刻 `config.value` 还是 null，正是这个窗口 | 三条都给兜底值，且兜底值**引 `@shared/constants` 里那三个默认值**（`DEFAULT_READER_FONT` 等），与配置那一侧同源——不是在这里再抄一遍数字（`book/BookApp.vue` 的 READER 那一块）。这条与 Q58「注进去的样式撤不回来」同一族：**凡是带 `!important` 的一层，都要先想清楚它压不到目标时会压到谁** |
| Q71 | 这一趟探针自己又摔了哪两跤 | （`spike/book-tab.js` 的 T4 / `spike/live-app.js` 的 A13）**① 按位置取元素，加一颗键就点到别处。**A13 里那句 `document.querySelector('.hud__key')?.click()` 本来点的是「目录」，而这一版在 HUD 里加了前面那颗「Aa」——于是点开的是排版面板，`目录项` 读回来 `{开着: false, 项: []}`，四行读数连着红，看起来像「目录没做出来」。**② 计算样式把无单位数与百分比都折算成 px。**T4 第一跑读回来的是 `字号 17px / 行距 31.45px / 左留白 60.1719px`——**一个完全正确的实现**，而判据是按字面值比 `1.85` 与 `6` 写的，于是红。那次读数本身没有错：`31.45 = 17 × 1.85`、`60.1719 = 1003 × 6%` | 两处都是判据的错，不是产品的错，与 Q66 的第 ② 条、Q64 那一族同源。**改法**：按**文字**找那颗键（`.find((b) => b.textContent.trim() === '目录')`，且找不到时如实报「没有那颗键」），以及比**比例**而不是比字面值（行距 ÷ 字号、左留白 ÷ 正文宽）。这一条值得单独记，是因为它把那一族的边界又往外推了一格：**同一支探针可以在同一次跑动里，一次替产品走了一步（Q69，是真缺陷）、一次把自己的读数读错了（本条第 ② 点，是假警报）**——两者混在一起时，谁都不该被另一个带过去 |
| Q72 | 点了「更新并重启」，应用关了，然后什么都没有——安装程序到底起没起来 | （1.6.1 真机）**没起来。**证据链：应用日志里两次 `静默安装并重启` 之后，`%TEMP%` 没有新增 NSIS 解包目录；用真安装包在探针里复现（同样的参数、`detached`、父进程活着），`spawn` 事件后 **512ms 进程退出、code 2**。对照 electron-builder 的 NSIS 模板（`templates/nsis/`），唯一会设 code 2 的是「旧版卸载失败」，但那条路有五次 × 一秒的重试，装不进 512ms——真正的死因在 `include/allowOnlyOneInstallerInstance.nsh`：**安装程序互斥锁（`${APP_GUID}`，由 appId 推出，两个版本同一把）**。早上那一个 1.6.0 安装窗口在桌面上开了九十分钟没关，于是此后每一个 1.6.1 安装程序都在 `.onInit` 里 `CreateMutex` 撞上 `ERROR_ALREADY_EXISTS` → `Abort`。两版的 `^SetupCaption` 不同（「纸团 1.6.0 安装」vs「1.6.1」），`FindWindow` 找不到旧窗口，连「把它叫到前台」那一步都省了，纯静默 | 产品的错不在安装程序，在**应用不问死活先退**：`spawnInstaller` 原来是「spawn 完立刻 quit」，安装程序夭折时用户手里什么都没有。**改法**：起与退之间加三秒**宽限期**（`UPDATE_SPAWN_GRACE_MS`），期内以任何姿态离场都算「没跑起来」——留在 ready（那一份仍是校验过的）、提示条说出原因（「若还有一个没关的安装窗口，先关掉它再试」）、按钮仍是「更新并重启」即重试；活过宽限期才 `unref + quit`。回归探针：`spike/update-check.js` 的 Q13（替身 `_fire('exit', 2)` 模拟早夭）。**附带教训**：诊断时「没有 NSIS 临时目录」不能证明「进程没起过」——NSIS 正常退出会自己删掉 `$PLUGINSDIR`，只有被杀的才留尸；真有分量的是**退出码 + 耗时** |

| Q73 | 升级时报 `Failed to uninstall old application files. Please try running the installer again.: 2`——那个 **2** 是谁的、为什么偏偏这时候来 | （1.6.2 → 1.6.4 真机）**2 是旧卸载器的退出码，是「逐个改名搬移」这条路逼出来的。**链路：新版安装器（`include/installUtil.nsh:224`）把旧卸载器拷到 `$PLUGINSDIR\old-uninstaller.exe`，用 `/S /KEEP_APP_DATA --updated _?=<安装目录>` 跑一遍；旧卸载器的 `un.atomicRMDir`（`uninstaller.nsh:38-96`）要把 `$INSTDIR` 下**每一个文件** `Rename` 到 `$PLUGINSDIR\old-install`，**其中一个改不动就 `Abort`**（`uninstaller.nsh:179`），进程以 2 退出；新版安装器的 `handleUninstallResult`（`installUtil.nsh:128-133`）见到 `$R0 != 0` 便 `MessageBox` + `SetErrorLevel 2` + `Quit`。**改名为什么会失败**：本机的安装目录是 `C:\Users\poem\Desktop\zhituan`——一个被反复扫描的目录（百度网盘同步空间、Defender 实时防护、资源管理器缩略图与索引器都会短时持有 `app.asar`、`*.dll`、`*.pak` 的句柄），而改名要求目录项独占，于是随机失败；这也正是「手动、晚一点、再跑一次」有时候能成的原因。另一个必要条件是自己还活着：升级是「先起安装程序、宽限期过后应用才退出」（Q72 那一版加的），而原生 `CHECK_APP_RUNNING` 找进程时按「路径前缀等于 `$INSTDIR`」筛、静默分支只 `Sleep 1000` 就动手，抓不住文件已被占住的那一瞬间。**附带一句**：那个框是英文的，因为 `templates/nsis/messages.yml` 的 `uninstallFailed` 有 `zh_TW` 却没有 `zh_CN`——中文标题配英文正文，就是这么来的 | 三层，互相兜底，全部落在 **`build/installer.nsh`**（由 `electron-builder.yml` 的 `nsis.include` 引入；这个文件在安装器与卸载器两次编译里都会被带上，所以每段的 `Var` 与标签都按「会被插进几个不同的函数/节」来写，宏一律带 `TAG` 参数区分标签）：① **`customCheckAppRunning`** 取代原生那一整套——按**镜像名** `taskkill /F /T`，拿退出码 `128` 当「本来就没有这个进程」的判据，最多重试 12 秒，收干净之后再留 1.5 秒让内核对象释放；**重点不是发出杀伤指令，而是确认它真的没了**。② **`customUnInstallCheck`** 取代 `handleUninstallResult` 里那段「弹框 + `Quit`」（`installUtil.nsh:112-116` 正是为这个替换留的口子）：`$R0 != 0` 且 `$INSTDIR` 下确实有纸团主程序时，收进程 + 带重试地 `RMDir /r`（两轮，各 12 次 × 1 秒），然后**照常返回、继续覆盖安装**——旧卸载器的行为我们改不了，能改的是「它失败之后怎么办」，**这一层才是把随机失败变成「能过去」的那层**（`$INSTDIR` 下没有主程序时绝不动手：全新安装时用户可能选了一个已存在的目录，那里面不是我们的东西）。**两轮之后还清不掉就如实停下**，弹一个说清楚原因的框（故意不带 `/SD`，静默升级下它照样要出现）：接着往下走的话，`File` 解压会把新文件铺在旧文件旁边，被占住的那些（多半正是 `app.asar`）留在原地，用户拿到的是一份「注册表写着新版本、`app.asar` 还是旧的」的混合安装——比直接失败更难查，而且下一次检查更新会原样再来一遍；③ **`customRemoveFiles`** 把 `uninstaller.nsh:164-188` 那块 `isUpdated` 的改名 / `Abort` 整块换掉，改成「先收进程、再带重试地直接删」——从 1.6.4 起升级不必再依赖第 ② 层。判据：`spike/nsis-abort-probe/lockhold.py` 用 `dwShareMode=0` 的独占句柄把「改名失败」从随机变成必然，再拿 1.6.2 / 1.6.4 两个安装包各跑一遍 `/S --updated --force-run`，比退出码与注册表里的版本号（`spike/nsis-abort-probe/installed-version.py` 读，PowerShell 的 stdout 在这个环境里常常回不来）。**真机读数**（1.6.2 装着——即 `Uninstall zhituan.exe` 是 1.6.2 那枚 138763 字节的，且 `resources\app.asar` 被 `dwShareMode=0` 独占）：**旧包**（`release/zhituan-1.6.2-x64.exe /S --updated --force-run`）——20 秒后进程仍在（`timeout` 返回 124），卡在 `uninstallFailed` 那个框上，与用户截图同一幕；**新包**——**退出码 0**、墙钟 36.9 秒装完、注册表 `DisplayVersion` 变 `1.6.4`、`--force-run` 把应用叫了回来（三个 `zhituan.exe` 进程），而 `%TEMP%\zhituan-install.log` 逐行走完：「安装前没有检测到纸团在运行 → 旧卸载器退出码 2 → 改为强制清场后继续覆盖安装 → [unc1] 尚未删净，第 1 次重试 → 已清空，继续覆盖安装」。**两条踩过的坑值得记**：①锁必须活过「安装程序启动 → 调用旧卸载器」那十几秒，第一次用 20 秒的锁就没赶上，日志里写的是 `旧卸载器退出码 0`——那不是修好了，是没量到；②`timeout … /S --updated --force-run` 那条命令里，`export MSYS_NO_PATHCONV=1` 被 `&` 关进了后台子 shell，于是前台那条 `/S` 被 MSYS 当路径转换掉、安装程序落进**交互向导**模式等人点，表现为「卡住 180 秒且日志一个字都没有」——`Section install` 根本没轮到执行。写成 `( … & )` 或把 `export` 留在前台即可。应用那一侧另加一道 `QUIT_WATCHDOG_MS`（`src/main/index.ts` 的 `quit()`）：退出链若停在 `before-quit` 的落盘上，到点直接切进程——它救不了「走不到 will-quit」的那种卡（Q72 那次卡过四十多秒），而更新流程里退出卡住的样子就是「应用关了，然后什么都没有」 |
| Q74 | 探针里「让页面自己按停一个播放器，再去检查它是不是还在停着」——为什么这条断言偶发假否 | （1.6.4 探针）`spike/media-pause.js` 的页面上有一个 `window.zhituanStart()`：先播起来，**250ms 之后由页面自己按停**一个播放器（用来验「用户自己按过暂停的那一个，切回来仍然是暂停的」）。Q13 因此偶发判否，读数里那个元素带着 `marked:true`——也就是**它被我们当成「正在播的」一起按了下去**。**原因不是产品**：那个 250ms 的 `setTimeout` 落在**隐藏的页面**里，而 Chromium 对不可见页面的定时器会**节流到大约一秒一次**（同一族的节流还有 `requestAnimationFrame` 完全停走）。于是「切走」先于「按停」发生，那一刻它确实还在播。 | 探针在切换之前加一道**前提等待**（`waitUntil` 轮询，等到两个页面里那个元素都真的处于 `paused && !marked` 再往下走），把断言的前提显式化成读数的一部分（这次记的是 `前提_那一个先得真的处于暂停态`），而不是靠 `delay` 猜时长。**可复用的那一条**：凡是「在后台页面上等一个由页面自己的定时器驱动的状态」，都不能用固定 `delay`——被节流之后等多久都不确定，只能轮询到稳定为止；反过来，探针里**不能**为了让断言好看而把隐藏页面叫到前台，那样量的就不是同一条路了。这与 Q29–Q33 是同一族（量的是探针的脾气，不是产品行为） |

| Q75 | 把卸载器的清场从「改名搬移 + `Abort`」换成「尽力而为地删」之后，**升级反而可能装出一份混合安装**——退出码去哪了 | （1.6.4 设计期，读模板 + 探针）**换掉的正是那个信号。** 原版 `uninstaller.nsh:164-188` 在 `isUpdated` 时走 `un.atomicRMDir`：把 `$INSTDIR` 里每个文件改名搬进 `$PLUGINSDIR\old-install`，**一个改不动就 `Abort`**——`Abort` 会把退出码置 2，安装器的 `handleUninstallResult` 据此判定「旧卸载器失败」并交给 `customUnInstallCheck` 清场。`customRemoveFiles` 把这个整块替换成 `RMDir /r` 之后，删不掉就只是**删不掉**：退出码默认 0，而 0 的语义是「目录清干净了」。安装器于是直接往下走，`File` 解压把新文件铺在旧文件旁边，被占住的那几个（多半正是 `resources\app.asar`）留在原地 —— 用户拿到的是「注册表写着新版本、`app.asar` 还是旧的」。**内层判据同时也在漏**：`customUnInstallCheck` 当时只在「`$INSTDIR` 下确有 `zhituan.exe`」时才动手，而 `RMDir /r` 是尽力而为的、**主程序照样被删掉**，留下来的形态恰恰是「`app.asar` 还在、主程序没了」——最该被认出来的那一种，反而看不见。**外层判据又不能简单地去掉**：`uninstallOldVersion` 一开始就把 `$R0` 置 0（`installUtil.nsh:152-153`），找不到旧版就提前返回、`$R0` 仍是 0，而 `handleUninstallResult` 是**每次安装之后都跑**的（`installSection.nsh:53`）——全新安装也会走进这个宏，而用户在全新安装时完全可能选一个**装着别的东西**的目录 | 两处一起改，方向相反：① **`customRemoveFiles` 末尾把信号还回去**——`${If} ${FileExists} "$INSTDIR\*.*"` 且 `${isUpdated}` 时 `SetErrorLevel 2`（普通卸载不报，那条路没人接这个码，报错只会让「没卸干净」失去落点）。② **`customUnInstallCheck` 的内层判据改认两处指纹任一**——主程序**或** `resources\app.asar`；外层 `$R0 != 0` 一个字不动，全新安装照旧整个排除在外。**顺带踩到一个 NSIS 形状坑**：探针里想给 `${isUpdated}` 钉一个「恒为真」，写成 `!define isUpdated \`"1" == "1"\`` 会编译不过（`macro "_If" requires 4 parameter(s), passed 2`）——`${If} ${isUpdated}` 展开成 `${If} "1" == "1"`，而 LogicLib 的 `_If` 收四个参数，少一个就炸；必须照 electron-builder 那两行的**形状**抄（`!macro _isUpdated _a _b _t _f` + `!define isUpdated \`"" isUpdated ""\``，即带空操作数的三元），见 `spike/nsis-abort-probe/isupdated-stub.nsh`。**判据：两个行为探针**（`spike/nsis-abort-probe/hook-branch.nsi` 与 `hook-remove.nsi`，都用 `-WX` 编译）——前者把四种组合各跑一遍（`退出码0+残留` 必须**不动**、`退出码0+别人的文件` 必须**不动**、`退出码2+只剩app.asar` 必须**清场**、`退出码2+主程序还在` 必须**清场**），四条全过；后者拿 `dwShareMode=0` 的独占句柄按住夹具里的 `app.asar`，断言卸载器**退出码 2**（墙钟 15 秒：`KillApp` 1.5s + 12 次 × 1s 重试），去掉锁则退出码 0 —— 正反两面都钉住 |
| Q76 | 「把 `app.asar` 锁住，让升级必然撞上旧卸载器失败」这一跑，跑三遍读出三个样子——哪一次是真的 | （1.6.4 真机，同一条链三遍）**①锁 20 秒**：日志 `旧卸载器退出码 0`、退出码 0、墙钟 35 秒。**②锁到哨兵（第一版）**：日志走到 `旧卸载器退出码 2`，接着两轮共 24 次重试，最后 `清不掉 … 停下并如实报错`，安装器被 `timeout` 杀掉（**124**）；注册表仍是 1.6.2，而 `$INSTDIR` 里只剩 `resources\app.asar`——主程序与卸载器都被那两轮 `RMDir /r` 删掉了。**③哨兵改成按字节找**：`旧卸载器退出码 2` → `[unc1] … 尚未删净，第 1 次重试` → `… 已清空，继续覆盖安装`，退出码 0。**①的病是锁过期**：从「安装程序启动」到「调用旧卸载器」之间要空**十几秒**（15:09:53 开头、15:10:22 才轮到旧卸载器），20 秒的锁只压住前半程——而那不是「修好了」，是**根本没量到那个失败**。**②的病是探针瞎了**：`%TEMP%\zhituan-install.log` 由 NSIS 的 `FileWrite` 写出，走的是**系统 ANSI 代码页**（中文机器上是 GBK；`od -c` 读出来是 `260 262` = 0xB0B2 =「安」），而哨兵按 `utf-8` 去找那个词，永远找不到，于是锁一直按到上限——安装器于是**真的**撞上「清不掉」。**③之后又发现第二个瞎子**：`lockprobe.py` 原先用一个固定名字的暂存目录，上一轮留下的同名项让 `os.rename` 以 winerror **183**（文件已存在）失败，而真占用报的是 winerror **5**（拒绝访问），**两行都写着 `BUSY`**——第一次跑时这两行同时出现，差一点一起咽下去 | 三处都改成**能对错**的读数，而不是「看起来对」：①**放锁时机交给哨兵**（`lockhold-until.py` 盯安装日志，出现 `旧卸载器退出码` 就松手）——那一刻恰好是「旧卸载器已经失败、安装器正要开始清场」，早了退回①的假象、晚了走到「清不掉」那条路（而那个框在静默模式下等人点，脚本就挂着）；②**哨兵按字节在多套编码里找**（utf-8 / gbk / utf-16-le），并把**「读不到」与「读到了但没有这个词」分开报**——两者的表现完全一样，本次正是靠这条诊断才认出是编码而不是路径写错；③`lockprobe` 每轮 `mkdtemp`，且「锁真在」另有**独立**证明（再开一次必须被拒、错误 32 = `ERROR_SHARING_VIOLATION`），不再只依赖它那一行 `BUSY`。整条链收进 `spike/nsis-abort-probe/e2e-upgrade.sh`，一条命令跑完、逐项打印读数。**顺带一条产品侧的观察**（不是缺陷，但要记住）：清场那两轮 `RMDir /r` 是**先删、删完才知道成不成**——真遇上永久占用时，它已经把主程序删掉了才走到「清不掉」那一支，用户手里的旧版就成了一份半删的目录，只能照框里那句话再跑一次安装程序（前提是占用的东西已放开）。原版的行为同样是破坏性的（`un.atomicRMDir` 把文件改名搬进 `$PLUGINSDIR\old-install`，而 `Abort` 之后那个目录随进程一起被删），所以这不算回归；真要更好，得改成「先改名到临时目录、确认搬完再删」，那是另一件事 |

## 对原设计的两处修正

**1. 无极透明度改用 `setOpacity`，而不是注入 CSS。**

原设计假定 `transparent: true`（DirectComposition 半透明路径）与 `setOpacity`
（经典 layered `LWA_ALPHA` 路径）是两条不可叠加的合成路径，因而计划把窗口透明度钉在 1、
改用向网页注入 `html{opacity:X}` 的方式。Q3 实测证明二者在本机完美叠加。

因此改用 `setOpacity` 作为主路径，这消除了整整一类缺陷：不必在每次导航后重新注入 CSS、
不必对抗页面自身样式、对任何网页都一致生效。原 CSS 方案降级为备选，由
`stealth.fadeStrategy` 控制。

**2. `setShape` 确认为命中区域主策略。**

Q4 显示被裁剪区域与桌面基线完全一致（差值 0），即区域外既不绘制也不接收鼠标事件。
这比 `setIgnoreMouseEvents` 方案更优：没有轮询竞态，显形条带天然可悬停、可拖拽。

> 后来这套机制整体移除了：窗口改成「收起时真的缩小成一枚球」，
> 尺寸本身就是命中区域，不必再靠裁剪去欺骗命中测试，`setShape` 也就不再有
> 存在的理由。Q4 仍然成立，只是现在没有调用点了。

## 仍需在真实环境验证的项

- **混合 DPI**：本机为 scaleFactor=1 的单显示器。125% / 150% 下
  `screen.getCursorScreenPoint()` 与 `getBounds()` 的坐标一致性尚未验证，
  这是「主体在光标仍在窗口内时误隐藏」最可能的成因。矩形计算必须走统一辅助函数。
- **多显示器**：跨屏拖动时的坐标与形状行为未测。
- **点击穿透的最终确认**：`setShape` 的语义由像素比对间接证明，
  仍需用真机测试确认——**把记事本放在窗口后面，隐藏主体后点击原主体位置，
  光标必须落进记事本**。
- **DevTools 打开时窗口不透明**（Electron 既有行为）：透明度相关验证必须关闭 DevTools 进行。
- **最大化之后的那个出口能不能点得到**：最大化时两栏都让位，界面层只剩右上角
  一小块（还原键 + 球），它盖在网页之上靠的是 Q18 那次重排。进程内没有任何东西
  能移动系统光标，命中测试无法自动化，只能真机确认——**点得到，这一态才有出口**。
- **窗口下边缘与左边缘能不能拖起来**：那两条边的像素归网页，靠「光标进边带抬起
  界面层」才拿得到（Q19）。若真机上不灵，兜底是只留上/右两条边与三个角
  （右上角那一个角已经足以到达任意 16:9 尺寸），以及最大化时保留右栏。
- **再按一次视频的全屏键**：Q21 里那个「第二趟起退不出来」在真机上是什么症状，
  只能真机看——探针那扇窗口从头到尾没显示过，量到的是环境的脾气。
- **真网站上的暂停与恢复**：`spike/media-pause.js` 用的是现做的 WAV 与一个 `data:`
  iframe，验的是「这条路通不通」；B 站这类站点的播放器自己也在监听页面可见性，
  两边同时下手时会是什么样，只能真机看。要看的是这一条：收起再展开后，
  片子是从原处接着放，而不是从头开始或干脆不放了。
- **裁剪弹窗的滚轮缩放**：`spike/ball-crop.js` 走的是合成 `PointerEvent` 与代码里
  那条缩放路径，滚轮事件本身（`deltaY` 的量级与符号）没有在真鼠标上过一遍。
- **拖动的流畅度只在隐藏窗口上量过**：`spike/dragTicks.js` 量的是定时器间隔与
  `setPosition` 的开销，二者都是**下界**——真实拖动时窗口是可见的，还要参与合成。
  因此「一个滴答一次」这个结论是确定的（间隔量化与窗口可见与否无关），
  而「肉眼是否够跟手」仍需真机确认。
- **托盘右键「现形」**：`spike/tray-reveal.js` 验到的是**控制器那一层**——真的
  `WindowController`、真的 `ConfigStore`（临时目录），十问全过，其中 Q1 先走旧路径
  把病钉死（只提到最前，回来仍是 40%），Q3 换一个实例从磁盘读回来。
  但它验不了「菜单上那一下点得到」：那是系统的托盘菜单，进程内点不着。
  真机上要看的是：把整扇窗调到 40%，藏进托盘，右键图标点「现形」——
  窗口回来后**是不是不透了**，以及右栏那条「整体」滑块**是不是也跟着回到最右**。
- **用真鼠标拖那条「整体」滑块**：Q46 的病与它的修法都是进程内量实的
  （`live-app.js` A10/A11 走的是真主进程、真渲染进程），A10 里那次原生拖动
  进程内也收得到（拖动后配置 = 0.8）。没走过的是**真手指**：按住在滑块上拖、
  中途把指针拖出滑块之外再松手、以及在窗口半透明时那条滑块本身好不好抓。
  这三样只能真机试，要看的是一件事——**松手之后它停在松手的地方**。
- **磷绿（终端世界）在起始页上的观感**：形态（直角、等宽字体、发光、扫描线）从
  1.5.1 起只在起始页那一份文档上（1.4.0 曾把它铺到整个界面，那一版收回了）。
  `spike/theme-chrome.js` 量得出起始页的 `--zhituan-radius*` 全是 0、字体栈里含
  `Cascadia Mono`、字带 `text-shadow`，以及这一页每套主题的对比度（最紧的一对
  4.99:1，是纸白下那一页的三级字），
  但「好不好看、等宽字体下的中文读着累不累」是量不出来的，只能真机看。
- **起始页在终端世界里的滚动条**：圆角改成走 `--radius-sm` 之后会跟着归零，
  但起始页只在站点多到溢出时才出滚动条，无头截图里未必抓得到，真机顺手看一眼。
- **真的下一次 111MB、并且真的静默装一遍**：`spike/update-check.js` 验到的是
  「手动查一次 → 自己开始下 → 落盘 → 边收边算 sha512 → 对得上 → 用户按「更新并重启」
  → `spawn(安装包, ['/S','--updated','--force-run'])` → 本进程退出」这一串（spawn 与 quit
  都是替身，数的是次数与参数）。再往后几步是安装程序自己的事，进程内看不见，只能真机走一遍：
  静默装完之后**应用有没有自己回来**（这正是 Q48 那一枚 `--force-run` 管的事）、
  装的时候**旧进程是不是已经退干净**、以及新版本起来之后 `lastSession` 有没有把标签页
  还回来。另外 `%TEMP%\zhituan-update` 里那份 111MB 的安装包**现在留着**
  ——下次检查发现 sha512 仍对得上就直接判 `ready`，省一次下载——换新版本时由 `sweep()`
  删掉同目录下别的版本。
- **免安装版（zip）点「更新并重启」**：它没有安装目录可更新，预期会**装出第二份**。
  这是已知限制，真机上确认一下症状，好把 README 里那句话写准。
- **「打开文件…」那个系统选文件框**：`spike/home-sections.js` 验到的是**它下游那一段**——
  选中的路径变成 `file://` 标签页、回来的是文件名、取消就什么都不开（Q39）。框本身长什么样
  进程内看不见，三条只能真机看：过滤器是不是只有 TXT / PDF 一组而且不误导（**挂上
  「所有文件」就会让人选中一本 EPUB 然后看着它变成一次下载**，那比选不到更费解）；
  在中文目录（「文档」「下载」）里文件名显示得对不对；多选几本时是不是每本各开一张标签页。
- **本机 TXT 与 PDF 读起来什么样**：TXT 仍由 Chromium 自己渲染，PDF 从 1.4.0 起是
  **自家那一页排的**（`renderer/pdf.html` + pdf.js），因此这两样现在问的不是一件事。
  TXT 要看的是**在 40% 透明度、置顶、不要滚动条的窗口里，那张白底会不会亮得刺眼**
  ——注入的那套透明样式对 `file:` 文档同样生效，但底色是浏览器自己排出来的。
  PDF 的纸已经是逐像素透明的（Q51–Q57 全在离屏窗口里量），真机上看的是另一头：
  **同一本书在纸白与暗夜两套主题下的墨色读不读得下去**，以及彩色插图被压成一块墨之后
  还剩多少信息——这一条是取舍不是缺陷，可好不好受只有眼睛知道。
- **阅读透明度调到多少才「还看得见」**：`live-app.js` 的 A12 量的是机制——淡了没有、
  撤掉没有、像素的幅是不是 255 → 102 → 255（那是 **TXT** 那一半）；**PDF** 那一半由
  `pdf-scheme.js` 的 Q9 量，量的是「纸的 alpha 走 0 → 0.6 → 1 而墨一个字节没动」。
  两处都量不出**手感**。真机要看的是四样：TXT 在 40% 时正文还剩多少可读性；
  **PDF 拉到 0%（一张实心白纸垫在字下面）在一张花桌面上读起来是不是比原来的透明更好**，
  这本就是这一版要问的那件事；TXT 拉到 0%（设计上取零，认的是「正文不在、界面还在」，
  见 DESIGN.md）这一点是否一眼看得懂；以及两条一起拉低（窗口 40% 叠正文 40%）会不会
  低到没法读。这四样没有量具。
