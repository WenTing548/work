const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const BASE_PORT = Number(process.env.PORT || 3000);
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'shiguang',
  password: process.env.DB_PASSWORD || 'shiguang123',
  database: process.env.DB_NAME || 'shiguangji',
  charset: 'utf8mb4',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: true
};
const pool = mysql.createPool(DB_CONFIG);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
function id(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}
async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}
async function verifyPassword(password, stored) {
  if (isBcryptHash(stored)) return bcrypt.compare(String(password), String(stored));
  return String(password) === String(stored);
}
function n(v) { return v == null ? null : Number(v); }
function mapUser(r) {
  return {
    id: r.id, username: r.username, name: r.name, college: r.college,
    role: r.role, verified: !!r.verified, credit: r.credit,
    balance: Number(r.balance), createdAt: n(r.created_at)
  };
}
// 其他用户只返回交易展示所需的公开摘要；不返回用户名、余额、密码等字段。
function mapPublicUser(r) {
  return {
    id: r.id, name: r.name, college: r.college,
    role: r.role, verified: !!r.verified, credit: r.credit
  };
}
function mapItem(r) {
  return {
    id: r.id, ownerId: r.owner_id, title: r.title, category: r.category,
    categoryId: r.category_id || null,
    price: Number(r.price), originalPrice: Number(r.original_price),
    condition: r.condition_level, description: r.description,
    delivery: r.delivery, status: r.status, createdAt: n(r.created_at),
    views: r.views, rejectReason: r.reject_reason || ''
  };
}
function mapOrder(r) {
  return {
    id: r.id, itemId: r.item_id, buyerId: r.buyer_id, sellerId: r.seller_id,
    amount: Number(r.amount), status: r.status,
    orderType: r.order_type || 'normal', planId: r.plan_id || null,
    delivery: r.delivery, pickupPointId: r.pickup_point_id || null,
    createdAt: n(r.created_at), deadline: n(r.deadline), paidAt: n(r.paid_at),
    deliveredAt: n(r.delivered_at), completedAt: n(r.completed_at),
    cancelledAt: n(r.cancelled_at), reviewed: !!r.reviewed
  };
}
function mapPayment(r) {
  return { id: r.id, userId: r.user_id, orderId: r.order_id, type: r.type, amount: Number(r.amount), note: r.note, at: n(r.at) };
}
function mapReview(r) {
  return { id: r.id, orderId: r.order_id, buyerId: r.buyer_id, sellerId: r.seller_id, rating: r.rating, text: r.text, at: n(r.at) };
}
function mapAudit(r) {
  return { id: r.id, itemId: r.item_id, result: r.result, reason: r.reason, operatorId: r.operator_id, at: n(r.at) };
}
function mapHistory(r) {
  return {
    id: r.id, itemId: r.item_id, action: r.action,
    fromStatus: r.from_status || null, toStatus: r.to_status || null,
    actorId: r.actor_id || null, note: r.note || '', createdAt: n(r.created_at)
  };
}
async function addHistory(conn, itemId, action, fromStatus, toStatus, actorId, note) {
  await conn.query(
    'INSERT INTO item_history (id,item_id,action,from_status,to_status,actor_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id('h'), itemId, action, fromStatus || null, toStatus || null, actorId || null, String(note || '').slice(0, 200), Date.now()]
  );
}
async function cancelActiveIntentsForItem(conn, itemId) {
  await conn.query(
    "UPDATE swap_intents SET status='cancelled' WHERE status='active' AND (my_item_id=? OR target_item_id=?)",
    [itemId, itemId]
  );
}
function mapSwapIntent(r) {
  return {
    id: r.id, userId: r.user_id, myItemId: r.my_item_id,
    targetItemId: r.target_item_id, status: r.status, createdAt: n(r.created_at)
  };
}
function mapSwapPlan(r) {
  return {
    id: r.id, intentAId: r.intent_a_id, intentBId: r.intent_b_id,
    itemAId: r.item_a_id, itemBId: r.item_b_id,
    userAId: r.user_a_id, userBId: r.user_b_id,
    status: r.status, createdAt: n(r.created_at),
    confirmDeadline: n(r.confirm_deadline),
    aConfirmedAt: n(r.a_confirmed_at), bConfirmedAt: n(r.b_confirmed_at),
    completedAt: n(r.completed_at), cancelledAt: n(r.cancelled_at)
  };
}
function mapCategory(r) {
  return { id: r.id, name: r.name, parentId: r.parent_id || null, sort: r.sort, status: r.status, createdAt: n(r.created_at) };
}
function mapRoster(r) {
  return { studentNo: r.student_no, name: r.name, college: r.college, major: r.major, grade: r.grade, className: r.class_name, status: r.status, importedAt: n(r.imported_at) };
}
function mapVerification(r) {
  return { id: r.id, userId: r.user_id, studentNo: r.student_no, realName: r.real_name, college: r.college, status: r.status, reason: r.reason, reviewedBy: r.reviewed_by || null, createdAt: n(r.created_at), reviewedAt: n(r.reviewed_at) };
}
function mapImage(r) {
  return { id: r.id, itemId: r.item_id, url: r.url, sort: r.sort, isPrimary: !!r.is_primary, status: r.status, createdAt: n(r.created_at) };
}
function mapPlatform(r) {
  return { id: r.id, accountType: r.account_type, escrowBalance: Number(r.escrow_balance), totalIn: Number(r.total_in), totalOut: Number(r.total_out), updatedAt: n(r.updated_at) };
}
function mapPickup(r) {
  return { id: r.id, name: r.name, address: r.address, contact: r.contact, status: r.status, createdAt: n(r.created_at) };
}
function mapDelivery(r) {
  return { id: r.id, orderId: r.order_id, method: r.method, pickupPointId: r.pickup_point_id || null, pickupCode: r.pickup_code || '', deliveredAt: n(r.delivered_at), confirmedAt: n(r.confirmed_at), operatorId: r.operator_id || null, note: r.note || '' };
}
function mapCredit(r) {
  return { id: r.id, userId: r.user_id, change: r.change_value, reason: r.reason, refType: r.ref_type || null, refId: r.ref_id || null, createdAt: n(r.created_at) };
}
function mapNotification(r) {
  return { id: r.id, userId: r.user_id, type: r.type, title: r.title, body: r.body, readAt: n(r.read_at), createdAt: n(r.created_at) };
}
function mapFavorite(r) {
  return { id: r.id, userId: r.user_id, itemId: r.item_id, createdAt: n(r.created_at) };
}
function mapWanted(r) {
  return { id: r.id, userId: r.user_id, title: r.title, categoryId: r.category_id || null, keywords: r.keywords, budgetMin: Number(r.budget_min), budgetMax: Number(r.budget_max), condition: r.condition_level, status: r.status, createdAt: n(r.created_at), expiresAt: n(r.expires_at) };
}
function mapArbitration(r) {
  return { id: r.id, orderId: r.order_id, applicantId: r.applicant_id, reason: r.reason, evidence: r.evidence, status: r.status, result: r.result, operatorId: r.operator_id || null, createdAt: n(r.created_at), decidedAt: n(r.decided_at) };
}
async function notify(conn, userId, type, title, body) {
  if (!userId) return;
  await conn.query(
    'INSERT INTO notifications (id,user_id,type,title,body,read_at,created_at) VALUES (?,?,?,?,?,NULL,?)',
    [id('n'), userId, type, String(title).slice(0, 80), String(body || '').slice(0, 300), Date.now()]
  );
}
async function addCredit(conn, userId, change, reason, refType, refId) {
  if (!userId || !change) return;
  await conn.query('UPDATE users SET credit = GREATEST(0, credit + ?) WHERE id = ?', [change, userId]);
  await conn.query(
    'INSERT INTO credit_records (id,user_id,change_value,reason,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,?,?)',
    [id('cr'), userId, change, String(reason).slice(0, 120), refType || null, refId || null, Date.now()]
  );
}

const SESSION_COOKIE = 'sg_token';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-shiguangji-2026';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET 未设置，使用开发默认值；部署到公网前必须设置。');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) return acc;
    const key = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    if (!key) return acc;
    try { value = decodeURIComponent(value); } catch (e) { /* 保留原始值 */ }
    acc[key] = value;
    return acc;
  }, {});
}

function sessionCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
}

function signSession(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

async function getAuthUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.sub) return null;
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [payload.sub]);
    return rows[0] ? mapUser(rows[0]) : null;
  } catch (e) {
    return null;
  }
}

async function requireAuth(req) {
  const user = await getAuthUser(req);
  if (!user) throw httpError(401, '请先登录');
  return user;
}

