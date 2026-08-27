import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'

const DATA_DIR = process.env.CHAT_RADAR_DATA ?? 'data'

export function openDb() {
  mkdirSync(DATA_DIR, { recursive: true })
  const db = new DatabaseSync(`${DATA_DIR}/chat-radar.db`)
  db.exec(`CREATE TABLE IF NOT EXISTS verdicts (
    chat_id TEXT PRIMARY KEY,
    chat_name TEXT,
    category TEXT,
    hot INTEGER,
    headline TEXT,
    reason TEXT,
    suggested_action TEXT,
    related TEXT,
    key_people TEXT,
    time_bucket TEXT,
    avatar TEXT,
    topic TEXT,
    latest_time TEXT,
    mention_count INTEGER,
    last_message_id TEXT,
    synced_at TEXT
  )`)
  try { db.exec('ALTER TABLE verdicts ADD COLUMN time_bucket TEXT') } catch {}
  try { db.exec('ALTER TABLE verdicts ADD COLUMN avatar TEXT') } catch {}
  try { db.exec('ALTER TABLE verdicts ADD COLUMN topic TEXT') } catch {}
  try { db.exec('ALTER TABLE verdicts ADD COLUMN latest_time TEXT') } catch {}
  try { db.exec('ALTER TABLE verdicts ADD COLUMN mention_count INTEGER') } catch {}
  try { db.exec('ALTER TABLE verdicts ADD COLUMN last_message_id TEXT') } catch {}
  return db
}

export function saveVerdict(db, v, syncedAt) {
  db.prepare(
    `INSERT INTO verdicts
      (chat_id, chat_name, category, hot, headline, reason, suggested_action, related, key_people, time_bucket, avatar, topic, latest_time, mention_count, last_message_id, synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(chat_id) DO UPDATE SET
       chat_name=excluded.chat_name, category=excluded.category, hot=excluded.hot,
       headline=excluded.headline, reason=excluded.reason, suggested_action=excluded.suggested_action,
       related=excluded.related, key_people=excluded.key_people, time_bucket=excluded.time_bucket, avatar=excluded.avatar,
       topic=excluded.topic, latest_time=excluded.latest_time, mention_count=excluded.mention_count, last_message_id=excluded.last_message_id, synced_at=excluded.synced_at`,
  ).run(
    v.chat_id, v.chat_name, v.category ?? 'ignore', v.hot ? 1 : 0,
    v.headline ?? '', v.reason ?? '', v.suggested_action ?? '',
    v.related ?? '', JSON.stringify(v.key_people ?? []), v.time_bucket ?? 'older', v.avatar ?? '', v.topic ?? '',
    v.latest_time ?? '', v.mention_count ?? 0, v.last_message_id ?? '', syncedAt,
  )
}

export function allVerdicts(db) {
  return db.prepare('SELECT * FROM verdicts').all()
}

export function latestVerdicts(db) {
  const row = db.prepare('SELECT MAX(synced_at) AS m FROM verdicts').get()
  if (!row || !row.m) return []
  return db.prepare('SELECT * FROM verdicts WHERE synced_at = ?').all(row.m)
}
