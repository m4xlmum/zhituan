# 架构要点

有二十处实现与直觉相反，都是被真机验证倒逼出来的，改动前请先读
[spike-findings.md](spike-findings.md)：

1. **每个 `WebContentsView` 都必须调用 `setBackgroundColor('#00000000')`。**
   默认背景是不透明白色，漏掉这一行整个透明方案就不成立。

2. **收起与展开就是同一扇窗的两套矩形**，靠 `setBounds` 切换。
   窗口的展开尺寸由真实的尺寸变化维护，**绝不在切换过程中从
   `win.getBounds()` 反推**——那一刻窗口还停在旧尺寸上，反推会把记住的
   展开尺寸覆盖成球的尺寸，展开就再也长不回去了。

3. **所有窗口级 surface 属性只能经 `windowSurface.ts` 一处设置。**
   `transparent: true` 与 `setOpacity` 在 Windows 上是两条不同的合成路径，
   从多处反复折腾它们会出问题。调用顺序在 `apply()` 里有注释说明，不要重排。

4. **`'closed'` 是在窗口销毁之后才触发的**，那时除了 `win.isDestroyed()`，
   读任何属性都会抛 `Object has been destroyed`——`win.id` 也是属性。
   所以 id 要在**建窗口时**记下来，清理代码里只用记下的值。主进程未捕获
   异常会弹出 Electron 的错误框，退出时那个框正是这么来的（`spike/destroyed.js`）。

5. **注入的网页样式绝不能碰自家页面。** 「让网页背景透明」这条规则是
   user origin 的 `!important`，在层叠顺序里压过作者样式表——系统设置的底板
   原本就写在 `html, body` 上，于是被抹掉，打开它时窗口整个透出桌面。
   两条防线：`TabManager.applyPageStyles()` 只对访客页注入，自家页面的底板
   另外画一层（起始页 `.page`、系统设置 `.layout`，`spike/ownpage-bg.js`）。
   第三张自家页面（本机 PDF 的阅读页）**反过来不能有底板**——它要的就是桌面
   透过来，于是它靠的只能是「不注入」这一条，不能靠「另画一层」（见第 17 条）。

6. **子组件的根元素会带上父组件的作用域属性。** 于是父组件里任何一条
   `.类名[data-v-父]` 的规则都可能落到子组件头上：主题菜单的根元素曾经带着
   `cards` 这个类（`variant` 的值被当类名用），正好撞上当时那套世界根元素的类名，
   结果它被 `StartCards`（已由 `StartModern` 取代）的整页排版规则排了一遍——
   标识被挤成两行、菜单横跨整幅页眉，而两边单独看都没有错。
   现在 `variant` 取 `modern` / `terminal`，与两套世界根元素的类名**依旧同名**，
   因此这条约束是活的：**给子组件传形态用属性（`data-variant`）而不是类名。**
   查这类串味用 `spike/which-rules.js`。

7. **顶栏里放不放得下一条标签条，只能量，不能猜。** 猜窗口宽度是不行的：
   导航、站点标识、新标签按钮先分走各自那一段，剩下的才轮得到标签条。
   而「量」有个陷阱——放不下时若把它 `display: none`，下次量出来就是 0，
   于是「放得下」→ 显示 → 又放不下，一帧一个样地抖。
   做法是让它一直挂着：放不下时 `position: absolute; visibility: hidden`，
   离开流（既不占宽度，也不把后面的按钮挤走）但仍能量出自己的自然宽度。
   容量与需求两把尺子在两态下都成立，判断就不会来回翻（`chrome/TabStrip.vue`）。

8. **`visibility: hidden` 挡住了子孙，但子孙可以自己走回来。** 整条标签条让位时
   是隐藏的，可 `visibility` 是可继承属性——当前那一格的关闭键写着
   `visibility: visible`，于是它照样画在下拉按钮右边，成了一个孤零零的 ✕
   （还能被 Tab 键选中，按一下就关掉标签页）。**整块隐藏时，块内凡是有
   自己 `visibility` 声明的地方都要一并算进去**：露出关闭键的那两条规则现在
   挂在「标签条显示中」这一态上。同时，判断某个元素究竟画没画出来要用
   `checkVisibility({ visibilityProperty: true })`，它会把祖先算进去；
   `getComputedStyle(el).visibility` 只看那一层自己的值，祖先被隐藏它照样报
   「可见」——这个 ✕ 就是那么混过了第一轮自查（`chrome/TabStrip.vue`）。

