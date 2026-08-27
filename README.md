# chat-radar

[![飞书 Feishu/Lark](https://img.shields.io/badge/飞书-Feishu%20%2F%20Lark-00D6B9?logo=feishu&logoColor=white)](https://open.feishu.cn/) [![DeepSeek](https://img.shields.io/badge/LLM-DeepSeek-4D6BFE?logo=deepseek&logoColor=white)](https://www.deepseek.com/) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/) ![Self-hosted BYOK](https://img.shields.io/badge/Self--hosted-BYOK-4c9aff)

飞书群聊信息面板：用 AI 替你判断每个群里的信息与你的关系，并把你可能漏掉的**补齐**。

面向群多、信息杂的飞书重度用户（白领 / 高校）。**自托管 · BYOK（自带凭证）· 数据只在你本机流动。**

## 它解决什么

- 看群**之前**你不知道：这群里有没有跟我相关的？要我参与的？要我拍板的？还是杂音与我无关？
- 就算**看了**群，跨群、跨周期、信息密度高，还得人肉整理才能得出上面的结论。

chat-radar 把每个群的动态裁定成「一句话结论 + 该你什么姿态」，汇到一个常驻控制台：

🔇 免看 ／ 👀 吃瓜 ／ 💬 接话 ／ 🎯 拍板 ／ 🔥 火线（紧急叠加）

每条还给：群此刻在聊的**具体议题**、一句**旁白**、**建议动作**、以及命中你信息版图的哪一块。

## 从零安装（全程无需 AI —— 都是终端里敲的普通命令）

```bash
# 1. 装飞书官方 CLI（@larksuite/cli，公开 npm 包）
npm i -g @larksuite/cli

# 2. 授权你的飞书账号（Device Flow，浏览器点一下，无需自建飞书应用）
lark-cli auth login --domain im,base

# 3. 装本项目依赖
npm install

# 4. 配 DeepSeek key
cp .env.example .env        # 编辑 .env，填 DEEPSEEK_API_KEY

# 5. 体检
node bin/chat-radar.js doctor
```

**Windows 更省事**：双击 `install.cmd`，会开一个浏览器安装向导，图形化走完环境检测 / 装 CLI / 授权 / 装依赖 / 填 key。

## 日常使用

双击 `console.cmd`（或 `node installer/server.js`）打开**常驻控制台**——一个本地网页：

- 三列瀑布流卡片墙，按**今天 / 昨天 / 本周内**筛选；火线醒目。
- 点「立即看一遍」手动刷新；或打开「自动盯梢」按间隔轮询（可随时关掉省 token）。
- 首次进来在「⚙ 配置」里填你的**信息版图**（`me.yaml`：你负责什么、关注什么、关键人、关键词），裁定才贴合你。

也可以纯命令行：

```bash
node bin/chat-radar.js sync          # 拉群消息 + AI 裁定，写本地库
node bin/chat-radar.js list          # 终端打印裁定面板
node bin/chat-radar.js push          # 可选：镜像到飞书 Base 多维表格
node bin/chat-radar.js refresh       # = sync + push，定时任务用
node bin/chat-radar.js sync --full   # 强制全部重裁（改了裁定规则后用）
```

### 省 token：增量裁定

`sync` 会先并发探测每个群的最新消息，**只对有新消息的群重新调用 AI**，没变的复用上次结论、火线随时间自动冷却。所以「自动盯梢」常开也不烧钱——稳态每轮只裁真正有动静的那几个群。

并发度、轮询间隔、活跃天数等都在 `config/settings.yaml`（照 `config/settings.example.yaml` 填）。

## 架构原则（硬约束）

- **无中心服务器**：永远没有作者的后端，每人跑自己的实例。
- **能力边界 = 你的可见边界**：只读你本人能看到的群，一个字节都不多（用你的用户身份，不是把机器人拉进群）。
- **可插拔**：LLM（默认 DeepSeek 的 `deepseek-chat`，非思考模型）与飞书接入都是可替换的一层。
- **运行时不需要任何 AI 会话**：唯一用到 AI 的地方是程序内部调 DeepSeek 做裁定（一次 HTTP 请求），那是引擎，不是"开一个 AI 对话"。

## License

MIT
