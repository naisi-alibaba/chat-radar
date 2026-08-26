import { createDeepSeek } from './deepseek.js'

export function createProvider(name = process.env.CHAT_RADAR_LLM ?? 'deepseek') {
  switch (name) {
    case 'deepseek':
      return createDeepSeek()
    default:
      throw new Error(`未知 LLM 供应商：${name}（当前仅实现 deepseek）`)
  }
}