9. **自定义属性里的 `var()` 是在「声明它的那个元素」上完成替换的。**
   底板的颜色令牌写在 `:root` 上：`--zhituan-surface: rgb(255 255 255 / var(--zhituan-alpha))`，
   而 `--zhituan-alpha` 原本写在组件自己的根节点（`.root` / `.panel`）上——于是
   `:root` 上早就把它替换成了一个定值（默认 1），再继承下去的颜色根本不参与替换。
   实测症状极其安静：`--zhituan-alpha` 读到 0.35，顶栏的实测底色却仍是
   `rgb(255, 255, 255)`——滑块在动，画面纹丝不动。**两者必须落在同一层**，
   也就是 `document.documentElement`（`composables/useBackgroundAlpha.ts`）。
   这条关系现在由 `spike/preview.js --bg 0.35` 的 `surfaces` 逐项盯着。

10. **`setInterval` 的间隔会被向上取整到 Windows 的系统时钟滴答（约 15.6ms）。**
    请求 16ms 得到的是 **p50 30.2ms**（两个滴答），拖动就成了每帧一顿；请求 8ms
    才落到一个滴答（15.1ms）——这不是「越小越流畅」，而是「不小于滴答就翻倍」。
    拖动循环因此取 `DRAG_TICK_MS = 8`，并去掉每帧那次 `win.getBounds()` 往返
    （位置按按下时的锚点**绝对**算，不做增量累加：卡住过一次的增量会越拖越偏，
    绝对算法下一帧就抹掉了）。数据见 `spike/dragTicks.js`。

11. **「哪儿能拖」不能交给 CSS 的 `-webkit-app-region`。** 那条路要求栏上
    留着没被 `no-drag` 盖住的像素，而顶栏中间是 `flex: 1 1 auto` 的标签条、
    右栏里是撑满的功能栈——两条栏被盖得只剩几像素的内边距，用户的结论就是
    「只能拖悬浮球」，而这从代码上看不出来。现在是一条读得懂的规则：
    **按在控件上是操作，按在别处都是拖窗口**（`composables/useWindowDrag.ts`，
    控件选择器定义在同一处），可拖区域不再随版面变化而悄悄消失。
    这条规则由 `spike/preview.js --drag-probe` 逐个位置问一遍界面自己。

12. **叠在一起的 `WebContentsView`，指针事件只到最上面那一层，CSS 管不了。**
    子视图是原生视图，不是 DOM——底下的视图收不到指针事件，`pointer-events`
    是浏览器里的概念，在这里一点用都没有（`spike/vieworder.js`）。这条否掉了
    「最大化时铺一张透明的整窗浮层」的画法：浮层一铺，整块网页就点不动了。
    现在的做法是**把界面层缩到右上角一小块**（80×48，`ChromeApp.vue` 的
    `.float`）并把它抬到最上层（`View.addChildView` 对**已在场**的子视图是
    「重排到最上层」，不是多插一份）。左、下两条边的缩放手柄同理，只能靠
    「光标进入边带时把界面层抬起来」——那 8px 边带因此是**惰性的**：抬起来之前
    落在上面的点击归网页，这是这套机制明码标价的代价。

13. **网页进全屏，窗口那一侧必须由我们接管，否则会大一圈。**
    `TabManager.create()` 里那一行 `disableHtmlFullscreenWindowResize: true`
    不是可选项：带电不带它，差别实测得出来——不带它时 Chromium 自己把窗口
    铺到**整块显示器**（本机 1920×1080，连任务栏一起盖住），而我们要的是
    **工作区**（1920×1032）。那 48px 就是「两边同时动手」会跳的那一下
    （`spike/fullscreen.js control`）。同时，窗口是谁最大化的要记清楚：
    `autoMaximized` 只标「这扇窗是视频全屏捎带出来的」，因此用户本来手动
    最大化的窗口，看个视频再退出全屏**不会**被缩回去（`windowController.ts`）。

