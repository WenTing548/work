# P0-4 自动化测试说明

## 1. 测试目标

验证四类边界，而不是只验证“页面能打开”：

1. 未登录不能读数据；
2. 学生只能看自己的订单、流水、评价；
3. 其他用户只暴露公开字段，不返回 `username`、`balance`、`createdAt`；
4. 支付、交付、确认、评价按买卖双方归属执行，越权返回 403。

## 2. 为什么用独立测试库

测试会先删除表再启动服务，不能指向 `shiguangji` 生产库。

默认使用：

```text
数据库：shiguangji_test
端口：3111
```

测试启动的 Node 服务只连测试库，不会碰 `shiguangji`。

## 3. 一次性准备

用 MySQL 管理员账号执行：

```sql
CREATE DATABASE IF NOT EXISTS shiguangji_test
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON shiguangji_test.* TO 'shiguang'@'localhost';
FLUSH PRIVILEGES;
```

如果本机账号不是 `shiguang / shiguang123`，用环境变量覆盖，见第 5 节。

## 4. 运行

```bash
cd D:\github_work\work\fullstack
npm test
```

或者在仓库根目录：

```bash
npm test
```

测试会自动：

1. 删除 `shiguangji_test` 里的 9 张表；
2. 用 `server.js` 重新建表并 seed；
3. 启动 3111 测试服务；
4. 跑 19 个断言；
5. 结束后停服务并清理测试表。

预期结果：

```text
tests 19
pass 19
fail 0
```

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TEST_PORT` | `3111` | 测试服务端口 |
| `TEST_DB_NAME` | `shiguangji_test` | 测试库名，禁止指向生产库 |
| `TEST_DB_HOST` | `127.0.0.1` | MySQL 地址 |
| `TEST_DB_PORT` | `3306` | MySQL 端口 |
| `TEST_DB_USER` | `shiguang` | 测试库账号 |
| `TEST_DB_PASSWORD` | `shiguang123` | 测试库密码 |

示例：

```powershell
$env:TEST_DB_PASSWORD='your-password'
npm test
```

## 6. 测试用例

| 编号 | 用例 | 预期 |
|---|---|---|
| 1 | 未登录 `GET /api/bootstrap` | 401 |
| 2 | student1 登录后看 `db.users` | 本人有 `username`/`balance`；u2 只有公开字段 |
| 3 | student1 创建 i1 订单 | buyerId=u1，sellerId=u2，status=unpaid |
| 4 | student2 看 bootstrap | 能看到自己作为卖家的订单；看不到 i5 待审核物品 |
| 5 | student3 看 bootstrap | 订单为 0；看不到 i5 |
| 6 | student3 支付 student1 的订单 | 403 |
| 7 | student1 支付 → student2 交付 → student1 确认 | 依次 `to_deliver`、`to_confirm`、`completed` |
| 8 | student1 评价 | 200，评价只属于自己的订单 |
| 9 | student1 审核 i5 | 403；admin 审核 200，i5 变 `on_sale` |
| 10 | admin 看全量 + `POST /api/sync` | 全量可见；sync 返回 404 |
| 11 | student1 `POST /api/reset`；退出后 `/api/me` | reset 403；退出后 401 |
| 12 | student1 单方发起置换意向 | 200，intent 为 active，不生成 plan |
| 13 | student2 反向发起意向 | 生成 pending plan，双方物品 locked |
| 14 | 双方确认置换方案 | plan 变 active，生成两张 0 元 `swap` 订单 |
| 15 | 完成置换 | 双方物品 owner 互换，订单/方案 completed |
| 16 | 普通订单接口操作置换单 | 409，必须走置换页面 |
| 17 | 放弃置换方案 | 物品回到 on_sale，方案 cancelled |
| 18 | 非参与者确认不存在的方案 | 404 |
| 19 | 单方意向存在时买下并支付该物品 | 购买成功；未匹配意向变 cancelled；已匹配方案购买返回 409 |

## 7. 注意

- 测试会清空 `shiguangji_test`，不要把 `TEST_DB_NAME` 设成 `shiguangji`。
- 测试端口 3111 被占用时，先停掉占用进程，或设置 `TEST_PORT`。
- `server.js` 启动时会执行 `schema.sql`；测试库为空时会自动 seed，因此不需要手工导数。
- 测试依赖 Node.js 18+ 内置的 `fetch` 和 `node:test`。
- 这是接口自动化测试，不是浏览器 E2E；页面交互仍按 README 的手工走查执行。

## 8. 当前状态

P0-4 已覆盖鉴权、数据范围、越权支付、学生越权审核、sync 关闭、退出失效。
P5 已覆盖两人置换的单方意向、反向匹配、双方确认、生成置换单、完成互换、
拒绝解锁和普通订单接口隔离。物品履历在普通交易和审核用例中断言，覆盖
`locked`、`paid`、`completed`、`approved` 事件。P6 覆盖“单方意向期间物品被
买下并支付后意向自动取消”，以及“方案匹配后购买锁定物品返回 409”。

尚未覆盖：

- 登录限流 / 暴力破解；
- CSRF token；
- 并发支付、重复回调、并发置换死锁的压力场景；
- 真实文件上传；
- 浏览器端 E2E 自动化。

这些属于后续 P1/P2，不在 P0-4 范围内。
