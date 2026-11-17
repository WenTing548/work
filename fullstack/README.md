# 拾光集 · 校园二手交易平台（Node.js + MySQL 全栈演示版）

这是《软件工程》课程项目“拾光集”的**可运行全栈演示版**，不是只有页面原型：前端通过 REST API 连接本机 Node.js 后端，业务数据写入 MySQL。

## 1. 技术栈

| 层 | 实现 |
|---|---|
| 前端 | 原生 HTML/CSS/JavaScript，响应式布局，无框架依赖 |
| 后端 | Node.js 原生 `http` 模块 + `mysql2` 连接池 |
| 数据库 | MySQL 8.0，数据库 `shiguangji`，专用账号 `shiguang` |
| 鉴权 | 密码使用 bcrypt 哈希；登录签发 HttpOnly JWT Cookie。业务接口的 Cookie 鉴权仍在改造中，当前仍兼容请求体 `userId`，不能当生产安全版本 |
| 支付 | **模拟钱包 + 平台托管**，不接入微信/支付宝，不涉及真实资金 |

## 2. 目录

```text
shiguang-mysql/
├─ public/
│  ├─ index.html      前端页面
│  ├─ styles.css      样式
│  └─ app.js          前端逻辑 + REST API 调用
├─ schema.sql         建表 + 初始演示数据
├─ server.js          Node.js HTTP 服务 + REST API
├─ package.json
├─ start.bat          Windows 一键启动
└─ README.md
```

## 3. 启动

### 3.1 前置条件

1. 已安装 **Node.js 18+**（建议 20/22）。
2. 本机 **MySQL 8.0** 服务已启动，端口 `3306`。
3. 已创建数据库和账号：

```sql
CREATE DATABASE IF NOT EXISTS shiguangji
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'shiguang'@'localhost' IDENTIFIED BY 'shiguang123';
GRANT ALL PRIVILEGES ON shiguangji.* TO 'shiguang'@'localhost';
FLUSH PRIVILEGES;
```

> 本项目当前按本机环境配置为 `shiguang / shiguang123`。如你的 MySQL 密码不同，修改 `server.js` 顶部的 `DB_PASSWORD` 即可。

### 3.2 一键启动（Windows）

双击 `start.bat`。脚本会：

1. 首次运行时执行 `npm install` 安装 `mysql2`；
2. 启动 `server.js`；
3. 自动打开 `http://127.0.0.1:3000`。

关闭命令行窗口即停止服务。

### 3.3 手动启动

```bash
npm install
npm start
# 或
node server.js --open
```

浏览器访问 <http://127.0.0.1:3000>。

## 4. 演示账号

| 账号 | 密码 | 角色 | 说明 |
|---|---|---|---|
| `student1` | `123456` | 学生（买家/卖家） | 林同学，计算机学院，初始余额 ¥500 |
| `student2` | `123456` | 学生（买家/卖家） | 陈同学，机械学院，初始余额 ¥300 |
| `admin` | `admin123` | 运营 | 审核物品、查看全部订单、查看平台数据 |

登录页也提供快捷登录按钮。

## 5. 已实现功能

- 注册 / 登录 / 退出；学生与运营两种角色。
- 浏览、按分类筛选、关键词搜索、商品详情、物品履历。
- 发布闲置 → 待审核 → 运营通过后自动上架 / 驳回。
- 下单锁定物品；**30 秒未支付自动取消并解锁**。
- 模拟钱包支付：买家余额扣减、平台托管、支付流水。
- 卖家确认交付 → 买家确认收货 → 托管放款给卖家。
- 订单详情、我的订单、钱包流水、交易评价。
- 运营后台：待审核队列、全部物品、全部订单、平台概览。
- MySQL 持久化：刷新页面、重启服务后数据仍在。
- “我的 → 重置演示数据”恢复初始数据。

## 6. 核心数据表（6 张）

| 表 | 用途 |
|---|---|
| `users` | 用户、角色、认证状态、信用分、钱包余额 |
| `items` | 物品、分类、成色、状态、发布人 |
| `orders` | 订单、买卖双方、金额、交易状态、时间戳 |
| `payments` | 钱包/托管流水，正数入账、负数出账 |
| `reviews` | 订单评价（一单一评） |
| `audits` | 运营审核记录 |