14. **自定义球图标不进配置。** 那是一张 5–20KB 的 WebP data URI，而配置的
    写入与广播是**全量**的——把它塞进 `config.ui`，拖动透明度滑块每动一格都会
    把它推一遍。它落在 `userData/ball-icon.json`（`services/ballIconStore.ts`，
    与配置同用 `jsonFile.ts` 的原子写），配置里只留「选了哪一枚」与「怎么落」。
    同理，球在各种形态下**盒子尺寸都不能变**：收起态的窗口正好等于球的尺寸，
    球涨一点点就会被窗口边缘切出四个方角。

15. **按钮与输入框不继承颜色。** UA 样式表给它们各自带一份（`buttontext` /
    `fieldtext`），作者样式表不写 `color: inherit` 就压不过它。五份文档是五份
    文档，这一条要在每一页各写一遍；系统设置那一页不加载 `base.css`，漏了它那一页
    就是**黑底黑字**——当年主题还铺满整个界面时，暗夜下探针量出来 1.18:1，而纸白下
    看不出来，因为 UA 给的那个黑与正文色几乎一样（`styles/settings.css`，
    `spike/theme-chrome.js` 的 Q9）。1.5.1 起设置页恒定落在纸白那一份上，
    那个 1.18 已经复现不出来了；留下的这条仍然是「每一页各写一遍」的凭据——
    探针如今量的是「五个分栏的字都压得住自己的底，且三套入参下逐条相同」。

16. **「占多少版面」只能是主进程的状态。** 网页是原生视图，它那一块矩形只由
    `computeLayout()` 算出来——界面里自己画的东西再多，也不会真的把网页推走。
    更新提示条因此是**一行版面**（`NOTICE_H = 30`），照地址栏那套走：
    `WindowRuntime.noticeVisible` 与 `addressOpen` 同类，改它要 `recomputeLayout()`
    再广播；而这一行**写什么**（版本号、进度、失败原因）走 `BROADCAST.updateState`
    那条单独的路。两份状态各有各的主人，谁都不去猜对方在什么状态。
    另一头是**别把状态塞进版面开关**：收起成球、藏进托盘时 `recomputeLayout`
    直接返回（那一块只有 40×40，塞不下），提示条跟着不见，展开时重排一次自己就
    回来了——为它另存一份「收起前有没有提示」是多余的（`UpdateNotice.vue`）。

17. **PDF 不能交给 Chromium 内置的阅读器——那一张白纸改不动。** 直觉是「网页能靠注入的
    样式变透明，PDF 照做就是」，而 PDFium 是把纸直接画在插件表面上的：user origin 的
    `!important`、`filter: invert(1)`、能算出 alpha 的 SVG 滤镜，三样一个像素都落不到它
    头上（实测 120000 个像素里 0 个透明；对照组的 TXT 同一把量具量出来是「本来就只剩字」，
    见 [spike-findings.md](spike-findings.md) 的 Q51）。于是本机 PDF 走**自家第三张页面**
    （`renderer/pdf.html` + pdf.js，Apache-2.0），也是**唯一一张画在标签条上的自家页面**：
    `kind = 'pdf'`、有标题、有 ✕、能被切走，而对外的地址仍是那个 `file:///…/book.pdf`
    ——历史、会话恢复、地址栏、离线阅读那一行读的都是它。**字节不走 `file://`**：
    `zhituan-pdf://doc/<token>`，token ↔ 路径的对应表只在主进程里，路径从不进渲染进程；
    资源走 `zhituan-pdf://asset/<目录>/<文件>`，白名单之外的目录一律 404（Q54）。
    **这条协议的特权必须在 app ready 之前声明**，晚了就是白注册；而且这三条协议
    （PDF / EPUB / TXT）的特权**必须合在一次调用里交上去**，见第 25 条。

18. **`webContents.zoomLevel` 改的就是 `devicePixelRatio`，而且它不发 `resize`。**
    右栏那条缩放落到这一页上不是「画面被拉大」，是 dpr 从 1 变成 1.2、CSS 宽度一点没动
    （实测 0 次 resize 事件）。自己排版的页面因此**不能等 resize**：页只能读 dpr
    （`matchMedia('(resolution: …dppx)')`，每变一次重挂一次查询），再把画布的**设备像素**
    宽算成 `CSS 宽 × dpr`——而画布的 CSS 宽铺满正文区这一点在放大前后不变，放大等于重排
    （`pdf/PdfApp.vue`，Q56）。

