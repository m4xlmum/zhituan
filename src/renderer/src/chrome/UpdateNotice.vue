<script setup lang="ts">
/**
 * 更新提示条：窗口内的一行，不是系统通知。
 *
 * 为什么坚持「窗口内」：这是一个隐身软件。系统通知会进通知中心、会上锁屏、
 * 会被录屏录进去——那等于替用户把「我在跑别的程序」说出去。所以更新这件事
 * 只有这一个出口：一行 30px 的字，待在地址栏与网页之间。
 *
 * 位置由主进程决定（NOTICE_H 是版面的一部分，网页要让出这一行），
 * 因此这里的渲染条件跟着 WindowRuntime.noticeVisible 走；写什么由
 * BROADCAST.updateState 给。两份状态各有各的主人，见 shared/ipc.ts。
 *
 * 那一枚 ✕ 是「忽略这个版本」而不是「稍后」：一次点击就把这一版收掉、且落盘，
 * 下次启动不再冒出来。撤销的入口在设置页（关于 → 已忽略 N.N.N〔仍然提示〕）——
 * 「稍后」只是把同一件事推迟到下次开机再问一遍，那更烦人。下载中也给这一枚：
 * 下载可能是「手动查一下」自己带起来的，用户总得有个出口，而它现在真的会把
 * 在下的那一份中止掉（见 updateService 的 ignore）。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { computed } from 'vue'
import { UPDATE_FEED_BASE } from '@shared/constants'
import { useUpdate } from '../composables/useUpdate'
import { useWindowDrag } from '../composables/useWindowDrag'
import Icon from './Icon.vue'

const { state, install, ignore } = useUpdate()

/** 这一行也能拖窗口：按在按钮上是操作，按在别处（文字、留白）都是拖 */
const drag = useWindowDrag()

const phase = computed(() => state.value?.phase ?? 'idle')
const version = computed(() => state.value?.version ?? null)
/** 用户已经按过「更新并重启」，只是还没下完——下完自己装 */
const pending = computed(() => state.value?.pendingInstall ?? false)

const text = computed(() => {
  switch (phase.value) {
    case 'downloading':
      // 按过「更新并重启」的人要的是「接下来会自己发生什么」，那正是这句话
      return pending.value
        ? `正在下载更新 ${state.value?.percent ?? 0}%，下完自动重启安装`
        : `正在下载更新 ${state.value?.percent ?? 0}%`
    case 'ready':
      // 不说「重启」，说清楚是「重启之后才会装上」：现在点别的都不会装
      return `纸团 ${version.value} 已下载，重启后安装`
    case 'error':
      return `更新下载失败：${state.value?.message || '原因不明'}`
    default:
      return `纸团 ${version.value} 可用`
  }
})

/**
 * 主操作。它只有一个意思：**更新并重启**。
 *
 * 「下载」不再是单独一颗按钮——按下去之后该下的先下、该排队的排队、能装的立刻
 * 装，都由 updateService.install 一处决定，这一行只要把「用户要的是更新」这件事
 * 说出去就够了。
 *
 * pendingInstall 之后不再画按钮：已经没什么可按的了，而且再按一次也没有第二种
 * 结果。失败那一支仍然是「打开发布页」——网络不通时那是唯一还走得通的路。
 */
const action = computed<{ label: string; run: () => void } | null>(() => {
  if (phase.value === 'error') return { label: '打开发布页', run: openReleases }
  if (phase.value === 'available' || phase.value === 'ready') {
    return { label: '更新并重启', run: install }
  }
  if (phase.value === 'downloading' && !pending.value) {
    return { label: '更新并重启', run: install }
  }
  return null
})

/**
 * 网络不通时唯一还走得通的路：在标签页里打开发布页，用户手动下。
 * 用普通标签页而不是系统浏览器——这个软件的窗口本来就该是它的全部出口。
 */
function openReleases(): void {
  void window.zhituan.tabs.create({ url: `${UPDATE_FEED_BASE}/releases/latest`, activate: true })
}

function dismiss(): void {
  if (version.value === null) return
  void ignore(version.value)
}
</script>

<template>
  <div
    class="notice-row"
    @pointerdown="drag.onPointerDown"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerCancel"
  >
    <span class="notice-text">{{ text }}</span>

    <button v-if="action" class="notice-btn primary" @click="action.run()">
      {{ action.label }}
    </button>

    <!--
      忽略键。下载中也留着：下载可能是「手动查一下」自己带起来的，用户得有个
      出口，而按它会**真的把在下的那一份中止掉、把半截文件删掉**（见
      updateService 的 ignore）——不然这一版会在他说了「不要」之后继续下完。
    -->
    <button
      class="notice-btn icon"
      :title="`忽略 ${version}，不再提示`"
      :aria-label="`忽略 ${version}，不再提示`"
      @click="dismiss"
    >
      <Icon name="close" :size="12" />
    </button>

    <!--
      进度线画在这一行的下沿，不占行高：条的高度是主进程算进版面里的，
      这里改高一点，网页就要被压住一条。2px 压在分隔线上，看得清又不碍事。
    -->
    <div
      v-if="phase === 'downloading'"
      class="notice-progress"
      :style="{ width: `${state?.percent ?? 0}%` }"
    />
  </div>
</template>

<style scoped>
.notice-row {
  position: relative;
  flex: 0 0 auto;
  height: var(--zhituan-notice-h);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  background: var(--zhituan-surface);
  border-bottom: 1px solid var(--zhituan-hairline);
}

.notice-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--zhituan-text-dim);
}

/*
 * 按钮要自带底色：base.css 把按钮重置成了「没有背景、没有边框」，
 * 而这一条底下是界面底板，只描边不填底的话在低透明度下就找不着了。
 */
.notice-btn {
  flex: 0 0 auto;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--zhituan-radius-sm);
  background: var(--zhituan-surface-hover);
  color: var(--zhituan-ink);
  font-size: 12px;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.notice-btn:hover {
  background: var(--zhituan-surface-active);
}

/*
 * 主操作（更新并重启 / 打开发布页）用强调色，与顶栏上那些「开着」的
 * 按钮同一套：平时是 accent-soft 上的强调色字，悬停才填满。
 * 这一条本来就只有 30px 高，填满的红或蓝一条会把整行变成一个色块。
 */
.notice-btn.primary {
  color: var(--zhituan-accent);
  background: var(--zhituan-accent-soft);
}

.notice-btn.primary:hover {
  color: var(--zhituan-on-fill);
  background: var(--zhituan-accent);
}

.notice-btn.icon {
  width: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--zhituan-text-dim);
}

.notice-btn.icon:hover {
  color: var(--zhituan-ink);
}

.notice-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--zhituan-accent);
  transition: width 160ms linear;
}
</style>
