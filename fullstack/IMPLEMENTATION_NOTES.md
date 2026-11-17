# 实现说明：21 表可运行版与设计文档差异

本文件记录可运行版在 21 张表、两人置换、履历、图片、认证、交付、信用、通知、求购和仲裁上的落地口径。设计文档 `业务流程说明(5).md`、`数据存储清单与业务对照(4).md` 保持冻结；代码与文档不一致处以此文件为准。

## 1. 范围

- 只实现**两人互换**，不实现三人环。
- 21 张业务表全部建表，并有对应的 API/UI 入口；不是“只建空表”。
- 复用原有 9 张表：`users`、`items`、`orders`、`payments`、`reviews`、`audits`、`item_history`、`swap_intents`、`swap_plans`。
- 新增 12 张表：
  - `categories`：分类，最多两级；
  - `student_roster`：学籍名单，认证比对源；
  - `verification_records`：认证申请与审核；
  - `item_images`：物品图片 URL、排序、首图、历史状态；
  - `platform_accounts`：平台托管账户，单行 `escrow`；
  - `pickup_points`：校内自提点；
  - `delivery_records`：交付方式、自提点、取件码、交付/确认时间；
  - `credit_records`：信用分变动流水；
  - `notifications`：站内通知；
  - `favorites`：收藏；
  - `wanted_posts`：求购；
  - `arbitration_requests`：仲裁申请与裁定。
- `items` 增加 `category_id`；`orders` 增加 `pickup_point_id`、`order_type`、`plan_id`。

## 2. 关键业务口径

### 2.1 审核

- 发布只创建 `pending` 物品。
- 运营审核通过/驳回时写 `items.status`、`audits`、`item_history`，并通知卖家；不在发布接口里“自动审核”。

### 2.2 图片

- 发布接受最多 6 个图片 URL，写 `item_images`，第一张为首图。
- 只支持 URL，不接对象存储上传；前端图片加载失败时回退到文字封面。
- 重新上架/换图的“旧图改历史”暂未做成独立流程，当前以新增图片记录为主。

### 2.3 两人置换

1. 学生 A 选自己的 `on_sale` 物品，再选 B 的 `on_sale` 物品，创建 `active` 意向。
2. B 反向选中 A 的物品时匹配：两条意向 `matched`，两件物品 `locked`，生成 `pending` 方案，10 分钟确认截止。
3. 双方各自确认；都确认后方案 `active`，生成两张 `order_type='swap'`、`amount=0`、`status='to_deliver'` 的置换单。
4. 任一方点“完成置换”：同一事务内交换两件物品 `owner_id`、物品/订单/方案/意向全部完成。
5. 任一方放弃或超时：方案取消、物品回到 `on_sale`、意向取消。
6. 所有匹配、确认、完成、取消都在事务内；物品按 ID 排序 `SELECT ... FOR UPDATE`，避免死锁。

### 2.4 置换与普通购买并发

- 方案匹配后物品 `locked`，普通下单返回 `409`。
- 单方意向阶段物品不锁；普通订单支付成功后，同一事务取消该物品所有未匹配 `active` 意向。
- 订单只创建未支付时物品由订单锁定；取消/超时回到 `on_sale`，原意向仍可匹配。

### 2.5 支付、交付、信用

- 支付：扣买家余额、写支付流水、平台托管余额/累计流入增加、通知卖家、取消未匹配置换意向。
- 交付：写 `delivery_records`；自提生成取件码；订单转 `to_confirm`；通知买家。
- 确认：订单/物品完成、卖家余额增加、写放款、平台托管减少/累计流出增加、写交付确认时间、双方 `credit_records +2` 且用户信用分 +2、通知双方。

### 2.6 认证、收藏、求购、通知、仲裁

- 学籍认证：管理员导入 `student_roster`，学生提交学号/姓名，运营审核；通过后 `users.verified=1` 并写通知。
- 收藏：`favorites` 唯一约束 `(user_id,item_id)`，重复点击即取消。
- 求购：`wanted_posts` 状态 `open/closed`，7 天过期；不自动撮合。
- 通知：审核、支付、交付、认证、仲裁等写 `notifications`；前端显示未读红点并支持全部/单条已读。
- 仲裁：订单双方在 `to_confirm/completed` 时可申请；运营裁定只写 `status/result/operator_id/decided_at`，**不自动退款/回滚**，需要人工按结果处理资金。

## 3. 与设计文档的差异