19. **同一张画布上 `getContext('2d')` 的选项只认第一次调用。** 后面再传什么都被丢掉，
    而且**不出声**——只在控制台留一句「getImageData 很慢」，画布还悄悄换成了 GPU 那张。
    阅读页的每一帧都要读回整张画布做键控，因此上下文在 `onMounted` 里**最先**取好
    （`willReadFrequently: true`）再交给 pdf.js；pdf.js 自己那份是 `{alpha: false}`，
    晚一步就轮到它说了算（Q55）。

20. **离线阅读透明度不用 `insertCSS` 注入，而且它必须由主进程推。** 这一条管的
    是「正在读的那一份」（本机 TXT 与自家 PDF 阅读页），判据是 `isLocalFile(entry.url)`
    ——**网页永远吃不到它**（与第 5、17 条同一条边界）。TXT 那一页是 Chromium 自己
    渲染的，界面侧没有那座桥（访客页不带 preload），因此值只能由主进程写进去：
    写配置的路不止一条，所以这件事挂在 `ConfigStore.subscribe` 上
    （`TabManager.refreshReaderView()`），与界面那份镜像的广播同一处。
    它一次刷**两件事**——透明度与排版四项（第 22 条）：对象、时机、判据完全一样，
    分开两处写等于把同一条判据抄两遍，那两条迟早会漏掉其中一条路。
    **注入方式是 CSSOM 上的一条行内声明**（`documentElement.style.setProperty('opacity',
    v, 'important')`），不是 `wc.insertCSS`：`removeInsertedCSS` 对 **user origin** 注入的
    表**不报错也不生效**（Electron 44.4.3 实测，default origin 同一对调用正常），
    于是「拉回 100%」这一半会当着用户的面失效——而且它安静得只有量像素才看得出来
    （第 20 条这一条与 `spike/css-remove.js`、`live-app.js` 的 A12 一起读；Q58）。
    行内 `!important` 顺带压过页面自己样式表里的任何同属性声明，也不受 CSP 约束。
    PDF 那一页走的是另一条实现——它是自家排的，而 1.5.2 起那一条落的是**那张纸**
    （给画布一层元素底色），不是给画布乘 `opacity`：这一页的位图里只剩墨，乘 `opacity`
    淡的会是字。同一个值落两处之所以必须分开写，根子在 TXT 那一页的纸是 Chromium 画的、
    我们碰不到（正是上面那条「撤不回来」逼出来的选择）；Q62。

21. **「谁该出声」只有一条判据，两个入口都调它。** 两条规矩其实是两件事：**收起**
    （成球 / 托盘 / 最小化）时全部暂停**并闭麦**，**切走**（切到别的标签、进起始页或
    设置）时只有正在看的那一张继续。两条取或，合在 `TabManager.applyMediaState()`
    一处算，`activate()` 与 `setBodyVisible()` 都调它。
    收在一处不是整洁问题：从前只有「收起」那一条，写成了「隐藏就全停、露出来就全恢复」，
    那时它是对的；加上第二条之后那种写法会把**后台**那张也一起放起来——两个声音同时
    出来。两个入口各算一遍必然有这个洞。两条也互不覆盖：`muteMediaOnCollapse` 关掉
    之后收起不再动媒体（旧行为），而「切走」那一条仍然把后台那张按着，不会被「展开」
    顺手放响。
    **闭麦只跟收起走**：`setAudioMuted` 挡的是 `pause()` 够不着的那一半（Web Audio、
    各家自己实现的播放器），收起要的是「一点声音都不漏」，切走只要「不该在这儿播」
    ——用户可能一边放着音乐一边翻别的页。
    暂停靠 `PAUSE_PLAYING_MEDIA` 在元素上打一个 `__zhituanPaused` 记号，恢复只认这个
    记号：用户自己按了暂停的，切回来不会被放起来；页面换了播放器元素或整页导航走了，
    这份账自然作废（不会去恢复一个已经不存在的播放器）。脚本**逐帧**跑
    （`framesInSubtree`），因为播放器常在 iframe 里，而跨源 iframe 的文档从顶层脚本
    够不着——主进程走这条路没有这个限制（`spike/media-pause.js`：收起那一组 Q1–Q10、
    切走那一组 Q11–Q16）。