function requireAdmin(user) {
  if (!user || user.role !== 'admin') throw httpError(403, '只有运营可以操作');
  return user;
}

async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (!rows.length) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`[migrate] ${table}.${column} 已添加`);
  }
}

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  // 兼容已有数据库：新增列不重建表，旧数据保留。
  await ensureColumn('orders', 'order_type', "VARCHAR(16) NOT NULL DEFAULT 'normal'");
  await ensureColumn('orders', 'plan_id', 'VARCHAR(32) NULL');
  await ensureColumn('items', 'category_id', 'VARCHAR(32) NULL');
  await ensureColumn('orders', 'pickup_point_id', 'VARCHAR(32) NULL');
  await ensureLookupData();
  const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM users');
  if (Number(row.c) === 0) await seed();
  await ensureLookupData();
}
async function ensureLookupData() {
  const now = Date.now();
  const categories = [
    ['c1', '教材', null, 10],
    ['c2', '出行', null, 20],
    ['c3', '生活', null, 30],
    ['c4', '乐器', null, 40],
    ['c5', '数码', null, 50]
  ];
  for (const c of categories) {
    await pool.query(
      'INSERT INTO categories (id,name,parent_id,sort,status,created_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
      [c[0], c[1], c[2], c[3], 'active', now]
    );
  }
  await pool.query(
    `INSERT IGNORE INTO student_roster (student_no,name,college,major,grade,class_name,status,imported_at) VALUES
     ('20230001','林同学','计算机学院','软件工程','2023','软工2301','active',?),
     ('20230002','陈同学','机械学院','机械设计','2023','机械2301','active',?)`,
    [now, now]
  );
  await pool.query(
    "INSERT IGNORE INTO platform_accounts (id,account_type,escrow_balance,total_in,total_out,updated_at) VALUES ('pa_escrow','escrow',0,0,0,?)",
    [now]
  );
  await pool.query(
    "INSERT IGNORE INTO pickup_points (id,name,address,contact,status,created_at) VALUES ('pp1','图书馆一楼服务台','图书馆一楼东侧','学生事务中心','active',?)",
    [now]
  );
  await pool.query(
    `UPDATE items SET category_id=(SELECT id FROM categories WHERE categories.name=items.category LIMIT 1)
     WHERE category_id IS NULL`
  );
}

