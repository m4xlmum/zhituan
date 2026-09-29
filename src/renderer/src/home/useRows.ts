/**
 * 起始页的行模型：两套世界共用的一份数据与一套交互。
 *
 * 三个主题共用同一套划分（页眉 / 输入行 / 栏目线 / 内容行 / 状态行），
 * 差别只在皮上。骨架既然是同一个，行怎么建、怎么筛、选中哪一行、回车做什么
 * 就不该各写一遍——两份实现迟早会在某一次改动里分家，而分家之后的症状是
 * 「某一套主题里回车打开的不是选中的那一行」这类只在一边复现的怪事。
 *
 * 因此：这个文件负责**行为**，两个世界组件只负责**画**。
 * 唯一留给世界自己的是按实测高度算出「这一屏放得下几行」——行高是皮的一部分。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed, ref, watch, type ComputedRef } from 'vue'
import type { HistoryEntry } from '@shared/types'
import { fileNameOf, hostOf } from '@shared/url'
import type { HomeTile } from './types'

export interface HomeRow {
  key: string
  /**
   * 这一行是「继续上次」、「打开某个站点」，还是「打开一本本机文件」。
   *
   * 终端世界把它印在行首（`resume` / `open` / `open-file`），现代世界把前两种
   * 印成「继续」与留白——但两者是同一件事，因此动词存在数据里，而不是各印各的。
   *
   * 本机文件的那些行**不是**第三种行为：点它与点一个站点是同一条路（开一张
   * 标签页），只有 `open-file` 那一行是新的——它要弹的是系统选文件框。
   */
  verb: 'resume' | 'open' | 'open-file'
  label: string
  host: string
  url: string
  /** 站点图标，来自历史或书签。终端世界不画它 */
  icon?: string
  /**
   * 这一行通向本机的东西，不是网页。
   *
   * 与 `verb` 不是一回事：本机文件那些行的 `verb` 是 `open`（点它就是开一张
   * 标签页，和点一个站点走同一条路），`local` 说的是「那一页不是网页」。
   * 图标那一格靠它决定画文件还是画站点图标——本机文件没有站点图标，
   * 落到首字母那一格上就和一列网站长得一模一样了。
   */
  local?: boolean
  /**
   * 这一行对应的站点条目，**有它这一行才编辑得了、删得掉**。
   *
   * 「继续上次」与本机文件那几行没有它：前者说的是「回上次那个地方」，
   * 删掉它并不等于那个站点没了（它只是最近读的那一条）；后者根本不是站点。
   * 页面据此决定这一行要不要露出那两枚按键，判据只有这一格。
   */
  tile?: HomeTile
  /** 过滤用的一整串，省得每次比较都现拼 */
  haystack: string
}

/** 站点与「继续上次」排成一份行。继续上次永远在第一行——它是这个页面上最常发生的事 */
export function rowsOf(tiles: HomeTile[], lastRead: HistoryEntry | null): HomeRow[] {
  const rows: HomeRow[] = []
  if (lastRead) {
    /*
     * 上次读的是本机的一本书，就照本机文件那一栏的样子拆成两列。
     *
     * 历史里那一条的标题已经是文件名了（见 HistoryStore 的 titleOf），因此
     * 「书名.txt」整个塞进名称那一列也说得过去；拆开是为了与「离线阅读」里
     * 同一本书那一行长得一模一样——同一本书在两地不该是两个样子。
     */
    const file = fileNameOf(lastRead.url)
    const parts = file ? splitName(file) : null
    const label = parts ? parts.stem : lastRead.title || lastRead.url
    // 站点那一列显示的是可注册域名（qq.com，不是 weread.qq.com），
    // 继续上次这一行也照同一把尺子裁，两行的域名才对得齐
    const host = parts ? parts.ext.toUpperCase() : (hostOf(lastRead.url) ?? '').replace(/^www\./, '')
    rows.push({
      key: 'resume',
      verb: 'resume',
      label,
      host,
      url: lastRead.url,
      // 历史里存过图标就带上：这一行说的是「回上次那个站」，那就该是那个站的图标
      icon: lastRead.faviconUrl,
      local: parts !== null,
      haystack: `${label} ${lastRead.url}`.toLowerCase()
    })
  }
  for (const tile of tiles) {
    rows.push({
      key: tile.key,
      verb: 'open',
      label: tile.name,
      host: tile.domain,
      url: tile.url,
      icon: tile.icon,
      // 编辑与删除都落在这一格上（见 HomeRow.tile）：站点行有它，其余行没有
      tile,
      haystack: `${tile.name} ${tile.domain} ${tile.url}`.toLowerCase()
    })
  }
  return rows
}