22. **本机文本的排版四项没有统一落点，一处一份写法：自家那两页从配置广播里读，
    交给 Chromium 的那些（`.md`、`.log`）才往那个 `pre` 上写，而且留白只能走 `padding`。**
    字号 / 行距 / 左右留白这一组是**一份配置**，落点却有四种：本机 EPUB 那一页是自家排的
    （书页右下角那枚 Aa 把三个自定义属性写进 `:root`，Shadow DOM 里的正文继承得到）；
    本机 PDF 不吃它（字印在位图里，想放大得改缩放）；**本机 TXT 也是自家的一页**
    （1.6.9 起，见 services/txtReader.ts 与第 24 条）；剩下那些**被交给 Chromium 自己渲染的**
    本机文本——整篇文档就是它生成的一个 `<pre>`（`.md`、`.log` 这一类），页面上挂不住任何
    控件，能碰的只有写在它身上的样式。于是顶栏长一枚 Aa（`TopBar.vue`）
    开一张面板（`OpenPopoverRequest.kind === 'typeset'`），主进程把三项写进那个 `pre`
    （`pageStyler.applyReaderTypeset`）。
    **写 `pre` 那一支不能照抄 EPUB 那一页的写法**：那边写的是 `width`，而 UA 给 `pre` 的是
    `max-width: none`——`width` 在它面前没有任何对手，于是 `width: 60%` 被无视，正文
    铺成一条不换行的横带、横向滚出去。留白因此走 `padding-left/right`（加在盒子内侧，
    `pre-wrap` 照旧在少了几十像素的行盒里折行），用百分比让换个窗口宽度读到的仍是同一份
    版心。注入方式与第 20 条同一条路（行内 CSSOM 的 `!important`：撤得掉、最强、不碰 CSP），
    重注入的时机也同一处（`applyPageStyles` 与 `refreshReaderView`）。
    **1.6.10 起这一组是四项**，第四项是段距（`ui.readerParagraph`：em、0–2、默认 0）。
    它与前三项最大的不同是**落点可能没有对象**：前三项对任何正文都成立，而段距要正文里
    分得出「段」。因此它自带一条规矩——**没有对象就禁掉那一行、并写明为什么，不装作能点**：
    自家那两页（EPUB / TXT）的正文是段落结构，由各自页面上那枚 Aa 按本章能不能切段灰掉
    （`reader/TypesetPanel.vue` 的 `paraOff`，判据是段块数超没超上限）；而 Chromium 排出来的
    那些整篇只是一个 `<pre>`，页面上一个标签都不是我们画的，那一行由顶栏那张面板灰掉
    （`popover/PopoverApp.vue` 的 `paraOff`，按当前标签页的地址判）。两处各管各的落点，
    合起来才是「能用的时候一定能用，不能用的时候一定看得见为什么」。
    **取值是加法，不是改版式**：往后一段上加 `padding-top`，单位 em（跟着这一段自己的
    字号走），默认 0——于是「默认 = 上一版的样子」是一句字面为真的话，老配置一个字段都
    不用迁移。用 `padding` 而不是 `margin`：**相邻的 margin 会合并（取大的那个，不是
    相加）**，而书自己写段距最常见的是 `p { margin: 0 0 1em }` 这一类「上外边距留 0」
    的写法——我们那点加法写在 `margin-top` 上就跟上一段的下外边距去比大小，比它小的
    时候**一点都不落到版面上**。T4c 拿同一份加法两处各写一遍量过：书里写着
    `p { margin: 0 0 60px }` 时，`margin-top: 22px` 那一版的间距**纹丝不动**（60 →
    60），`padding-top: 22px` 那一版才多出一个字号（60 → 82）。
    EPUB 那一页还多一层：那条规则（`p + p { padding-top: … !important }`）写在自己一张
    表里，而**值为 0 时整张表 `disabled`**——不这么做，它会把书自己写的
    `p + p { padding-top }` 一起压平，而那属于书的版式，我们不碰。
    边界仍然只有一条：**网页永远吃不到它**，判据还是 `isLocalFile`（谓词多了一层
    `isLocalPdf` 的反面，见 `@shared/url` 的 `isLocalText`，那是给界面判断那枚键
    此刻管不管得着用的）。
    **判据：`spike/txt-typeset.js`**（1.6.5 建的那一版量的是往 `pre` 上写；1.6.9 起
    `.txt` 不再走那一支，它量的是自家那一页——而那个 `pre` 那一支仍然由
    `.md` / `.log` 走，代码一个字没删；1.6.10 起它量四行）与 `spike/book-tab.js` 的 T4b
    （书那一侧：值为 0 时那张表停不停用、拖上去当场落不落进 `p + p`）、T4c
    （同一份加法写在 `margin-top` 与 `padding-top` 上各量一遍，`padding` 那个选择
    就落在那两组数上）。