> 课程报告的数据设计包含 21 张表；本可运行演示版先落地交易闭环所需的 6 张核心表，其余表（学籍、分类、自提点、悬赏、置换方案、仲裁等）在报告中为设计/原型范围。

## 7. REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/login` | 登录，成功时返回 `Set-Cookie: sg_token=...` |
| POST | `/api/logout` | 退出登录，清除 Cookie |
| GET | `/api/me` | 读取当前登录用户（需要 Cookie） |
| POST | `/api/register` | 注册（赠送 ¥300 演示余额） |
| GET | `/api/bootstrap?userId=` | 拉取当前用户 + 全部演示数据 |
| POST | `/api/sync` | 前端状态同步到 MySQL（演示版采用整体快照同步） |
| POST | `/api/reset` | 重置演示数据（请求体 `{"confirm":"RESET"}`） |
| GET | `/api/items` | 在售物品 |
| POST | `/api/items` | 发布物品 |
| POST | `/api/items/:id/approve` | 运营通过审核 |
| POST | `/api/orders` | 下单 |
| POST | `/api/orders/:id/pay` | 模拟支付 |
| POST | `/api/orders/:id/deliver` | 卖家交付 |
| POST | `/api/orders/:id/confirm` | 买家确认收货 |
| POST | `/api/orders/:id/cancel` | 取消未支付订单 |
| POST | `/api/reviews` | 提交评价 |
| POST | `/api/wallet/recharge` | 模拟充值 |
| POST | `/api/admin/audit` | 审核（通过/驳回） |

演示前端主要使用 `bootstrap` + `sync` 两个接口，保证 UI 与 MySQL 中的数据一致；其余接口保留为后续按模块拆分调用的基础。

## 8. 测试

已用无头 Edge + CDP 实测通过：

1. `student1` 登录；
2. 购买 `i1`（高等数学 第七版，¥18）；
3. 支付，余额从 ¥500 变为 ¥482；
4. 切换 `student2` 确认交付；
5. 切回 `student1` 确认收货；
6. MySQL 中订单状态为 `completed`，物品状态为 `completed`。

测试脚本 `test-flow.js` 仅用于开发验证，交付版可以删除。

## 9. 已知边界（请如实说明）

- 支付是**模拟钱包**，没有真实支付通道。
- 会话：密码已使用 bcrypt 哈希；登录已签发 HttpOnly JWT Cookie，并提供 `/api/me`、`/api/logout`。但业务接口尚未全部改为从 Cookie 认人，审核/支付/交付等仍读取请求体 `userId`/`operatorId`，**当前仍可被伪造身份，不能当生产安全版本**。
- 前端采用**整体快照同步**，适合课程演示；生产应改为按业务接口写入并加事务/幂等/并发控制。
- 未实现：真实图片上传、学籍认证对接、悬赏/三方置换、仲裁、消息通知、压测、线上部署。
- 6 张核心表可跑通交易闭环，但不是报告里 21 张表的全部落地。
- 需要本机 MySQL 服务运行；换机器需重新建库/改配置。

## 10. 部署

GitHub Pages 只能托管静态页面，不能运行本项目的 Node.js + MySQL。全栈版需要部署到 Render、Railway 等支持 Node 的平台，并连接外部 MySQL。

完整步骤见 [`DEPLOY.md`](DEPLOY.md)，包括：

- GitHub Pages 部署纯前端 `app/`；
- Render + Aiven MySQL 部署全栈版；
- Railway 同时部署 Node 和 MySQL；
- GitHub Codespaces 临时演示。

`server.js` 已支持云平台的 `PORT`、`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`DB_SSL` 环境变量，并监听 `0.0.0.0`。登录 Cookie 还需要：

- `JWT_SECRET`：生产环境必须设置为长随机字符串；
- `COOKIE_SECURE=true`：线上 HTTPS 环境建议开启，本地 HTTP 调试不要开启。

本地不设置 `JWT_SECRET` 时会使用开发默认值并打印警告，不能用于公网。

## 11. 与报告的关系

报告第 5—8 章描述的是“设计 + 关键模块实现方案 + 原型 + 测试方案”；本目录是**可运行实现**，用于答辩演示。报告中的 21 张表、F1—F14 流程是完整设计范围，本演示版只落地核心交易闭环，不把未实现部分写成已完成。
