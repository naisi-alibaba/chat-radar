@echo off
chcp 65001 >nul
echo ============================================
echo   chat-radar setup （全程无 AI，纯命令）
echo ============================================
echo.
echo [1/3] 安装飞书官方 CLI (@larksuite/cli) ...
call npm i -g @larksuite/cli
echo.
echo [2/3] 安装项目依赖 ...
call npm install
echo.
echo [3/3] 生成 .env（如不存在）...
if not exist .env (
  copy .env.example .env >nul
  echo   已生成 .env
) else (
  echo   .env 已存在，跳过
)
echo.
echo 自动部分完成。还差手动两步：
echo   1) lark-cli auth login --domain im,base   （浏览器授权飞书账号）
echo   2) 编辑 .env 填入 DEEPSEEK_API_KEY
echo.
echo 然后体检： node bin\chat-radar.js doctor
echo.
pause
