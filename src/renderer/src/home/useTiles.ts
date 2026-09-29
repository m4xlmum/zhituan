/**
 * 起始页的站点编排：从「我的站点 / 历史 / 预置」拼出这一页能打开的站点，
 * 再按栏目摊成行。
 *
 * 为什么单独放一个文件而不是留在 HomeApp.vue 里：这段是**纯数据**，却又是这一页
 * 最要紧的一条规矩（一栏里该有谁、认不出的域名落在哪儿、读数数的是什么）。
 * 而 HomeApp 是单文件组件，探针 require 不了它——留在那边就只能由探针另抄一份，
 * 抄本会跟着源本一起漂，验出来的结论不算数（这正是 spike/ 那一堆注释反复讲的
 * 「验真的，不验抄本」）。搬到这里之后，spike/home-sections.js 打包的就是真跑在
 * 界面里的那一份。
 *
 * 这里不引 vue：全是纯函数，进出都是普通数据，因此探针不必把整个框架拉起来。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { PRESET_SITES, sectionOfUrl } from '@shared/presets'
import type { SectionId } from '@shared/constants'
import type { Bookmark, HistoryEntry, SiteRecord } from '@shared/types'
import { asSiteUrl, domainOf } from '@shared/url'
import { localRowsOf, rowsOf, type HomeRow } from './useRows'
import type { HomeTile } from './types'

/**
 * 域名到可注册域名（`weread.qq.com` → `qq.com`）。
 *
 * 本体的实现搬去了 @shared/url（主进程那份「被移除的站点」名单要按同一把尺子
 * 写域名，两边必须同源，见 domainOf 那段注释），这里只是把它**照原名**再露出来：
 * 这个模块的读者与探针（spike/home-sections.js）一直是按 tiles.domainOf 取它的。
 */
export { domainOf } from '@shared/url'

/** 域名 → 图标地址。历史与书签里存过图标的直接复用，这是浏览器的做法 */
export function iconByDomainOf(
  history: HistoryEntry[],
  bookmarks: Bookmark[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of [...history, ...bookmarks]) {
    const domain = domainOf(entry.url)
    const icon = 'faviconUrl' in entry ? entry.faviconUrl : undefined
    if (domain && icon && !map.has(domain)) map.set(domain, icon)
  }
  return map
}

/** 按访问次数排序的常访问站点，一个域名只留访问最多的那一条 */
export function mostVisitedOf(history: HistoryEntry[]): HistoryEntry[] {
  const byDomain = new Map<string, HistoryEntry>()
  for (const entry of history) {
    const domain = domainOf(entry.url)
    if (!domain) continue
    const existing = byDomain.get(domain)
    if (!existing || entry.visitCount > existing.visitCount) byDomain.set(domain, entry)
  }
  return [...byDomain.values()].sort((a, b) => b.visitCount - a.visitCount)
}

/**
 * 上限只是防着一份用了很久的历史把 DOM 撑起来：任何一档窗口都显示不了这么多行，
 * 因此这个截断不会被看见。
 */
export const MAX_TILES = 36

/**
 * 候选站点。顺序即优先级：自己固定的 → 常访问的 → 预置的热门站点。
 *
 * 同一个域名只出现一次（先去的有理）：起始页是一份入口清单，
 * 「知乎」出现两遍不提供任何信息。
 *
 * `sectionOfUrl` 认不出栏目的站点 `section` 是 null——它只出现在「全部」里。
 * 这里**不做关键词猜测**，理由见 @shared/presets 里那个函数。
 *
 * `hidden` 是被移除掉的域名（@shared/types 的 HiddenSite）：起始页上「删除」
 * 那一下落成的就是它。三个来源一律照此过滤——包括我的站点：删一行就是让那个
 * 域名别再出现，用户不必知道这一行是从哪儿来的（删除的实现里那份记录也一并删了，
 * 见 useTiles 的 planOfRemove；这里是第二道闸，挡住手改配置留下的那种半截状态）。
 */
export function tilesOf(
  sites: SiteRecord[],
  history: HistoryEntry[],
  bookmarks: Bookmark[],
  hidden: readonly string[]
): HomeTile[] {
  const icons = iconByDomainOf(history, bookmarks)
  const gone = new Set(hidden)
  const seen = new Set<string>()
  const out: HomeTile[] = []

  const push = (name: string, url: string, key: string, siteId: string | null): void => {
    const domain = domainOf(url)
    if (!domain || gone.has(domain) || seen.has(domain)) return
    seen.add(domain)
    out.push({
      key,
      name,
      url,
      domain,
      icon: icons.get(domain),
      section: sectionOfUrl(url),
      siteId
    })
  }

  for (const site of sites) push(site.title, site.url, site.id, site.id)
  for (const entry of mostVisitedOf(history)) push(entry.title || entry.url, entry.url, entry.id, null)
  for (const preset of PRESET_SITES) push(preset.title, preset.url, preset.id, null)

  return out.slice(0, MAX_TILES)
}

// ---------------------------------------------------------------- 增删改的落点

