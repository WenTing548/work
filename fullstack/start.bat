@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo 首次运行：正在安装 Node.js 依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请确认已安装 Node.js 且网络可用。
    pause
    exit /b 1
  )
)

echo 正在启动拾光集全栈演示版...
echo 后端：Node.js + MySQL
echo 地址：http://127.0.0.1:3000
echo 关闭此窗口即可停止服务。
echo.
node server.js --open
pause
