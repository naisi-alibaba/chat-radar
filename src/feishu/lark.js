import { execFileSync } from 'node:child_process'

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