/**
 * 起始页上「保存」这一下要落成哪几件事。
 *
 * 三件事各归各处，而不是一句「写 sites」：起始页那一列站点有三个来源，
 * 用户在编辑器里改的那一行可能根本不是自己的（常访问、热门站点都没有记录），
 * 于是「改一行」在数据上其实是**把它收成一条自己的站点**。
 *
 *   · `save.id` 为 null = 新增一条；有 id = 改既有那条（它本来就是我的站点）。
 *   · `hide` 是**换域名**留下的那个旧域名：这一行改成了别家，它原来那一行
 *     就不该再回来（常访问与热门站点都还会把它推出来）。
 *   · `unhide` 是把这个域名从被移除名单里划掉——用户又把它添回来了。
 *
 * 纯数据、无副作用：真正动手的是 HomeApp（它手里有那几条 IPC）。搬在这里是为了
 * 让探针能要求到这**一条**规矩，而不是照抄一份（见本文件开头那段账）。
 */
export interface SiteSavePlan {
  save: { id: string | null; title: string; url: string }
  hide: string[]
  unhide: string[]
}

export function planOfSave(
  /** 正在编辑的那一行；null 表示「新增」 */
  tile: HomeTile | null,
  draft: { title: string; url: string },
  hidden: readonly string[]
): SiteSavePlan | null {
  const url = asSiteUrl(draft.url)
  // 认不出域名就存不进去：起始页按域名去重与归栏，一条没有域名的记录
  // 存下去也永远显示不出来（见 tilesOf 的 push）。挡在这里，别让它落盘。
  const domain = domainOf(url)
  if (!domain) return null

  /*
   * 名称留空就用**域名**，不是整条网址。
   *
   * 这一格是给眼睛看的：`https://www.bilibili.com/` 那一串在行里要占满后半截，
   * 还把真正的信息（哪一家）挤到最左边一小截；`bilibili.com` 才是「这是谁」。
   * 编辑器里那句提示与它说的是同一件事（见 SiteEditor 的 tip）。
   */
  const title = draft.title.trim() || domain
  // 改的是别家域名：旧的那一行要一并消失，否则它会顺着历史或预置表顶回来
  const oldDomain = tile && tile.domain !== domain ? [tile.domain] : []
  return {
    save: { id: tile?.siteId ?? null, title, url },
    hide: oldDomain,
    unhide: hidden.includes(domain) ? [domain] : []
  }
}

/**
 * 起始页上「移除」这一下要落成哪几件事。
 *
 * 两条，且**总是**两条一起：域名进名单（这一行没了），我的站点那份记录也删掉
 * （有的话）。分成两步而不是只做一步，是因为两种半截状态都难看——只记域名，
 * 记录还在，用户在别处（比如手改配置后又添回来）会看见一个「删过又活着」的站点；
 * 只删记录，常访问或预置表会立刻把同一行顶回来，看着像没删动。
 */
export interface SiteRemovePlan {
  /** 要从「我的站点」里删掉的记录；它本来不是我的站点就是 null */
  removeId: string | null
  hide: string[]
}

export function planOfRemove(tile: HomeTile): SiteRemovePlan {
  return { removeId: tile.siteId, hide: [tile.domain] }
}

/**
 * 一栏里该有哪些行。
 *
 * 「全部」把「继续上次」摆在第一行——它是这个页面上最常发生的事；
 * 单栏不摆它：在「视频」栏里顶着一本上周读的书，说的不是这一栏的事。
 * 「离线阅读」整栏另走一条路（见 useRows 的 localRowsOf）。
 */
export function plateRowsOf(
  tiles: HomeTile[],
  history: HistoryEntry[],
  lastRead: HistoryEntry | null,
  plate: SectionId
): HomeRow[] {
  if (plate === 'local') return localRowsOf(history)
  if (plate === 'all') return rowsOf(tiles, lastRead)
  // 单栏只放本栏的站点。认不出栏目（section 为 null）的只在「全部」里出现
  return rowsOf(
    tiles.filter((tile) => tile.section === plate),
    null
  )
}

/** 状态行左端的读数：这一栏里数的是什么、有多少 */
export interface PlateStat {
  kind: 'site' | 'local' | 'match'
  count: number
}

/**
 * 读数。
 *
 * 数的是这一栏里有多少东西——「站点 0」摆在离线阅读那一栏里是句错话，
 * 那边的数是本机文件。而「打开文件…」那一行不是一本书，因此本机那一栏要减掉它：
 * 读数是给别人判断「这一栏里有多少东西」用的，把一个动作算进去就是虚报。
 *
 * 搜索时数的是命中的行（`matchCount`），因为底下显示的就是那些。
 */
export function statOf(input: {
  tiles: HomeTile[]
  history: HistoryEntry[]
  plate: SectionId
  /** 正在搜索时传命中的行数，否则传 null */
  matchCount: number | null
}): PlateStat {
  const { tiles, history, plate, matchCount } = input
  if (matchCount !== null) return { kind: 'match', count: matchCount }
  if (plate === 'local') return { kind: 'local', count: localRowsOf(history).length - 1 }
  const count =
    plate === 'all' ? tiles.length : tiles.filter((tile) => tile.section === plate).length
  return { kind: 'site', count }
}
