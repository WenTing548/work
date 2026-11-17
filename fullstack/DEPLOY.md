# 部署说明

先明确一件事：

- **GitHub Pages 只能托管静态文件**，不能运行 Node.js，也不能提供 MySQL。
- 因此 `fullstack/` 这个 Node.js + MySQL 全栈版**不能只靠 GitHub Pages 上线**。
- GitHub 负责存代码；真正运行全栈版需要一台能跑 Node.js 的服务器，以及一个 MySQL 数据库。

下面给三种可行方案。

---

## 方案一：GitHub Pages 部署纯前端版（最简单，但没有数据库）

适合只想给别人看界面和交互，不要求真实登录、下单、审核数据持久化。

仓库里的 `app/` 是纯前端 localStorage 版，可以直接部署到 GitHub Pages。

### 步骤

1. 打开仓库：<https://github.com/WenTing548/work>
2. 进入 **Settings → Pages**
3. **Build and deployment → Source** 选择 **GitHub Actions**
4. 在仓库新建 `.github/workflows/pages.yml`：

```yaml
name: Deploy static app

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app
      - id: deployment
        uses: actions/deploy-pages@v4
```

5. 提交后进入 **Actions**，等待 `Deploy static app` 完成。
6. 页面地址通常是：

```text
https://wenting548.github.io/work/
```

### 这个方案的边界

- 登录、下单、审核等数据只在浏览器 localStorage 中；
- 换浏览器/清缓存就恢复初始数据；
- 没有真实后端和 MySQL；
- 页面上的“演示版”提示是准确的。

---

## 方案二：Render + 外部 MySQL（推荐的全栈部署）

目标：GitHub 存代码，Render 运行 Node.js，Aiven/TiDB/Railway 提供 MySQL。

### 1. 准备 MySQL

以 Aiven MySQL 免费版为例：

1. 注册 <https://aiven.io/>，创建 MySQL 服务；
2. 记下 `host`、`port`、`user`、`password`、`database`（通常是 `defaultdb`）；
3. 在 Navicat 或 MySQL 客户端中连接，执行仓库里的 `fullstack/schema.sql`。

命令行方式：

```bash
mysql --ssl-mode=REQUIRED \
  -h <HOST> -P <PORT> -u <USER> -p <DATABASE> \
  < fullstack/schema.sql
```

### 2. 在 Render 创建 Web Service

1. 注册 <https://render.com/>；
2. **New → Web Service**；
3. 连接 GitHub 仓库 `WenTing548/work`；
4. 配置：

| 配置项 | 值 |
|---|---|
| Name | `shiguangji` |
| Root Directory | `fullstack` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Health Check Path | `/api/health` |

5. 在 **Environment** 中添加：

```text
DB_HOST=<MySQL host>
DB_PORT=<MySQL port>
DB_USER=<MySQL user>
DB_PASSWORD=<MySQL password>
DB_NAME=<MySQL database>
DB_SSL=true
```

> Render 会自动提供 `PORT`，不要手动覆盖。
> Aiven/TiDB 需要 SSL，所以 `DB_SSL=true`；本机 MySQL 不需要。

6. 点击 **Create Web Service**，等待部署完成；
7. 打开 Render 给出的 `https://xxxx.onrender.com`。

### 3. 验证

访问：

```text
https://<你的服务>.onrender.com/api/health
```

返回：

```json
{"ok":true,"service":"shiguangji-mysql"}
```

然后打开首页，用 `student1 / 123456`、`admin / admin123` 登录。

### 注意事项

- Render 免费实例一段时间不访问会休眠，首次打开慢；
- 数据库必须用外部 MySQL，Render 免费版不提供 MySQL；
- 不要把数据库密码提交到 GitHub，只写在 Render 的 Environment 里；
- 免费实例适合课程演示，不适合正式生产。

---

## 方案三：Railway（GitHub 一键连接，MySQL 也在 Railway）

1. 注册 <https://railway.app/>；
2. **New Project → Deploy from GitHub repo**，选择 `WenTing548/work`；
3. 在服务设置中把 **Root Directory** 设为 `fullstack`；
4. 在项目中 **New → Database → MySQL**；
5. 打开 MySQL 服务的 **Variables**，把对应值填到 Node 服务的变量：

```text
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_SSL=false
```

6. 在 MySQL 的 Query 面板执行 `fullstack/schema.sql`；
7. Node 服务启动命令填 `node server.js`，重新部署。

Railway 的免费额度和政策会变化，使用前先看当前套餐。

---

## 方案四：GitHub Codespaces（临时在线演示）

如果只是答辩时临时展示，不想买服务器：

1. 仓库页面 **Code → Codespaces → Create codespace on main**；
2. 在终端安装并启动 MySQL：

```bash
sudo apt update
sudo apt install -y mysql-server
sudo service mysql start
```

3. 建库、建用户、导入表：

```bash
sudo mysql -e "CREATE DATABASE shiguangji CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'shiguang'@'localhost' IDENTIFIED BY 'shiguang123';"
sudo mysql -e "GRANT ALL PRIVILEGES ON shiguangji.* TO 'shiguang'@'localhost';"
sudo mysql shiguangji < fullstack/schema.sql
```

4. 启动项目：

```bash
cd fullstack
npm install
node server.js
```

5. 在 **Ports** 面板把 `3000` 端口设为 **Public**，用转发地址访问。

Codespace 停止后服务就没了，不适合长期公网访问。

---

## 推荐选择

| 目标 | 方案 |
|---|---|
| 只展示 UI，不要求数据库 | GitHub Pages + `app/` |
| 要真实登录/下单/MySQL 持久化 | Render + Aiven MySQL |
| 想在一个平台同时管 Node 和 MySQL | Railway |
| 答辩临时演示 | GitHub Codespaces |

## 当前仓库已经准备好的部分

- `fullstack/server.js` 已监听 `0.0.0.0`，支持云平台注入 `PORT`；
- 支持 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`DB_SSL` 环境变量；
- `fullstack/package.json` 的 `start` 为 `node server.js`；
- `fullstack/schema.sql` 可导入空数据库；
- `fullstack/public/` 由同一个 Node 服务托管，不需要单独部署前端。

## 不能做的事

- 不要把 `fullstack/` 直接当静态站点扔到 GitHub Pages：页面能打开，但 `/api/*` 全部 404。
- 不要把 MySQL 密码写进代码或 README 后提交。
- 不要用 `localhost` 作为云平台的 `DB_HOST`：云上的 `localhost` 指应用容器自己，不是你的电脑。
