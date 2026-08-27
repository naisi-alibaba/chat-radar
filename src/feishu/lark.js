import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export function larkRaw(args, opts = {}) {
  return execFileSync('lark-cli', args, {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
}

export function larkJson(args) {
  const res = JSON.parse(larkRaw(args))
  if (res && res.ok === false) throw new Error(`lark-cli ${args.join(' ')}：${res.error ?? '调用失败'}`)
  return res
}

export function authStatus() {
  return larkJson(['auth', 'status'])
}

export function listChats({ includeP2p = false, excludeMuted = false } = {}) {
  const all = []
  let pageToken
  do {
    const args = ['im', '+chat-list', '--page-size', '100', '--sort', 'active_time']
    if (excludeMuted) args.push('--exclude-muted')
    if (includeP2p) args.push('--types=p2p,group')
    if (pageToken) args.push('--page-token', pageToken)
    const res = larkJson(args)
    all.push(...(res?.data?.chats ?? []))
    pageToken = res?.data?.has_more ? res?.data?.page_token : null
  } while (pageToken)
  return all.filter((c) => c.chat_status === 'normal' && c.chat_mode === 'group')
}

export function listMessages(chatId, { pageSize = 50 } = {}) {
  const res = larkJson([
    'im', '+chat-messages-list',
    '--chat-id', chatId,
    '--page-size', String(pageSize),
    '--order', 'desc',
    '--no-reactions',
  ])
  const msgs = (res?.data?.messages ?? [])
    .filter((m) => !m.deleted && m.msg_type !== 'system' && m.content)
    .map((m) => ({
      time: m.create_time,
      sender: m.sender?.name ?? '未知',
      text: m.content ?? '',
      mentions: (m.mentions ?? []).map((x) => x.id),
    }))
  return msgs.reverse()
}

// ——— 异步版（仅供 sync 的并发 probe / 拉取使用；同步版保持不变）———

export async function larkRawAsync(args, opts = {}) {
  const { stdout } = await execFileP('lark-cli', args, {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
  return stdout
}

export async function larkJsonAsync(args) {
  const res = JSON.parse(await larkRawAsync(args))
  if (res && res.ok === false) throw new Error(`lark-cli ${args.join(' ')}：${res.error ?? '调用失败'}`)
  return res
}

export async function listMessagesAsync(chatId, { pageSize = 50 } = {}) {
  const res = await larkJsonAsync([
    'im', '+chat-messages-list',
    '--chat-id', chatId,
    '--page-size', String(pageSize),
    '--order', 'desc',
    '--no-reactions',
  ])
  const msgs = (res?.data?.messages ?? [])
    .filter((m) => !m.deleted && m.msg_type !== 'system' && m.content)
    .map((m) => ({
      time: m.create_time,
      sender: m.sender?.name ?? '未知',
      text: m.content ?? '',
      mentions: (m.mentions ?? []).map((x) => x.id),
      message_id: m.message_id,
    }))
  return msgs.reverse() // 时间正序，最新一条 = 最后一个元素
}

// 零依赖并发池：size 个 worker 共享游标，永不 reject；单项失败记 { ok:false, error }。
export async function pool(items, size, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const run = async () => {
    while (cursor < items.length) {
      const i = cursor++
      try { results[i] = { ok: true, value: await worker(items[i], i) } }
      catch (e) { results[i] = { ok: false, error: e } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run))
  return results
}