23. **安装器收旧进程时不许带 `taskkill /T`——`/T` 连子进程树一起收，而安装程序自己就在那棵树里。**
    「更新并重启」是应用起安装程序：`spawn(安装包, ['/S','--updated','--force-run'],
    { detached: true, stdio: 'ignore' })`。`detached` 在 Windows 上只等于 `DETACHED_PROCESS`
    加一个新进程组，**父进程链原封不动**——安装程序是那个 `zhituan.exe` 的子进程。而安装器里
    「把还在跑的纸团收干净」那一句原本是 `taskkill /F /T /IM zhituan.exe`：`/T` 的语义是
    「连同子进程树一起结束」，于是它**把自己也收走了**，死在发出指令的那一刻——旧版卸不掉、
    文件一个字节不换、`--force-run` 也到不了，用户看到的就是「应用关了、然后什么都没有」
    （读数见 Q80）。
    **去掉 `/T` 不掉杀伤力**：Electron 的主进程、renderer、GPU、utility **全部同名**
    `zhituan.exe`，`/IM` 本来就是一枚不漏的（真机 `tasklist` 里十个进程镜像名一模一样）。
    `/T` 在这里纯属多余，多余出来的那部分恰好是发起者自己。
    **别顺手补一道 `/FI "PID ne $ztSelf"`**（上游 `KILL_PROCESS` 就是那么写的）：实测它会
    毁掉 `taskkill` 的 **128**——「目标已经没了」不再报 128 而是报 0，而 `zt.KillApp` 的
    重试循环正是靠 128 收敛的，于是每调一次白跑满 24 轮（约 26 秒，一轮升级要调三次）。
    这一条与 `customRemoveFiles` 里「删不干净必须以非 0 退出」是同一种东西：
    **退出码是这条链上唯一的信号通路，动它之前先量它。**
    判据：`spike/nsis-abort-probe/kill-self.nsi` + `kill-self.sh`——假「应用」（node.exe
    改名的 `zt-fakeapp.exe`）用同样的 `detached` 方式起探针，探针里跑的就是**生产的**
    `customCheckAppRunning`；改前只有 `A`（探针在宏里消失），改后 `A/B/C` 齐，且假应用
    必须照旧被杀掉（「什么都不杀」也能骗过活着那一半）。
    还有一条**只对 1.6.4 → 1.6.6 这一次升级成立**的依赖：1.6.4 的卸载器里仍带着 `/T`
    （已发布的旧代码，改不了），它之所以没炸，是因为本安装器在调它之前已经把应用**确认**
    收干净了（`zt.KillApp` 要循环到 `taskkill` 返回 128 才罢手）。

