# 拾光集 · 校园二手交易平台（Node.js + MySQL 全栈演示版）

这是《软件工程》课程项目“拾光集”的**可运行全栈演示版**，不是只有页面原型：前端通过 REST API 连接本机 Node.js 后端，业务数据写入 MySQL。

## 1. 技术栈

| 层 | 实现 |
|---|---|
| 前端 | 原生 HTML/CSS/JavaScript，响应式布局，无框架依赖 |
| 后端 | Node.js 原生 `http` 模块 + `mysql2` 连接池 |
| 数据库 | MySQL 8.0，数据库 `shiguangji`，专用账号 `shiguang` |
| 鉴权 | 密码使用 bcrypt 哈希；登录签发 HttpOnly JWT Cookie；业务接口从 Cookie 识别当前用户，审核/同步/重置额外校验运营角色 |
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
- 两人置换：双方互相选中对方在售物品 → 生成置换方案 → 10 分钟内双方确认 → 生成两张 0 元置换单 → 线下交付后完成互换；任一方放弃或超时则物品解锁。
- 运营后台：待审核队列、全部物品、全部订单、平台概览。
- MySQL 持久化：刷新页面、重启服务后数据仍在。
- “我的 → 重置演示数据”恢复初始数据。

## 6. 核心数据表（9 张）

| 表 | 用途 |
|---|---|
| `users` | 用户、角色、认证状态、信用分、钱包余额 |
| `items` | 物品、分类、成色、状态、发布人 |
| `orders` | 订单、买卖双方、金额、交易状态、时间戳；置换单带 `order_type='swap'` 和 `plan_id` |
| `payments` | 钱包/托管流水，正数入账、负数出账 |
| `reviews` | 订单评价（一单一评） |
| `audits` | 运营审核记录 |
| `item_history` | 物品履历：发布、审核、锁定、支付、交付、成交、置换，只追加不覆盖 |
| `swap_intents` | 两人置换意向：谁用自己的哪件物品换对方的哪件物品 |
| `swap_plans` | 双方互相意向后生成的置换方案、确认截止时间和双方确认时间 |

> 课程报告的数据设计包含 21 张表；本可运行演示版落地交易闭环、两人置换和物品履历所需的 9 张表，其余表（学籍、分类、自提点、悬赏、仲裁、通知、图片等）在报告中为设计/原型范围。两人置换是 21 表中的 F11/表 16–17 的简化落地，不含三人环。


## 7. REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/login` | 登录，成功时返回 `Set-Cookie: sg_token=...` |
| POST | `/api/logout` | 退出登录，清除 Cookie |
| GET | `/api/me` | 读取当前登录用户（需要 Cookie） |
| POST | `/api/register` | 注册并直接登录（赠送 ¥300 演示余额） |
| GET | `/api/bootstrap` | 按当前登录用户范围返回数据（物品、自己的订单/流水/评价、物品履历；运营返回全量审核数据） |
| POST | `/api/sync` | 整体快照同步；默认关闭，仅 `ALLOW_SYNC=true` 时运营可用 |
| POST | `/api/reset` | 重置演示数据（仅运营 + `confirm:"RESET"`；生产环境需 `ALLOW_RESET=true`） |
| GET | `/api/items` | 在售物品 |
| POST | `/api/items` | 发布物品（需要学生登录） |
| POST | `/api/items/:id/approve` | 运营通过审核 |
| POST | `/api/items/:id/reject` | 运营驳回审核 |
| POST | `/api/orders` | 下单（需要学生登录） |
| POST | `/api/orders/:id/pay` | 模拟支付（仅买家本人） |
| POST | `/api/orders/:id/deliver` | 卖家交付（仅卖家本人） |
| POST | `/api/orders/:id/confirm` | 买家确认收货（仅买家本人） |
| POST | `/api/orders/:id/cancel` | 取消未支付订单（仅买家本人） |
| POST | `/api/reviews` | 提交评价（仅订单双方） |
| POST | `/api/wallet/recharge` | 模拟充值（仅学生） |
| POST | `/api/swaps/intents` | 发起两人置换意向（自己的物品 + 对方在售物品） |
| POST | `/api/swaps/intents/:id/cancel` | 取消尚未匹配的置换意向 |
| POST | `/api/swaps/plans/:id/confirm` | 确认置换方案（双方各自确认） |
| POST | `/api/swaps/plans/:id/reject` | 放弃置换方案并解锁双方物品 |
| POST | `/api/swaps/plans/:id/complete` | 完成置换：交换物品归属、完成两张 0 元置换单 |