/**
 * 文件名拆成「书名」与「格式」两截，给本机文件的那些行用。
 *
 * 拆开是因为行里就两列：名称那一列说「哪本书」，右端那一列说「什么东西」——
 * 而 `斗破苍穹.txt` 连同格式一起挤在名称里，右端就只能空着或者重复一遍。
 * 拆开之后它读起来与文件管理器里的「名称 / 类型」一个样子。
 *
 * 点开头的不算扩展名（`.gitignore` 是一整本书名），没有点就是整截书名。
 */
function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) }
}

/**
 * 「离线阅读」那一栏的行：先「打开文件…」，再最近打开过的那几本。
 *
 * 顺序反了就不成立：这一栏的头一行永远是那个动作，它不是一本书，
 * 而是这一栏唯一能接纳新内容的地方。
 *
 * 最近打开过的书取自历史里 `file:` 的那些条目，**按打开时间倒序**——
 * 历史本身就是这么排的，因此这里不重排。名字走 fileNameOf：历史里存的
 * 标题本来就该是文件名（见 HistoryStore 的 titleOf），这里再取一次是
 * 为了挡住更早的版本留下的、标题里装着整条路径的那些旧记录。
 */
export function localRowsOf(history: HistoryEntry[]): HomeRow[] {
  const rows: HomeRow[] = [
    {
      key: 'open-file',
      verb: 'open-file',
      label: '打开文件…',
      host: '',
      url: '',
      local: true,
      // 认得出的词都放进去：这一行是「我想读本机的东西」，而用户手里那个词
      // 可能是「打开」「文件」「本机」「离线」里的任何一个
      haystack: '打开文件 open file 本机 离线 txt pdf'
    }
  ]

  const seen = new Set<string>()
  for (const entry of history) {
    const name = fileNameOf(entry.url)
    if (!name || seen.has(entry.url)) continue
    seen.add(entry.url)
    const { stem, ext } = splitName(name)
    rows.push({
      key: entry.id,
      verb: 'open',
      label: stem,
      host: ext.toUpperCase(),
      url: entry.url,
      icon: entry.faviconUrl,
      local: true,
      haystack: `${stem} ${ext} ${entry.url}`.toLowerCase()
    })
  }
  return rows
}

/**
 * 输入框里的文字既当命令也当过滤器。
 *
 * `open x` 只拿 x 去过滤——用户已经说清楚要的是站点，再拿 "open" 这两个字母
 * 去比就什么都比不中了。
 */
export function needleOf(query: string): string {
  const q = query.trim().toLowerCase()
  const open = /^(?:open|o)\s+(.*)$/i.exec(q)
  if (open) return open[1].trim()
  if (/^(?:resume|r)$/i.test(q)) return ''
  return q
}

export function filterRows(rows: HomeRow[], query: string): HomeRow[] {
  const needle = needleOf(query)
  if (!needle) return rows
  return rows.filter((row) => row.haystack.includes(needle))
}

/** 回车要做的事 */
export type RowIntent =
  | { kind: 'resume' }
  | { kind: 'open'; url: string }
  | { kind: 'open-file' }
  | { kind: 'text'; text: string }

function intentForRow(row: HomeRow): RowIntent {
  if (row.verb === 'resume') return { kind: 'resume' }
  if (row.verb === 'open-file') return { kind: 'open-file' }
  return { kind: 'open', url: row.url }
}

