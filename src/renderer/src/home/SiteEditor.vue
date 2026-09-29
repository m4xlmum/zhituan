<script setup lang="ts">
/**
 * 站点编辑器。起始页上「添加」与「编辑」共用这一块浮层。
 *
 * 为什么是一块**盖在页上的浮层**，而不是把两格输入嵌进那一列行里：这一页的高度
 * 是量着配的（一屏放得下几行由实测算出来，见 StartPage），插一行进去会让整列
 * 重新排一次，而用户此刻正在改的就是其中某一行——行会跳。盖在上面则一行都不动。
 *
 * 两格：名称与网址。名称可以留空（留空就用域名，见 planOfSave），网址是必须的——
 * 空着的网址没有意义，因此「保存」是禁用的，而不是存下去一条空白记录。
 *
 * 键盘：Esc 收起（不保存），回车保存。Esc 挂在这一层自己身上而不是 window 上：
 * 浮层出现时焦点已经在它的输入框里（挂载时抢过来），事件必然先经过这里。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { onMounted, ref, useTemplateRef } from 'vue'

const props = defineProps<{
  mode: 'add' | 'edit'
  /** 打开时两格的初值。编辑时是那一行现在的名称与网址 */
  initial: { name: string; url: string }
  /** 终端世界：提示符与直角，见 StartPage 里那两套世界 */
  terminal: boolean
  compact: boolean
}>()

const emit = defineEmits<{
  save: [draft: { title: string; url: string }]
  close: []
}>()

const title = ref(props.mode === 'edit' ? props.initial.name : '')
const url = ref(props.mode === 'edit' ? props.initial.url : '')

const nameEl = useTemplateRef<HTMLInputElement>('nameEl')
const urlEl = useTemplateRef<HTMLInputElement>('urlEl')

/*
 * 光标先落在**要先填的那一格**上：新增时先填网址（名称留空就用域名，
 * 它是可选的），编辑时先落在名称上（网址多半是对的，改的多半是名字）。
 */
onMounted(() => {
  if (props.mode === 'add') urlEl.value?.focus()
  else nameEl.value?.focus()
})

function save(): void {
  const value = url.value.trim()
  if (!value) return
  emit('save', { title: title.value, url: value })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div class="site-editor" @click.self="emit('close')" @keydown="onKeydown">
    <form class="box" @submit.prevent="save">
      <p class="head">
        <span v-if="terminal" class="mark">&gt;</span>
        {{ mode === 'add' ? '添加站点' : '编辑站点' }}
      </p>

      <label class="field">
        <span class="key">名称</span>
        <input
          ref="nameEl"
          v-model="title"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :placeholder="terminal ? '' : '可留空，留空就用域名'"
        />
      </label>

      <label class="field">
        <span class="key">网址</span>
        <input
          ref="urlEl"
          v-model="url"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="bilibili.com"
        />
      </label>

      <!--
        这一句说的是**存下去之后会发生什么**，不是输入格式的规矩：
        少了协议头照样能填（见 @shared/url 的 asSiteUrl），用户不必先在心里
        拼一个 https:// 出来。编辑一行常访问或热门站点时，第二句才是重点
        ——那两种不是用户自己的站点，改完就要收进「我的站点」里。
      -->
      <p class="tip">
        不带 http:// 也行，会自动补上。
        <template v-if="mode === 'edit'">改完这一行会收进「我的站点」。</template>
      </p>

      <div class="acts">
        <button type="button" class="btn" @click="emit('close')">取消</button>
        <button type="submit" class="btn primary" :disabled="!url.trim()">保存</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/*
 * 蒙层：整页盖住，点空白处收起。颜色由 --text 混出来，于是浅色主题下是
 * 一层灰、深色主题下是一层雾，两个世界都不用各配一次。
 */
.site-editor {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in srgb, var(--text) 16%, transparent);
}

.box {
  width: min(340px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--ground);
  border: 1px solid var(--divider-strong);
  border-radius: var(--radius);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--text) 22%, transparent);
}

/*
 * 终端世界的直角与方块光标：这一层是两套世界共用的，形状只由变量决定
 * （终端世界把 --radius 整组归零，见 themes.css 末尾）。
 */
.term .box {
  box-shadow: none;
}

.head {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}

.head .mark {
  margin-right: 5px;
  color: var(--accent);
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.key {
  flex: 0 0 auto;
  width: 2.4em;
  font-size: 12px;
  color: var(--text-tertiary);
}

.field input {
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  background: var(--tile);
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  font: inherit;
  color: var(--text);
  outline: none;
}

.field input:focus {
  border-color: var(--accent);
}

.field input::placeholder {
  color: var(--text-tertiary);
}

.tip {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  height: 24px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--divider-strong);
  font: inherit;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 100ms ease-out, color 100ms ease-out;
}

.btn:hover {
  background: var(--ground-hover);
  color: var(--text);
}

/*
 * 主键：底是强调色、字是**页底那个颜色**，也就是「反过来」。
 * 写死白色在三套配色里只有纸白是对的：暗夜与磷绿的强调色本身就是亮的
 * （#8ea9ea / #6bffa4），白字压上去等于白压亮。--ground 是那一套里
 * 与强调色对比度最高的那个底，反过来用就永远立得住。
 */
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ground);
}

.btn.primary:hover {
  background: var(--accent-hover);
  color: var(--ground);
}

.btn:disabled {
  opacity: 0.45;
}

.btn:disabled:hover {
  background: transparent;
  color: var(--text-secondary);
}

.compact .box {
  padding: 10px;
  gap: 8px;
}
</style>
