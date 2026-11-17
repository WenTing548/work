# 软件工程大作业

## 拾光集——校园二手交易平台

本仓库保存《软件工程》实验报告第 5—8 章、配套图表，以及可运行的网页演示。演示分为两版：

- **全栈版（推荐）**：[`fullstack/`](fullstack/) —— Node.js + MySQL，真实后端与数据库。
- **纯前端旧版**：[`app/`](app/) —— 数据保存在浏览器 localStorage，仅用于快速预览。

### 在线演示

<https://work-production-e1c5e2db.up.railway.app>

> Railway 试用实例，长时间无人访问可能休眠；试用到期后需重新部署。演示账号见下表。

### 全栈版（Node.js + MySQL）

进入 [`fullstack/`](fullstack/) 目录：

1. 确认本机 MySQL 8.0 已启动；
2. 双击 `start.bat`，或执行 `npm install && npm start`；
3. 浏览器访问 <http://127.0.0.1:3000>。

数据库默认配置：`shiguangji`，账号 `shiguang / shiguang123`。建表和初始数据由 `schema.sql` 自动完成，也可手动导入。

演示账号：

| 账号 | 密码 | 角色 |
|---|---|---|
| `student1` | `123456` | 学生 |
| `student2` | `123456` | 学生 |
| `admin` | `admin123` | 运营 |

已实现：注册登录、浏览搜索、发布审核、下单锁物、30 秒未支付取消、模拟钱包支付/托管、卖家交付、买家确认收货、评价、钱包流水、运营后台、两人置换、MySQL 持久化、重置演示数据。

> 全栈版落地 8 张核心表：`users`、`items`、`orders`、`payments`、`reviews`、`audits`、`swap_intents`、`swap_plans`；两人置换为 F11/表 16–17 的简化实现，不含三人环。报告中的 21 张表是完整设计范围，其余表仍属于设计/原型内容。支付为模拟钱包，不接入真实资金。

详细说明见 [`fullstack/README.md`](fullstack/README.md)。

部署到公网请先看 [`fullstack/DEPLOY.md`](fullstack/DEPLOY.md)：GitHub Pages 只能部署纯前端，不能运行 Node.js + MySQL；全栈版推荐 Render + 外部 MySQL，或 Railway。

Railway 从零部署和复现步骤见 [`fullstack/RAILWAY_DEPLOY.md`](fullstack/RAILWAY_DEPLOY.md)，包含常见报错和验收清单。

### 纯前端旧版

- 进入 [`app/`](app/) 目录，双击 `index.html` 或 `start.bat` 即可打开。
- 演示账号同上。
- 数据保存在浏览器本地，支付为模拟钱包。

该版本没有后端和 MySQL，仅用于快速查看界面与交互；需要真实数据库时请使用 `fullstack/`。

### 报告

- [实验报告 Word（第 5—8 章）](docs/拾光集-实验报告-第5-8章.docx)
- [报告 Markdown 源文](docs/第5-8章.md)
- [图表目录](docs/images/)

> 报告第 5 章中的界面图为界面原型，不是运行截图；报告描述的是业务流程、数据设计、实现方案、关键状态机、界面原型和测试方案。全栈演示版是报告设计之后补充的可运行实现。

### 本册内容

- 第 5 章 系统实现：开发环境、总体架构、数据库连接、关键模块实现、界面原型、测试方案。
- 第 6 章 维护：维护过程、监控告警、备份恢复、一致性维护、安全与发布回滚。
- 第 7 章 总结与体会：成果、不足与下一步计划。
- 第 8 章 附录：21 张表清单、核心接口、状态枚举、建表脚本节选、术语表。
