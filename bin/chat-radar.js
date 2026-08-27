#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { larkRaw, authStatus, listChats, listMessagesAsync, pool } from '../src/feishu/lark.js'

process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.error(w.message)
})

const DOTENV_KEYS = new Set()
loadDotenv()

const [cmd] = process.argv.slice(2)

const commands = {
  doctor,
  chats,
  sync,
  list,
  push,
  refresh,
  help: usage,
}

const handler = commands[cmd] ?? (cmd ? unknown : usage)
await handler()

function usage() {
  console.log(`chat-radar v0.6.0 — 飞书群聊信息面板（自托管 / BYOK）

用法：chat-radar <命令>

命令：
  doctor            检查运行环境（node / lark-cli 授权 / DeepSeek key / 配置）
  chats [--write]   列出你所在的群（--write 直接写入 config/chats.yaml）
  sync [--limit N]  拉取群消息并裁定，写入本地库（--limit 只跑前 N 个群）
  list              按分类打印裁定面板（终端）
  push              把本地裁定推送到飞书 Base 看板
  refresh           = sync + push，一步刷新（定时任务用）
  help              显示本帮助

架构与版本路线见 knowledge/decisions/`)
}

function unknown() {
  console.log(`未知命令：${cmd}\n`)
  usage()
  process.exit(1)
}

function chats() {
  const list = listChats()

  if (process.argv.includes('--write')) {
    const lines = ['# 由 `chat-radar chats --write` 生成；可手动增删或调整每群 lookback。', 'chats:']
    for (const c of list) {
      lines.push(`  - chat_id: ${c.chat_id}`)
      lines.push(`    name: ${JSON.stringify(c.name)}`)
      lines.push('    lookback: 50')
    }
    writeChats(lines.join('\n') + '\n')
    console.log(`已写入 config/chats.yaml（${list.length} 个群）`)
    return
  }

  console.log(`你所在的群（${list.length} 个，已过滤单聊/已解散）：\n`)
  list.forEach((c, i) => {
    const tag = c.external ? '外部' : '内部'
    console.log(`  ${String(i + 1).padStart(2)}. [${tag}] ${c.name}`)
    console.log(`      ${c.chat_id}`)
  })
  console.log(`\n挑几个高价值群填进 config/chats.yaml，或用 chat-radar chats --write 一次写全。`)
}

async function sync() {
  const { loadConfig } = await import('../src/config/load.js')
  const { triageChat } = await import('../src/triage/triage.js')
  const { openDb, saveVerdict, allVerdicts } = await import('../src/store/db.js')
  const { daysSince, timeBucket } = await import('../src/util/time.js')

  const { me, categories, overlay } = loadConfig()
  let settings = {}
  try { settings = (await import('yaml')).parse(readFileSync('config/settings.yaml', 'utf8')) || {} } catch {}
  const activeDays = Number(argValue('--days') ?? settings.days ?? 15)
  const full = process.argv.includes('--full') || process.argv.includes('--force')
  const probeConc = Number(settings.sync_concurrency ?? 6)
  const triageConc = Number(settings.triage_concurrency ?? 2)
  const openId = me.identity && me.identity.open_id
  const limitArg = argValue('--limit')
  let ordered = listChats({ excludeMuted: !!settings.exclude_muted })
  if (limitArg) ordered = ordered.slice(0, Number(limitArg))

  const db = openDb()
  const syncedAt = new Date().toISOString()
  const prev = new Map(allVerdicts(db).map((r) => [r.chat_id, r]))

  // A. 并发 probe：逐群拉最新一条真实消息，拿 { latest_time, message_id }
  console.log(`探测 ${ordered.length} 个群的最新消息（并发 ${probeConc}）…`)
  let probed = 0
  const probes = await pool(ordered, probeConc, async (chat) => {
    const msgs = await listMessagesAsync(chat.chat_id, { pageSize: 15 })
    probed++
    process.stdout.write(`\r  探测 [${probed}/${ordered.length}]        `)
    if (!msgs.length) return null
    const last = msgs[msgs.length - 1]
    return { latest_time: last.time, message_id: last.message_id }
  })
  process.stdout.write('\n')

  // B. 三分类：不活跃丢弃 / 指纹未变复用 / 变了·新群·--full 待裁
  const reuse = []
  const triageList = []
  ordered.forEach((chat, i) => {
    const p = probes[i]
    if (!p || !p.ok || !p.value) return
    const { latest_time, message_id } = p.value
    if (daysSince(latest_time) > activeDays) return
    const old = prev.get(chat.chat_id)
    if (!full && old && old.last_message_id && old.last_message_id === message_id) {
      reuse.push({ chat, old, latest_time })
    } else {
      triageList.push({ chat, latest_time, message_id })
    }
  })

  // C. 复用旧裁定（火线随时间自动冷却，纯本地算、不烧 token）
  for (const { chat, old, latest_time } of reuse) {
    const bucket = timeBucket(latest_time)
    saveVerdict(db, {
      ...old,
      chat_name: chat.name,
      avatar: chat.avatar || old.avatar || '',
      time_bucket: bucket,
      hot: old.hot && bucket === 'today' ? 1 : 0,
      latest_time,
      last_message_id: old.last_message_id,
      key_people: safeParse(old.key_people),
    }, syncedAt)
  }

  // D. 新裁：拉 lookback 条 + triageChat，低并发避 DeepSeek 频控
  console.log(`复用 ${reuse.length} 个，新裁 ${triageList.length} 个…\n`)
  let newDone = 0
  const tr = await pool(triageList, triageConc, async ({ chat, latest_time, message_id }) => {
    const messages = await listMessagesAsync(chat.chat_id, { pageSize: chat.lookback ?? 50 })
    const v = await triageChat({ chat, messages, me }, categories, overlay)
    v.time_bucket = timeBucket(latest_time)
    v.avatar = chat.avatar || ''
    v.latest_time = latest_time
    v.last_message_id = message_id
    v.mention_count = messages.filter((m) => (m.mentions || []).includes(openId)).length
    saveVerdict(db, v, syncedAt)
    newDone++
    console.log(`  [${newDone}/${triageList.length}] ${labelOf(v.category, categories)}${v.hot ? '🔥' : ''} [${bucketZh(v.time_bucket)}] ${chat.name} — ${v.headline}`)
    return v
  })
  const newCount = tr.filter((r) => r.ok).length
  const failCount = tr.length - newCount

  db.close()
  const skipped = ordered.length - reuse.length - newCount
  console.log(`\n复用 ${reuse.length} · 新裁 ${newCount}${failCount ? ` · 失败 ${failCount}` : ''} · 跳过 ${skipped}（不活跃/空群）。chat-radar push 推看板。`)
}