24. **阅读位置只认「此刻画着的那一屏」报回来的那一笔——而这件事只有 `TabManager` 知道。**
    本机 EPUB 与本机 TXT 两页共用一条通道（`SEND.bookReading`）报「我在第几章的百分之几」，
    而这份账只有一行：同一份文件开着两屏时两屏都在报，**后到的覆盖先到的**。
    危险的不是「用户没在读它」这么简单——后台那一屏自己会因为重排、被重新摆一次、
    补位落定而发一串滚动事件，于是**一次会话下来最后落在账上的，往往是它开屏时读到的
    位置**：眼前这一屏读到第 200 章，旁边那屏还停在开屏时的第 11 章，下一次打开就回到
    第 11 章——正是用户那句「记不住读到哪儿」（判据是 `spike/txt-resume.js` 的 T5，
    改前它如实报坏；账里那一笔的 `at` 比第 200 章那一笔更晚，是它盖上去的现场证据）。
    于是这条 IPC 上有一道闸：`ctx.tabs.isActiveView(event.sender)`，不在上面的那一屏
    报什么都不记。**判的是视图的 `webContents` 而不是标签页 id**——报告人手里只有自己的
    `webContents`（那条 IPC 的形状如此），而「谁在上面」只有 `TabManager` 一处记着
    （`activeId`）；因此这条规矩**不能写在阅读页里**，页面自己不知道自己是前台还是后台。
    代价是后台那一屏的位置不记——那本来也不是用户的「上次」。这一条同时管住 EPUB 与 TXT
    两页，改一次两处都对。

25. **三条阅读协议的特权只能有一次调用——`registerSchemesAsPrivileged()` 只认最后一次。**
    「自家阅读页怎么拿到一份本机文件的字节」这件事有三条协议（`zhituan-pdf` /
    `zhituan-book` / `zhituan-txt`），权限一字不差。它们的名字必须在 app ready **之前**
    声明，而声明这件事**只能做一次**：分开调三次，前两次当场作废，量出来的样子是那两条
    协议的 `fetch` 全抛 `TypeError: Failed to fetch`，只有最后交上去的那条取得到
    （`spike/reader-schemes.js` 的两面：一次交 → 三条都 200；分开交 → 前两条抛、最后
    一条 200）。**这个坑 1.6.9 真踩了**：TXT 那条协议加在末尾之后，PDF 与 EPUB 一起哑了
    ——本机 EPUB 点开是一句「打不开这本书：Failed to fetch」（`spike/book-tab.js` 的 T1），
    PDF 那一页的字节与它那四样资源（cMap / 标准字体 / wasm）也全取不到
    （`spike/pdf-tab.js` 的 P1/P2/P3）。而主进程那一侧看起来一切正常：handler 挂上了、
    `isProtocolHandled` 是 true、warn 一条都不出——因为**请求根本没走到 handler**（Q86）。
    因此这三份声明各自留在各自的模块里（`XXX_SCHEME_PRIVILEGED`），由 `index.ts`
    **合在一次调用里交上去**；再加第四条协议时**加进那一次调用**，不许另起一句
    ——`spike/reader-schemes.js` 的 S1 就是扫这件事的：`src/main` 底下
    `protocol.registerSchemesAsPrivileged(` 的**代码**只许出现一处，且三份名字都要在里面。

> 早期版本用 `setShape` 裁剪窗口的命中区域来实现「隐藏区域点击穿透」。
> 改为收起成球之后这套机制已整体移除：窗口真的缩小了，就不需要再靠裁剪
> 去欺骗命中测试，`setShape` 也不再有存在的理由。

## 目录

```
src/shared/    三个进程共享的类型、IPC 契约、常量
src/main/      主进程：窗口编排、状态机、浏览器、数据存储
src/preload/   唯一的 contextBridge 桥
src/renderer/  chrome 界面 / 弹出面板 / 系统设置 / PDF 阅读页 / EPUB 阅读页 / TXT 阅读页
```

关键文件：