| 设计文档 | 当前实现 | 原因 |
|---|---|---|
| F11 支持两人/三人环 | 只支持两人互换 | 三人环的匹配、确认、结算复杂度高，先保证两人闭环 |
| `置换方案表` 含意向 A/B/C | 只有 `intent_a_id`、`intent_b_id` | 两人版不需要 C |
| 置换单直接写“完成” | 先 `to_deliver`，双方再点“完成置换” | 保留线下交付确认，避免误点直接过户 |
| F11 写 `交付记录表` | 置换完成不写 `delivery_records` | 置换按面交完成，当前用订单/方案时间戳表达；普通订单交付会写 |
| F10 再次上架写 `物品图片表` | 图片表已建，但未做“旧图改历史”的完整重新上架流程 | 当前以新增图片为主 |
| 审核由 F3 写物品状态 | F3 只创建 `pending`，F12 审核时写 `on_sale/rejected` | 避免“发布即审核”的职责混乱 |
| 通知表 | 已实现站内通知 | 轮询/刷新可见，不是 WebSocket |
| 信用记录表 | 已实现普通交易 +2 流水；置换不加分 | 置换是否加分需产品规则，当前不凭空加分 |
| 仲裁支持退款/回滚 | 只记录裁定结果 | 自动退款涉及资金回滚和订单状态，当前不伪造已完成 |

## 4. REST API（新增部分）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/categories` | 运营 | 新增/更新分类 |
| POST | `/api/admin/pickup-points` | 运营 | 新增/更新自提点 |
| POST | `/api/admin/roster/import` | 运营 | 导入学籍，body `{students:[...]}` |
| POST | `/api/verifications` | 学生 | 提交认证，body `{studentNo,realName}` |
| POST | `/api/admin/verifications/:id/review` | 运营 | body `{action:'approve'|'reject',reason}` |
| POST | `/api/favorites/:itemId/toggle` | 登录 | 收藏/取消收藏 |
| POST | `/api/notifications/read` | 登录 | body `{id}` 或 `{}` 全部已读 |
| POST | `/api/wanted` | 学生 | 发布求购 |
| POST | `/api/arbitrations` | 订单双方 | 申请仲裁，body `{orderId,reason,evidence}` |
| POST | `/api/admin/arbitrations/:id/decide` | 运营 | body `{action:'support'|'support_buyer'|'support_seller',result}` |

`/api/bootstrap` 新增返回 `db.categories/images/favorites/notifications/wanted/arbitrations/verifications/roster/pickupPoints/deliveries/creditRecords/platform` 和 `db.stats.unreadNotifications`。学生按归属裁剪，运营返回全量；`roster/platform` 仅运营可见。

## 5. 数据库迁移

`schema.sql` 已包含 21 张表和新列。已有数据库启动时，`init()` 会：

```sql
ALTER TABLE items ADD COLUMN category_id VARCHAR(32) NULL;
ALTER TABLE orders ADD COLUMN pickup_point_id VARCHAR(32) NULL;
ALTER TABLE orders ADD COLUMN order_type VARCHAR(16) NOT NULL DEFAULT 'normal';
ALTER TABLE orders ADD COLUMN plan_id VARCHAR(32) NULL;
```

如果列已存在则跳过；新表使用 `CREATE TABLE IF NOT EXISTS`，不会清空已有数据。`ensureLookupData()` 会补 c1–c5 分类、20230001/20230002 学籍、平台托管账户 `pa_escrow`、自提点 `pp1`，并按分类名回填旧物品的 `category_id`。

## 6. 测试

`fullstack/test/security.test.js` 现在包含 28 项：

- P0-4 鉴权/数据范围/交易闭环 11 项；
- P5 两人置换 7 项；
- P6 21 表与新功能 10 项：21 表存在、分类/自提点/学籍、图片/履历/审核通知、认证、收藏/求购、支付/交付/确认的托管/交付/信用、仲裁、通知已读。

运行：

```bash
cd fullstack
npm test
```

## 7. 已知边界

- 支付是模拟钱包；平台托管是单行模拟账。
- 仲裁只记录裁定结果，不自动退款/回滚。
- 图片只接受 URL，不接对象存储上传。
- 学籍认证是名单比对，不接学校系统。
- 没有三人环置换；置换单 0 元、跳过支付、按面交完成。
- 10 分钟方案超时依赖访问 `bootstrap` 时触发清理；没有独立定时任务。
- `syncState()` 仍只处理旧表快照，默认关闭；生产不要开启。
- 服务启动会执行 `schema.sql` 并对已有表补列；线上部署前应备份数据库、在维护窗口执行，并确认账号有 `CREATE/ALTER` 权限。
