#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { larkRaw, authStatus, listChats, listMessages } from '../src/feishu/lark.js'

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
  console.log(`chat-radar v0.5.0 — 飞书群聊信息面板（自托管 / BYOK）

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
  const { openDb, saveVerdict } = await import('../src/store/db.js')
  const { daysSince, timeBucket } = await import('../src/util/time.js')

  const { me, categories, overlay } = loadConfig()
  let settings = {}
  try { settings = (await import('yaml')).parse(readFileSync('config/settings.yaml', 'utf8')) || {} } catch {}
  const activeDays = Number(argValue('--days') ?? settings.days ?? 15)
  const limitArg = argValue('--limit')
  let ordered = listChats({ excludeMuted: !!settings.exclude_muted })
  if (limitArg) ordered = ordered.slice(0, Number(limitArg))

  const db = openDb()
  const syncedAt = new Date().toISOString()

  console.log(`扫描 ${ordered.length} 个群，裁定近 ${activeDays} 天有更新的…\n`)
  let done = 0
  for (let i = 0; i < ordered.length; i++) {
    const chat = ordered[i]
    const tag = `[${i + 1}/${ordered.length}]`
    let latest
    try {
      const probe = listMessages(chat.chat_id, { pageSize: 5 })
      if (probe.length === 0) { console.log(`${tag} ${chat.name}·空群，跳过`); continue }
      latest = probe[probe.length - 1].time
    } catch {
      console.log(`${tag} ${chat.name}·读取失败，跳过`); continue
    }
    if (daysSince(latest) > activeDays) { console.log(`${tag} ${chat.name}·${Math.round(daysSince(latest))}天前，跳过`); continue }
    try {
      const messages = listMessages(chat.chat_id, { pageSize: chat.lookback ?? 50 })
      const v = await triageChat({ chat, messages, me }, categories, overlay)
      v.time_bucket = timeBucket(latest)
      v.avatar = chat.avatar || ''
      v.latest_time = latest
      v.mention_count = messages.filter((m) => (m.mentions || []).includes(me.identity && me.identity.open_id)).length
      saveVerdict(db, v, syncedAt)
      done++
      console.log(`${tag} ${labelOf(v.category, categories)}${v.hot ? '🔥' : ''} [${bucketZh(v.time_bucket)}] ${chat.name} — ${v.headline}`)
    } catch (e) {
      console.log(`${tag} ${chat.name}·裁定失败：${String(e.message).slice(0, 40)}`)
    }
  }
  db.close()
  console.log(`\n裁定了 ${done} 个近 ${activeDays} 天活跃群。chat-radar push 推看板。`)
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