async function seed() {
  const now = Date.now();
  const student1Password = await hashPassword('123456');
  const student2Password = await hashPassword('123456');
  const adminPassword = await hashPassword('admin123');
  const users = [
    ['u1', 'student1', student1Password, '林同学', '计算机学院', 'student', 1, 96, 500.00, now - 86400000 * 20],
    ['u2', 'student2', student2Password, '陈同学', '机械学院', 'student', 1, 92, 300.00, now - 86400000 * 18],
    ['admin', 'admin', adminPassword, '运营小林', '学生事务中心', 'admin', 1, 100, 0.00, now - 86400000 * 30]
  ];
  const items = [
    ['i1', 'u2', '高等数学 第七版', '教材', 18, 45, '90', '书角有轻微磨损，内页干净，无笔记。可约图书馆门口面交。', '面交/自提', 'on_sale', now - 3600000, 38, null],
    ['i2', 'u2', '捷安特山地车', '出行', 260, 699, '70', '骑了两年，刹车和变速正常，送车锁。毕业出，可小刀。', '自提', 'on_sale', now - 7200000, 64, null],
    ['i3', 'u1', '护眼台灯', '生活', 25, 89, '90', '三档调光，宿舍书桌用刚好，功能正常。', '面交/自提', 'on_sale', now - 10800000, 21, null],
    ['i4', 'u2', '民谣吉他 41 寸', '乐器', 180, 520, '70', '音准正常，琴颈无裂，送琴包和拨片。', '自提', 'on_sale', now - 86400000, 47, null],
    ['i5', 'u1', '数据结构与算法分析', '教材', 22, 59, '90', 'C 语言描述版，重点章节有少量铅笔标注。', '面交', 'pending', now - 1800000, 0, null]
  ];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO users (id,username,password,name,college,role,verified,credit,balance,created_at) VALUES ?', [users]);
    await conn.query('INSERT INTO items (id,owner_id,title,category,price,original_price,condition_level,description,delivery,status,created_at,views,reject_reason) VALUES ?', [items]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function bootstrap(currentUser) {
  const isAdmin = currentUser.role === 'admin';
  const user = currentUser;

  // 过期的置换方案先按规则取消并解锁物品，避免首页长期看到 locked。
  await expireSwapPlans();

  // 学生只拿到公开在售物品、自己的物品、自己参与的订单及其资金流水。
  const itemSql = isAdmin
    ? 'SELECT * FROM items ORDER BY created_at DESC'
    : `SELECT * FROM items
       WHERE status = 'on_sale'
          OR owner_id = ?
          OR id IN (SELECT item_id FROM orders WHERE buyer_id = ? OR seller_id = ?)
       ORDER BY created_at DESC`;
  const itemArgs = isAdmin ? [] : [user.id, user.id, user.id];
  const orderSql = isAdmin
    ? 'SELECT * FROM orders ORDER BY created_at DESC'
    : 'SELECT * FROM orders WHERE buyer_id = ? OR seller_id = ? ORDER BY created_at DESC';
  const orderArgs = isAdmin ? [] : [user.id, user.id];
  const paymentSql = isAdmin
    ? 'SELECT * FROM payments ORDER BY at DESC'
    : `SELECT * FROM payments
       WHERE user_id = ?
          OR order_id IN (SELECT id FROM orders WHERE buyer_id = ? OR seller_id = ?)
       ORDER BY at DESC`;
  const paymentArgs = isAdmin ? [] : [user.id, user.id, user.id];
  const reviewSql = isAdmin
    ? 'SELECT * FROM reviews ORDER BY at DESC'
    : 'SELECT * FROM reviews WHERE buyer_id = ? OR seller_id = ? ORDER BY at DESC';
  const reviewArgs = isAdmin ? [] : [user.id, user.id];
  const auditSql = isAdmin
    ? 'SELECT * FROM audits ORDER BY at DESC'
    : 'SELECT * FROM audits WHERE item_id IN (SELECT id FROM items WHERE owner_id = ?) ORDER BY at DESC';
  const auditArgs = isAdmin ? [] : [user.id];
  const swapIntentSql = isAdmin
    ? 'SELECT * FROM swap_intents ORDER BY created_at DESC'
    : 'SELECT * FROM swap_intents WHERE user_id = ? ORDER BY created_at DESC';
  const swapIntentArgs = isAdmin ? [] : [user.id];
  const swapPlanSql = isAdmin
    ? 'SELECT * FROM swap_plans ORDER BY created_at DESC'
    : 'SELECT * FROM swap_plans WHERE user_a_id = ? OR user_b_id = ? ORDER BY created_at DESC';
  const swapPlanArgs = isAdmin ? [] : [user.id, user.id];

  const [[items], [orders], [payments], [reviews], [audits], [intents], [plans]] = await Promise.all([
    pool.query(itemSql, itemArgs),
    pool.query(orderSql, orderArgs),
    pool.query(paymentSql, paymentArgs),
    pool.query(reviewSql, reviewArgs),
    pool.query(auditSql, auditArgs),
    pool.query(swapIntentSql, swapIntentArgs),
    pool.query(swapPlanSql, swapPlanArgs)
  ]);

  // 方案涉及的物品处于 locked，不在“在售/自己的/订单”范围内，单独补进来。
  const knownItemIds = new Set(items.map(i => i.id));
  const planItemIds = [...new Set(plans.flatMap(p => [p.item_a_id, p.item_b_id]))]
    .filter(id => !knownItemIds.has(id));
  if (planItemIds.length) {
    const marks = planItemIds.map(() => '?').join(',');
    const [extraItems] = await pool.query(`SELECT * FROM items WHERE id IN (${marks})`, planItemIds);
    items.push(...extraItems);
  }

  const visibleItemIds = items.map(i => i.id);
  const historySql = isAdmin
    ? 'SELECT * FROM item_history ORDER BY created_at ASC'
    : visibleItemIds.length
      ? `SELECT * FROM item_history WHERE item_id IN (${visibleItemIds.map(() => '?').join(',')}) ORDER BY created_at ASC`
      : null;
  const [history] = historySql ? await pool.query(historySql, isAdmin ? [] : visibleItemIds) : [[]];
  const orderIds = orders.map(o => o.id);
  const imageSql = isAdmin
    ? "SELECT * FROM item_images WHERE status='active' ORDER BY item_id, sort, created_at"
    : visibleItemIds.length
      ? `SELECT * FROM item_images WHERE status='active' AND item_id IN (${visibleItemIds.map(() => '?').join(',')}) ORDER BY item_id, sort, created_at`
      : null;
  const deliverySql = isAdmin
    ? 'SELECT * FROM delivery_records ORDER BY delivered_at DESC'
    : orderIds.length
      ? `SELECT * FROM delivery_records WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY delivered_at DESC`
      : null;
  const arbitrationSql = isAdmin
    ? 'SELECT * FROM arbitration_requests ORDER BY created_at DESC'
    : `SELECT * FROM arbitration_requests WHERE applicant_id = ?
       OR order_id IN (SELECT id FROM orders WHERE buyer_id=? OR seller_id=?) ORDER BY created_at DESC`;
  const verificationSql = isAdmin
    ? 'SELECT * FROM verification_records ORDER BY created_at DESC'
    : 'SELECT * FROM verification_records WHERE user_id=? ORDER BY created_at DESC';
  const wantedSql = isAdmin
    ? 'SELECT * FROM wanted_posts ORDER BY created_at DESC'
    : "SELECT * FROM wanted_posts WHERE status='open' OR user_id=? ORDER BY created_at DESC";
  const pickupSql = isAdmin
    ? 'SELECT * FROM pickup_points ORDER BY created_at DESC'
    : "SELECT * FROM pickup_points WHERE status='active' ORDER BY created_at DESC";
  const creditSql = isAdmin
    ? 'SELECT * FROM credit_records ORDER BY created_at DESC LIMIT 200'
    : 'SELECT * FROM credit_records WHERE user_id=? ORDER BY created_at DESC LIMIT 100';
  const [categories] = await pool.query(isAdmin ? 'SELECT * FROM categories ORDER BY sort,created_at' : "SELECT * FROM categories WHERE status='active' ORDER BY sort,created_at");
  const [images] = imageSql ? await pool.query(imageSql, isAdmin ? [] : visibleItemIds) : [[]];
  const [deliveries] = deliverySql ? await pool.query(deliverySql, isAdmin ? [] : orderIds) : [[]];
  const [arbitrations] = await pool.query(arbitrationSql, isAdmin ? [] : [user.id, user.id, user.id]);
  const [verifications] = await pool.query(verificationSql, isAdmin ? [] : [user.id]);
  const [roster] = isAdmin ? await pool.query('SELECT * FROM student_roster ORDER BY college, student_no') : [[]];
  const [wanted] = await pool.query(wantedSql, isAdmin ? [] : [user.id]);
  const [pickups] = await pool.query(pickupSql);
  const [creditRecords] = await pool.query(creditSql, isAdmin ? [] : [user.id]);
  const [favorites] = await pool.query('SELECT * FROM favorites WHERE user_id=? ORDER BY created_at DESC', [user.id]);
  const [notifications] = await pool.query('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [user.id]);
  const [platformRows] = isAdmin ? await pool.query("SELECT * FROM platform_accounts WHERE account_type='escrow' LIMIT 1") : [[]];

  // 只返回当前用户及当前数据里出现过的其他用户，避免全站用户资料暴露。
  const userIds = new Set([user.id]);
  items.forEach(i => userIds.add(i.owner_id));
  orders.forEach(o => { userIds.add(o.buyer_id); userIds.add(o.seller_id); });
  reviews.forEach(r => { userIds.add(r.buyer_id); userIds.add(r.seller_id); });
  intents.forEach(i => userIds.add(i.user_id));
  plans.forEach(p => { userIds.add(p.user_a_id); userIds.add(p.user_b_id); });
  const userIdList = [...userIds];
  const placeholders = userIdList.map(() => '?').join(',');
  const [userRows] = await pool.query(
    `SELECT id, username, name, college, role, verified, credit, created_at
     FROM users WHERE id IN (${placeholders}) ORDER BY created_at`,
    userIdList
  );
  // currentUser 来自 getAuthUser，已包含余额；公开用户查询刻意不取余额。
  const safeUsers = userRows.map(r => r.id === user.id ? user : mapPublicUser(r));

  const [[studentCountRow]] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role = 'student'");
  const [[onSaleCountRow]] = await pool.query("SELECT COUNT(*) AS c FROM items WHERE status = 'on_sale'");

  return {
    db: {
      users: safeUsers,
      items: items.map(mapItem),
      orders: orders.map(mapOrder),
      reviews: reviews.map(mapReview),
      tx: payments.map(mapPayment),
      audits: audits.map(mapAudit),
      history: history.map(mapHistory),
      swaps: {
        intents: intents.map(mapSwapIntent),
        plans: plans.map(mapSwapPlan)
      },
      categories: categories.map(mapCategory),
      images: images.map(mapImage),
      favorites: favorites.map(mapFavorite),
      notifications: notifications.map(mapNotification),
      wanted: wanted.map(mapWanted),
      arbitrations: arbitrations.map(mapArbitration),
      verifications: verifications.map(mapVerification),
      roster: roster.map(mapRoster),
      pickupPoints: pickups.map(mapPickup),
      deliveries: deliveries.map(mapDelivery),
      creditRecords: creditRecords.map(mapCredit),
      platform: platformRows[0] ? mapPlatform(platformRows[0]) : null,
      stats: {
        studentCount: Number(studentCountRow.c),
        onSaleCount: Number(onSaleCountRow.c),
        unreadNotifications: notifications.filter(x => !x.read_at).length
      }
    },
    user
  };
}

async function login(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  const u = rows[0];
  if (!u || !(await verifyPassword(password, u.password))) {
    throw httpError(401, '用户名或密码不正确');
  }
  // 兼容旧数据：首次用明文密码登录成功后自动升级为 bcrypt。
  if (!isBcryptHash(u.password)) {
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(password), u.id]);
  }
  return mapUser(u);
}

async function register(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const college = String(body.college || '').trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw httpError(400, '用户名需为 3—20 位英文、数字或下划线');
  if (password.length < 6) throw httpError(400, '密码至少 6 位');
  if (!name) throw httpError(400, '请填写昵称');
  const [[exists]] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE username = ?', [username]);
  if (Number(exists.c) > 0) throw httpError(409, '用户名已存在');
  const uid = id('u');
  const now = Date.now();
  const passwordHash = await hashPassword(password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO users (id,username,password,name,college,role,verified,credit,balance,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [uid, username, passwordHash, name, college || '未填写', 'student', 1, 80, 300.00, now]);
    await conn.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), uid, null, '注册赠送', 300, '演示环境初始钱包', now]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [uid]);
  return mapUser(rows[0]);
}

async function publishItem(user, body) {
  if (user.role !== 'student') throw httpError(403, '运营账号不能发布物品');
  const title = String(body.title || '').trim();
  const price = Number(body.price);
  if (title.length < 2) throw httpError(400, '标题至少 2 个字');
  if (!price || price <= 0) throw httpError(400, '请输入有效售价');
  let categoryId = String(body.categoryId || '').trim() || null;
  let categoryName = String(body.category || '教材').trim() || '教材';
  if (categoryId) {
    const [c] = await pool.query("SELECT * FROM categories WHERE id=? AND status='active'", [categoryId]);
    if (!c[0]) throw httpError(400, '分类不存在');
    categoryName = c[0].name;
  }
  const itemId = id('i');
  const now = Date.now();
  const images = Array.isArray(body.images) ? body.images.map(x => String(typeof x === 'string' ? x : x.url || '').trim()).filter(Boolean).slice(0, 6) : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO items (id,owner_id,title,category,category_id,price,original_price,condition_level,description,delivery,status,created_at,views) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)',
      [itemId, user.id, title, categoryName.slice(0, 20), categoryId, price, Number(body.originalPrice) || price, String(body.condition || '90'), String(body.description || ''), String(body.delivery || '面交/自提'), 'pending', now]
    );
    for (let i = 0; i < images.length; i++) {
      await conn.query(
        'INSERT INTO item_images (id,item_id,url,sort,is_primary,status,created_at) VALUES (?,?,?,?,?,?,?)',
        [id('img'), itemId, images[i].slice(0, 500), i, i === 0 ? 1 : 0, 'active', now]
      );
    }
    await addHistory(conn, itemId, 'published', null, 'pending', user.id, '发布，等待审核');
    const [admins] = await conn.query("SELECT id FROM users WHERE role='admin'");
    for (const a of admins) await notify(conn, a.id, 'audit', '新的待审核物品', `${user.name} 发布了「${title}」，请审核。`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [itemId]);
  return mapItem(rows[0]);
}

