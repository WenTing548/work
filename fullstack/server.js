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
function mapItem(r) {
  return {
    id: r.id, ownerId: r.owner_id, title: r.title, category: r.category,
    price: Number(r.price), originalPrice: Number(r.original_price),
    condition: r.condition_level, description: r.description,
    delivery: r.delivery, status: r.status, createdAt: n(r.created_at),
    views: r.views, rejectReason: r.reject_reason || ''
  };
}
function mapOrder(r) {
  return {
    id: r.id, itemId: r.item_id, buyerId: r.buyer_id, sellerId: r.seller_id,
    amount: Number(r.amount), status: r.status, delivery: r.delivery,
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

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM users');
  if (Number(row.c) === 0) await seed();
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

async function bootstrap(userId) {
  const [users] = await pool.query('SELECT id,username,name,college,role,verified,credit,balance,created_at FROM users ORDER BY created_at');
  const [items] = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
  const [orders] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  const [payments] = await pool.query('SELECT * FROM payments ORDER BY at DESC');
  const [reviews] = await pool.query('SELECT * FROM reviews ORDER BY at DESC');
  const [audits] = await pool.query('SELECT * FROM audits ORDER BY at DESC');
  const safeUsers = users.map(mapUser);
  const user = userId ? safeUsers.find(u => u.id === userId) || null : null;
  return {
    db: {
      users: safeUsers,
      items: items.map(mapItem),
      orders: orders.map(mapOrder),
      reviews: reviews.map(mapReview),
      tx: payments.map(mapPayment),
      audits: audits.map(mapAudit)
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

async function publishItem(body) {
  const user = await requireUser(body.ownerId);
  if (user.role !== 'student') throw httpError(403, '运营账号不能发布物品');
  const title = String(body.title || '').trim();
  const price = Number(body.price);
  if (title.length < 2) throw httpError(400, '标题至少 2 个字');
  if (!price || price <= 0) throw httpError(400, '请输入有效售价');
  const itemId = id('i');
  const now = Date.now();
  await pool.query(
    'INSERT INTO items (id,owner_id,title,category,price,original_price,condition_level,description,delivery,status,created_at,views) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)',
    [itemId, user.id, title, String(body.category || '教材'), price, Number(body.originalPrice) || price, String(body.condition || '90'), String(body.description || ''), String(body.delivery || '面交/自提'), 'pending', now]
  );
  const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [itemId]);
  return mapItem(rows[0]);
}

async function approveItem(itemId, operatorId) {
  const operator = await requireUser(operatorId);
  if (operator.role !== 'admin') throw httpError(403, '只有运营可以审核');
  const [items] = await pool.query('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!items[0]) throw httpError(404, '物品不存在');
  if (items[0].status !== 'pending') throw httpError(409, '该物品不在待审核状态');
  await pool.query("UPDATE items SET status='on_sale' WHERE id=?", [itemId]);
  await pool.query('INSERT INTO audits (id,item_id,result,reason,operator_id,at) VALUES (?,?,?,?,?,?)', [id('a'), itemId, '通过', '', operator.id, Date.now()]);
  const [rows] = await pool.query('SELECT * FROM items WHERE id=?', [itemId]);
  return mapItem(rows[0]);
}

async function rejectItem(itemId, operatorId, reason) {
  const operator = await requireUser(operatorId);
  if (operator.role !== 'admin') throw httpError(403, '只有运营可以审核');
  const [items] = await pool.query('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!items[0]) throw httpError(404, '物品不存在');
  if (items[0].status !== 'pending') throw httpError(409, '该物品不在待审核状态');
  await pool.query("UPDATE items SET status='rejected', reject_reason=? WHERE id=?", [reason || '未填写原因', itemId]);
  await pool.query('INSERT INTO audits (id,item_id,result,reason,operator_id,at) VALUES (?,?,?,?,?,?)', [id('a'), itemId, '驳回', reason || '未填写原因', operator.id, Date.now()]);
  const [rows] = await pool.query('SELECT * FROM items WHERE id=?', [itemId]);
  return mapItem(rows[0]);
}

async function requireUser(userId) {
  if (!userId) throw httpError(401, '请先登录');
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows[0]) throw httpError(401, '用户不存在');
  return rows[0];
}

async function createOrder(body) {
  const buyer = await requireUser(body.buyerId);
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
    const orderId = id('o');
    const now = Date.now();
    await conn.query('INSERT INTO orders (id,item_id,buyer_id,seller_id,amount,status,delivery,created_at,deadline,reviewed) VALUES (?,?,?,?,?,?,?,?,?,0)', [orderId, itemId, buyer.id, item.owner_id, item.price, 'unpaid', item.delivery, now, now + 30000]);
    await conn.query("UPDATE items SET status='locked' WHERE id=?", [itemId]);
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
    if (order.buyer_id !== userId) throw httpError(403, '无权支付该订单');
    if (order.status !== 'unpaid') throw httpError(409, '订单状态不允许支付');
    if (Number(order.deadline) < Date.now()) {
      await conn.query("UPDATE orders SET status='cancelled', cancelled_at=? WHERE id=?", [Date.now(), orderId]);
      await conn.query("UPDATE items SET status='on_sale' WHERE id=? AND status='locked'", [order.item_id]);
      await conn.commit();
      throw httpError(409, '订单已超时取消，请重新下单');
    }
    const [users] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [userId]);
    const buyer = users[0];
    if (Number(buyer.balance) < Number(order.amount)) throw httpError(400, '余额不足');
    await conn.query('UPDATE users SET balance = balance - ? WHERE id=?', [order.amount, userId]);
    await conn.query("UPDATE orders SET status='to_deliver', paid_at=? WHERE id=?", [Date.now(), orderId]);
    await conn.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), userId, orderId, '支付', order.amount, '订单 ' + orderId + ' · 平台托管', Date.now()]);
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

async function cancelOrder(orderId, userId, auto) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) throw httpError(404, '订单不存在');
    if (!auto && order.buyer_id !== userId) throw httpError(403, '无权取消该订单');
    if (order.status !== 'unpaid') throw httpError(409, '订单状态不允许取消');
    await conn.query("UPDATE orders SET status='cancelled', cancelled_at=? WHERE id=?", [Date.now(), orderId]);
    await conn.query("UPDATE items SET status='on_sale' WHERE id=? AND status='locked'", [order.item_id]);
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
  const [orders] = await pool.query('SELECT * FROM orders WHERE id=?', [orderId]);
  const order = orders[0];
  if (!order) throw httpError(404, '订单不存在');
  if (order.seller_id !== userId) throw httpError(403, '只有卖家可以确认交付');
  if (order.status !== 'to_deliver') throw httpError(409, '订单状态不允许交付');
  await pool.query("UPDATE orders SET status='to_confirm', delivered_at=? WHERE id=?", [Date.now(), orderId]);
  const [rows] = await pool.query('SELECT * FROM orders WHERE id=?', [orderId]);
  return mapOrder(rows[0]);
}

