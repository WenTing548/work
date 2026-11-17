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
    await conn.query('DROP TABLE IF EXISTS item_history, swap_plans, swap_intents, audits, reviews, payments, orders, items, users');
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
});
