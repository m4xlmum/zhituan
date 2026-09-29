/**
 * 起始页上被移除的站点域名。
 *
 * 起始页那一列站点的来源有三个（我的站点 / 常访问 / 热门站点），后两个没有
 * 「属于谁」这一说——删掉一行无处可删。于是删除统一落成这份名单：
 * 界面删一行就是报一个域名上来，起始页排站点时跳过它（见 useTiles 的 tilesOf）。
 *
 * 为什么单开一份文件而不是塞进配置：它是**一份会长长的清单**（用户删过多少个，
 * 就有多少条），而配置一变就全量广播——一个删过三十个站点的人，此后每次调
 * 透明度滑块都会把这三十条推一遍。与悬浮球图标不进配置是同一条道理（见
 * ballIconStore.ts），只是冷热刚好相反。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import type { HiddenSite } from '@shared/types'
import { domainOf } from '@shared/url'
import { JsonListStore, makeId } from './jsonListStore'

function normalizeHidden(raw: unknown): HiddenSite[] {
  if (!Array.isArray(raw)) return []
  const out: HiddenSite[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Partial<HiddenSite>
    /*
     * 存进来的域名要**按同一把尺子再裁一遍**：这份文件是用户手改得着的
     * （与 sites.json 一样躺在配置目录里），而认得出域名是这一条能起作用的前提
     * ——起始页那边是拿 tilesOf 算出来的域名去比这一份，两边不同源就一条也比不中。
     * 认不出的（写坏的、手填的整条网址）直接丢掉，不留在名单里充数。
     */
    const domain = domainOf(typeof r.domain === 'string' ? `https://${r.domain}` : null)
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : makeId('hide'),
      domain,
      removedAt: typeof r.removedAt === 'number' ? r.removedAt : Date.now()
    })
  }
  return out
}

export class HiddenSiteStore extends JsonListStore<HiddenSite> {
  constructor(userDataDir: string) {
    super(userDataDir, 'home-hidden.json', normalizeHidden)
  }

  /**
   * 把一批域名记进名单。
   *
   * 已经在名单里的不再记一遍（去重留在这一处，界面那边就不必先查一次再删）——
   * 但**它仍然算「这一次生效了」**：调用方要的是「这个域名别再出现」这个结果，
   * 而不是「这次多了一条记录」。
   */
  hide(domains: string[]): HiddenSite[] {
    const have = new Set(this.items.map((h) => h.domain))
    const added: HiddenSite[] = []
    for (const raw of domains) {
      const domain = domainOf(raw.includes('://') ? raw : `https://${raw}`)
      if (!domain || have.has(domain)) continue
      have.add(domain)
      added.push({ id: makeId('hide'), domain, removedAt: Date.now() })
    }
    if (!added.length) return this.items
    return this.commit([...this.items, ...added])
  }

  /**
   * 把一个域名从名单里划掉（用户又把它添回来了）。
   *
   * 与 hide 同一条规矩：不在名单里也算「这一次生效了」——添一个从没删过的站点
   * 不该报错，也不该在名单里留下一行空账。
   */
  unhide(domains: string[]): HiddenSite[] {
    const drop = new Set(
      domains
        .map((raw) => domainOf(raw.includes('://') ? raw : `https://${raw}`))
        .filter((d): d is string => d !== null)
    )
    if (!drop.size) return this.items
    const next = this.items.filter((h) => !drop.has(h.domain))
    if (next.length === this.items.length) return this.items
    return this.commit(next)
  }

  /** 被移除的域名清单。起始页排站点时要的就是它 */
  domains(): string[] {
    return this.items.map((h) => h.domain)
  }
}