function safeParse(s) {
  if (Array.isArray(s)) return s
  try { return JSON.parse(s) } catch { return [] }
}

async function list() {
  const { loadConfig } = await import('../src/config/load.js')
  const { openDb, latestVerdicts } = await import('../src/store/db.js')

  const { categories } = loadConfig()
  const db = openDb()
  const rows = latestVerdicts(db)
  db.close()
  if (rows.length === 0) return console.log('还没有裁定结果，先跑 chat-radar sync')

  const order = ['lead', 'reply', 'watch', 'ignore']
  const label = Object.fromEntries(categories.map((c) => [c.key, `${c.emoji} ${c.name}`]))
  const rank = { today: 0, yesterday: 1, week: 2, older: 3 }
  const byTime = (a, b) => (rank[a.time_bucket] ?? 9) - (rank[b.time_bucket] ?? 9)

  const hot = rows.filter((r) => r.hot).sort(byTime)
  if (hot.length) {
    console.log('🔥 火线')
    hot.forEach(printRow)
    console.log('')
  }
  for (const key of order) {
    const group = rows.filter((r) => r.category === key && !r.hot).sort(byTime)
    if (!group.length) continue
    console.log(label[key] ?? key)
    group.forEach(printRow)
    console.log('')
  }

  function printRow(r) {
    console.log(`  · [${bucketZh(r.time_bucket)}] ${r.chat_name} — ${r.headline}`)
    if (r.category !== 'ignore' && r.suggested_action) console.log(`      ↳ ${r.suggested_action}`)
  }
}

async function push() {
  const { openDb, latestVerdicts } = await import('../src/store/db.js')
  const { pushVerdicts } = await import('../src/feishu/base.js')

  const appToken = process.env.BASE_APP_TOKEN
  const tableId = process.env.BASE_TABLE_ID
  if (!appToken || !tableId) return console.log('未配置 BASE_APP_TOKEN / BASE_TABLE_ID（.env）')

  const db = openDb()
  const rows = latestVerdicts(db)
  db.close()
  if (!rows.length) return console.log('本地无裁定，先跑 chat-radar sync')

  const n = pushVerdicts(rows, { appToken, tableId })
  console.log(`已推送 ${n} 条到飞书 Base 看板`)
}

async function refresh() {
  await sync()
  await push()
}

function labelOf(key, categories) {
  const c = categories.find((x) => x.key === key)
  return c ? `${c.emoji}${c.name}` : key
}

function bucketZh(b) {
  return { today: '今天', yesterday: '昨天', week: '本周', older: '更早' }[b] ?? b
}

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}

function writeChats(text) {
  writeFileSync('config/chats.yaml', text)
}

function doctor() {
  const checks = []

  const nodeMajor = Number(process.versions.node.split('.')[0])
  checks.push(['Node >= 22', nodeMajor >= 22, process.versions.node])

  let larkOk = false
  let larkInfo = '未找到 lark-cli'
  try {
    larkInfo = larkRaw(['--version']).trim()
    larkOk = true
  } catch {}
  checks.push(['lark-cli 可用', larkOk, larkInfo])

  let authOk = false
  let authInfo = '未授权'
  if (larkOk) {
    try {
      const user = authStatus()?.identities?.user
      authOk = Boolean(user && user.available)
      authInfo = authOk ? `user: ${user.userName ?? user.openId}` : '用户身份不可用'
    } catch {
      authInfo = '读取授权失败'
    }
  }
  checks.push(['飞书用户授权', authOk, authInfo])

  const keyOk = Boolean(process.env.DEEPSEEK_API_KEY)
  const keySrc = DOTENV_KEYS.has('DEEPSEEK_API_KEY') ? '来自 .env' : '来自系统环境'
  checks.push(['DEEPSEEK_API_KEY', keyOk, keyOk ? `已设置（${keySrc}）` : '未设置（填 .env）'])

  const cfgOk = existsSync('config/me.yaml')
  checks.push(['config/me.yaml', cfgOk, cfgOk ? '存在' : '未创建'])

  const baseOk = Boolean(process.env.BASE_APP_TOKEN && process.env.BASE_TABLE_ID)
  checks.push(['飞书 Base 看板', baseOk, baseOk ? '已配置' : '未配置（可选）'])

  console.log('chat-radar doctor\n')
  for (const [name, ok, info] of checks) {
    console.log(`  ${ok ? '✓' : '✗'}  ${name.padEnd(18)} ${info}`)
  }
  const blockers = checks.filter((c) => !c[1]).map((c) => c[0])
  console.log(blockers.length ? `\n待解决：${blockers.join('、')}` : '\n环境就绪。')
}

function loadDotenv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (m && m[2] !== '') {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        DOTENV_KEYS.add(m[1])
      }
    }
  } catch {}
}
