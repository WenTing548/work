# 两人置换实现说明（代码与设计文档差异）

本文件记录可运行版在“两人置换”功能上的落地口径。设计文档
`业务流程说明(5).md`、`数据存储清单与业务对照(4).md` 保持冻结，代码与
文档不一致处以此文件为准。

## 1. 范围

- 只实现**两人互换**，不实现三人环。
- 复用现有 `users`、`items`、`orders`、`payments`、`reviews`、`audits`。
- 新增两张表：
  - `swap_intents`：一条“我用自己的物品 A，换对方的物品 B”的意向。
  - `swap_plans`：两条互相匹配的意向 + 确认截止时间 + 双方确认时间。
- `orders` 增加：
  - `order_type`：`normal` / `swap`；
  - `plan_id`：置换方案号，普通订单为 `NULL`。

落地后核心表从 6 张变为 8 张；仍然不是 21 张表的全量实现。

## 2. 业务流程

1. 学生 A 选择自己的一件 `on_sale` 物品，再选择学生 B 的一件 `on_sale`
   物品，发起意向。
2. 学生 B 如果也选择 A 的这件物品发起反向意向，两条意向匹配：
   - 两条意向改为 `matched`；
   - 两件物品改为 `locked`；
   - 生成一条 `pending` 的置换方案，确认截止时间为 10 分钟后。
3. 双方在截止前各自确认：
   - 只确认一方时，方案仍为 `pending`；
   - 双方都确认后，方案改为 `active`，并生成两张 `order_type='swap'`、
     `amount=0`、`status='to_deliver'` 的置换单。
4. 线下交付后，任一方点击“完成置换”：
   - 两件物品的 `owner_id` 互换；
   - 两件物品改为 `completed`；
   - 两张置换单改为 `completed`；
   - 方案和两条意向改为 `completed`。
5. 任一方放弃，或超过 10 分钟未双方确认：
   - 方案改为 `cancelled`；
   - 两件物品从 `locked` 回到 `on_sale`；
   - 两条意向改为 `cancelled`。

所有匹配、确认、完成、取消操作都在数据库事务内完成；物品按 ID 排序后
`SELECT ... FOR UPDATE`，避免双方同时发起时死锁。

## 3. 与设计文档的差异

| 设计文档 | 当前实现 | 原因 |
|---|---|---|
| F11 支持两人/三人环 | 只支持两人互换 | 三人环的匹配、确认、结算复杂度高，课程周期内先保证两人闭环 |
| `置换方案表` 含意向 A/B/C | 只有 `intent_a_id`、`intent_b_id` | 两人版不需要 C |
| 置换单直接写“完成” | 先 `to_deliver`，双方再点“完成置换” | 保留线下交付确认，避免误点直接过户 |
| F11 写 `交付记录表` | 未写独立交付记录表 | 当前 8 表版没有该表；置换单的 `delivered_at/completed_at` 记录时间，后续补表再迁移 |
| F10 再次上架写 `物品图片表` | 未实现图片历史 | 当前版本没有 `item_images`；图片上传本身也未实现 |
| 审核由 F3 写物品状态 | F3 只创建 `pending`，F12 审核时写 `on_sale/rejected` + 审核记录 | 避免“发布即审核”的职责混乱；与 F12 的审核动作一致 |
| 通知表 | 未实现通知 | 当前用页面状态和列表刷新表达结果，后续补通知表 |
| 信用记录表 | 未实现置换信用流水 | 当前置换不加信用分，避免没有信用流水表时出现不可追溯的加分 |

## 4. REST API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/swaps/intents` | 学生 | 创建意向；body `{myItemId,targetItemId}` |
| POST | `/api/swaps/intents/:id/cancel` | 意向本人 | 取消尚未匹配的意向 |
| POST | `/api/swaps/plans/:id/confirm` | 方案双方 | 确认方案；双方都确认后生成两张置换单 |
| POST | `/api/swaps/plans/:id/reject` | 方案双方 | 放弃方案并解锁物品 |
| POST | `/api/swaps/plans/:id/complete` | 方案双方 | 完成互换、交换归属、完成置换单 |

`/api/bootstrap` 的 `db.swaps` 返回：

```json
{
  "intents": [],
  "plans": []
}
```

学生只看到自己发起的意向、自己参与的方案，以及方案涉及的物品；运营可以
看到全部置换数据。

## 5. 数据库迁移

`schema.sql` 已包含新表和 `orders` 新列。已有数据库启动时，`init()` 会：

```sql
ALTER TABLE orders ADD COLUMN order_type VARCHAR(16) NOT NULL DEFAULT 'normal';
ALTER TABLE orders ADD COLUMN plan_id VARCHAR(32) NULL;
```

如果列已存在则跳过。新表使用 `CREATE TABLE IF NOT EXISTS`，不会清空已有数据。

## 6. 测试

`fullstack/test/security.test.js` 现在包含 18 项：

- 原 P0-4 鉴权/数据范围/交易闭环 11 项；
- 新增 P5 两人置换 7 项：单方意向、反向匹配、双方确认、生成两张 0 元置换单、
  完成互换、拒绝/取消解锁、非参与者校验。

运行：

```bash
cd fullstack
npm test
```

## 7. 已知边界

- 置换单金额为 0，不走钱包、不写支付流水；这是有意设计，不是漏写。
- 完成置换没有单独的“交付确认”二次弹窗；双方确认方案后，任一方可直接完成。
- 10 分钟超时依赖访问 `bootstrap` 时触发清理；没有独立定时任务。生产环境应补
  定时任务或消息队列。
- 没有图片上传、通知、信用流水、独立交付记录、三人环；这些仍属于设计范围。
- 服务启动时会执行 `schema.sql` 并对已有 `orders` 表补列，因此本地和线上都会发生迁移。生产环境仍建议先备份数据库、在维护窗口部署，并确认数据库账号有 `CREATE/ALTER` 权限；不要在未备份时直接让线上自动迁移。
