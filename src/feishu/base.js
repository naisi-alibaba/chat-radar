import { writeFileSync, mkdirSync } from 'node:fs'
import { larkJson, larkRaw } from './lark.js'

const TMP = 'data/.batch.json'
const CAT_LABEL = { lead: '🎯拍板', reply: '💬接话', watch: '👀吃瓜', ignore: '🔇免看' }
const BUCKET_ZH = { today: '今天', yesterday: '昨天', week: '本周', older: '更早' }
const FIELDS = ['群名', '分类', '火线', '时间', '旁白', '建议动作', '相关', '更新时间', '群链接']

export function pushVerdicts(verdicts, { appToken, tableId }) {
  mkdirSync('data', { recursive: true })
  try {
    clearTable(appToken, tableId)
  } catch (e) {
    console.log('  (清空旧记录跳过：' + e.message + ')')
  }

  const rows = verdicts.map((v) => [
    v.chat_name ?? '',
    CAT_LABEL[v.category] ?? v.category ?? '',
    v.hot ? '🔥是' : '否',
    BUCKET_ZH[v.time_bucket] ?? '更早',
    v.headline ?? '',
    v.suggested_action ?? '',
    v.related ?? '',
    v.synced_at ?? '',
    v.chat_id ? `https://applink.feishu.cn/client/chat/open?openChatId=${v.chat_id}` : '',
  ])

  for (let i = 0; i < rows.length; i += 200) {
    writeJson({ fields: FIELDS, rows: rows.slice(i, i + 200) })
    larkJson(['base', '+record-batch-create', '--base-token', appToken, '--table-id', tableId, '--json', `@${TMP}`])
  }
  return rows.length
}

function clearTable(appToken, tableId) {
  const md = larkRaw(['base', '+record-list', '--base-token', appToken, '--table-id', tableId, '--limit', '200'])
  const ids = [...md.matchAll(/\|\s*(rec[A-Za-z0-9]+)\s*\|/g)].map((m) => m[1])
  if (!ids.length) return
  writeJson({ record_id_list: ids })
  larkJson(['base', '+record-delete', '--base-token', appToken, '--table-id', tableId, '--json', `@${TMP}`, '--yes'])
}

function writeJson(obj) {
  writeFileSync(TMP, JSON.stringify(obj))
}
