export function daysSince(timeStr) {
  const t = parseTime(timeStr)
  if (t == null) return Infinity
  return (Date.now() - t) / 86400000
}

export function timeBucket(timeStr) {
  const t = parseTime(timeStr)
  if (t == null) return 'older'
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startYesterday = startToday - 86400000
  const dow = (now.getDay() + 6) % 7
  const startWeek = startToday - dow * 86400000
  if (t >= startToday) return 'today'
  if (t >= startYesterday) return 'yesterday'
  if (t >= startWeek) return 'week'
  return 'older'
}

function parseTime(s) {
  if (!s) return null
  const t = Date.parse(s.replace(' ', 'T'))
  return Number.isNaN(t) ? null : t
}
