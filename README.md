# chat-radar

飞书群聊信息面板：用 AI 替你判断每个群里的信息与你的关系，并把你可能漏掉的**补齐**。

面向群多、信息杂的飞书重度用户（白领 / 高校）。**自托管 · BYOK（自带凭证）· 数据只在你本机流动。**

> 状态：v0.1 开发中（先验证「裁定准不准」）。完整版本路线见 `knowledge/decisions/`。

## 它解决什么

- 看群**之前**你不知道：这群里有没有跟我相关的？要我参与的？要我拍板的？还是杂音与我无关？
- 就算**看了**群，跨群、跨周期、信息密度高，还得人肉整理才能得出上面的结论。

chat-radar 把每个群的动态裁定成「一句话结论 + 该你什么姿态」，汇到一个面板：

🔇 免看 ／ 👀 吃瓜 ／ 💬 接话 ／ 🎯 拍板 ／ 🔥 火线（紧急叠加）

## 从零安装（全程无需 AI —— 都是终端里敲的普通命令）

```bash
# 1. 装飞书官方 CLI（@larksuite/cli，公开 npm 包，联网下载）
npm i -g @larksuite/cli

# 2. 授权你的飞书账号（Device Flow，浏览器点一下即可，无需自建飞书应用）
lark-cli auth login --domain im,base

# 3. 装本项目依赖
npm install

# 4. 配 DeepSeek key
cp .env.example .env        # 然后编辑 .env，填 DEEPSEEK_API_KEY

# 5. 体检 + 首次运行
node bin/chat-radar.js doctor
node bin/chat-radar.js refresh     # 裁定近15天活跃群 + 推到飞书 Base 看板
```

Windows 可直接双击 `setup.cmd` 完成第 1/3/4 步（装 CLI、装依赖、生成 .env），再手动做第 2 步授权、填 key。

> 以上每一条都是标准命令，**人手敲、或计划任务自动跑均可，过程中不需要任何 AI**。唯一用到「AI」的地方是运行时程序内部去调 DeepSeek 做裁定（一次 HTTP 请求），那是引擎、不是"启动一个 AI 会话"。

## 架构原则（硬约束）

- **无中心服务器**：永远没有作者的后端，每人跑自己的实例。
- **能力边界 = 你的可见边界**：只读你本人能看到的群，一个字节都不多。
- **可插拔**：LLM（默认 DeepSeek）与飞书接入都是可替换的一层。

详见 `knowledge/decisions/2026-08-26-架构基石与产品定位.md`。

## License

MIT