async function approveItem(itemId, operator) {
  if (operator.role !== 'admin') throw httpError(403, '只有运营可以审核');
  const [items] = await pool.query('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!items[0]) throw httpError(404, '物品不存在');
  if (items[0].status !== 'pending') throw httpError(409, '该物品不在待审核状态');
  await pool.query("UPDATE items SET status='on_sale' WHERE id=?", [itemId]);
  await pool.query('INSERT INTO audits (id,item_id,result,reason,operator_id,at) VALUES (?,?,?,?,?,?)', [id('a'), itemId, '通过', '', operator.id, Date.now()]);
  await addHistory(pool, itemId, 'approved', 'pending', 'on_sale', operator.id, '审核通过，自动上架');
  await notify(pool, items[0].owner_id, 'audit', '物品审核通过', `「${items[0].title}」已上架。`);
  const [rows] = await pool.query('SELECT * FROM items WHERE id=?', [itemId]);
  return mapItem(rows[0]);
}

async function rejectItem(itemId, operator, reason) {
  if (operator.role !== 'admin') throw httpError(403, '只有运营可以审核');
  const [items] = await pool.query('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!items[0]) throw httpError(404, '物品不存在');
  if (items[0].status !== 'pending') throw httpError(409, '该物品不在待审核状态');
  await pool.query("UPDATE items SET status='rejected', reject_reason=? WHERE id=?", [reason || '未填写原因', itemId]);
  await pool.query('INSERT INTO audits (id,item_id,result,reason,operator_id,at) VALUES (?,?,?,?,?,?)', [id('a'), itemId, '驳回', reason || '未填写原因', operator.id, Date.now()]);
  await addHistory(pool, itemId, 'rejected', 'pending', 'rejected', operator.id, reason || '未填写原因');
  await notify(pool, items[0].owner_id, 'audit', '物品审核未通过', `「${items[0].title}」被驳回：${reason || '未填写原因'}`);
  const [rows] = await pool.query('SELECT * FROM items WHERE id=?', [itemId]);
  return mapItem(rows[0]);
}

async function createOrder(body, buyer) {
  if (buyer.role !== 'student') throw httpError(403, '运营账号不能购买');
  const itemId = String(body.itemId || '');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [items] = await conn.query('SELECT * FROM items WHERE id = ? FOR UPDATE', [itemId]);
    const item = items[0];
    if (!item) throw httpError(404, '物品不存在');
    if (item.status !== 'on_sale') throw httpError(409, '该物品当前不可购买');
    if (item.owner_id === buyer.id) throw httpError(400, '不能购买自己发布的物品');
    if (Number(buyer.balance) < Number(item.price)) throw httpError(400, '余额不足，请先到钱包充值');
    const pickupPointId = body.pickupPointId ? String(body.pickupPointId) : null;
    if (pickupPointId) {
      const [pp] = await conn.query("SELECT id FROM pickup_points WHERE id=? AND status='active'", [pickupPointId]);
      if (!pp[0]) throw httpError(400, '自提点不存在');
    }
    const orderId = id('o');
    const now = Date.now();
    await conn.query('INSERT INTO orders (id,item_id,buyer_id,seller_id,amount,status,delivery,created_at,deadline,reviewed,pickup_point_id) VALUES (?,?,?,?,?,?,?,?,?,0,?)', [orderId, itemId, buyer.id, item.owner_id, item.price, 'unpaid', item.delivery, now, now + 30000, pickupPointId]);
    await conn.query("UPDATE items SET status='locked' WHERE id=?", [itemId]);
    await addHistory(conn, itemId, 'locked', 'on_sale', 'locked', buyer.id, '买家下单，物品锁定');
    await notify(conn, item.owner_id, 'order', '收到新订单', `${buyer.name} 下单了「${item.title}」，等待买家支付。`);
    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
    return mapOrder(rows[0]);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function payOrder(orderId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) throw httpError(404, '订单不存在');
    if (order.order_type === 'swap') throw httpError(409, '置换单请在“置换”页面处理');
    if (order.buyer_id !== userId) throw httpError(403, '无权支付该订单');
    if (order.status !== 'unpaid') throw httpError(409, '订单状态不允许支付');
    if (Number(order.deadline) < Date.now()) {
      await conn.query("UPDATE orders SET status='cancelled', cancelled_at=? WHERE id=?", [Date.now(), orderId]);
      await conn.query("UPDATE items SET status='on_sale' WHERE id=? AND status='locked'", [order.item_id]);
      await addHistory(conn, order.item_id, 'unlocked', 'locked', 'on_sale', userId, '订单超时取消，物品解锁');
      await conn.commit();
      throw httpError(409, '订单已超时取消，请重新下单');
    }
    const [users] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [userId]);
    const buyer = users[0];
    if (Number(buyer.balance) < Number(order.amount)) throw httpError(400, '余额不足');
    await conn.query('UPDATE users SET balance = balance - ? WHERE id=?', [order.amount, userId]);
    await conn.query("UPDATE orders SET status='to_deliver', paid_at=? WHERE id=?", [Date.now(), orderId]);
    await conn.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), userId, orderId, '支付', order.amount, '订单 ' + orderId + ' · 平台托管', Date.now()]);
    await conn.query(
      "UPDATE platform_accounts SET escrow_balance=escrow_balance+?, total_in=total_in+?, updated_at=? WHERE account_type='escrow'",
      [order.amount, order.amount, Date.now()]
    );
    await addHistory(conn, order.item_id, 'paid', 'locked', 'locked', userId, '支付成功，进入平台托管');
    await notify(conn, order.seller_id, 'order', '买家已支付', `订单 ${orderId} 已支付，请尽快交付。`);
    // 购买支付成功即视为交易成立：取消该物品尚未匹配的置换意向，避免“已卖出但仍显示置换中”。
    await cancelActiveIntentsForItem(conn, order.item_id);
    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
    return mapOrder(rows[0]);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function cancelOrder(orderId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) throw httpError(404, '订单不存在');
    if (order.order_type === 'swap') throw httpError(409, '置换单请在“置换”页面处理');
    if (order.buyer_id !== userId) throw httpError(403, '无权取消该订单');
    if (order.status !== 'unpaid') throw httpError(409, '订单状态不允许取消');
    await conn.query("UPDATE orders SET status='cancelled', cancelled_at=? WHERE id=?", [Date.now(), orderId]);
    await conn.query("UPDATE items SET status='on_sale' WHERE id=? AND status='locked'", [order.item_id]);
    await addHistory(conn, order.item_id, 'unlocked', 'locked', 'on_sale', userId, '买家取消订单，物品解锁');
    await notify(conn, order.seller_id, 'order', '买家取消订单', `订单 ${orderId} 已取消，物品重新上架。`);
    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
    return mapOrder(rows[0]);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function deliverOrder(orderId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) throw httpError(404, '订单不存在');
    if (order.order_type === 'swap') throw httpError(409, '置换单请在“置换”页面处理');
    if (order.seller_id !== userId) throw httpError(403, '只有卖家可以确认交付');
    if (order.status !== 'to_deliver') throw httpError(409, '订单状态不允许交付');
    const now = Date.now();
    const pickupCode = order.pickup_point_id ? ('P' + Math.random().toString(36).slice(2, 6).toUpperCase()) : null;
    await conn.query("UPDATE orders SET status='to_confirm', delivered_at=? WHERE id=?", [now, orderId]);
    await conn.query(
      `INSERT INTO delivery_records (id,order_id,method,pickup_point_id,pickup_code,delivered_at,confirmed_at,operator_id,note)
       VALUES (?,?,?,?,?,?,NULL,?,?)
       ON DUPLICATE KEY UPDATE method=VALUES(method), pickup_point_id=VALUES(pickup_point_id), pickup_code=VALUES(pickup_code), delivered_at=VALUES(delivered_at), operator_id=VALUES(operator_id)`,
      [id('d'), orderId, order.delivery || '面交', order.pickup_point_id || null, pickupCode, now, userId, '卖家确认交付']
    );
    await addHistory(conn, order.item_id, 'delivered', 'locked', 'locked', userId, '卖家确认交付，等待买家确认');
    await notify(conn, order.buyer_id, 'order', '卖家已交付', `订单 ${orderId} 已交付，请确认收货。`);
    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
    return mapOrder(rows[0]);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function confirmOrder(orderId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) throw httpError(404, '订单不存在');
    if (order.order_type === 'swap') throw httpError(409, '置换单请在“置换”页面处理');
    if (order.buyer_id !== userId) throw httpError(403, '只有买家可以确认收货');
    if (order.status !== 'to_confirm') throw httpError(409, '订单状态不允许确认');
    await conn.query("UPDATE orders SET status='completed', completed_at=? WHERE id=?", [Date.now(), orderId]);
    await conn.query("UPDATE items SET status='completed' WHERE id=?", [order.item_id]);
    await conn.query('UPDATE users SET balance = balance + ? WHERE id=?', [order.amount, order.seller_id]);
    await conn.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), order.seller_id, orderId, '放款', order.amount, '订单 ' + orderId + ' · 托管放款', Date.now()]);
    await conn.query(
      "UPDATE platform_accounts SET escrow_balance=GREATEST(0, escrow_balance-?), total_out=total_out+?, updated_at=? WHERE account_type='escrow'",
      [order.amount, order.amount, Date.now()]
    );
    await conn.query('UPDATE delivery_records SET confirmed_at=? WHERE order_id=?', [Date.now(), orderId]);
    await addCredit(conn, order.seller_id, 2, '交易完成', 'order', orderId);
    await addCredit(conn, order.buyer_id, 2, '交易完成', 'order', orderId);
    await addHistory(conn, order.item_id, 'completed', 'locked', 'completed', userId, '买家确认收货，交易完成');
    await notify(conn, order.seller_id, 'order', '交易完成，已放款', `订单 ${orderId} 已完成，款项已到余额。`);
    await notify(conn, order.buyer_id, 'order', '交易完成', `订单 ${orderId} 已确认收货，感谢使用拾光集。`);
    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
    return mapOrder(rows[0]);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function reviewOrder(body, userId) {
  const { orderId, rating, text } = body;
  const [orders] = await pool.query('SELECT * FROM orders WHERE id=?', [orderId]);
  const order = orders[0];
  if (!order) throw httpError(404, '订单不存在');
  if (order.buyer_id !== userId) throw httpError(403, '只有买家可以评价');
  if (order.status !== 'completed') throw httpError(409, '订单完成后才能评价');
  if (order.reviewed) throw httpError(409, '这笔订单已经评价过了');
  const score = Math.max(1, Math.min(5, Number(rating) || 5));
  await pool.query('INSERT INTO reviews (id,order_id,buyer_id,seller_id,rating,text,at) VALUES (?,?,?,?,?,?,?)', [id('r'), orderId, order.buyer_id, order.seller_id, score, String(text || '').slice(0, 500), Date.now()]);
  await pool.query('UPDATE orders SET reviewed=1 WHERE id=?', [orderId]);
  return { ok: true };
}