/**
 * 回车。顺序是「先认命令，再认站点，最后才当网址或关键词」：
 * 敲 `bili` 的人要的多半是 B 站而不是「搜索 bili」；而想搜「如何做红烧肉」
 * 这种匹配不上任何站点的话，才落到搜索上——那一层交给外面，因为它要用配置里的
 * 搜索引擎模板。
 *
 * 挑中的行取自**过滤后的全部行**，而不是当前这一屏显示出来的那几行：
 * 在迷你档里搜一个排在第 8 位的站点，它没被显示出来，但用户的意思很明确。
 */
export function intentOf(query: string, rows: HomeRow[], selected: number): RowIntent | null {
  const q = query.trim()
  if (!q) {
    const row = rows[selected] ?? rows[0]
    return row ? intentForRow(row) : null
  }
  if (/^(?:resume|r)$/i.test(q)) return { kind: 'resume' }

  const open = /^(?:open|o)\s+(.*)$/i.exec(q)
  if (open) {
    const rest = open[1].trim()
    if (rest) return { kind: 'text', text: rest }
    return rows[0] ? intentForRow(rows[0]) : null
  }

  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+/.test(q)
  const hit = rows[selected] ?? rows[0]
  if (hit && !looksLikeUrl) return intentForRow(hit)
  return { kind: 'text', text: q }
}

export interface RowListHandlers {
  open: (url: string) => void
  resume: () => void
  /** 弹系统选文件框，开一本本机文件 */
  openFile: () => void
  submit: (text: string) => void
  clearQuery: () => void
}

/**
 * 行列表的交互：一屏显示几行、选中哪一行、上下键与回车。
 *
 * `limit` 由调用方按各自的行高与实测高度算出来——只有世界自己知道它的行有多高。
 *
 * `step` 是上下键一步走几格：**列表里是 1，网格里是一整行**（也就是列数）。
 * 屏幕上就是把光标往上/下挪一格位置，这一条不许写死成 1，否则网格里按一下
 * 下键会从第一格跳到第二格——那是「往右一格」，不是「下一行」。
 */
export function useRowList(
  rows: ComputedRef<HomeRow[]>,
  limit: ComputedRef<number>,
  handlers: RowListHandlers,
  step: ComputedRef<number> = computed(() => 1)
) {
  const visible = computed(() => rows.value.slice(0, Math.max(1, limit.value)))
  const sel = ref(0)

  // 过滤之后行会变少，光标可能停在已经不存在的那一行上
  watch([rows, visible], () => {
    if (sel.value > visible.value.length - 1) {
      sel.value = Math.max(0, visible.value.length - 1)
    }
  })

  /** 网格里左右键走一格。列表里它到不了这儿——那时左右键是换板块或移动插入点 */
  const grid = computed(() => step.value > 1)

  function move(delta: number): void {
    const last = Math.max(0, visible.value.length - 1)
    sel.value = Math.max(0, Math.min(sel.value + delta, last))
  }

  function pick(row: HomeRow): void {
    if (row.verb === 'resume') handlers.resume()
    else if (row.verb === 'open-file') handlers.openFile()
    else handlers.open(row.url)
  }

  /** 光标回到第一行。换一栏的时候用——新的一栏与上一栏的行没有任何关系 */
  function reset(): void {
    sel.value = 0
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(step.value)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-step.value)
    } else if (grid.value && event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
    } else if (grid.value && event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'Escape') {
      handlers.clearQuery()
      sel.value = 0
    }
  }

  /** 提示行里按下回车：执行完就把它清空——免得同一条命令被按两次 */
  function onSubmit(query: string): void {
    const intent = intentOf(query, rows.value, sel.value)
    if (query.trim()) handlers.clearQuery()
    if (!intent) return
    if (intent.kind === 'resume') handlers.resume()
    else if (intent.kind === 'open') handlers.open(intent.url)
    else if (intent.kind === 'open-file') handlers.openFile()
    else handlers.submit(intent.text)
  }

  return { visible, sel, pick, move, reset, onKeydown, onSubmit }
}