| 文件 | 职责 |
|---|---|
| `src/main/services/windowSurface.ts` | 所有窗口级属性的唯一入口 |
| `src/main/services/windowController.ts` | 窗口编排与状态机：状态、合法迁移、守卫 |
| `src/main/services/windowLeaveWatcher.ts` | 光标轮询、迟滞、挂起门控 |
| `src/main/services/geometry.ts` | 版面矩形计算，坐标判断的唯一来源 |
| `src/main/services/updateService.ts` | 更新那一路：查 `latest.yml` → 比版本 → 下载并校验 sha512 → 起安装程序。**不用 electron-updater** 的三条理由写在文件头 |
| `src/main/services/pdfReader.ts` | 本机 PDF 那条路：`zhituan-pdf://` 的两张面（字节与资源）、token ↔ 路径的对应表、阅读页的地址。特权那一份声明（`PDF_SCHEME_PRIVILEGED`）也住在这里，但**注册不在这里**——三条协议合在一次调用里交，见第 25 条 |
| `src/main/services/txtReader.ts` | 本机 TXT 那条路：`zhituan-txt://<token>/text` 把字节交给自家那一页（**故意不带 charset**——认编码是页面那一半的事，用的是同一个 `TextDecoder`），以及续读那一半：开这一页时从 `reading.of(本机路径)` 取回上一次的章与章内比例，编进地址的 `at` / `ratio` |
| `src/shared/txt.ts` | 切章那一套的**全部**（纯函数，主进程与渲染进程共用同一份）：五档编码的 `decodeText`、`splitChapters` / `chapterText` / `isChapterLine`、位置记号的 `formatMark` / `parseMark` / `locateChapter`。它是「章」这件事唯一的定义处 |
| `src/main/services/pageStyler.ts` | 注入访客页面的四样东西：透明底、藏滚动条、离线阅读透明度在 **Chromium 自己排的本机文本**那一半上的 `opacity`、以及排版四项里对那个 `pre` 成立的三项（字号 / 行距 / 左右留白；**段距在 `pre` 上没有对象**，那一行因此是灰的，见第 22 条）。**后两样都只给本机文件**（见第 20、22 条；PDF 那一半由页面自己落在画布底色上，EPUB 与 TXT 那两页自己从配置里读） |
| `src/renderer/src/txt/TxtApp.vue` | 本机 TXT 的阅读页：认编码、切章、**一次只把一章放进 DOM**（`chapterText`），滚动到章末再滚一下 / 方向键 / 目录里点一条三条通道翻章，位置按 600ms 去抖上报（第 24 条那道闸在主进程那一头） |
| `src/renderer/src/composables/usePopover.ts` | 「从按下的那一格上开一张弹出面板」的唯一一处：量锚点、报给主进程摆位（顶栏那枚 Aa 与右栏那四格共用） |
| `src/renderer/src/home/useRows.ts` | 起始页的行模型与交互：三套主题共用，世界组件只负责画 |
| `src/renderer/src/pdf/PdfApp.vue` | 阅读页：pdf.js 把一页画进画布，再把纸收掉、把字上成一份固定的近黑墨（这一页不写主题，见 `useTheme.ts`；排版在 `styles/pdf.css`）；离线阅读透明度在这一页上落的是**画布的元素底色**（那张纸），不是 `opacity`（见第 20 条） |
| `src/renderer/src/pdf/keying.ts` | 键控本身：这一页的纸是哪一张（有没有、浅还是深）、墨的零点在哪儿、要不要翻面 |
| `src/renderer/src/composables/useWindowDrag.ts` | 「按控件是操作、按别处是拖窗口」的唯一判据，界面各处共用 |
| `src/renderer/src/composables/useBackgroundAlpha.ts` | 底板透明度写进文档根（必须与令牌同层，见架构要点第 9 条） |
| `src/renderer/src/composables/useTheme.ts` | 主题与形态写进文档根——**只有起始页那一份文档调它**，其余四份不写这两个属性，于是永远落在纸白那一组（文档之间没有继承路径，这就是边界的机制） |
| `src/renderer/src/chrome/TabStrip.vue` | 顶栏标签条，含「放不下就让位给下拉清单」的实测判断 |
| `src/renderer/src/styles/themes.css` | 三套主题的配色与两套世界的形态，五份文档共用这一份（谁把主题名写上去，见上一行） |
| `src/renderer/src/styles/home.css` | 起始页自己的排版，以及**只在起始页**出现的扫描线与暗角 |
| `src/shared/ipc.ts` | 三个进程共享的通道与载荷契约 |
| `build/installer.nsh` | 安装器 / 卸载器的扩展钩子（`nsis.include` 引入，两次编译都带上）：进程检查、旧卸载器失败后的清场、我们这一版卸载器的删文件。**它跑在安装期间，没有界面、只有一份日志**（`%TEMP%\zhituan-install.log`），改动前务必先读第 23 条 |

> 计划里原本把状态机拆成独立的 `windowStateMachine.ts`，实现时发现它与窗口编排放一起
> 内聚性更好（状态迁移总是伴随窗口动作），故合并进 `windowController.ts`。
