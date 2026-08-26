import { createProvider } from '../llm/index.js'

export async function triageChat({ chat, messages, me }, categories, overlay) {
  if (messages.length === 0) {
    return {
      chat_id: chat.chat_id, chat_name: chat.name,
      category: 'ignore', hot: false, headline: '近期无消息',
      reason: '', suggested_action: '', key_people: [], related: '',
    }
  }
  const provider = createProvider()
  const verdict = await provider.chatJson(
    buildSystem(me, categories, overlay),
    buildUser(chat, messages, me),
  )
  return { chat_id: chat.chat_id, chat_name: chat.name, ...verdict }
}

function buildSystem(me, categories, overlay) {
  const cats = categories.map((c) => `- ${c.key} ${c.name}：${c.desc}`).join('\n')
  const ov = overlay.map((c) => `- ${c.key} ${c.name}：${c.desc}`).join('\n')
  return `你是「chat-radar」，${me.identity.name} 的群聊分诊助手。目标：读一个飞书群最近的聊天记录，结合他的「信息版图」，判断这个群此刻对他意味着什么、该以什么姿态介入。

信息版图：
- 角色：${me.identity.role ?? ''}
- 负责(owns)：${(me.owns ?? []).join('；')}
- 关注不主导(follows)：${(me.follows ?? []).join('；')}
- 关键人：${(me.people ?? []).map((p) => p.name).join('、')}
- 关键词：${(me.keywords ?? []).join('、')}
- 在意的信号：${(me.care_about ?? []).join('；')}
- 他的 open_id：${me.identity.open_id}

分类（必选且只选一个）：
${cats}

叠加标（布尔，可与上面任一类共存）：
${ov}

原则：
- 只依据聊天内容和信息版图判断，不脑补。
- 多数群其实跟他无关，就大胆给 ignore，别讨好式高估相关性。
- **注意时间**：每条消息带时间戳，今天日期见 user 消息开头。以最近（今天/昨天）的消息判断"当前"状态。若某个会议、决策、紧急事项发生在几天前、且此后没有相关跟进消息，说明它已经过去——不要再判为火线或拍板，按当前余温降为接话/吃瓜。
- headline 要讲"最近发生了什么、当前卡在哪"，不要翻出窗口里最早、最戏剧化但已结束的旧话题冒充当前紧急。
- hot(火线) 只给"最近（今天/昨天）仍悬而未决、确实需要尽快反应"的；旧的@、已开完的会、已拍板的事都不是火线。
- 只输出 JSON，不要任何额外文字。`
}

function buildUser(chat, messages, me) {
  const lines = messages
    .map((m) => {
      const at = m.mentions.includes(me.identity.open_id) ? ' [@了你]' : ''
      return `[${m.time}] ${m.sender}${at}: ${m.text}`
    })
    .join('\n')
  const today = new Date().toISOString().slice(0, 10)
  return `今天是 ${today}（据此判断每条消息的新鲜度）。
群名：${chat.name}
最近 ${messages.length} 条消息（时间正序）：
${lines}

输出 JSON：
{
  "category": "ignore|watch|reply|lead",
  "hot": true 或 false,
  "topic": "群里此刻在聊的那个具体议题，6-14字，如「OTA1排期确认」「隐私协议平台接入」",
  "headline": "一句话旁白，≤30字",
  "reason": "为什么这么判，≤50字，引用群里的具体信号",
  "suggested_action": "建议动作，≤30字；ignore 可留空",
  "key_people": ["涉及的关键人名，可空"],
  "related": "命中你版图的哪块(项目/主题/人)，没有留空"
}`
}