async function recharge(user) {
  if (user.role !== 'student') throw httpError(403, '运营账号没有钱包');
  const amount = 100;
  await pool.query('UPDATE users SET balance = balance + ? WHERE id=?', [amount, user.id]);
  await pool.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), user.id, null, '充值', amount, '模拟充值', Date.now()]);
  const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [user.id]);
  return mapUser(rows[0]);
}

async function cancelSwapPlanTx(conn, plan) {
  const now = Date.now();
  await conn.query(
    "UPDATE swap_plans SET status='cancelled', cancelled_at=? WHERE id=? AND status='pending'",
    [now, plan.id]
  );
  await conn.query(
    "UPDATE items SET status='on_sale' WHERE id IN (?,?) AND status='locked'",
    [plan.item_a_id, plan.item_b_id]
  );
  await conn.query(
    "UPDATE swap_intents SET status='cancelled' WHERE id IN (?,?) AND status IN ('active','matched')",
    [plan.intent_a_id, plan.intent_b_id]
  );
  await addHistory(conn, plan.item_a_id, 'swap_cancelled', 'locked', 'on_sale', null, '置换方案取消，物品解锁');
  await addHistory(conn, plan.item_b_id, 'swap_cancelled', 'locked', 'on_sale', null, '置换方案取消，物品解锁');
}