前端已改为调用 REST 接口，登录后由浏览器自动携带 `sg_token` Cookie；`/api/bootstrap` 只返回当前用户可见的数据，`/api/sync` 默认关闭，不再作为正常业务写入通道。

## 8. 测试

### 8.1 自动化安全测试

测试使用独立的 `shiguangji_test` 数据库和 3111 端口，不会读写 `shiguangji` 生产库。

一次性建库授权（用 MySQL 管理员执行）：

```sql
CREATE DATABASE IF NOT EXISTS shiguangji_test
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON shiguangji_test.* TO 'shiguang'@'localhost';
FLUSH PRIVILEGES;
```

运行：

```bash
cd fullstack
npm test
```

覆盖用例：

1. 未登录访问 `/api/bootstrap` 返回 401；
2. student1 能看自己的 `username`/`balance`，其他用户只有公开摘要；
3. student1 创建的订单归属正确；
4. student2 只看到自己作为卖家的订单，看不到别人的待审核物品；
5. student3 看不到别人的订单，代付返回 403；
6. 支付、交付、确认、评价的完整闭环；
7. 普通学生审核返回 403，管理员审核成功；
8. 管理员能看全量，`/api/sync` 默认 404；
9. 普通学生 `/api/reset` 返回 403；
10. 退出后 Cookie 失效；
11. 两人置换：单方意向、反向匹配、双方确认、生成两张 0 元置换单、完成互换；
12. 置换拒绝/取消后物品回到 `on_sale`；
13. 非参与者不能确认或完成置换方案。

详细说明见 [`TESTING.md`](TESTING.md)。

### 8.2 手工走查

已用无头 Edge + CDP 实测通过：

1. `student1` 登录；
2. 购买 `i1`（高等数学 第七版，¥18）；
3. 支付，余额从 ¥500 变为 ¥482；
4. 切换 `student2` 确认交付；
5. 切回 `student1` 确认收货；
6. MySQL 中订单状态为 `completed`，物品状态为 `completed`。

## 9. 已知边界（请如实说明）

- 支付是**模拟钱包**，没有真实支付通道。
- 会话：密码使用 bcrypt 哈希；登录签发 HttpOnly JWT Cookie；`/api/bootstrap`、发布、下单、支付、取消、交付、确认、评价、充值均从 Cookie 识别当前用户，审核/重置校验运营角色。`/api/bootstrap` 已按用户收窄：学生只拿公开在售物品、自己的物品、自己参与的订单/流水/评价；其他用户只返回公开资料，不含余额。`/api/sync` 默认关闭（需 `ALLOW_SYNC=true`），`/api/reset` 生产环境需 `ALLOW_RESET=true`。仍需补：登录限流、CSRF token、密码找回、操作审计告警。
- 前端已改为按 REST 接口写入；生产仍应补事务/幂等/并发控制，不能依赖前端状态。
- 未实现：真实图片上传、学籍认证对接、悬赏、三人环置换、仲裁、消息通知、压测、线上部署。
- 物品履历已落地：详情页按时间展示发布、审核、锁定、支付、交付、成交和置换事件；`item_history` 只追加，不覆盖历史。
- 两人置换只做“两人互换”，不含三人环；置换单为 0 元、跳过支付，按面交完成；未写独立交付记录表（与 F11 原设计有差异，见 [`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md)）。
- 9 张核心表可跑通交易闭环、两人置换和物品履历，但不是报告里 21 张表的全部落地。
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
