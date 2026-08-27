export function createDeepSeek({
  apiKey = process.env.DEEPSEEK_API_KEY,
  baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
} = {}) {
  if (!apiKey) throw new Error('未设置 DEEPSEEK_API_KEY')

  async function chatJson(system, user, { temperature = 0.4 } = {}) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content ?? '{}'
    return JSON.parse(content)
  }

  return { name: 'deepseek', model, chatJson }
}