async function expireSwapPlans() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [plans] = await conn.query(
      "SELECT * FROM swap_plans WHERE status='pending' AND confirm_deadline < ? FOR UPDATE",
      [Date.now()]
    );
    for (const plan of plans) await cancelSwapPlanTx(conn, plan);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function createSwapIntent(user, body) {
  if (user.role !== 'student') throw httpError(403, '运营账号不能发起置换');
  const myItemId = String(body.myItemId || '');
  const targetItemId = String(body.targetItemId || '');
  if (!myItemId || !targetItemId) throw httpError(400, '请选择双方物品');
  if (myItemId === targetItemId) throw httpError(400, '不能和自己的物品置换');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 固定按 id 排序加锁，两个用户同时互相发起时不会以相反顺序死锁。
    const [locked] = await conn.query(
      'SELECT * FROM items WHERE id IN (?,?) ORDER BY id FOR UPDATE',
      [myItemId, targetItemId]
    );
    const byId = new Map(locked.map(i => [i.id, i]));
    const myItem = byId.get(myItemId);
    const targetItem = byId.get(targetItemId);
    if (!myItem || !targetItem) throw httpError(404, '物品不存在');
    if (myItem.owner_id !== user.id) throw httpError(403, '只能用自己的物品发起置换');
    if (targetItem.owner_id === user.id) throw httpError(400, '不能换自己的物品');
    if (myItem.status !== 'on_sale' || targetItem.status !== 'on_sale') {
      throw httpError(409, '只有双方物品都在售时才能发起置换');
    }
    const [busy] = await conn.query(
      "SELECT * FROM swap_intents WHERE my_item_id=? AND status IN ('active','matched') LIMIT 1 FOR UPDATE",
      [myItemId]
    );
    if (busy[0]) throw httpError(409, '这件物品已经有进行中的置换意向');

    const intentId = id('si');
    const now = Date.now();
    await conn.query(
      'INSERT INTO swap_intents (id,user_id,my_item_id,target_item_id,status,created_at) VALUES (?,?,?,?,?,?)',
      [intentId, user.id, myItemId, targetItemId, 'active', now]
    );
    // 对方是否已经发出“用 targetItem 换 myItem”的反向意向。
    const [reverse] = await conn.query(
      `SELECT * FROM swap_intents
       WHERE user_id=? AND my_item_id=? AND target_item_id=? AND status='active'
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [targetItem.owner_id, targetItemId, myItemId]
    );
    if (reverse[0]) {
      const a = reverse[0].id < intentId ? reverse[0] : null;
      const b = a ? { id: intentId, user_id: user.id, my_item_id: myItemId, target_item_id: targetItemId } : reverse[0];
      const first = a || { id: intentId, user_id: user.id, my_item_id: myItemId, target_item_id: targetItemId };
      const second = a ? b : { id: reverse[0].id, user_id: reverse[0].user_id, my_item_id: reverse[0].my_item_id, target_item_id: reverse[0].target_item_id };
      const planId = id('sp');
      await conn.query(
        "UPDATE swap_intents SET status='matched' WHERE id IN (?,?)",
        [first.id, second.id]
      );
      const [lockedA] = await conn.query(
        "UPDATE items SET status='locked' WHERE id=? AND status='on_sale'",
        [first.my_item_id]
      );
      const [lockedB] = await conn.query(
        "UPDATE items SET status='locked' WHERE id=? AND status='on_sale'",
        [second.my_item_id]
      );
      if (lockedA.affectedRows !== 1 || lockedB.affectedRows !== 1) {
        throw httpError(409, '物品状态已变化，请刷新后重试');
      }
      await conn.query(
        `INSERT INTO swap_plans
         (id,intent_a_id,intent_b_id,item_a_id,item_b_id,user_a_id,user_b_id,status,created_at,confirm_deadline)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [planId, first.id, second.id, first.my_item_id, second.my_item_id, first.user_id, second.user_id, 'pending', now, now + 10 * 60 * 1000]
      );
      const [planRows] = await conn.query('SELECT * FROM swap_plans WHERE id=?', [planId]);
      await addHistory(conn, first.my_item_id, 'swap_locked', 'on_sale', 'locked', first.user_id, '置换匹配，物品锁定');
      await addHistory(conn, second.my_item_id, 'swap_locked', 'on_sale', 'locked', second.user_id, '置换匹配，物品锁定');
      await conn.commit();
      return { intent: { id: first.id, userId: first.user_id, myItemId: first.my_item_id, targetItemId: first.target_item_id, status: 'matched', createdAt: now }, plan: mapSwapPlan(planRows[0]) };
    }
    await conn.commit();
    return { intent: mapSwapIntent({ id: intentId, user_id: user.id, my_item_id: myItemId, target_item_id: targetItemId, status: 'active', created_at: now }) };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function cancelSwapIntent(intentId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM swap_intents WHERE id=? FOR UPDATE', [intentId]);
    const intent = rows[0];
    if (!intent) throw httpError(404, '置换意向不存在');
    if (intent.user_id !== userId) throw httpError(403, '无权取消该意向');
    if (intent.status !== 'active') throw httpError(409, '该意向已匹配或已结束');
    await conn.query("UPDATE swap_intents SET status='cancelled' WHERE id=?", [intentId]);
    await conn.commit();
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function confirmSwapPlan(planId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM swap_plans WHERE id=? FOR UPDATE', [planId]);
    const plan = rows[0];
    if (!plan) throw httpError(404, '置换方案不存在');
    if (plan.user_a_id !== userId && plan.user_b_id !== userId) throw httpError(403, '无权确认该方案');
    if (plan.status === 'completed' || plan.status === 'cancelled') throw httpError(409, '该方案已结束');
    if (plan.status === 'active') {
      await conn.commit();
      return mapSwapPlan(plan);
    }
    if (Number(plan.confirm_deadline) < Date.now()) {
      await cancelSwapPlanTx(conn, plan);
      await conn.commit();
      throw httpError(409, '方案已超时取消，物品已解锁');
    }
    const now = Date.now();
    const isA = plan.user_a_id === userId;
    if (isA && !plan.a_confirmed_at) {
      plan.a_confirmed_at = now;
      await conn.query('UPDATE swap_plans SET a_confirmed_at=? WHERE id=?', [now, planId]);
    }
    if (!isA && !plan.b_confirmed_at) {
      plan.b_confirmed_at = now;
      await conn.query('UPDATE swap_plans SET b_confirmed_at=? WHERE id=?', [now, planId]);
    }
    if (plan.a_confirmed_at && plan.b_confirmed_at) {
      await conn.query("UPDATE swap_plans SET status='active' WHERE id=?", [planId]);
      const [existing] = await conn.query('SELECT id FROM orders WHERE plan_id=? LIMIT 1', [planId]);
      if (!existing.length) {
        const orderA = id('o');
        const orderB = id('o');
        await conn.query(
          `INSERT INTO orders
           (id,item_id,buyer_id,seller_id,amount,status,order_type,plan_id,delivery,created_at,deadline,paid_at,reviewed)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
          [orderA, plan.item_a_id, plan.user_b_id, plan.user_a_id, 0, 'to_deliver', 'swap', planId, '面交', now, now, now]
        );
        await conn.query(
          `INSERT INTO orders
           (id,item_id,buyer_id,seller_id,amount,status,order_type,plan_id,delivery,created_at,deadline,paid_at,reviewed)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
          [orderB, plan.item_b_id, plan.user_a_id, plan.user_b_id, 0, 'to_deliver', 'swap', planId, '面交', now, now, now]
        );
      }
      plan.status = 'active';
    }
    await conn.commit();
    return mapSwapPlan(plan);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function rejectSwapPlan(planId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM swap_plans WHERE id=? FOR UPDATE', [planId]);
    const plan = rows[0];
    if (!plan) throw httpError(404, '置换方案不存在');
    if (plan.user_a_id !== userId && plan.user_b_id !== userId) throw httpError(403, '无权拒绝该方案');
    if (plan.status !== 'pending') throw httpError(409, '该方案已确认或已结束');
    await cancelSwapPlanTx(conn, plan);
    await conn.commit();
    return { ok: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function completeSwapPlan(planId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM swap_plans WHERE id=? FOR UPDATE', [planId]);
    const plan = rows[0];
    if (!plan) throw httpError(404, '置换方案不存在');
    if (plan.user_a_id !== userId && plan.user_b_id !== userId) throw httpError(403, '无权完成该方案');
    if (plan.status !== 'active') throw httpError(409, '双方确认后才能完成置换');
    const [items] = await conn.query(
      'SELECT * FROM items WHERE id IN (?,?) ORDER BY id FOR UPDATE',
      [plan.item_a_id, plan.item_b_id]
    );
    if (items.length !== 2) throw httpError(409, '置换物品不存在');
    const itemA = items.find(i => i.id === plan.item_a_id);
    const itemB = items.find(i => i.id === plan.item_b_id);
    if (!itemA || !itemB || itemA.status !== 'locked' || itemB.status !== 'locked') {
      throw httpError(409, '物品状态已变化，无法完成置换');
    }
    if (itemA.owner_id !== plan.user_a_id || itemB.owner_id !== plan.user_b_id) {
      throw httpError(409, '物品归属已变化，无法完成置换');
    }
    const now = Date.now();
    const [swapA] = await conn.query(
      "UPDATE items SET owner_id=?, status='completed' WHERE id=? AND owner_id=? AND status='locked'",
      [plan.user_b_id, plan.item_a_id, plan.user_a_id]
    );
    const [swapB] = await conn.query(
      "UPDATE items SET owner_id=?, status='completed' WHERE id=? AND owner_id=? AND status='locked'",
      [plan.user_a_id, plan.item_b_id, plan.user_b_id]
    );
    if (swapA.affectedRows !== 1 || swapB.affectedRows !== 1) throw httpError(409, '物品归属已变化，无法完成置换');
    const [orderUpdate] = await conn.query(
      "UPDATE orders SET status='completed', completed_at=? WHERE plan_id=? AND status='to_deliver'",
      [now, planId]
    );
    if (orderUpdate.affectedRows < 2) throw httpError(409, '置换单状态异常，无法完成');
    await conn.query("UPDATE swap_plans SET status='completed', completed_at=? WHERE id=?", [now, planId]);
    await conn.query("UPDATE swap_intents SET status='completed' WHERE id IN (?,?)", [plan.intent_a_id, plan.intent_b_id]);
    await addHistory(conn, plan.item_a_id, 'swap_completed', 'locked', 'completed', userId, '置换完成，归属转给对方');
    await addHistory(conn, plan.item_b_id, 'swap_completed', 'locked', 'completed', userId, '置换完成，归属转给对方');
    await conn.commit();
    plan.status = 'completed';
    plan.completed_at = now;
    return mapSwapPlan(plan);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function createCategory(user, body) {
  requireAdmin(user);
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, '分类名称不能为空');
  const cid = String(body.id || id('cat'));
  const parentId = body.parentId ? String(body.parentId) : null;
  await pool.query(
    `INSERT INTO categories (id,name,parent_id,sort,status,created_at) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), parent_id=VALUES(parent_id), sort=VALUES(sort), status=VALUES(status)`,
    [cid, name.slice(0, 40), parentId, Number(body.sort) || 0, body.status === 'inactive' ? 'inactive' : 'active', Date.now()]
  );
  return mapCategory((await pool.query('SELECT * FROM categories WHERE id=?', [cid]))[0][0]);
}
async function createPickupPoint(user, body) {
  requireAdmin(user);
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, '自提点名称不能为空');
  const pid = String(body.id || id('pp'));
  await pool.query(
    `INSERT INTO pickup_points (id,name,address,contact,status,created_at) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), address=VALUES(address), contact=VALUES(contact), status=VALUES(status)`,
    [pid, name.slice(0, 60), String(body.address || '').slice(0, 120), String(body.contact || '').slice(0, 60), body.status === 'inactive' ? 'inactive' : 'active', Date.now()]
  );
  return mapPickup((await pool.query('SELECT * FROM pickup_points WHERE id=?', [pid]))[0][0]);
}
async function importRoster(user, body) {
  requireAdmin(user);
  const rows = Array.isArray(body.students) ? body.students.slice(0, 500) : [];
  if (!rows.length) throw httpError(400, '没有可导入的学籍记录');
  let count = 0;
  for (const r of rows) {
    const studentNo = String(r.studentNo || '').trim();
    const name = String(r.name || '').trim();
    if (!studentNo || !name) continue;
    await pool.query(
      `INSERT INTO student_roster (student_no,name,college,major,grade,class_name,status,imported_at) VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), college=VALUES(college), major=VALUES(major), grade=VALUES(grade), class_name=VALUES(class_name), status=VALUES(status)`,
      [studentNo, name.slice(0, 40), String(r.college || '').slice(0, 60), String(r.major || '').slice(0, 60), String(r.grade || '').slice(0, 10), String(r.className || '').slice(0, 60), 'active', Date.now()]
    );
    count++;
  }
  return { imported: count };
}
async function submitVerification(user, body) {
  if (user.role !== 'student') throw httpError(403, '只有学生可以认证');
  const studentNo = String(body.studentNo || '').trim();
  const realName = String(body.realName || '').trim();
  if (!studentNo || !realName) throw httpError(400, '请填写学号和姓名');
  const [roster] = await pool.query("SELECT * FROM student_roster WHERE student_no=? AND status='active'", [studentNo]);
  if (!roster[0]) throw httpError(400, '学籍库中找不到该学号');
  if (roster[0].name !== realName) throw httpError(400, '姓名与学籍库不一致');
  const [pending] = await pool.query("SELECT * FROM verification_records WHERE user_id=? AND status='pending' LIMIT 1", [user.id]);
  if (pending[0]) throw httpError(409, '已有待审核的认证申请');
  const vid = id('v');
  await pool.query(
    'INSERT INTO verification_records (id,user_id,student_no,real_name,college,status,reason,reviewed_by,created_at,reviewed_at) VALUES (?,?,?,?,?,?,\'\',NULL,?,NULL)',
    [vid, user.id, studentNo, realName, roster[0].college, 'pending', Date.now()]
  );
  return mapVerification((await pool.query('SELECT * FROM verification_records WHERE id=?', [vid]))[0][0]);
}
async function reviewVerification(user, idValue, body) {
  requireAdmin(user);
  const approve = body.action === 'approve';
  const [rows] = await pool.query('SELECT * FROM verification_records WHERE id=?', [idValue]);
  const rec = rows[0];
  if (!rec) throw httpError(404, '认证申请不存在');
  if (rec.status !== 'pending') throw httpError(409, '该申请已处理');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE verification_records SET status=?, reason=?, reviewed_by=?, reviewed_at=? WHERE id=?", [approve ? 'approved' : 'rejected', String(body.reason || '').slice(0, 200), user.id, Date.now(), idValue]);
    if (approve) {
      await conn.query('UPDATE users SET verified=1, college=? WHERE id=?', [rec.college || '', rec.user_id]);
      await notify(conn, rec.user_id, 'verify', '学籍认证通过', '你的校园身份已认证，可以发布和下单。');
    } else {
      await notify(conn, rec.user_id, 'verify', '学籍认证未通过', String(body.reason || '信息与学籍库不一致'));
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return mapVerification((await pool.query('SELECT * FROM verification_records WHERE id=?', [idValue]))[0][0]);
}
async function toggleFavorite(user, itemId) {
  const [items] = await pool.query("SELECT id FROM items WHERE id=?", [itemId]);
  if (!items[0]) throw httpError(404, '物品不存在');
  const [rows] = await pool.query('SELECT * FROM favorites WHERE user_id=? AND item_id=?', [user.id, itemId]);
  if (rows[0]) {
    await pool.query('DELETE FROM favorites WHERE user_id=? AND item_id=?', [user.id, itemId]);
    return { favorited: false };
  }
  await pool.query('INSERT INTO favorites (id,user_id,item_id,created_at) VALUES (?,?,?,?)', [id('f'), user.id, itemId, Date.now()]);
  return { favorited: true };
}
async function readNotifications(user, body) {
  if (body.id) {
    await pool.query('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL', [Date.now(), String(body.id), user.id]);
  } else {
    await pool.query('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [Date.now(), user.id]);
  }
  return { ok: true };
}
async function createWanted(user, body) {
  if (user.role !== 'student') throw httpError(403, '只有学生可以发布求购');
  const title = String(body.title || '').trim();
  if (title.length < 2) throw httpError(400, '求购标题至少 2 个字');
  const wid = id('w');
  await pool.query(
    'INSERT INTO wanted_posts (id,user_id,title,category_id,keywords,budget_min,budget_max,condition_level,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [wid, user.id, title.slice(0, 80), body.categoryId ? String(body.categoryId) : null, String(body.keywords || '').slice(0, 120), Number(body.budgetMin) || 0, Number(body.budgetMax) || 0, String(body.condition || '90'), 'open', Date.now(), Date.now() + 7 * 86400000]
  );
  return mapWanted((await pool.query('SELECT * FROM wanted_posts WHERE id=?', [wid]))[0][0]);
}
async function createArbitration(user, body) {
  const orderId = String(body.orderId || '');
  const reason = String(body.reason || '').trim();
  if (!reason) throw httpError(400, '请填写仲裁原因');
  const [orders] = await pool.query('SELECT * FROM orders WHERE id=?', [orderId]);
  const order = orders[0];
  if (!order) throw httpError(404, '订单不存在');
  if (order.buyer_id !== user.id && order.seller_id !== user.id) throw httpError(403, '只能对自己的订单申请仲裁');
  if (order.status !== 'completed' && order.status !== 'to_confirm') throw httpError(409, '当前订单状态不能申请仲裁');
  const aid = id('ar');
  await pool.query(
    'INSERT INTO arbitration_requests (id,order_id,applicant_id,reason,evidence,status,result,operator_id,created_at,decided_at) VALUES (?,?,?,?,?,?,\'\',NULL,?,NULL)',
    [aid, orderId, user.id, reason.slice(0, 500), String(body.evidence || '').slice(0, 1000), 'pending', Date.now()]
  );
  const [admins] = await pool.query("SELECT id FROM users WHERE role='admin'");
  for (const a of admins) await notify(pool, a.id, 'arbitration', '新的仲裁申请', `订单 ${orderId} 申请仲裁：${reason}`);
  return mapArbitration((await pool.query('SELECT * FROM arbitration_requests WHERE id=?', [aid]))[0][0]);
}
async function decideArbitration(user, idValue, body) {
  requireAdmin(user);
  const [rows] = await pool.query('SELECT * FROM arbitration_requests WHERE id=?', [idValue]);
  const rec = rows[0];
  if (!rec) throw httpError(404, '仲裁申请不存在');
  if (rec.status !== 'pending') throw httpError(409, '该申请已处理');
  const status = ['support', 'support_buyer', 'support_seller'].includes(body.action) ? 'supported' : 'rejected';
  await pool.query('UPDATE arbitration_requests SET status=?, result=?, operator_id=?, decided_at=? WHERE id=?', [status, String(body.result || '').slice(0, 500), user.id, Date.now(), idValue]);
  await notify(pool, rec.applicant_id, 'arbitration', '仲裁结果已出', String(body.result || '运营已完成仲裁'));
  return mapArbitration((await pool.query('SELECT * FROM arbitration_requests WHERE id=?', [idValue]))[0][0]);
}

async function resetData() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM delivery_records');
    await conn.query('DELETE FROM arbitration_requests');
    await conn.query('DELETE FROM credit_records');
    await conn.query('DELETE FROM notifications');
    await conn.query('DELETE FROM favorites');
    await conn.query('DELETE FROM wanted_posts');
    await conn.query('DELETE FROM verification_records');
    await conn.query('DELETE FROM reviews');
    await conn.query('DELETE FROM payments');
    await conn.query('DELETE FROM audits');
    await conn.query('DELETE FROM item_history');
    await conn.query('DELETE FROM item_images');
    await conn.query('DELETE FROM swap_plans');
    await conn.query('DELETE FROM swap_intents');
    await conn.query('DELETE FROM orders');
    await conn.query('DELETE FROM items');
    await conn.query('DELETE FROM users');
    await conn.query("UPDATE platform_accounts SET escrow_balance=0,total_in=0,total_out=0,updated_at=? WHERE account_type='escrow'", [Date.now()]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await seed();
  await ensureLookupData();
}

async function syncState(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.users) || !Array.isArray(snapshot.items)) {
    throw httpError(400, '同步数据格式不正确');
  }
  const users = snapshot.users;
  const items = snapshot.items;
  const orders = Array.isArray(snapshot.orders) ? snapshot.orders : [];
  const payments = Array.isArray(snapshot.tx) ? snapshot.tx : [];
  const reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews : [];
  const audits = Array.isArray(snapshot.audits) ? snapshot.audits : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM reviews');
    await conn.query('DELETE FROM payments');
    await conn.query('DELETE FROM audits');
    await conn.query('DELETE FROM item_history');
    await conn.query('DELETE FROM orders');
    await conn.query('DELETE FROM swap_plans');
    await conn.query('DELETE FROM swap_intents');
    await conn.query('DELETE FROM items');
    if (users.length) {
      const userRows = [];
      for (const u of users) {
        const rawPassword = String(u.password || '123456');
        const passwordHash = isBcryptHash(rawPassword) ? rawPassword : await hashPassword(rawPassword);
        userRows.push([u.id, u.username, passwordHash, u.name, u.college || '', u.role || 'student', u.verified ? 1 : 0, u.credit || 80, Number(u.balance) || 0, Number(u.createdAt) || Date.now()]);
      }
      await conn.query(
        `INSERT INTO users (id,username,password,name,college,role,verified,credit,balance,created_at) VALUES ?
         ON DUPLICATE KEY UPDATE name=VALUES(name), college=VALUES(college), role=VALUES(role),
         verified=VALUES(verified), credit=VALUES(credit), balance=VALUES(balance)`,
        [userRows]
      );
    }
    if (items.length) {
      await conn.query(
        'INSERT INTO items (id,owner_id,title,category,price,original_price,condition_level,description,delivery,status,created_at,views,reject_reason) VALUES ?',
        [items.map(i => [i.id, i.ownerId, i.title, i.category, Number(i.price), Number(i.originalPrice), i.condition, i.description || '', i.delivery || '面交/自提', i.status, Number(i.createdAt) || Date.now(), Number(i.views) || 0, i.rejectReason || null])]
      );
    }
    if (orders.length) {
      await conn.query(
        'INSERT INTO orders (id,item_id,buyer_id,seller_id,amount,status,delivery,created_at,deadline,paid_at,delivered_at,completed_at,cancelled_at,reviewed) VALUES ?',
        [orders.map(o => [o.id, o.itemId, o.buyerId, o.sellerId, Number(o.amount), o.status, o.delivery || '面交', Number(o.createdAt) || Date.now(), Number(o.deadline) || Date.now() + 30000, o.paidAt || null, o.deliveredAt || null, o.completedAt || null, o.cancelledAt || null, o.reviewed ? 1 : 0])]
      );
    }
    if (payments.length) {
      await conn.query(
        'INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES ?',
        [payments.map(t => [t.id, t.userId || null, t.orderId || null, t.type, Number(t.amount), t.note || '', Number(t.at) || Date.now()])]
      );
    }
    if (reviews.length) {
      await conn.query(
        'INSERT INTO reviews (id,order_id,buyer_id,seller_id,rating,text,at) VALUES ?',
        [reviews.map(r => [r.id, r.orderId, r.buyerId, r.sellerId, Number(r.rating) || 5, r.text || '', Number(r.at) || Date.now()])]
      );
    }
    if (audits.length) {
      await conn.query(
        'INSERT INTO audits (id,item_id,result,reason,operator_id,at) VALUES ?',
        [audits.map(a => [a.id, a.itemId, a.result, a.reason || '', a.operatorId || 'admin', Number(a.at) || Date.now()])]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function routeApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, service: 'shiguangji-mysql' });
  if (p === '/api/bootstrap' && req.method === 'GET') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await bootstrap(user), { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/login' && req.method === 'POST') {
    const user = await login(await readBody(req));
    return sendJson(res, 200, { user }, {
      'Set-Cookie': sessionCookie(signSession(user)),
      'Cache-Control': 'no-store'
    });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': sessionCookie('', 0),
      'Cache-Control': 'no-store'
    });
  }
  if (p === '/api/me' && req.method === 'GET') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { user }, { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/register' && req.method === 'POST') {
    const user = await register(await readBody(req));
    return sendJson(res, 200, { user }, {
      'Set-Cookie': sessionCookie(signSession(user)),
      'Cache-Control': 'no-store'
    });
  }
  if (p === '/api/items' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { item: await publishItem(user, await readBody(req)) });
  }
  if (p === '/api/orders' && req.method === 'POST') {
    const buyer = await requireAuth(req);
    return sendJson(res, 200, { order: await createOrder(await readBody(req), buyer) });
  }
  const m = p.match(/^\/api\/items\/([^/]+)\/(approve|reject)$/);
  if (m && req.method === 'POST') {
    const operator = await requireAuth(req);
    requireAdmin(operator);
    const body = await readBody(req);
    if (m[2] === 'approve') return sendJson(res, 200, { item: await approveItem(m[1], operator) });
    return sendJson(res, 200, { item: await rejectItem(m[1], operator, body.reason) });
  }
  const o = p.match(/^\/api\/orders\/([^/]+)\/(pay|cancel|deliver|confirm)$/);
  if (o && req.method === 'POST') {
    const user = await requireAuth(req);
    if (o[2] === 'pay') return sendJson(res, 200, { order: await payOrder(o[1], user.id) });
    if (o[2] === 'cancel') return sendJson(res, 200, { order: await cancelOrder(o[1], user.id) });
    if (o[2] === 'deliver') return sendJson(res, 200, { order: await deliverOrder(o[1], user.id) });
    return sendJson(res, 200, { order: await confirmOrder(o[1], user.id) });
  }
  if (p === '/api/swaps/intents' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await createSwapIntent(user, await readBody(req)));
  }
  const si = p.match(/^\/api\/swaps\/intents\/([^/]+)\/cancel$/);
  if (si && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await cancelSwapIntent(si[1], user.id));
  }
  const sp = p.match(/^\/api\/swaps\/plans\/([^/]+)\/(confirm|reject|complete)$/);
  if (sp && req.method === 'POST') {
    const user = await requireAuth(req);
    if (sp[2] === 'confirm') return sendJson(res, 200, { plan: await confirmSwapPlan(sp[1], user.id) });
    if (sp[2] === 'reject') return sendJson(res, 200, await rejectSwapPlan(sp[1], user.id));
    return sendJson(res, 200, { plan: await completeSwapPlan(sp[1], user.id) });
  }
  if (p === '/api/reviews' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await reviewOrder(await readBody(req), user.id));
  }
  if (p === '/api/wallet/recharge' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { user: await recharge(user) });
  }
  if (p === '/api/categories' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { category: await createCategory(user, await readBody(req)) });
  }
  if (p === '/api/admin/pickup-points' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { pickupPoint: await createPickupPoint(user, await readBody(req)) });
  }
  if (p === '/api/admin/roster/import' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await importRoster(user, await readBody(req)));
  }
  if (p === '/api/verifications' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { verification: await submitVerification(user, await readBody(req)) });
  }
  const vr = p.match(/^\/api\/admin\/verifications\/([^/]+)\/review$/);
  if (vr && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { verification: await reviewVerification(user, vr[1], await readBody(req)) });
  }
  const fav = p.match(/^\/api\/favorites\/([^/]+)\/toggle$/);
  if (fav && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await toggleFavorite(user, fav[1]));
  }
  if (p === '/api/notifications/read' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, await readNotifications(user, await readBody(req)));
  }
  if (p === '/api/wanted' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { wanted: await createWanted(user, await readBody(req)) });
  }
  if (p === '/api/arbitrations' && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { arbitration: await createArbitration(user, await readBody(req)) });
  }
  const arb = p.match(/^\/api\/admin\/arbitrations\/([^/]+)\/decide$/);
  if (arb && req.method === 'POST') {
    const user = await requireAuth(req);
    return sendJson(res, 200, { arbitration: await decideArbitration(user, arb[1], await readBody(req)) });
  }
  if (p === '/api/sync' && req.method === 'POST') {
    // 正常业务已改为按接口写入；整体快照会删全库，默认关闭。
    if (process.env.ALLOW_SYNC !== 'true') throw httpError(404, '接口不存在');
    const operator = await requireAuth(req);
    requireAdmin(operator);
    const body = await readBody(req);
    await syncState(body.db);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/reset' && req.method === 'POST') {
    // 生产环境默认禁用清库；本地演示保留，线上要显式 ALLOW_RESET=true。
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_RESET !== 'true') {
      throw httpError(403, '生产环境已禁用重置');
    }
    const operator = await requireAuth(req);
    requireAdmin(operator);
    const body = await readBody(req);
    if (body.confirm !== 'RESET') throw httpError(400, '缺少重置确认');
    await resetData();
    return sendJson(res, 200, { ok: true });
  }
  throw httpError(404, '接口不存在');
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(httpError(413, '请求体过大')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(httpError(400, '请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(__dirname, 'public', pathname));
  const root = path.join(__dirname, 'public');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    sendJson(res, status, { error: e.message || '服务器错误' });
  }
});

server.once('listening', () => {
  const actualPort = server.address().port;
  console.log(`拾光集 MySQL 后端已启动：http://127.0.0.1:${actualPort}`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    exec(`start "" http://127.0.0.1:${actualPort}`);
  }
});

function listenWithFallback(port, attempt = 0) {
  server.listen(port, '0.0.0.0');
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.warn(`端口 ${port} 已被占用，尝试 ${port + 1} ...`);
      setTimeout(() => listenWithFallback(port + 1, attempt + 1), 120);
    } else {
      console.error('服务启动失败：', err.message);
      process.exit(1);
    }
  });
}
init().then(() => {
  listenWithFallback(BASE_PORT);
}).catch((e) => {
  console.error('启动失败：', e.message);
  console.error('请确认 MySQL80 已启动，并已创建 shiguangji 数据库和 shiguang 用户。');
  process.exit(1);
});
