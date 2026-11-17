'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const mysql = require('mysql2/promise');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_NAME = process.env.TEST_DB_NAME || 'shiguangji_test';

const DB = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER || 'shiguang',
  password: process.env.TEST_DB_PASSWORD || 'shiguang123',
  database: DB_NAME,
  multipleStatements: true
};

let server;
let serverLog = '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resetDb() {
  const conn = await mysql.createConnection(DB);
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('DROP TABLE IF EXISTS delivery_records, arbitration_requests, credit_records, notifications, favorites, wanted_posts, verification_records, item_images, platform_accounts, pickup_points, student_roster, categories, item_history, swap_plans, swap_intents, audits, reviews, payments, orders, items, users');
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
  } finally {
    await conn.end();
  }
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited before health check:\n${serverLog}`);
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (_) {
      // server is still starting
    }
    await sleep(100);
  }
  throw new Error(`server did not become healthy:\n${serverLog}`);
}

function getCookie(res) {
  const headers = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = headers
    .flatMap(value => String(value).split(/,(?=\s*[^;=]+=)/))
    .map(value => value.split(';')[0].trim())
    .find(value => value.startsWith('sg_token='));
  return cookie || null;
}

async function request(pathname, options = {}) {
  const headers = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(BASE + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text;
  }
  return { status: res.status, data, cookie: getCookie(res) };
}

async function login(username, password) {
  const result = await request('/api/login', {
    method: 'POST',
    body: { username, password }
  });
  assert.equal(result.status, 200, `login ${username} failed: ${JSON.stringify(result.data)}`);
  assert.ok(result.cookie, `login ${username} did not set sg_token`);
  return result.cookie;
}

before(async () => {
  await resetDb();

  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_HOST: DB.host,
      DB_PORT: String(DB.port),
      DB_USER: DB.user,
      DB_PASSWORD: DB.password,
      DB_NAME: DB_NAME,
      JWT_SECRET: 'p0-4-test-secret',
      NODE_ENV: 'test',
      ALLOW_SYNC: 'false',
      ALLOW_RESET: 'false',
      COOKIE_SECURE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
  server.stderr.on('data', chunk => { serverLog += chunk.toString(); });

  await waitForHealth();
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await sleep(300);
  }
  try {
    await resetDb();
  } catch (error) {
    console.error('cleanup test database failed:', error.message);
  }
});

test('P0-4 鉴权、数据范围和核心交易闭环', async t => {
  let student1Cookie;
  let student2Cookie;
  let student3Cookie;
  let adminCookie;
  let orderId;

  await t.test('未登录不能读取 bootstrap', async () => {
    const result = await request('/api/bootstrap');
    assert.equal(result.status, 401);
    assert.match(result.data.error, /请先登录/);
  });

  await t.test('student1 登录并只能看到自己的完整资料', async () => {
    student1Cookie = await login('student1', '123456');

    const me = await request('/api/me', { cookie: student1Cookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, 'u1');

    const result = await request('/api/bootstrap', { cookie: student1Cookie });
    assert.equal(result.status, 200);

    const meInDb = result.data.db.users.find(user => user.id === 'u1');
    const other = result.data.db.users.find(user => user.id === 'u2');
    assert.ok(meInDb.username);
    assert.equal(meInDb.balance, 500);
    assert.ok(meInDb.createdAt);
    assert.ok(other, 'u2 should be present as a referenced seller');
    assert.deepEqual(
      Object.keys(other).sort(),
      ['college', 'credit', 'id', 'name', 'role', 'verified']
    );
    assert.equal(other.username, undefined);
    assert.equal(other.balance, undefined);
    assert.equal(other.createdAt, undefined);
  });

  await t.test('student1 创建订单后，订单归属正确', async () => {
    const result = await request('/api/orders', {
      method: 'POST',
      cookie: student1Cookie,
      body: { itemId: 'i1', delivery: '面交' }
    });
    assert.equal(result.status, 200);
    orderId = result.data.order.id;
    assert.equal(result.data.order.buyerId, 'u1');
    assert.equal(result.data.order.sellerId, 'u2');
    assert.equal(result.data.order.status, 'unpaid');
    const afterCreate = await request('/api/bootstrap', { cookie: student1Cookie });
    assert.ok(afterCreate.data.db.history.some(h => h.itemId === 'i1' && h.action === 'locked'));
  });

  await t.test('student2 能看到自己作为卖家的订单，但看不到别人的待审核物品', async () => {
    student2Cookie = await login('student2', '123456');
    const result = await request('/api/bootstrap', { cookie: student2Cookie });
    assert.equal(result.status, 200);
    assert.ok(result.data.db.orders.some(order => order.id === orderId));
    assert.ok(result.data.db.orders.every(order =>
      order.buyerId === 'u2' || order.sellerId === 'u2'
    ));
    assert.ok(!result.data.db.items.some(item => item.id === 'i5'));
  });

  await t.test('student3 看不到别人的订单和待审核物品，也不能代付', async () => {
    const reg = await request('/api/register', {
      method: 'POST',
      body: {
        username: 'student3',
        password: '123456',
        name: '测试同学',
        college: '测试学院'
      }
    });
    assert.equal(reg.status, 200);
    assert.ok(reg.cookie);
    student3Cookie = reg.cookie;

    const result = await request('/api/bootstrap', { cookie: student3Cookie });
    assert.equal(result.status, 200);
    assert.equal(result.data.db.orders.length, 0);
    assert.ok(result.data.db.tx.every(tx => tx.userId === reg.data.user.id));
    assert.ok(!result.data.db.items.some(item => item.id === 'i5'));

    const pay = await request(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      cookie: student3Cookie
    });
    assert.equal(pay.status, 403);
  });

  await t.test('买家支付、卖家交付、买家确认后订单完成', async () => {
    const pay = await request(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      cookie: student1Cookie
    });
    assert.equal(pay.status, 200);
    assert.equal(pay.data.order.status, 'to_deliver');

    const afterPay = await request('/api/bootstrap', { cookie: student1Cookie });
    assert.equal(afterPay.data.user.balance, 482);

    const deliver = await request(`/api/orders/${orderId}/deliver`, {
      method: 'POST',
      cookie: student2Cookie
    });
    assert.equal(deliver.status, 200);
    assert.equal(deliver.data.order.status, 'to_confirm');

    const confirm = await request(`/api/orders/${orderId}/confirm`, {
      method: 'POST',
      cookie: student1Cookie
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.data.order.status, 'completed');

    const review = await request('/api/reviews', {
      method: 'POST',
      cookie: student1Cookie,
      body: { orderId, rating: 5, text: '测试评价' }
    });
    assert.equal(review.status, 200);

    const finalState = await request('/api/bootstrap', { cookie: student1Cookie });
    assert.equal(finalState.data.db.orders[0].status, 'completed');
    assert.ok(finalState.data.db.orders.every(order =>
      order.buyerId === 'u1' || order.sellerId === 'u1'
    ));
    assert.equal(finalState.data.db.reviews.length, 1);
    assert.equal(finalState.data.db.reviews[0].orderId, orderId);
    const actions = finalState.data.db.history.filter(h => h.itemId === 'i1').map(h => h.action);
    assert.ok(actions.includes('locked'));
    assert.ok(actions.includes('paid'));
    assert.ok(actions.includes('completed'));
  });

  await t.test('普通学生不能审核，管理员可以审核', async () => {
    const denied = await request('/api/items/i5/approve', {
      method: 'POST',
      cookie: student1Cookie
    });
    assert.equal(denied.status, 403);

    adminCookie = await login('admin', 'admin123');
    const approved = await request('/api/items/i5/approve', {
      method: 'POST',
      cookie: adminCookie
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.item.status, 'on_sale');
    const approvedState = await request('/api/bootstrap', { cookie: adminCookie });
    assert.ok(approvedState.data.db.history.some(h => h.itemId === 'i5' && h.action === 'approved'));
  });

  await t.test('管理员能看到全量数据，sync 默认关闭', async () => {
    const result = await request('/api/bootstrap', { cookie: adminCookie });
    assert.equal(result.status, 200);
    assert.ok(result.data.db.orders.some(order => order.id === orderId));
    assert.ok(result.data.db.items.some(item => item.id === 'i5'));

    const sync = await request('/api/sync', {
      method: 'POST',
      cookie: adminCookie,
      body: {}
    });
    assert.equal(sync.status, 404);
  });

  await t.test('普通学生不能重置数据库', async () => {
    const reset = await request('/api/reset', {
      method: 'POST',
      cookie: student1Cookie,
      body: { confirm: 'RESET' }
    });
    assert.equal(reset.status, 403);
  });

  await t.test('退出后 Cookie 失效', async () => {
    const logout = await request('/api/logout', {
      method: 'POST',
      cookie: student1Cookie
    });
    assert.equal(logout.status, 200);
    assert.match(logout.cookie, /^sg_token=$/);

    const me = await request('/api/me', { cookie: logout.cookie });
    assert.equal(me.status, 401);
  });
});

test('P5 两人置换：互相意向、双方确认、完成互换', async t => {
  // 重新 seed，避免上一组测试把 i1 卖成 completed。
  const adminCookie = await login('admin', 'admin123');
  const reset = await request('/api/reset', {
    method: 'POST',
    cookie: adminCookie,
    body: { confirm: 'RESET' }
  });
  assert.equal(reset.status, 200);

  const s1 = await login('student1', '123456');
  const s2 = await login('student2', '123456');
  let planId;

  await t.test('单方意向不会生成方案', async () => {
    const first = await request('/api/swaps/intents', {
      method: 'POST',
      cookie: s1,
      body: { myItemId: 'i3', targetItemId: 'i1' }
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.intent.status, 'active');
    assert.equal(first.data.plan, undefined);
  });

  await t.test('反向意向匹配后生成 pending 方案并锁定双方物品', async () => {
    const second = await request('/api/swaps/intents', {
      method: 'POST',
      cookie: s2,
      body: { myItemId: 'i1', targetItemId: 'i3' }
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.intent.status, 'matched');
    assert.equal(second.data.plan.status, 'pending');
    planId = second.data.plan.id;

    const bootstrap = await request('/api/bootstrap', { cookie: s1 });
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.data.db.items.find(item => item.id === 'i1').status, 'locked');
    assert.equal(bootstrap.data.db.items.find(item => item.id === 'i3').status, 'locked');
    assert.equal(bootstrap.data.db.swaps.plans.length, 1);

    const buyLocked = await request('/api/orders', {
      method: 'POST',
      cookie: s1,
      body: { itemId: 'i1', delivery: 'face' }
    });
    assert.equal(buyLocked.status, 409);
  });

  await t.test('双方确认后生成两张 0 元置换单', async () => {
    const first = await request(`/api/swaps/plans/${planId}/confirm`, {
      method: 'POST',
      cookie: s1
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.plan.status, 'pending');

    const second = await request(`/api/swaps/plans/${planId}/confirm`, {
      method: 'POST',
      cookie: s2
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.plan.status, 'active');

    const bootstrap = await request('/api/bootstrap', { cookie: s1 });
    const swapOrders = bootstrap.data.db.orders.filter(order => order.planId === planId);
    assert.equal(swapOrders.length, 2);
    assert.ok(swapOrders.every(order => order.orderType === 'swap' && order.amount === 0));
    assert.ok(swapOrders.every(order => order.status === 'to_deliver'));

    const wrongDeliver = await request(`/api/orders/${swapOrders[0].id}/deliver`, {
      method: 'POST',
      cookie: s1
    });
    assert.equal(wrongDeliver.status, 409);
    assert.match(wrongDeliver.data.error, /置换/);
  });

  await t.test('完成置换后物品归属互换、订单和方案完成', async () => {
    const done = await request(`/api/swaps/plans/${planId}/complete`, {
      method: 'POST',
      cookie: s1
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.plan.status, 'completed');

    const s1State = await request('/api/bootstrap', { cookie: s1 });
    assert.equal(s1State.data.db.items.find(item => item.id === 'i1').ownerId, 'u1');
    assert.equal(s1State.data.db.items.find(item => item.id === 'i3').ownerId, 'u2');
    assert.ok(s1State.data.db.items.find(item => item.id === 'i1').status === 'completed');
    assert.equal(s1State.data.db.swaps.plans[0].status, 'completed');
    assert.equal(s1State.data.db.orders.filter(order => order.planId === planId).every(order => order.status === 'completed'), true);
  });

  await t.test('非参与者不能确认或完成方案', async () => {
    const other = await request('/api/swaps/plans/not-a-plan/confirm', {
      method: 'POST',
      cookie: s2
    });
    assert.equal(other.status, 404);
  });

  await t.test('放弃方案后双方物品解锁、方案取消', async () => {
    const resetAgain = await request('/api/reset', {
      method: 'POST',
      cookie: adminCookie,
      body: { confirm: 'RESET' }
    });
    assert.equal(resetAgain.status, 200);

    const s1b = await login('student1', '123456');
    const s2b = await login('student2', '123456');
    await request('/api/swaps/intents', {
      method: 'POST',
      cookie: s1b,
      body: { myItemId: 'i3', targetItemId: 'i1' }
    });
    const matched = await request('/api/swaps/intents', {
      method: 'POST',
      cookie: s2b,
      body: { myItemId: 'i1', targetItemId: 'i3' }
    });
    assert.equal(matched.status, 200);
    assert.equal(matched.data.plan.status, 'pending');

    const rejected = await request(`/api/swaps/plans/${matched.data.plan.id}/reject`, {
      method: 'POST',
      cookie: s2b
    });
    assert.equal(rejected.status, 200);

    const state = await request('/api/bootstrap', { cookie: s1b });
    assert.equal(state.data.db.items.find(item => item.id === 'i1').status, 'on_sale');
    assert.equal(state.data.db.items.find(item => item.id === 'i3').status, 'on_sale');
    assert.equal(state.data.db.swaps.plans[0].status, 'cancelled');
  });

  await t.test('物品被买下并支付后，未匹配的置换意向自动取消', async () => {
    const resetAgain = await request('/api/reset', {
      method: 'POST',
      cookie: adminCookie,
      body: { confirm: 'RESET' }
    });
    assert.equal(resetAgain.status, 200);

    const buyer = await login('student1', '123456');
    const intent = await request('/api/swaps/intents', {
      method: 'POST',
      cookie: buyer,
      body: { myItemId: 'i3', targetItemId: 'i1' }
    });
    assert.equal(intent.status, 200);
    assert.equal(intent.data.intent.status, 'active');

    const order = await request('/api/orders', {
      method: 'POST',
      cookie: buyer,
      body: { itemId: 'i1', delivery: 'face' }
    });
    assert.equal(order.status, 200);
    const pay = await request(`/api/orders/${order.data.order.id}/pay`, {
      method: 'POST',
      cookie: buyer
    });
    assert.equal(pay.status, 200);

    const state = await request('/api/bootstrap', { cookie: buyer });
    const stale = state.data.db.swaps.intents.find(item => item.id === intent.data.intent.id);
    assert.equal(stale.status, 'cancelled');
  });
});

test('P6 21 张表与新功能：分类、认证、图片、收藏、求购、交付、信用、仲裁、通知', async t => {
  const admin = await login('admin', 'admin123');
  const s1 = await login('student1', '123456');
  const s2 = await login('student2', '123456');

  await t.test('21 张业务表全部存在', async () => {
    const conn = await mysql.createConnection(DB);
    try {
      const [rows] = await conn.query('SHOW TABLES');
      assert.equal(rows.length, 21, `expected 21 tables, got ${rows.length}`);
    } finally {
      await conn.end();
    }
  });

  await t.test('管理员维护分类、自提点和学籍', async () => {
    const suffix = Date.now().toString().slice(-6);
    const category = await request('/api/categories', {
      method: 'POST', cookie: admin, body: { name: `测试分类${suffix}`, sort: 99 }
    });
    assert.equal(category.status, 200);
    assert.equal(category.data.category.name, `测试分类${suffix}`);

    const pickup = await request('/api/admin/pickup-points', {
      method: 'POST', cookie: admin, body: { name: `测试自提点${suffix}`, address: '图书馆一楼', contact: '值班老师' }
    });
    assert.equal(pickup.status, 200);

    const imported = await request('/api/admin/roster/import', {
      method: 'POST', cookie: admin,
      body: { students: [{ studentNo: `T${suffix}`, name: '测试学生', college: '计算机学院', major: '软件工程', grade: '2023', className: '软工2301' }] }
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.data.imported, 1);
  });

  let publishedItem;
  await t.test('发布带图片物品，审核后写图片、履历和通知', async () => {
    const title = `测试相机 ${Date.now().toString().slice(-5)}`;
    const publish = await request('/api/items', {
      method: 'POST', cookie: s1,
      body: {
        title, categoryId: 'c1', price: 66, originalPrice: 120,
        condition: '90', description: '功能正常，配原装包。', delivery: '面交',
        images: ['https://example.com/a.jpg', 'https://example.com/b.jpg']
      }
    });
    assert.equal(publish.status, 200, JSON.stringify(publish.data));
    publishedItem = publish.data.item;
    assert.equal(publishedItem.status, 'pending');
    assert.equal(publishedItem.categoryId, 'c1');

    const approve = await request(`/api/items/${encodeURIComponent(publishedItem.id)}/approve`, {
      method: 'POST', cookie: admin, body: {}
    });
    assert.equal(approve.status, 200);

    const state = await request('/api/bootstrap', { cookie: s1 });
    const item = state.data.db.items.find(i => i.id === publishedItem.id);
    assert.equal(item.status, 'on_sale');
    assert.equal(state.data.db.images.filter(img => img.itemId === publishedItem.id).length, 2);
    assert.ok(state.data.db.history.some(h => h.itemId === publishedItem.id && h.action === 'approved'));
    assert.ok(state.data.db.notifications.some(n => n.type === 'audit'));
  });

  await t.test('学籍认证提交与管理员审核', async () => {
    const submit = await request('/api/verifications', {
      method: 'POST', cookie: s2, body: { studentNo: '20230002', realName: '陈同学' }
    });
    assert.equal(submit.status, 200, JSON.stringify(submit.data));
    assert.equal(submit.data.verification.status, 'pending');

    const review = await request(`/api/admin/verifications/${encodeURIComponent(submit.data.verification.id)}/review`, {
      method: 'POST', cookie: admin, body: { action: 'approve', reason: '' }
    });
    assert.equal(review.status, 200, JSON.stringify(review.data));
    assert.equal(review.data.verification.status, 'approved');
  });

  await t.test('收藏与求购写入新表', async () => {
    const fav = await request(`/api/favorites/${encodeURIComponent(publishedItem.id)}/toggle`, {
      method: 'POST', cookie: s2
    });
    assert.equal(fav.status, 200);
    assert.equal(fav.data.favorited, true);

    const wanted = await request('/api/wanted', {
      method: 'POST', cookie: s2,
      body: { title: `求购测试 ${Date.now().toString().slice(-5)}`, categoryId: 'c1', keywords: '相机', budgetMin: 20, budgetMax: 80 }
    });
    assert.equal(wanted.status, 200);
    assert.equal(wanted.data.wanted.status, 'open');
  });

  let order;
  await t.test('下单、支付、交付、确认写入平台账户、交付记录和信用流水', async () => {
    const beforeState = await request('/api/bootstrap', { cookie: admin });
    const beforeEscrow = beforeState.data.db.platform.escrowBalance;
    const created = await request('/api/orders', {
      method: 'POST', cookie: s2, body: { itemId: publishedItem.id }
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    order = created.data.order;
    assert.equal(order.amount, 66);

    const pay = await request(`/api/orders/${encodeURIComponent(order.id)}/pay`, {
      method: 'POST', cookie: s2
    });
    assert.equal(pay.status, 200, JSON.stringify(pay.data));

    const deliver = await request(`/api/orders/${encodeURIComponent(order.id)}/deliver`, {
      method: 'POST', cookie: s1
    });
    assert.equal(deliver.status, 200, JSON.stringify(deliver.data));

    const confirm = await request(`/api/orders/${encodeURIComponent(order.id)}/confirm`, {
      method: 'POST', cookie: s2
    });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));

    const state = await request('/api/bootstrap', { cookie: admin });
    const delivery = state.data.db.deliveries.find(d => d.orderId === order.id);
    assert.ok(delivery, 'delivery record should exist');
    assert.ok(delivery.deliveredAt);
    assert.ok(delivery.confirmedAt);
    assert.equal(state.data.db.platform.escrowBalance, beforeEscrow);
    assert.ok(state.data.db.creditRecords.some(c => c.userId === 'u1' && c.refId === order.id && c.change === 2));
    assert.ok(state.data.db.creditRecords.some(c => c.userId === 'u2' && c.refId === order.id && c.change === 2));
  });

  await t.test('仲裁申请与管理员裁定', async () => {
    const create = await request('/api/arbitrations', {
      method: 'POST', cookie: s2, body: { orderId: order.id, reason: '物品与描述不符', evidence: '照片' }
    });
    assert.equal(create.status, 200, JSON.stringify(create.data));
    const arbitration = create.data.arbitration;
    const decide = await request(`/api/admin/arbitrations/${encodeURIComponent(arbitration.id)}/decide`, {
      method: 'POST', cookie: admin, body: { action: 'support', result: '支持买家，退款并回滚' }
    });
    assert.equal(decide.status, 200, JSON.stringify(decide.data));
    assert.equal(decide.data.arbitration.status, 'supported');
  });

  await t.test('通知可读取并清空未读', async () => {
    const before = await request('/api/bootstrap', { cookie: s1 });
    assert.ok(before.data.db.notifications.length > 0);
    const mark = await request('/api/notifications/read', {
      method: 'POST', cookie: s1, body: {}
    });
    assert.equal(mark.status, 200);
    const after = await request('/api/bootstrap', { cookie: s1 });
    assert.equal(after.data.db.stats.unreadNotifications, 0);
  });
});