async function confirmOrder(orderId, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order) throw httpError(404, '订单不存在');
    if (order.buyer_id !== userId) throw httpError(403, '只有买家可以确认收货');
    if (order.status !== 'to_confirm') throw httpError(409, '订单状态不允许确认');
    await conn.query("UPDATE orders SET status='completed', completed_at=? WHERE id=?", [Date.now(), orderId]);
    await conn.query("UPDATE items SET status='completed' WHERE id=?", [order.item_id]);
    await conn.query('UPDATE users SET balance = balance + ?, credit = LEAST(100, credit + 2) WHERE id=?', [order.amount, order.seller_id]);
    await conn.query('UPDATE users SET credit = LEAST(100, credit + 2) WHERE id=?', [order.buyer_id]);
    await conn.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), order.seller_id, orderId, '放款', order.amount, '订单 ' + orderId + ' · 托管放款', Date.now()]);
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

async function reviewOrder(body) {
  const { orderId, userId, rating, text } = body;
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

async function recharge(body) {
  const user = await requireUser(body.userId);
  if (user.role !== 'student') throw httpError(403, '运营账号没有钱包');
  const amount = 100;
  await pool.query('UPDATE users SET balance = balance + ? WHERE id=?', [amount, user.id]);
  await pool.query('INSERT INTO payments (id,user_id,order_id,type,amount,note,at) VALUES (?,?,?,?,?,?,?)', [id('t'), user.id, null, '充值', amount, '模拟充值', Date.now()]);
  const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [user.id]);
  return mapUser(rows[0]);
}

async function resetData() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM reviews');
    await conn.query('DELETE FROM payments');
    await conn.query('DELETE FROM audits');
    await conn.query('DELETE FROM orders');
    await conn.query('DELETE FROM items');
    await conn.query('DELETE FROM users');
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await seed();
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
    await conn.query('DELETE FROM orders');
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
  if (p === '/api/bootstrap' && req.method === 'GET') return sendJson(res, 200, await bootstrap(url.searchParams.get('userId')));
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
    const user = await getAuthUser(req);
    if (!user) throw httpError(401, '请先登录');
    return sendJson(res, 200, { user }, { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/register' && req.method === 'POST') return sendJson(res, 200, { user: await register(await readBody(req)) });
  if (p === '/api/items' && req.method === 'POST') return sendJson(res, 200, { item: await publishItem(await readBody(req)) });
  if (p === '/api/orders' && req.method === 'POST') return sendJson(res, 200, { order: await createOrder(await readBody(req)) });
  const m = p.match(/^\/api\/items\/([^/]+)\/(approve|reject)$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    if (m[2] === 'approve') return sendJson(res, 200, { item: await approveItem(m[1], body.operatorId) });
    return sendJson(res, 200, { item: await rejectItem(m[1], body.operatorId, body.reason) });
  }
  const o = p.match(/^\/api\/orders\/([^/]+)\/(pay|cancel|deliver|confirm)$/);
  if (o && req.method === 'POST') {
    const body = await readBody(req);
    if (o[2] === 'pay') return sendJson(res, 200, { order: await payOrder(o[1], body.userId) });
    if (o[2] === 'cancel') return sendJson(res, 200, { order: await cancelOrder(o[1], body.userId, !!body.auto) });
    if (o[2] === 'deliver') return sendJson(res, 200, { order: await deliverOrder(o[1], body.userId) });
    return sendJson(res, 200, { order: await confirmOrder(o[1], body.userId) });
  }
  if (p === '/api/reviews' && req.method === 'POST') return sendJson(res, 200, await reviewOrder(await readBody(req)));
  if (p === '/api/wallet/recharge' && req.method === 'POST') return sendJson(res, 200, { user: await recharge(await readBody(req)) });
  if (p === '/api/sync' && req.method === 'POST') {
    const body = await readBody(req);
    await syncState(body.db);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/reset' && req.method === 'POST') {
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
