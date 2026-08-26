import { readFileSync, existsSync } from 'node:fs'
import { parse } from 'yaml'

const CONFIG_DIR = process.env.CHAT_RADAR_CONFIG ?? 'config'

export function loadConfig() {
  const me = loadYaml(`${CONFIG_DIR}/me.yaml`, true)
  const categories = loadYaml(`${CONFIG_DIR}/categories.yaml`, true)
  const chats = loadYaml(`${CONFIG_DIR}/chats.yaml`, false).chats ?? []
  validate(me, categories)
  return { me, categories: categories.categories, overlay: categories.overlay ?? [], chats }
}

function loadYaml(path, required) {
  if (!existsSync(path)) {
    if (required) throw new Error(`缺少配置文件：${path}（参考同目录的 *.example.yaml）`)
    return {}
  }
  return parse(readFileSync(path, 'utf8')) ?? {}
}

function validate(me, categories) {
  if (!me?.identity?.open_id || me.identity.open_id.startsWith('ou_你的'))
    throw new Error('me.yaml 未填 identity.open_id（当前还是示例占位）')
  if (!Array.isArray(categories?.categories) || categories.categories.length === 0)
    throw new Error('categories.yaml 未定义任何分类')
}
