import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = 8787
const isWin = process.platform === 'win32'
const clients = new Set()
let keyResolver = null
let runId = 0
const timer = { enabled: false, intervalMin: 15, handle: null, running: false }

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0]

  if (url === '/' || url === '/index.html') { serveHtml(res, 'dashboard.html'); return }
  if (url === '/setup') { serveHtml(res, 'wizard.html'); return }
  if (url === '/config') { serveHtml(res, 'config.html'); return }
  if (url === '/result') { serveHtml(res, 'result.html'); return }

  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write('retry: 3000\n\n')
    clients.add(res)
    req.on('close', () => { clients.delete(res) })
    return
  }

  if (url === '/run' && req.method === 'POST') {
    runId += 1
    const my = runId
    runSteps(my).catch((e) => send({ type: 'fatal', text: String((e && e.message) || e) }))
    res.writeHead(200); res.end('{"ok":true}')
    return
  }

  if ((url === '/run-radar' || url === '/api/refresh') && req.method === 'POST') {
    runRefresh(url === '/api/refresh' ? 'manual' : 'first')
    res.writeHead(200); res.end('{"ok":true}')
    return
  }

  if (url === '/api/verdicts') {
    let rows = [], lastRun = null
    try {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(join(ROOT, 'data', 'chat-radar.db'))
      const r = db.prepare('SELECT MAX(synced_at) AS m FROM verdicts').get()
      if (r && r.m) { lastRun = r.m; rows = db.prepare('SELECT chat_name, category, hot, headline, suggested_action, related, time_bucket, avatar, topic, latest_time, mention_count FROM verdicts WHERE synced_at = ?').all(r.m) }
      db.close()
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ rows, lastRun, baseUrl: readEnv('BASE_URL'), timer: { enabled: timer.enabled, intervalMin: timer.intervalMin, running: timer.running } }))
    return
  }

  if (url === '/api/timer' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}')
        timer.enabled = !!p.enabled
        timer.intervalMin = Math.max(1, Number(p.intervalMin) || 15)
        const sp = join(ROOT, 'config', 'settings.yaml')
        let s = { days: 15, exclude_muted: false }
        if (existsSync(sp)) { try { s = { ...s, ...(parse(readFileSync(sp, 'utf8')) || {}) } } catch {} }
        s.timer_enabled = timer.enabled
        s.interval_min = timer.intervalMin
        writeFileSync(sp, stringify(s))
        if (timer.enabled) startTimer(); else stopTimer()
        res.writeHead(200); res.end(JSON.stringify({ ok: true, timer: { enabled: timer.enabled, intervalMin: timer.intervalMin } }))
      } catch { res.writeHead(400); res.end('{"ok":false}') }
    })
    return
  }

  if (url === '/api/profile') {
    const status = await larkJson(['auth', 'status'])
    const u = (status && status.identities && status.identities.user) || {}
    let me = {}
    const mePath = join(ROOT, 'config', 'me.yaml')
    if (existsSync(mePath)) { try { me = parse(readFileSync(mePath, 'utf8')) || {} } catch {} }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ name: u.userName || (me.identity && me.identity.name) || '', open_id: u.openId || (me.identity && me.identity.open_id) || '', me }))
    return
  }
  if (url === '/api/me' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}')
        const me = { identity: { name: p.name || '', open_id: p.open_id || '', role: p.role || '' }, owns: p.owns || [], follows: p.follows || [], people: p.people || [], keywords: p.keywords || [], care_about: p.care_about || [] }
        writeFileSync(join(ROOT, 'config', 'me.yaml'), stringify(me))
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}')
      } catch { res.writeHead(400); res.end('{"ok":false}') }
    })
    return
  }
  if (url === '/api/settings' && req.method === 'GET') {
    let s = { days: 15, exclude_muted: false, skip_progress: false, timer_enabled: false, interval_min: 15 }
    const p = join(ROOT, 'config', 'settings.yaml')
    if (existsSync(p)) { try { s = { ...s, ...(parse(readFileSync(p, 'utf8')) || {}) } } catch {} }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(s))
    return
  }
  if (url === '/api/settings' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}')
        const sp = join(ROOT, 'config', 'settings.yaml')
        let s = { days: 15, exclude_muted: false }
        if (existsSync(sp)) { try { s = { ...s, ...(parse(readFileSync(sp, 'utf8')) || {}) } } catch {} }
        s.days = Number(p.days) || 15
        s.exclude_muted = !!p.exclude_muted
        writeFileSync(sp, stringify(s))
        res.writeHead(200); res.end('{"ok":true}')
      } catch { res.writeHead(400); res.end('{"ok":false}') }
    })
    return
  }
  if (url === '/api/skip' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}')
        const sp = join(ROOT, 'config', 'settings.yaml')
        let s = { days: 15, exclude_muted: false }
        if (existsSync(sp)) { try { s = { ...s, ...(parse(readFileSync(sp, 'utf8')) || {}) } } catch {} }
        s.skip_progress = !!p.skip
        writeFileSync(sp, stringify(s))
        res.writeHead(200); res.end('{"ok":true}')
      } catch { res.writeHead(400); res.end('{"ok":false}') }
    })
    return
  }
  if (url === '/save-key' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body || '{}')
        if (key && keyResolver) { keyResolver(String(key).trim()); keyResolver = null }
        res.writeHead(200); res.end('{"ok":true}')
      } catch { res.writeHead(400); res.end('{"ok":false}') }
    })
    return
  }
  res.writeHead(404); res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`
  console.log('chat-radar console:', url)
  initTimer()
  const firstRun = !existsSync(join(ROOT, 'config', 'me.yaml'))
  openBrowser(url + (firstRun ? '/setup' : '/'))
})

function initTimer() {
  const sp = join(ROOT, 'config', 'settings.yaml')
  if (!existsSync(sp)) return
  try {
    const s = parse(readFileSync(sp, 'utf8')) || {}
    timer.enabled = !!s.timer_enabled
    timer.intervalMin = Math.max(1, Number(s.interval_min) || 15)
    if (timer.enabled) startTimer()
  } catch {}
}
function startTimer() { stopTimer(); timer.handle = setInterval(() => runRefresh('timer'), timer.intervalMin * 60000) }
function stopTimer() { if (timer.handle) { clearInterval(timer.handle); timer.handle = null } }

function runRefresh(source) {
  if (timer.running) { send({ type: 'refresh-busy' }); return }
  timer.running = true
  send({ type: 'refresh-start', source })
  const child = spawn('node', ['bin/chat-radar.js', 'refresh', '--limit', '50'], { cwd: ROOT, shell: isWin })
  child.stdout.on('data', (d) => send({ type: 'refresh-log', text: d.toString() }))
  child.stderr.on('data', (d) => send({ type: 'refresh-log', text: d.toString() }))
  child.on('close', () => { timer.running = false; send({ type: 'refresh-done' }) })
  child.on('error', () => { timer.running = false; send({ type: 'refresh-done' }) })
}

function serveHtml(res, name) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' })
  res.end(readFileSync(join(HERE, name)))
}
function send(obj) { const line = `data: ${JSON.stringify(obj)}\n\n`; for (const c of clients) { try { c.write(line) } catch {} } }
function step(id, status) { send({ type: 'step', id, status }) }
function log(id, text) { send({ type: 'log', id, text }) }
function readEnv(key) {
  try {
    const m = readFileSync(join(ROOT, '.env'), 'utf8').match(new RegExp('^\\s*' + key + '\\s*=\\s*(.+)\\s*$', 'm'))
    return m ? m[1].trim() : ''
  } catch { return '' }
}
function openBrowser(url) {
  if (isWin) execFile('cmd', ['/c', 'start', '', url], () => {})
  else if (process.platform === 'darwin') execFile('open', [url], () => {})
  else execFile('xdg-open', [url], () => {})
}
function run(id, cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: isWin })
    child.stdout.on('data', (d) => log(id, d.toString().trimEnd()))
    child.stderr.on('data', (d) => log(id, d.toString().trimEnd()))
    child.on('error', (e) => { log(id, '✗ ' + e.message); resolve(1) })
    child.on('close', (code) => resolve(code ?? 0))
  })
}
function larkJson(args) {
  return new Promise((resolve) => {
    execFile('lark-cli', args, { shell: true, maxBuffer: 1 << 24 }, (err, stdout) => { try { resolve(JSON.parse(stdout)) } catch { resolve(null) } })
  })
}
function hasLarkCli() { return new Promise((r) => execFile('lark-cli', ['--version'], { shell: true }, (e) => r(!e))) }

async function runSteps(my) {
  const alive = () => my === runId
  step('env', 'running')
  const major = Number(process.versions.node.split('.')[0])
  log('env', `Node.js ${process.versions.node}`)
  if (major < 22) { log('env', '⚠ 建议升级到 Node 22+'); step('env', 'warn') } else { log('env', '✓ 版本满足'); step('env', 'done') }
  if (!alive()) return

  step('cli', 'running')
  if (await hasLarkCli()) { log('cli', '✓ 已安装 @larksuite/cli'); step('cli', 'done') }
  else {
    log('cli', '未检测到，开始安装 @larksuite/cli …')
    const code = await run('cli', 'npm', ['i', '-g', '@larksuite/cli'])
    if (!alive()) return
    if (code === 0 && (await hasLarkCli())) { log('cli', '✓ 安装完成'); step('cli', 'done') } else { log('cli', '✗ 安装失败，请手动 npm i -g @larksuite/cli'); step('cli', 'error'); return }
  }
  if (!alive()) return

  step('auth', 'running')
  const status = await larkJson(['auth', 'status'])
  const user = status && status.identities && status.identities.user
  if (user && user.available) { log('auth', `✓ 已授权：${user.userName || user.openId}`); step('auth', 'done') }
  else {
    log('auth', '获取授权链接（Device Flow）…')
    const init = await larkJson(['auth', 'login', '--no-wait', '--json', '--domain', 'im,base'])
    const d = (init && init.data) || init || {}
    const authUrl = d.verification_url || d.verification_uri || d.verification_uri_complete
    const deviceCode = d.device_code
    if (!authUrl || !deviceCode) { log('auth', '✗ 获取授权链接失败'); step('auth', 'error'); return }
    send({ type: 'auth', url: authUrl, code: d.user_code || '' })
    const ok = await new Promise((resolve) => {
      const t0 = Date.now()
      const tick = async () => {
        if (!alive()) return resolve(false)
        const r = await larkJson(['auth', 'login', '--device-code', deviceCode, '--json'])
        const uu = r && ((r.identities && r.identities.user) || r.data)
        if (r && (r.ok === true || (uu && uu.available) || (uu && uu.open_id))) return resolve(true)
        if (Date.now() - t0 > 300000) return resolve(false)
        setTimeout(tick, 3000)
      }
      tick()
    })
    if (!alive()) return
    if (ok) { log('auth', '✓ 授权成功'); step('auth', 'done'); send({ type: 'auth-done' }) } else { log('auth', '✗ 授权超时'); step('auth', 'error'); return }
  }
  if (!alive()) return

  step('deps', 'running')
  try { const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')); log('deps', '本项目依赖：' + (Object.keys(pkg.dependencies || {}).join('、') || '无')) } catch {}
  const dcode = await run('deps', 'npm', ['install'])
  if (!alive()) return
  if (dcode === 0) { log('deps', '✓ 依赖安装完成'); step('deps', 'done') } else { log('deps', '✗ 依赖安装失败'); step('deps', 'error'); return }
  if (!alive()) return

  step('key', 'running')
  const envPath = join(ROOT, '.env')
  const hasKey = existsSync(envPath) && /^\s*DEEPSEEK_API_KEY\s*=\s*\S/m.test(readFileSync(envPath, 'utf8'))
  if (hasKey) { log('key', '✓ 已配置 DeepSeek key'); step('key', 'done') }
  else {
    send({ type: 'need-key' })
    const key = await new Promise((resolve) => { keyResolver = resolve })
    if (!alive()) return
    if (!existsSync(envPath) && existsSync(join(ROOT, '.env.example'))) writeFileSync(envPath, readFileSync(join(ROOT, '.env.example')))
    appendFileSync(envPath, `\nDEEPSEEK_API_KEY=${key}\n`)
    log('key', '✓ 已写入 .env'); step('key', 'done')
  }
  send({ type: 'done', text: '环境就绪！下一步配置你的信息版图。' })
}
