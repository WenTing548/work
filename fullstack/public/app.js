/* 拾光集 · 校园二手交易平台（Node.js + MySQL 全栈演示版）
 * 前端通过 REST API 读取/同步 MySQL 数据库；支付为模拟钱包。
 */
const DB_KEY = 'shiguang_app_v2';
const SESSION_KEY = 'shiguang_app_session_v2';
const store = (() => {
  try {
    const k = '__shiguang_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch (e) {
    const memory = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null),
      setItem: (k, v) => { memory[k] = String(v); },
      removeItem: (k) => { delete memory[k]; },
      clear: () => { Object.keys(memory).forEach((k) => delete memory[k]); }
    };
  }
})();
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const modalEl = document.getElementById('modal');

const CATS = ['教材', '数码', '出行', '生活', '乐器'];
const CAT_STYLE = {
  '教材': 'linear-gradient(145deg,#2f5d4d,#173f35)',
  '数码': 'linear-gradient(145deg,#4f6d8f,#283d58)',
  '出行': 'linear-gradient(145deg,#c47a52,#8f4b2e)',
  '生活': 'linear-gradient(145deg,#d8b67a,#a67a3f)',
  '乐器': 'linear-gradient(145deg,#7a6b9a,#493f69)'
};
const CAT_SHORT = { '教材': '书', '数码': '机', '出行': '车', '生活': '灯', '乐器': '琴' };
const CONDITION_LABEL = { 'new': '全新', '90': '九成新', '70': '七成新', '50': '五成新' };
const HISTORY_LABEL = {
  published: '发布', approved: '审核通过', rejected: '审核驳回',
  locked: '下单锁定', paid: '支付托管', unlocked: '取消解锁',
  delivered: '卖家交付', completed: '交易完成',
  swap_locked: '置换锁定', swap_cancelled: '置换取消', swap_completed: '置换完成'
};

let db = { users: [], items: [], orders: [], reviews: [], tx: [], audits: [], history: [], swaps: { intents: [], plans: [] }, categories: [], images: [], favorites: [], notifications: [], wanted: [], arbitrations: [], verifications: [], roster: [], pickupPoints: [], deliveries: [], creditRecords: [], platform: null };
let currentUserId = store.getItem(SESSION_KEY) || null;
let countdownTimer = null;
let reviewRating = 5;
let ui = {
  route: 'home',
  itemId: null,
  orderId: null,
  q: '',
  cat: '全部',
  orderTab: 'all',
  adminTab: 'audit',
  loginTab: 'login'
};

/* ---------- data ---------- */
function seedDB() {
  const now = Date.now();
  return {
    seq: 100,
    users: [
      { id: 'u1', username: 'student1', password: '123456', name: '林同学', college: '计算机学院', role: 'student', verified: true, credit: 96, balance: 500, createdAt: now - 86400000 * 20 },
      { id: 'u2', username: 'student2', password: '123456', name: '陈同学', college: '机械学院', role: 'student', verified: true, credit: 92, balance: 300, createdAt: now - 86400000 * 18 },
      { id: 'admin', username: 'admin', password: 'admin123', name: '运营小林', college: '学生事务中心', role: 'admin', verified: true, credit: 100, balance: 0, createdAt: now - 86400000 * 30 }
    ],
    items: [
      { id: 'i1', ownerId: 'u2', title: '高等数学 第七版', category: '教材', price: 18, originalPrice: 45, condition: '90', description: '书角有轻微磨损，内页干净，无笔记。可约图书馆门口面交。', delivery: '面交/自提', status: 'on_sale', createdAt: now - 3600 * 1000, views: 38 },
      { id: 'i2', ownerId: 'u2', title: '捷安特山地车', category: '出行', price: 260, originalPrice: 699, condition: '70', description: '骑了两年，刹车和变速正常，送车锁。毕业出，可小刀。', delivery: '自提', status: 'on_sale', createdAt: now - 7200 * 1000, views: 64 },
      { id: 'i3', ownerId: 'u1', title: '护眼台灯', category: '生活', price: 25, originalPrice: 89, condition: '90', description: '三档调光，宿舍书桌用刚好，功能正常。', delivery: '面交/自提', status: 'on_sale', createdAt: now - 10800 * 1000, views: 21 },
      { id: 'i4', ownerId: 'u2', title: '民谣吉他 41 寸', category: '乐器', price: 180, originalPrice: 520, condition: '70', description: '音准正常，琴颈无裂，送琴包和拨片。', delivery: '自提', status: 'on_sale', createdAt: now - 86400 * 1000, views: 47 },
      { id: 'i5', ownerId: 'u1', title: '数据结构与算法分析', category: '教材', price: 22, originalPrice: 59, condition: '90', description: 'C 语言描述版，重点章节有少量铅笔标注。', delivery: '面交', status: 'pending', createdAt: now - 1800 * 1000, views: 0 }
    ],
    orders: [],
    reviews: [],
    tx: [],
    audits: [],
    notifications: []
  };
}

function loadDB() {
  try {
    const raw = store.getItem(DB_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.users) && Array.isArray(data.items)) return data;
    }
  } catch (e) { /* ignore */ }
  const fresh = seedDB();
  store.setItem(DB_KEY, JSON.stringify(fresh));
  return fresh;
}
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
let syncTimer = null;
let syncBusy = false;
let syncDirty = false;
function saveDB() {
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 60);
}
async function flushSync() {
  if (syncBusy) return;
  if (!syncDirty) return;
  syncDirty = false;
  syncBusy = true;
  try {
    await api('/api/sync', { db });
  } catch (e) {
    console.error('同步到 MySQL 失败', e);
  } finally {
    syncBusy = false;
    if (syncDirty) saveDB();
  }
}
async function refreshState(renderAfter = true) {
  const res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  if (res.status === 401) {
    currentUserId = null;
    store.removeItem(SESSION_KEY);
    db = { users: [], items: [], orders: [], reviews: [], tx: [], audits: [], history: [], swaps: { intents: [], plans: [] }, categories: [], images: [], favorites: [], notifications: [], wanted: [], arbitrations: [], verifications: [], roster: [], pickupPoints: [], deliveries: [], creditRecords: [], platform: null };
    if (renderAfter) renderLogin();
    return null;
  }
  if (!res.ok) throw new Error('后端返回 ' + res.status);
  const data = await res.json();
  db = data.db;
  db.history = db.history || [];
  db.swaps = db.swaps || { intents: [], plans: [] };
  for (const key of ['categories', 'images', 'favorites', 'notifications', 'wanted', 'arbitrations', 'verifications', 'roster', 'pickupPoints', 'deliveries', 'creditRecords']) db[key] = db[key] || [];
  db.platform = db.platform || null;
  if (data.user) {
    currentUserId = data.user.id;
    store.setItem(SESSION_KEY, currentUserId);
  } else {
    currentUserId = null;
    store.removeItem(SESSION_KEY);
  }
  if (renderAfter) render();
  return data;
}
function me() { return db.users.find(u => u.id === currentUserId) || null; }
function getUser(id) { return db.users.find(u => u.id === id); }
function getItem(id) { return db.items.find(i => i.id === id); }
function getOrder(id) { return db.orders.find(o => o.id === id); }
function nextId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

/* ---------- helpers ---------- */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  const v = Number(n || 0);
  return '¥' + (Number.isInteger(v) ? v : v.toFixed(2));
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function statusText(s) {
  return { unpaid: '待支付', to_deliver: '待交付', to_confirm: '待确认', completed: '已完成', cancelled: '已取消' }[s] || s;
}
function itemStatusText(s) {
  return { pending: '待审核', on_sale: '在售', locked: '已锁定', completed: '已完成', rejected: '已驳回', off_shelf: '已下架', frozen: '已冻结' }[s] || s;
}
function statusPill(s) { return `<span class="status ${s}">${statusText(s)}</span>`; }
function itemStatusPill(s) {
  const cls = s === 'on_sale' ? 'completed' : s === 'pending' ? 'to_deliver' : s === 'locked' ? 'to_confirm' : s === 'rejected' ? 'unpaid' : 'cancelled';
  return `<span class="status ${cls}">${itemStatusText(s)}</span>`;
}
function thumbBg(item) { return CAT_STYLE[item.category] || CAT_STYLE['教材']; }
function thumbChar(item) { return CAT_SHORT[item.category] || '物'; }
function avatarChar(u) { return (u && u.name ? u.name.slice(0, 1) : '拾'); }
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}
function go(route, data = {}) {
  clearInterval(countdownTimer);
  ui = { ...ui, ...data, route };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function openItem(id) { go('detail', { itemId: id }); }
function closeModal() { modalEl.classList.remove('show'); modalEl.innerHTML = ''; }

/* ---------- render root ---------- */
function render() {
  clearInterval(countdownTimer);
  const user = me();
  if (!user) { renderLogin(); return; }
  app.innerHTML = shell(renderRoute(user));
  if (ui.route === 'orderDetail') startCountdown();
}
function shell(content) {
  const user = me();
  const isAdmin = user.role === 'admin';
  const unread = (db.notifications || []).filter(n => !n.readAt).length;
  const nav = [
    ['home', '首页'],
    ['publish', '发布闲置'],
    ['swaps', '置换'],
    ['wanted', '求购'],
    ['orders', '我的订单'],
    ['notifications', `通知${unread ? `<span class="nav-dot">${unread}</span>` : ''}`],
    ['wallet', '钱包'],
    ['my', '我的']
  ];
  if (isAdmin) nav.splice(1, 5, ['admin', '审核后台'], ['orders', '全部订单'], ['notifications', `通知${unread ? `<span class="nav-dot">${unread}</span>` : ''}`]);
  return `
  <header class="app-header">
    <div class="header-inner">
      <button class="logo" onclick="go('home')"><span class="mark"></span>拾光集</button>
      <nav class="nav">
        ${nav.map(([r, label]) => `<button class="${ui.route === r ? 'active' : ''}" onclick="go('${r}')">${label}</button>`).join('')}
      </nav>
      <div class="header-right">
        ${isAdmin ? '<span class="balance-pill">运营账号</span>' : `<span class="balance-pill">余额 ${money(user.balance)}</span>`}
        <button class="user-chip" onclick="go('my')">
          <span class="avatar">${esc(avatarChar(user))}</span>
          <span><b>${esc(user.name)}</b><small>${isAdmin ? '运营' : (user.verified ? '已认证' : '未认证')}</small></span>
        </button>
      </div>
    </div>
  </header>
  <main class="main">${content}</main>
  <footer class="footer">拾光集 · 校园二手交易平台演示版　|　数据保存在 Railway MySQL，支付为模拟钱包，不涉及真实资金　|　建议使用 Edge / Chrome 打开</footer>`;
}
function renderRoute(user) {
  switch (ui.route) {
    case 'home': return viewHome(user);
    case 'detail': return viewDetail(user);
    case 'publish': return viewPublish(user);
    case 'swaps': return viewSwaps(user);
    case 'wanted': return viewWanted(user);
    case 'notifications': return viewNotifications(user);
    case 'orders': return viewOrders(user);
    case 'orderDetail': return viewOrderDetail(user);
    case 'wallet': return viewWallet(user);
    case 'admin': return viewAdmin(user);
    case 'my': return viewMy(user);
    default: return viewHome(user);
  }
}

/* ---------- login ---------- */
function renderLogin() {
  const isLogin = ui.loginTab !== 'register';
  app.innerHTML = `
  <div class="login-page">
    <section class="login-brand">
      <div class="brand-mark"><span class="brand-dot"></span>拾光集 · CAMPUS REUSE</div>
      <div>
        <h1>让旧物<br><em>继续发光。</em></h1>
        <p>校园实名认证、物品履历、资金托管、面交/自提。把闲置交给下一个需要它的人，也把故事留在校园里。</p>
        <div class="brand-points"><span>实名认证</span><span>资金托管</span><span>物品履历</span><span>面交 / 自提</span></div>
      </div>
      <div class="brand-foot">《软件工程》课程项目 · Node.js + MySQL 全栈演示版</div>
    </section>
    <section class="login-panel">
      <div class="login-card">
        <h2>${isLogin ? '欢迎回来' : '加入拾光集'}</h2>
        <p>${isLogin ? '登录后浏览、发布、下单和管理订单。' : '注册后即可发布闲置；演示环境自动通过学籍认证。'}</p>
        <div class="tabs">
          <button class="${isLogin ? 'active' : ''}" onclick="setLoginTab('login')">登录</button>
          <button class="${!isLogin ? 'active' : ''}" onclick="setLoginTab('register')">注册</button>
        </div>
        ${isLogin ? loginForm() : registerForm()}
        <div class="demo-box">
          <b>演示账号</b>
          <div class="demo-row">
            <button onclick="quickLogin('student1')">学生 · student1</button>
            <button onclick="quickLogin('admin')">运营 · admin</button>
            <button onclick="quickLogin('student2')">学生 · student2</button>
          </div>
          <div class="login-note" style="margin-top:9px">密码：学生 123456　运营 admin123</div>
        </div>
        <div class="login-note">这是 Node.js + MySQL 全栈演示版，数据保存在 Railway 云端数据库 shiguangji；点击“我的 → 重置演示数据”可以恢复初始状态。</div>
      </div>
    </section>
  </div>`;
}
function loginForm() {
  return `<form onsubmit="doLogin(event)">
    <div class="field"><label>用户名</label><input name="username" autocomplete="username" placeholder="请输入用户名" required></div>
    <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></div>
    <button class="btn orange block" type="submit">登录</button>
  </form>`;
}
function registerForm() {
  return `<form onsubmit="doRegister(event)">
    <div class="field"><label>用户名</label><input name="username" placeholder="用于登录，建议英文/数字" required></div>
    <div class="field"><label>昵称</label><input name="name" placeholder="例如：林同学" required></div>
    <div class="field"><label>学院</label><input name="college" placeholder="例如：计算机学院" required></div>
    <div class="field"><label>密码</label><input name="password" type="password" placeholder="至少 6 位" required></div>
    <button class="btn orange block" type="submit">注册并登录</button>
  </form>`;
}
function setLoginTab(tab) { ui.loginTab = tab; renderLogin(); }
async function doLogin(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const username = String(fd.get('username') || '').trim();
  const password = String(fd.get('password') || '');
  try {
    const { user } = await api('/api/login', { username, password });
    await refreshState(false);
    ui.route = user.role === 'admin' ? 'admin' : 'home';
    toast(`欢迎回来，${user.name}`);
    render();
  } catch (err) {
    toast(err.message || '登录失败');
  }
}
async function quickLogin(username) {
  const passwords = { student1: '123456', student2: '123456', admin: 'admin123' };
  try {
    const { user } = await api('/api/login', { username, password: passwords[username] || '123456' });
    await refreshState(false);
    ui.route = user.role === 'admin' ? 'admin' : 'home';
    toast(`已切换为 ${user.name}`);
    render();
  } catch (err) {
    toast(err.message || '登录失败，请确认后端已启动');
  }
}
async function doRegister(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const username = String(fd.get('username') || '').trim();
  const name = String(fd.get('name') || '').trim();
  const college = String(fd.get('college') || '').trim();
  const password = String(fd.get('password') || '');
  try {
    const { user } = await api('/api/register', { username, name, college, password });
    await refreshState(false);
    ui.route = 'home';
    toast('注册成功，已赠送 ¥300 演示余额');
    render();
  } catch (err) {
    toast(err.message || '注册失败');
  }
}
async function logout() {
  try { await api('/api/logout'); } catch (e) { /* 本地仍然清状态 */ }
  currentUserId = null;
  store.removeItem(SESSION_KEY);
  db = { users: [], items: [], orders: [], reviews: [], tx: [], audits: [], history: [], swaps: { intents: [], plans: [] } };
  ui = { route: 'home', itemId: null, orderId: null, q: '', cat: '全部', orderTab: 'all', adminTab: 'audit', loginTab: 'login' };
  renderLogin();
}

/* ---------- home ---------- */
function viewHome(user) {
  const onSale = db.items.filter(i => i.status === 'on_sale');
  const pending = db.items.filter(i => i.status === 'pending').length;
  let list = onSale.slice();
  if (ui.cat !== '全部') list = list.filter(i => i.category === ui.cat);
  if (ui.q) {
    const q = ui.q.toLowerCase();
    list = list.filter(i => (i.title + i.description + i.category).toLowerCase().includes(q));
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  const isAdmin = user.role === 'admin';
  return `
  <section class="hero">
    <div class="hero-copy">
      <span class="hero-kicker">● 校园实名 · 资金托管</span>
      <h1>把闲置，<br>交给<em>下一个需要</em>的人。</h1>
      <p>教材、数码、出行、生活、乐器。每一件旧物都有履历，每一次交易都有记录。</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${onSale.length}</b><span>件在售</span></div>
        <div class="hero-stat"><b>${pending}</b><span>待审核</span></div>
        <div class="hero-stat"><b>${(db.stats && db.stats.studentCount) || db.users.filter(u => u.role === 'student').length}</b><span>位同学</span></div>
      </div>
    </div>
    <div class="hero-copy" style="align-self:end">
      ${isAdmin ? `<button class="btn orange" onclick="go('admin')">进入审核后台 →</button>` : `<button class="btn orange" onclick="go('publish')">发布我的闲置 →</button>`}
    </div>
  </section>
  <form class="searchbar" onsubmit="doSearch(event)">
    <input name="q" value="${esc(ui.q)}" placeholder="搜索教材、数码、闲置……">
    <button class="btn" type="submit">搜索</button>
  </form>
  <div class="section-head">
    <div><h2>${ui.q ? '搜索结果' : '刚刚上架'}</h2><p>${ui.q ? `关键词“${esc(ui.q)}” · ${list.length} 件` : '按发布时间排序 · 支持面交/自提'}</p></div>
    <div class="cats">
      <button class="${ui.cat === '全部' ? 'active' : ''}" onclick="setCat('全部')">全部</button>
      ${CATS.map(c => `<button class="${ui.cat === c ? 'active' : ''}" onclick="setCat('${c}')">${c}</button>`).join('')}
    </div>
  </div>
  ${list.length ? `<div class="item-grid">${list.map(itemCard).join('')}</div>` : `<div class="empty">没有找到符合条件的物品。<br><button class="btn ghost" style="margin-top:14px" onclick="setCat('全部');ui.q='';render()">清除筛选</button></div>`}
  <div class="section-head"><div><h2>怎么交易</h2><p>平台只做信息与资金托管，交付以面交/自提为主</p></div></div>
  <div class="item-grid" style="grid-template-columns:repeat(4,1fr)">
    ${[['01', '实名认证', '学号绑定，认证后才能发布和购买'], ['02', '下单托管', '买家付款先进入平台托管'], ['03', '面交/自提', '线下面交或到自提点取件'], ['04', '确认放款', '确认收货后放款给卖家']].map(([n, t, d]) => `<div class="panel" style="padding:15px"><div style="color:var(--orange);font-size:10px;font-weight:800">${n}</div><div style="margin-top:7px;font-size:12px;font-weight:750">${t}</div><div style="margin-top:5px;color:var(--muted);font-size:9px;line-height:1.6">${d}</div></div>`).join('')}
  </div>`;
}
function itemCard(item) {
  const seller = getUser(item.ownerId);
  return `<article class="item-card" onclick="openItem('${item.id}')">
    <div class="item-thumb" style="background:${thumbBg(item)}">
      <span class="status">在售</span>
      <span class="big">${thumbChar(item)}</span>
    </div>
    <div class="item-info">
      <div class="item-cat">${esc(item.category)} · ${esc(seller ? seller.college : '未知学院')}</div>
      <div class="item-title">${esc(item.title)}</div>
      <div class="item-price">${money(item.price)}<s>${money(item.originalPrice)}</s></div>
      <div class="item-meta"><span>${esc(CONDITION_LABEL[item.condition] || item.condition)}</span><span>${esc(item.delivery)}</span></div>
    </div>
  </article>`;
}
function doSearch(e) {
  e.preventDefault();
  ui.q = String(new FormData(e.target).get('q') || '').trim();
  render();
}
function setCat(cat) { ui.cat = cat; render(); }

/* ---------- wanted / notifications ---------- */
function viewWanted(user) {
  const list = (db.wanted || []).filter(w => w.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
  const cats = (db.categories || []).filter(c => c.status === 'active');
  const form = user.role === 'student' ? `
    <div class="panel" style="margin-bottom:18px">
      <div class="section-head"><div><h2>发布求购</h2><p>写下想要的物品，卖家上架后更容易被匹配。</p></div></div>
      <form onsubmit="createWanted(event)">
        <div class="form-grid">
          <div class="field span2"><label>求购标题</label><input name="title" placeholder="例如：收一本线性代数 第六版" maxlength="60" required></div>
          <div class="field"><label>分类</label><select name="categoryId">${cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>关键词</label><input name="keywords" placeholder="线性代数, 同济"></div>
          <div class="field"><label>预算下限</label><input name="budgetMin" type="number" min="0" value="10"></div>
          <div class="field"><label>预算上限</label><input name="budgetMax" type="number" min="0" value="40"></div>
        </div>
        <div class="submit-row"><button class="btn orange" type="submit">发布求购</button></div>
      </form>
    </div>` : '';
  return `<div class="page-head"><div><h1>求购广场</h1><p>买家发出需求，卖家可以主动联系；当前为演示版，不自动撮合。</p></div></div>
  ${form}
  <div class="section-head"><div><h2>正在求购</h2><p>${list.length} 条</p></div></div>
  ${list.length ? `<div class="order-list">${list.map(w => {
    const owner = getUser(w.userId);
    return `<div class="order-card"><div class="order-main"><div class="order-thumb" style="background:linear-gradient(145deg,#d8b67a,#a67a3f)">求</div><div class="order-item"><b>${esc(w.title)}</b><small>${esc(owner ? owner.name : '同学')} · ${esc((db.categories.find(c => c.id === w.categoryId) || {}).name || '不限分类')} · ${fmtTime(w.createdAt)}</small><span class="tag">预算 ${money(w.budgetMin)} - ${money(w.budgetMax)}</span></div></div><div class="order-actions"><span class="status completed">求购中</span><button class="btn ghost small" onclick="toast('已记录联系意向（演示环境不接入聊天）')">联系 TA</button></div></div>`;
  }).join('')}</div>` : `<div class="empty">还没有求购信息，发布第一条吧。</div>`}`;
}
async function createWanted(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/wanted', {
      title: String(fd.get('title') || '').trim(),
      categoryId: String(fd.get('categoryId') || ''),
      keywords: String(fd.get('keywords') || '').trim(),
      budgetMin: Number(fd.get('budgetMin')) || 0,
      budgetMax: Number(fd.get('budgetMax')) || 0
    });
    await refreshState(false);
    toast('求购已发布');
    go('wanted');
  } catch (err) { toast(err.message || '发布失败'); }
}
function viewNotifications(user) {
  const list = (db.notifications || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const unread = list.filter(n => !n.readAt).length;
  return `<div class="page-head"><div><h1>通知</h1><p>${unread ? `${unread} 条未读` : '全部已读'}</p></div><button class="btn ghost" onclick="readNotifications()">全部标为已读</button></div>
  ${list.length ? `<div class="order-list">${list.map(n => `<div class="order-card" style="${n.readAt ? 'opacity:.72' : ''}"><div class="order-main"><div class="order-thumb" style="background:${n.type === 'audit' ? 'linear-gradient(145deg,#4f6d8f,#283d58)' : 'linear-gradient(145deg,#2f5d4d,#173f35)'}">${n.readAt ? '读' : '新'}</div><div class="order-item"><b>${esc(n.title)}</b><small>${esc(n.body)}</small><span class="tag">${fmtTime(n.createdAt)}</span></div></div><div class="order-actions">${n.readAt ? '' : `<button class="btn ghost small" onclick="readNotifications('${n.id}')">标为已读</button>`}</div></div>`).join('')}</div>` : `<div class="empty">还没有通知。审核、支付、交付和仲裁结果会出现在这里。</div>`}`;
}
async function readNotifications(id) {
  try {
    await api('/api/notifications/read', id ? { id } : {});
    await refreshState(false);
    render();
  } catch (err) { toast(err.message || '操作失败'); }
}

/* ---------- detail ---------- */
function viewDetail(user) {
  const item = getItem(ui.itemId);
  if (!item) return `<div class="empty">物品不存在。<button class="btn ghost" onclick="go('home')">返回首页</button></div>`;
  const seller = getUser(item.ownerId);
  const isOwner = item.ownerId === user.id;
  const canBuy = item.status === 'on_sale' && !isOwner && user.role === 'student';
  let buyLabel = '立即购买';
  let disabled = false;
  if (isOwner) { buyLabel = '这是你发布的物品'; disabled = true; }
  else if (user.role === 'admin') { buyLabel = '运营账号不能购买'; disabled = true; }
  else if (item.status !== 'on_sale') { buyLabel = itemStatusText(item.status); disabled = true; }
  const records = (db.history || []).filter(h => h.itemId === item.id);
  const images = (db.images || []).filter(img => img.itemId === item.id).sort((a, b) => a.sort - b.sort);
  const favorite = (db.favorites || []).some(f => f.itemId === item.id);
  const pickupPoints = (db.pickupPoints || []).filter(p => p.status === 'active');
  const canPickup = item.delivery.includes('自提') && pickupPoints.length;
  const history = records.length
    ? records.map(h => [
        HISTORY_LABEL[h.action] || h.action,
        `${fmtTime(h.createdAt)}${h.note ? ' · ' + h.note : ''}`
      ])
    : [
        ['建档', fmtTime(item.createdAt)],
        ['上架', fmtTime(item.createdAt)],
        item.status === 'completed' ? ['成交', '已完成交易'] : ['当前', itemStatusText(item.status)]
      ];
  return `<button class="back" onclick="go('home')">‹ 返回</button>
  <div class="detail-layout">
    <div class="detail-visual" style="background:${thumbBg(item)}">
      <span class="badge">${esc(CONDITION_LABEL[item.condition] || item.condition)}</span>
      ${images[0] ? `<img src="${esc(images[0].url)}" alt="${esc(item.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:24px" onerror="this.style.display='none'">` : `<span class="big">${thumbChar(item)}</span>`}
    </div>
    <div class="detail-panel">
      <div class="item-cat">${esc(item.category)} · ${esc(item.delivery)}</div>
      <h1>${esc(item.title)}</h1>
      <div class="detail-price">${money(item.price)}<s>原价 ${money(item.originalPrice)}</s></div>
      <div class="detail-tags"><span class="tag">${esc(CONDITION_LABEL[item.condition] || item.condition)}</span><span class="tag">${esc(item.delivery)}</span><span class="tag">可小刀</span></div>
      <div class="seller-card">
        <span class="avatar">${esc(avatarChar(seller))}</span>
        <div><b>${esc(seller ? seller.name : '未知卖家')} · ${esc(seller ? seller.college : '')}</b><small>${seller && seller.verified ? '已认证' : '未认证'} · 信用 ${seller ? seller.credit : '—'}</small></div>
        <span class="credit">信用 ${seller ? seller.credit : '—'}</span>
      </div>
      <div class="detail-desc"><h3>物品描述</h3><p>${esc(item.description)}</p>${images.length > 1 ? `<div class="image-strip">${images.map((img, i) => `<img src="${esc(img.url)}" alt="图片 ${i + 1}" onerror="this.style.display='none'">`).join('')}</div>` : ''}</div>
      <div class="history"><h3>物品履历</h3><div class="timeline">${history.map(([t, d]) => `<p>${t} · ${d}</p>`).join('')}</div></div>
      ${canPickup ? `<div class="field"><label>自提点</label><select id="pickup-select">${pickupPoints.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.address)}</option>`).join('')}</select></div>` : ''}
      <div class="buy-row">
        <button class="btn ghost" onclick="toast('已发送联系请求（演示环境不接入聊天）')">联系卖家</button>
        <button class="btn line" onclick="toggleFavorite('${item.id}')">${favorite ? '已收藏' : '收藏'}</button>
        <button class="btn orange" ${disabled ? 'disabled' : ''} onclick="buyItem('${item.id}')">${buyLabel}</button>
      </div>
      <div class="buy-note">下单后 30 秒内未支付会自动取消；支付金额先进入平台托管，确认收货后放款给卖家。</div>
      ${user.role === 'admin' && item.status === 'pending' ? `<div style="display:flex;gap:8px;margin-top:12px"><button class="btn" onclick="approveItem('${item.id}')">通过审核</button><button class="btn danger" onclick="rejectItem('${item.id}')">驳回</button></div>` : ''}
    </div>
  </div>`;
}
async function buyItem(id) {
  const user = me();
  const item = getItem(id);
  if (!item || item.status !== 'on_sale') return toast('该物品当前不可购买');
  if (item.ownerId === user.id) return toast('不能购买自己发布的物品');
  if (user.role !== 'student') return toast('运营账号不能购买');
  if (user.balance < item.price) { toast('余额不足，请先到钱包充值'); return go('wallet'); }
  try {
    const pickupEl = document.getElementById('pickup-select');
    const { order } = await api('/api/orders', { itemId: id, pickupPointId: pickupEl ? pickupEl.value : null });
    await refreshState(false);
    toast('订单已创建，请在 30 秒内支付');
    go('orderDetail', { orderId: order.id });
  } catch (err) {
    toast(err.message || '下单失败');
  }
}
async function toggleFavorite(itemId) {
  try {
    const r = await api(`/api/favorites/${encodeURIComponent(itemId)}/toggle`);
    await refreshState(false);
    toast(r.favorited ? '已收藏' : '已取消收藏');
    render();
  } catch (err) { toast(err.message || '收藏失败'); }
}
function startCountdown() {
  clearInterval(countdownTimer);
  const order = getOrder(ui.orderId);
  if (!order || order.status !== 'unpaid') return;
  const tick = () => {
    const left = Math.max(0, Math.ceil((order.deadline - Date.now()) / 1000));
    const el = document.getElementById('countdown');
    if (el) el.textContent = left + ' 秒';
    if (left <= 0) {
      clearInterval(countdownTimer);
      cancelOrder(order.id, true);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 500);
}
async function payOrder(id) {
  const order = getOrder(id);
  const user = me();
  if (!order || order.status !== 'unpaid') return toast('订单状态已变化');
  if (Date.now() > order.deadline) { return cancelOrder(id, true); }
  if (user.balance < order.amount) { toast('余额不足'); return go('wallet'); }
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/pay`);
    await refreshState(false);
    toast('支付成功，金额已进入平台托管');
    go('orderDetail', { orderId: id });
  } catch (err) {
    toast(err.message || '支付失败');
  }
}
async function cancelOrder(id, auto = false) {
  const order = getOrder(id);
  if (!order || order.status !== 'unpaid') return;
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/cancel`);
    await refreshState(false);
    clearInterval(countdownTimer);
    toast(auto ? '订单超时，已自动取消并解锁物品' : '订单已取消，物品已回到在售');
    if (ui.route === 'orderDetail' && ui.orderId === id) go('orderDetail', { orderId: id });
    else render();
  } catch (err) {
    toast(err.message || '取消失败');
  }
}
async function deliverOrder(id) {
  const order = getOrder(id);
  if (!order || order.status !== 'to_deliver') return toast('订单状态不允许交付');
  if (order.sellerId !== me().id) return toast('只有卖家可以确认交付');
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/deliver`);
    await refreshState(false);
    toast('已记录交付，等待买家确认收货');
    render();
  } catch (err) {
    toast(err.message || '交付失败');
  }
}
async function confirmOrder(id) {
  const order = getOrder(id);
  if (!order || order.status !== 'to_confirm') return toast('订单状态不允许确认');
  if (order.buyerId !== me().id) return toast('只有买家可以确认收货');
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/confirm`);
    await refreshState(false);
    toast('已确认收货，托管金额已放款给卖家');
    go('orderDetail', { orderId: id });
  } catch (err) {
    toast(err.message || '确认失败');
  }
}

/* ---------- swaps ---------- */
function swapIntentStatusText(s) {
  return { active: '等待对方回应', matched: '已生成方案', cancelled: '已取消', completed: '已完成' }[s] || s;
}
function swapPlanStatusText(s) {
  return { pending: '待双方确认', active: '待完成置换', completed: '已完成', cancelled: '已取消' }[s] || s;
}
function viewSwaps(user) {
  if (user.role === 'admin') return `<div class="empty">运营账号不参与置换。<button class="btn ghost" onclick="go('admin')">返回后台</button></div>`;
  const myItems = db.items.filter(i => i.ownerId === user.id && i.status === 'on_sale');
  const targets = db.items.filter(i => i.ownerId !== user.id && i.status === 'on_sale');
  const intents = (db.swaps && db.swaps.intents) || [];
  const plans = (db.swaps && db.swaps.plans) || [];
  const form = myItems.length && targets.length ? `
    <form onsubmit="createSwapIntent(event)">
      <div class="form-grid">
        <div class="field"><label>我的物品</label><select name="myItemId" required>${myItems.map(i => `<option value="${i.id}">${esc(i.title)} · ${money(i.price)}</option>`).join('')}</select></div>
        <div class="field"><label>想换的物品</label><select name="targetItemId" required>${targets.map(i => `<option value="${i.id}">${esc(i.title)} · ${esc((getUser(i.ownerId) || {}).name || '同学')} · ${money(i.price)}</option>`).join('')}</select></div>
      </div>
      <div class="form-note">双方都发出指向彼此的意向时，系统才会生成置换方案；方案 10 分钟内双方确认，确认后生成两张 0 元置换单，线下交付后点“完成置换”。</div>
      <div class="submit-row"><button class="btn orange" type="submit">发起置换意向</button></div>
    </form>` : `<div class="empty">${myItems.length ? '目前没有其他同学的在售物品可换。' : '你还没有在售物品，先去发布一件吧。'}<br><button class="btn ghost" style="margin-top:12px" onclick="go('${myItems.length ? 'home' : 'publish'}')">${myItems.length ? '去逛逛' : '去发布'}</button></div>`;
  return `<div class="page-head"><div><h1>置换</h1><p>两人互换 · 不经过钱包 · 双方确认后线下交付</p></div></div>
  <div class="panel"><h3 style="margin:0 0 4px;font-size:14px">发起置换意向</h3><p class="small muted" style="margin:0 0 13px">先选自己的在售物品，再选想换的在售物品。</p>${form}</div>
  <div class="section-head"><div><h2>我的置换方案</h2><p>${plans.length} 个方案</p></div></div>
  ${plans.length ? `<div class="order-list">${plans.map(p => swapPlanCard(p, user)).join('')}</div>` : '<div class="empty">还没有置换方案。双方互相发起意向后会自动生成。</div>'}
  <div class="section-head"><div><h2>我发出的意向</h2><p>${intents.length} 条</p></div></div>
  ${intents.length ? `<div class="order-list">${intents.map(i => swapIntentCard(i, user)).join('')}</div>` : '<div class="empty">还没有发出过置换意向。</div>'}`;
}
function swapIntentCard(intent, user) {
  const myItem = getItem(intent.myItemId);
  const target = getItem(intent.targetItemId);
  const canCancel = intent.status === 'active';
  return `<div class="order-card">
    <div class="order-top"><span class="order-id">意向 ${intent.id} · ${fmtTime(intent.createdAt)}</span><span class="status ${intent.status === 'active' ? 'to_confirm' : intent.status === 'matched' ? 'completed' : 'cancelled'}">${swapIntentStatusText(intent.status)}</span></div>
    <div class="order-main">
      <div class="order-thumb" style="background:${myItem ? thumbBg(myItem) : CAT_STYLE['教材']}">${myItem ? thumbChar(myItem) : '我'}</div>
      <div class="order-item"><b>${esc(myItem ? myItem.title : '物品已删除')}</b><small>换 → ${esc(target ? target.title : '物品已删除')} · 卖家 ${esc((target && getUser(target.ownerId) || {}).name || '—')}</small></div>
      <div class="order-amount" style="font-size:13px;color:var(--green)">互换</div>
    </div>
    ${canCancel ? `<div class="order-actions"><button class="btn line small" onclick="cancelSwapIntent('${intent.id}')">取消意向</button></div>` : ''}
  </div>`;
}
function swapPlanCard(plan, user) {
  const isA = plan.userAId === user.id;
  const myItem = getItem(isA ? plan.itemAId : plan.itemBId);
  const otherItem = getItem(isA ? plan.itemBId : plan.itemAId);
  const otherId = isA ? plan.userBId : plan.userAId;
  const other = getUser(otherId);
  const mineConfirmed = isA ? plan.aConfirmedAt : plan.bConfirmedAt;
  const actions = [];
  if (plan.status === 'pending') {
    if (!mineConfirmed) actions.push(`<button class="btn orange small" onclick="confirmSwapPlan('${plan.id}')">确认置换</button>`);
    else actions.push('<span class="small muted" style="align-self:center">已确认，等待对方</span>');
    actions.push(`<button class="btn line small" onclick="rejectSwapPlan('${plan.id}')">放弃方案</button>`);
  }
  if (plan.status === 'active') actions.push(`<button class="btn small" onclick="completeSwapPlan('${plan.id}')">完成置换</button>`);
  return `<div class="order-card">
    <div class="order-top"><span class="order-id">方案 ${plan.id} · ${fmtTime(plan.createdAt)}</span><span class="status ${plan.status === 'completed' ? 'completed' : plan.status === 'active' ? 'to_confirm' : plan.status === 'cancelled' ? 'cancelled' : 'to_deliver'}">${swapPlanStatusText(plan.status)}</span></div>
    <div class="order-main">
      <div class="order-thumb" style="background:${myItem ? thumbBg(myItem) : CAT_STYLE['教材']}">${myItem ? thumbChar(myItem) : '我'}</div>
      <div class="order-item"><b>${esc(myItem ? myItem.title : '物品已删除')} ⇄ ${esc(otherItem ? otherItem.title : '物品已删除')}</b><small>对方 ${esc(other ? other.name : '—')} · ${plan.status === 'pending' ? '双方确认后生成置换单' : plan.status === 'active' ? '线下交付后点完成' : '已结束'} · ${fmtTime(plan.confirmDeadline)} 截止</small></div>
      <div class="order-amount" style="font-size:13px;color:var(--green)">0 元</div>
    </div>
    ${actions.length ? `<div class="order-actions">${actions.join('')}</div>` : ''}
  </div>`;
}
async function createSwapIntent(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/swaps/intents', { myItemId: String(fd.get('myItemId')), targetItemId: String(fd.get('targetItemId')) });
    await refreshState(false);
    toast(data.plan ? '双方意向匹配成功，已生成置换方案' : '置换意向已发出，等待对方回应');
    go('swaps');
  } catch (err) {
    toast(err.message || '发起置换失败');
  }
}
async function cancelSwapIntent(id) {
  if (!window.confirm('确定取消这条置换意向吗？')) return;
  try {
    await api(`/api/swaps/intents/${encodeURIComponent(id)}/cancel`);
    await refreshState(false);
    toast('置换意向已取消');
    go('swaps');
  } catch (err) {
    toast(err.message || '取消失败');
  }
}
async function confirmSwapPlan(id) {
  try {
    await api(`/api/swaps/plans/${encodeURIComponent(id)}/confirm`);
    await refreshState(false);
    toast('已确认置换；双方都确认后会生成两张置换单');
    go('swaps');
  } catch (err) {
    toast(err.message || '确认失败');
  }
}
async function rejectSwapPlan(id) {
  if (!window.confirm('放弃后双方物品会解锁，确定吗？')) return;
  try {
    await api(`/api/swaps/plans/${encodeURIComponent(id)}/reject`);
    await refreshState(false);
    toast('方案已取消，物品已解锁');
    go('swaps');
  } catch (err) {
    toast(err.message || '取消失败');
  }
}
async function completeSwapPlan(id) {
  if (!window.confirm('确认已完成线下交付并交换物品吗？完成后双方物品归属会互换。')) return;
  try {
    await api(`/api/swaps/plans/${encodeURIComponent(id)}/complete`);
    await refreshState(false);
    toast('置换完成，物品归属已互换');
    go('swaps');
  } catch (err) {
    toast(err.message || '完成失败');
  }
}

/* ---------- orders ---------- */
function viewOrders(user) {
  const isAdmin = user.role === 'admin';
  let list = db.orders.filter(o => o.orderType !== 'swap');
  if (!isAdmin) list = list.filter(o => o.buyerId === user.id || o.sellerId === user.id);
  if (ui.orderTab !== 'all') list = list.filter(o => o.status === ui.orderTab);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const tabs = [['all', '全部'], ['unpaid', '待支付'], ['to_deliver', '待交付'], ['to_confirm', '待确认'], ['completed', '已完成']];
  return `<div class="page-head"><div><h1>${isAdmin ? '全部订单' : '我的订单'}</h1><p>${isAdmin ? '运营视角 · 查看平台全部交易' : '我买到的和我卖出的'}</p></div></div>
  <div class="toolbar"><div class="pills">${tabs.map(([k, l]) => `<button class="${ui.orderTab === k ? 'active' : ''}" onclick="ui.orderTab='${k}';render()">${l}</button>`).join('')}</div><span class="small muted">${list.length} 笔</span></div>
  ${list.length ? `<div class="order-list">${list.map(o => orderCard(o, user)).join('')}</div>` : `<div class="empty">这里还没有订单。<br><button class="btn ghost" style="margin-top:14px" onclick="go('home')">去逛逛</button></div>`}`;
}
function orderCard(order, user) {
  const item = getItem(order.itemId);
  const buyer = getUser(order.buyerId);
  const seller = getUser(order.sellerId);
  const isBuyer = order.buyerId === user.id;
  const isSeller = order.sellerId === user.id;
  const actions = [];
  if (order.status === 'unpaid' && isBuyer) {
    actions.push(`<button class="btn orange small" onclick="event.stopPropagation();payOrder('${order.id}')">去支付</button>`);
    actions.push(`<button class="btn line small" onclick="event.stopPropagation();cancelOrder('${order.id}')">取消</button>`);
  }
  if (order.status === 'to_deliver' && isSeller) actions.push(`<button class="btn small" onclick="event.stopPropagation();deliverOrder('${order.id}')">确认交付</button>`);
  if (order.status === 'to_confirm' && isBuyer) actions.push(`<button class="btn orange small" onclick="event.stopPropagation();confirmOrder('${order.id}')">确认收货</button>`);
  if (order.status === 'completed' && isBuyer && !order.reviewed) actions.push(`<button class="btn line small" onclick="event.stopPropagation();openReview('${order.id}')">评价</button>`);
  return `<div class="order-card" onclick="go('orderDetail',{orderId:'${order.id}'})">
    <div class="order-top"><span class="order-id">订单 ${order.id} · ${fmtTime(order.createdAt)}</span>${statusPill(order.status)}</div>
    <div class="order-main">
      <div class="order-thumb" style="background:${item ? thumbBg(item) : CAT_STYLE['教材']}">${item ? thumbChar(item) : '物'}</div>
      <div class="order-item"><b>${esc(item ? item.title : '物品已删除')}</b><small>${isBuyer ? '我买到的' : isSeller ? '我卖出的' : '平台订单'} · 买家 ${esc(buyer ? buyer.name : '—')} · 卖家 ${esc(seller ? seller.name : '—')}</small></div>
      <div class="order-amount">${money(order.amount)}</div>
    </div>
    ${actions.length ? `<div class="order-actions">${actions.join('')}</div>` : ''}
  </div>`;
}
function viewOrderDetail(user) {
  const order = getOrder(ui.orderId);
  if (!order) return `<div class="empty">订单不存在。<button class="btn ghost" onclick="go('orders')">返回订单</button></div>`;
  if (order.orderType === 'swap') return `<div class="empty">这是一张置换单，确认和完成都在“置换”页面操作。<br><button class="btn orange" style="margin-top:14px" onclick="go('swaps')">去置换页面</button></div>`;
  const item = getItem(order.itemId);
  const buyer = getUser(order.buyerId);
  const seller = getUser(order.sellerId);
  const isBuyer = order.buyerId === user.id;
  const isSeller = order.sellerId === user.id;
  const steps = ['unpaid', 'to_deliver', 'to_confirm', 'completed'];
  const idx = steps.indexOf(order.status);
  const actions = [];
  if (order.status === 'unpaid' && isBuyer) {
    actions.push(`<button class="btn orange" onclick="payOrder('${order.id}')">支付 ${money(order.amount)}</button>`);
    actions.push(`<button class="btn line" onclick="cancelOrder('${order.id}')">取消订单</button>`);
  }
  if (order.status === 'to_deliver' && isSeller) actions.push(`<button class="btn" onclick="deliverOrder('${order.id}')">确认已交付</button>`);
  if (order.status === 'to_confirm' && isBuyer) actions.push(`<button class="btn orange" onclick="confirmOrder('${order.id}')">确认收货</button>`);
  if (order.status === 'completed' && isBuyer && !order.reviewed) actions.push(`<button class="btn line" onclick="openReview('${order.id}')">评价这笔交易</button>`);
  const review = db.reviews.find(r => r.orderId === order.id);
  return `<button class="back" onclick="go('orders')">‹ 返回订单</button>
  <div class="page-head"><div><h1>订单详情</h1><p>订单号 ${order.id}</p></div>${statusPill(order.status)}</div>
  <div class="detail-layout">
    <div class="panel">
      <div style="display:flex;gap:12px;align-items:center">
        <div class="order-thumb" style="width:76px;height:76px;border-radius:12px;background:${item ? thumbBg(item) : CAT_STYLE['教材']};font-size:17px">${item ? thumbChar(item) : '物'}</div>
        <div style="flex:1"><div class="item-cat">${item ? esc(item.category) : ''}</div><div style="margin-top:5px;font-size:15px;font-weight:750">${esc(item ? item.title : '物品已删除')}</div><div style="margin-top:5px;color:var(--orange);font-size:20px;font-weight:850">${money(order.amount)}</div></div>
      </div>
      <div class="divider"></div>
      <div class="kv"><span>交易状态</span><span>${statusText(order.status)}</span></div>
      <div class="kv"><span>买家</span><span>${esc(buyer ? buyer.name : '—')}</span></div>
      <div class="kv"><span>卖家</span><span>${esc(seller ? seller.name : '—')}</span></div>
      <div class="kv"><span>交付方式</span><span>${esc(order.delivery || (item ? item.delivery : '面交'))}</span></div>
      <div class="kv"><span>创建时间</span><span>${fmtTime(order.createdAt)}</span></div>
      <div class="kv"><span>支付时间</span><span>${fmtTime(order.paidAt)}</span></div>
      <div class="kv"><span>完成时间</span><span>${fmtTime(order.completedAt)}</span></div>
      ${order.status === 'unpaid' ? `<div class="notice" style="margin-top:12px">请在 <span id="countdown" class="countdown">30 秒</span> 内完成支付，超时订单会自动取消并解锁物品。</div>` : ''}
      ${actions.length ? `<div class="buy-row">${actions.join('')}</div>` : ''}
      ${order.status === 'to_deliver' && isBuyer ? `<div class="notice" style="margin-top:12px">等待卖家确认交付。线下完成面交/自提后，卖家会在系统里记录交付。</div>` : ''}
      ${order.status === 'to_confirm' && isSeller ? `<div class="notice" style="margin-top:12px">已记录交付，等待买家确认收货；确认后平台会把托管金额放款到你的钱包。</div>` : ''}
      ${review ? `<div class="detail-desc" style="margin-top:12px"><h3>买家评价</h3><p>${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}　${esc(review.text || '未填写文字评价')}</p></div>` : ''}
    </div>
    <div class="panel">
      <h3 style="margin:0 0 12px;font-size:13px">交易进度</h3>
      <div class="timeline">
        ${steps.map((s, i) => `<p style="${i <= idx ? '' : 'opacity:.45'}">${statusText(s)}${i === 0 ? ' · 下单' : i === 1 ? ' · 支付托管' : i === 2 ? ' · 交付待确认' : ' · 放款完成'}</p>`).join('')}
      </div>
      ${order.status === 'cancelled' ? '<div class="notice" style="margin-top:14px">该订单已取消，物品已回到在售。</div>' : ''}
      <div class="divider"></div>
      <div class="small muted" style="line-height:1.8">平台规则：支付后资金进入托管；买家确认收货后放款；收货后 5 分钟内可申请售后；退款/仲裁按交易状态分流。</div>
    </div>
  </div>`;
}

/* ---------- publish ---------- */
function viewPublish(user) {
  if (user.role === 'admin') return `<div class="empty">运营账号不发布物品。<button class="btn ghost" onclick="go('admin')">去审核后台</button></div>`;
  return `<div class="page-head"><div><h1>发布闲置</h1><p>填写物品信息，提交后由运营审核；审核通过自动上架。</p></div></div>
  <div class="panel" style="max-width:840px">
    <form onsubmit="publishItem(event)">
      <div class="form-grid">
        <div class="field span2"><label>标题</label><input name="title" placeholder="例如：高等数学 第七版" maxlength="60" required></div>
        <div class="field"><label>分类</label><select name="categoryId">${(db.categories || []).filter(c => c.status === 'active').map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>成色</label><select name="condition">${Object.entries(CONDITION_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>售价（元）</label><input name="price" type="number" min="0.01" step="0.01" placeholder="18" required></div>
        <div class="field"><label>原价（元）</label><input name="originalPrice" type="number" min="0" step="0.01" placeholder="45"></div>
        <div class="field"><label>交易方式</label><select name="delivery"><option>面交/自提</option><option>面交</option><option>自提</option></select></div>
        <div class="field span2"><label>图片 URL（每行一张，最多 6 张）</label><textarea name="images" placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"></textarea></div>
        <div class="field span2"><label>描述</label><textarea name="description" placeholder="成色、瑕疵、配件、可约地点……" required></textarea></div>
      </div>
      <div class="form-note">提交后进入“待审核”，运营在审核后台通过后才会出现在首页。演示环境会自动通过学籍认证。</div>
      <div class="submit-row"><button type="button" class="btn line" onclick="go('home')">取消</button><button class="btn orange" type="submit">提交审核</button></div>
    </form>
  </div>`;
}
async function publishItem(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const title = String(fd.get('title') || '').trim();
  const price = Number(fd.get('price'));
  if (title.length < 2) return toast('标题至少 2 个字');
  if (!price || price <= 0) return toast('请输入有效售价');
  const payload = {
    title, categoryId: String(fd.get('categoryId') || ''),
    price, originalPrice: Number(fd.get('originalPrice')) || price,
    condition: String(fd.get('condition')), description: String(fd.get('description') || '').trim(),
    delivery: String(fd.get('delivery')),
    images: String(fd.get('images') || '').split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 6)
  };
  try {
    await api('/api/items', payload);
    await refreshState(false);
    toast('已提交审核，运营通过后自动上架');
    go('my');
  } catch (err) {
    toast(err.message || '发布失败');
  }
}

/* ---------- wallet ---------- */
function viewWallet(user) {
  if (user.role === 'admin') return `<div class="empty">运营账号没有学生钱包。<button class="btn ghost" onclick="go('admin')">返回后台</button></div>`;
  const tx = db.tx.filter(t => t.userId === user.id).sort((a, b) => b.at - a.at);
  return `<div class="page-head"><div><h1>我的钱包</h1><p>模拟钱包 · 充值、支付、退款、放款都记录流水。</p></div></div>
  <div class="wallet-hero"><small>可用余额</small><div class="amount">${money(user.balance)}</div><button class="btn" onclick="recharge()">模拟充值 ¥100</button></div>
  <div class="section-head"><div><h2>资金流水</h2><p>共 ${tx.length} 条</p></div></div>
  ${tx.length ? `<div class="tx-list">${tx.map(t => `<div class="tx-row"><div class="tx-icon">${t.amount > 0 ? '＋' : '－'}</div><div class="tx-info"><b>${esc(t.type)}</b><small>${fmtTime(t.at)} · ${esc(t.note || '')}</small></div><div class="tx-amount ${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${money(t.amount)}</div></div>`).join('')}</div>` : `<div class="empty">还没有资金流水。去首页买一件物品，或者先模拟充值。</div>`}`;
}
async function recharge() {
  const user = me();
  if (!user || user.role === 'admin') return;
  try {
    await api('/api/wallet/recharge');
    await refreshState(false);
    toast('已充值 ¥100（演示）');
    render();
  } catch (err) {
    toast(err.message || '充值失败');
  }
}

/* ---------- admin ---------- */
function viewAdmin(user) {
  if (user.role !== 'admin') return `<div class="empty">只有运营账号可以进入审核后台。</div>`;
  const pending = db.items.filter(i => i.status === 'pending');
  const onSale = db.items.filter(i => i.status === 'on_sale');
  const orders = db.orders;
  const gmv = orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.amount, 0);
  const auditTab = ui.adminTab || 'audit';
  return `<div class="page-head"><div><h1>运营工作台</h1><p>审核物品、查看订单与平台数据。</p></div><button class="btn ghost" onclick="go('home')">回到首页</button></div>
  <div class="stat-grid">
    <div class="stat-card"><b>${pending.length}</b><span>待审核物品</span></div>
    <div class="stat-card"><b>${onSale.length}</b><span>在售物品</span></div>
    <div class="stat-card"><b>${orders.length}</b><span>累计订单</span></div>
    <div class="stat-card"><b>${money(gmv)}</b><span>已完成成交额</span></div>
  </div>
  <div class="toolbar"><div class="pills"><button class="${auditTab === 'audit' ? 'active' : ''}" onclick="ui.adminTab='audit';render()">审核队列</button><button class="${auditTab === 'items' ? 'active' : ''}" onclick="ui.adminTab='items';render()">全部物品</button><button class="${auditTab === 'orders' ? 'active' : ''}" onclick="ui.adminTab='orders';render()">全部订单</button><button class="${auditTab === 'verifications' ? 'active' : ''}" onclick="ui.adminTab='verifications';render()">认证审核</button><button class="${auditTab === 'arbitrations' ? 'active' : ''}" onclick="ui.adminTab='arbitrations';render()">仲裁</button><button class="${auditTab === 'base' ? 'active' : ''}" onclick="ui.adminTab='base';render()">基础数据</button></div></div>
  ${auditTab === 'audit' ? renderAuditQueue(pending) : auditTab === 'items' ? renderAdminItems() : auditTab === 'orders' ? renderAdminOrders(orders) : auditTab === 'verifications' ? renderVerifications() : auditTab === 'arbitrations' ? renderArbitrations() : renderAdminBase()}`;
}
function renderAuditQueue(pending) {
  if (!pending.length) return `<div class="empty">审核队列为空，所有物品都已处理。</div>`;
  return `<div class="audit-list">${pending.map(i => {
    const owner = getUser(i.ownerId);
    return `<div class="audit-card">
      <div class="item-thumb" style="background:${thumbBg(i)}"><span class="big">${thumbChar(i)}</span></div>
      <div class="audit-info"><b>${esc(i.title)}</b><small>${esc(owner ? owner.name : '—')} · ${esc(owner ? owner.college : '')} · ${money(i.price)} · ${esc(CONDITION_LABEL[i.condition] || i.condition)}</small><span class="tag">${esc(i.category)} · ${esc(i.delivery)}</span></div>
      <div class="audit-actions"><button class="btn small" onclick="approveItem('${i.id}')">通过</button><button class="btn danger small" onclick="rejectItem('${i.id}')">驳回</button></div>
    </div>`;
  }).join('')}</div>`;
}
async function approveItem(id) {
  const item = getItem(id);
  if (!item || item.status !== 'pending') return toast('该物品不在待审核状态');
  try {
    await api(`/api/items/${encodeURIComponent(id)}/approve`);
    await refreshState(false);
    toast('已通过审核，物品自动上架');
    render();
  } catch (err) {
    toast(err.message || '审核失败');
  }
}
async function rejectItem(id) {
  const item = getItem(id);
  if (!item || item.status !== 'pending') return toast('该物品不在待审核状态');
  const reason = window.prompt('请填写驳回原因（可留空）', '信息不完整，请补充描述或图片');
  if (reason === null) return;
  try {
    await api(`/api/items/${encodeURIComponent(id)}/reject`, { reason: reason || '未填写原因' });
    await refreshState(false);
    toast('已驳回该物品');
    render();
  } catch (err) {
    toast(err.message || '驳回失败');
  }
}
function renderAdminItems() {
  const list = db.items.slice().sort((a, b) => b.createdAt - a.createdAt);
  return `<div class="panel" style="padding:0;overflow:hidden"><table class="table"><thead><tr><th>物品</th><th>分类</th><th>卖家</th><th>价格</th><th>状态</th><th>发布时间</th></tr></thead><tbody>
  ${list.map(i => `<tr><td class="title-cell">${esc(i.title)}</td><td>${esc(i.category)}</td><td>${esc((getUser(i.ownerId) || {}).name || '—')}</td><td>${money(i.price)}</td><td>${itemStatusPill(i.status)}</td><td>${fmtTime(i.createdAt)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderAdminOrders(orders) {
  if (!orders.length) return `<div class="empty">暂无订单。</div>`;
  return `<div class="panel" style="padding:0;overflow:hidden"><table class="table"><thead><tr><th>订单</th><th>物品</th><th>买家</th><th>卖家</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody>
  ${orders.map(o => { const it = getItem(o.itemId); return `<tr><td>${o.id}</td><td class="title-cell">${esc(it ? it.title : '—')}</td><td>${esc((getUser(o.buyerId) || {}).name || '—')}</td><td>${esc((getUser(o.sellerId) || {}).name || '—')}</td><td>${money(o.amount)}</td><td>${statusPill(o.status)}</td><td>${fmtTime(o.createdAt)}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function renderVerifications() {
  const rows = db.verifications || [];
  if (!rows.length) return `<div class="empty">暂无认证申请。</div>`;
  return `<div class="panel" style="padding:0;overflow:hidden"><table class="table"><thead><tr><th>学号</th><th>姓名</th><th>学院</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
  ${rows.map(v => `<tr><td>${esc(v.studentNo)}</td><td>${esc(v.realName)}</td><td>${esc(v.college || '—')}</td><td>${v.status === 'pending' ? '<span class="tag">待审核</span>' : v.status === 'approved' ? '<span class="tag green">已通过</span>' : `<span class="tag red">已驳回</span><small>${esc(v.reason || '')}</small>`}</td><td>${fmtTime(v.createdAt)}</td><td>${v.status === 'pending' ? `<button class="btn small" onclick="reviewVerification('${v.id}','approved')">通过</button> <button class="btn danger small" onclick="reviewVerification('${v.id}','rejected')">驳回</button>` : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}
async function reviewVerification(id, action) {
  let reason = '';
  if (action === 'rejected') { reason = prompt('驳回原因：', '学号或姓名与学籍库不一致') || ''; if (!reason) return; }
  try {
    await api(`/api/admin/verifications/${encodeURIComponent(id)}/review`, { action: action === 'approved' ? 'approve' : 'reject', reason });
    await refreshState(false);
    toast(action === 'approved' ? '认证已通过' : '认证已驳回');
    render();
  } catch (err) { toast(err.message || '审核失败'); }
}
function renderArbitrations() {
  const rows = db.arbitrations || [];
  if (!rows.length) return `<div class="empty">暂无仲裁申请。</div>`;
  return `<div class="panel" style="padding:0;overflow:hidden"><table class="table"><thead><tr><th>订单</th><th>申请人</th><th>原因</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>
  ${rows.map(a => `<tr><td>${esc(a.orderId)}</td><td>${esc((getUser(a.applicantId) || {}).name || a.applicantId)}</td><td style="max-width:260px">${esc(a.reason)}<br><small class="muted">${esc(a.evidence || '')}</small></td><td>${a.status === 'pending' ? '<span class="tag">待处理</span>' : `<span class="tag green">已裁定</span><small>${esc(a.result || '')}</small>`}</td><td>${fmtTime(a.createdAt)}</td><td>${a.status === 'pending' ? `<button class="btn small" onclick="decideArbitration('${a.id}','support_buyer')">支持买家</button> <button class="btn danger small" onclick="decideArbitration('${a.id}','support_seller')">支持卖家</button>` : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}
async function decideArbitration(id, action) {
  const result = prompt('裁定说明：', action === 'support_buyer' ? '支持买家退款/回滚' : '支持卖家，售后关闭') || '';
  try {
    await api(`/api/admin/arbitrations/${encodeURIComponent(id)}/decide`, { action, result });
    await refreshState(false);
    toast('仲裁已处理');
    render();
  } catch (err) { toast(err.message || '处理失败'); }
}
function renderAdminBase() {
  const cats = db.categories || [];
  const points = db.pickupPoints || [];
  const roster = db.roster || [];
  return `<div class="grid-2">
    <div class="panel"><h3 style="margin:0 0 12px;font-size:14px">分类管理</h3><form onsubmit="addCategory(event)" class="form-grid"><div class="field"><label>分类名</label><input name="name" placeholder="如：运动" required></div><div class="field"><label>排序</label><input name="sort" type="number" value="6"></div><div class="submit-row span2"><button class="btn orange" type="submit">新增分类</button></div></form><div style="margin-top:12px">${cats.map(c => `<div class="my-item-row"><div style="flex:1"><b>${esc(c.name)}</b><small>${c.status} · 排序 ${c.sort}</small></div></div>`).join('') || '<div class="muted small">暂无分类</div>'}</div></div>
    <div class="panel"><h3 style="margin:0 0 12px;font-size:14px">自提点</h3><form onsubmit="addPickupPoint(event)" class="form-grid"><div class="field"><label>名称</label><input name="name" placeholder="图书馆服务台" required></div><div class="field"><label>地址</label><input name="address" placeholder="图书馆一楼" required></div><div class="field span2"><label>联系人</label><input name="contact" placeholder="值班老师"></div><div class="submit-row span2"><button class="btn orange" type="submit">新增自提点</button></div></form><div style="margin-top:12px">${points.map(p => `<div class="my-item-row"><div style="flex:1"><b>${esc(p.name)}</b><small>${esc(p.address)} · ${esc(p.contact || '')}</small></div></div>`).join('') || '<div class="muted small">暂无自提点</div>'}</div></div>
    <div class="panel" style="grid-column:1/-1"><h3 style="margin:0 0 12px;font-size:14px">学籍名单（${roster.length} 条）</h3><form onsubmit="importRoster(event)"><div class="field"><label>CSV：学号,姓名,学院,专业,年级,班级（每行一条）</label><textarea name="rows" placeholder="20230003,张三,计算机学院,软件工程,2023,软工2301" required></textarea></div><div class="submit-row"><button class="btn orange" type="submit">导入学籍</button></div></form><div style="margin-top:12px">${roster.slice(0, 20).map(r => `<div class="my-item-row"><div style="flex:1"><b>${esc(r.studentNo)} · ${esc(r.name)}</b><small>${esc(r.college)} · ${esc(r.major || '')} · ${esc(r.grade || '')}</small></div></div>`).join('') || '<div class="muted small">暂无学籍数据</div>'}</div></div>
  </div>`;
}
async function addCategory(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try { await api('/api/categories', { name: String(fd.get('name') || '').trim(), sort: Number(fd.get('sort')) || 0 }); await refreshState(false); toast('分类已新增'); render(); } catch (err) { toast(err.message || '新增失败'); }
}
async function addPickupPoint(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try { await api('/api/admin/pickup-points', { name: String(fd.get('name') || '').trim(), address: String(fd.get('address') || '').trim(), contact: String(fd.get('contact') || '').trim() }); await refreshState(false); toast('自提点已新增'); render(); } catch (err) { toast(err.message || '新增失败'); }
}
async function importRoster(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const rows = String(fd.get('rows') || '').split('\n').map(line => line.split(',').map(s => s.trim())).filter(r => r.length >= 3);
  if (!rows.length) return toast('没有可导入的行');
  const students = rows.map(r => ({ studentNo: r[0], name: r[1], college: r[2] || '', major: r[3] || '', grade: r[4] || '', className: r[5] || '' }));
  try { await api('/api/admin/roster/import', { students }); await refreshState(false); toast(`已导入 ${students.length} 条`); render(); } catch (err) { toast(err.message || '导入失败'); }
}

/* ---------- my ---------- */

function verificationPanel(user) {
  if (user.role !== 'student') return '';
  const pending = (db.verifications || []).find(v => v.status === 'pending');
  const latest = (db.verifications || [])[0];
  if (user.verified) return `<div class="panel" style="margin-top:16px"><h3 style="margin:0 0 6px;font-size:13px">学籍认证</h3><p class="small muted" style="margin:0">已认证 · ${esc(user.college || '')}。认证记录可在下方查看。</p></div>`;
  if (pending) return `<div class="panel" style="margin-top:16px"><h3 style="margin:0 0 6px;font-size:13px">学籍认证</h3><p class="small muted" style="margin:0">申请已提交，等待运营审核：${esc(pending.studentNo)} · ${esc(pending.realName)}。</p></div>`;
  return `<div class="panel" style="margin-top:16px">
    <h3 style="margin:0 0 6px;font-size:13px">学籍认证</h3>
    <p class="small muted" style="margin:0 0 10px">${latest && latest.status === 'rejected' ? `上次未通过：${esc(latest.reason || '信息不一致')}。` : '认证后才能发布、下单和置换。'}</p>
    <form onsubmit="submitVerification(event)"><div class="form-grid"><div class="field"><label>学号</label><input name="studentNo" placeholder="20230001" required></div><div class="field"><label>姓名</label><input name="realName" placeholder="与学籍库一致" required></div></div><div class="submit-row"><button class="btn orange" type="submit">提交认证</button></div></form>
  </div>`;
}
async function submitVerification(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/verifications', { studentNo: String(fd.get('studentNo') || '').trim(), realName: String(fd.get('realName') || '').trim() });
    await refreshState(false);
    toast('认证申请已提交');
    render();
  } catch (err) { toast(err.message || '提交失败'); }
}
function viewMy(user) {
  const isAdmin = user.role === 'admin';
  const myItems = db.items.filter(i => i.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const myOrders = db.orders.filter(o => o.buyerId === user.id || o.sellerId === user.id);
  return `<div class="page-head"><div><h1>我的</h1><p>账号、余额、发布和演示数据管理。</p></div></div>
  <div class="panel">
    <div class="profile-head"><span class="avatar">${esc(avatarChar(user))}</span><div><h2>${esc(user.name)}</h2><p>${esc(user.college)} · ${isAdmin ? '运营账号' : user.verified ? '学籍已认证' : '未认证'} · 信用 ${user.credit}</p></div><div style="margin-left:auto;text-align:right"><div class="small muted">${isAdmin ? '运营账号' : '可用余额'}</div><div style="font-size:22px;font-weight:850;color:var(--green)">${isAdmin ? '—' : money(user.balance)}</div></div></div>
    <div class="divider"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${isAdmin ? `<button class="btn" onclick="go('admin')">进入审核后台</button>` : `<button class="btn" onclick="go('wallet')">查看钱包</button><button class="btn ghost" onclick="go('publish')">发布闲置</button>`}
      <button class="btn line" onclick="logout()">退出登录</button>
    </div>
  </div>
  ${verificationPanel(user)}
  ${!isAdmin && (db.favorites || []).length ? `<div class="section-head"><div><h2>我的收藏</h2><p>${db.favorites.length} 件</p></div></div><div class="panel" style="padding:6px 16px">${db.favorites.map(f => { const it = getItem(f.itemId); return it ? `<div class="my-item-row" onclick="openItem('${it.id}')"><div class="order-thumb" style="background:${thumbBg(it)}">${thumbChar(it)}</div><div style="flex:1"><b>${esc(it.title)}</b><small>${esc(it.category)} · ${money(it.price)}</small></div><div class="right">${itemStatusPill(it.status)}</div></div>` : ''; }).join('')}</div>` : ''}
  ${!isAdmin ? `<div class="section-head"><div><h2>我发布的</h2><p>${myItems.length} 件 · 审核通过后自动上架</p></div></div>
  <div class="panel" style="padding:6px 16px">
    ${myItems.length ? myItems.map(i => `<div class="my-item-row" onclick="openItem('${i.id}')"><div class="order-thumb" style="background:${thumbBg(i)}">${thumbChar(i)}</div><div style="flex:1"><b>${esc(i.title)}</b><small>${esc(i.category)} · ${money(i.price)} · ${fmtTime(i.createdAt)}</small></div><div class="right">${itemStatusPill(i.status)}</div></div>`).join('') : '<div class="empty" style="border:0;padding:26px 0">还没有发布过物品。<button class="btn ghost" style="margin-top:12px" onclick="go(\'publish\')">去发布</button></div>'}
  </div>` : ''}
  <div class="section-head"><div><h2>我的订单</h2><p>${myOrders.length} 笔</p></div><button class="btn line small" onclick="go('orders')">查看全部</button></div>
  <div class="panel" style="padding:6px 16px">${myOrders.length ? myOrders.slice(0, 3).map(o => { const it = getItem(o.itemId); return `<div class="my-item-row" onclick="go('orderDetail',{orderId:'${o.id}'})"><div class="order-thumb" style="background:${it ? thumbBg(it) : CAT_STYLE['教材']}">${it ? thumbChar(it) : '物'}</div><div style="flex:1"><b>${esc(it ? it.title : '物品已删除')}</b><small>${o.id} · ${money(o.amount)} · ${fmtTime(o.createdAt)}</small></div><div class="right">${statusPill(o.status)}</div></div>`; }).join('') : '<div class="empty" style="border:0;padding:26px 0">还没有订单。<button class="btn ghost" style="margin-top:12px" onclick="go(\'home\')">去逛逛</button></div>'}</div>
  ${!isAdmin ? `<div class="section-head"><div><h2>信用流水</h2><p>最近 ${(db.creditRecords || []).length} 条</p></div></div><div class="panel" style="padding:6px 16px">${(db.creditRecords || []).length ? db.creditRecords.slice(0, 8).map(c => `<div class="my-item-row"><div class="order-thumb" style="background:linear-gradient(145deg,#7a6b9a,#493f69)">信</div><div style="flex:1"><b>${esc(c.reason)}</b><small>${fmtTime(c.createdAt)} · ${esc(c.refType || '')} ${esc(c.refId || '')}</small></div><div class="right" style="color:${c.change >= 0 ? 'var(--green)' : '#b45309'};font-weight:800">${c.change >= 0 ? '+' : ''}${c.change}</div></div>`).join('') : '<div class="empty" style="border:0;padding:20px 0">交易完成后会产生信用流水。</div>'}</div>` : ''}
  <div class="panel" style="margin-top:16px">
    <h3 style="margin:0 0 6px;font-size:13px">演示数据</h3>
    <p class="small muted" style="line-height:1.7;margin:0 0 12px">所有数据保存在 Railway 云端 MySQL 数据库 shiguangji。重置会清空发布、订单、流水、评价和审核记录，恢复初始演示状态。</p>
    <button class="btn danger" onclick="resetDemo()">重置演示数据</button>
  </div>`;
}
async function resetDemo() {
  if (!window.confirm('确定重置 MySQL 中的演示数据吗？此操作会清空发布、订单、流水、评价和审核记录，并恢复初始数据。')) return;
  try {
    await api('/api/reset', { confirm: 'RESET' });
    await api('/api/logout');
    store.removeItem(SESSION_KEY);
    currentUserId = null;
    db = { users: [], items: [], orders: [], reviews: [], tx: [], audits: [], history: [], swaps: { intents: [], plans: [] }, categories: [], images: [], favorites: [], notifications: [], wanted: [], arbitrations: [], verifications: [], roster: [], pickupPoints: [], deliveries: [], creditRecords: [], platform: null };
    ui = { route: 'home', itemId: null, orderId: null, q: '', cat: '全部', orderTab: 'all', adminTab: 'audit', loginTab: 'login' };
    toast('MySQL 演示数据已重置');
    renderLogin();
  } catch (err) {
    toast(err.message || '重置失败');
  }
}

/* ---------- reviews ---------- */
function openReview(orderId) {
  const order = getOrder(orderId);
  if (!order || order.status !== 'completed') return toast('订单完成后才能评价');
  if (order.buyerId !== me().id) return toast('只有买家可以评价');
  if (order.reviewed) return toast('这笔订单已经评价过了');
  reviewRating = 5;
  modalEl.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
    <h3>评价这笔交易</h3><p>评价只展示，不直接改变信用分；退款成立时评价会作废。</p>
    <div class="stars" id="stars">${[1, 2, 3, 4, 5].map(n => `<button class="${n <= reviewRating ? 'on' : ''}" onclick="setReviewRating(${n})">★</button>`).join('')}</div>
    <div class="field"><label>评价内容</label><textarea id="review-text" placeholder="物品和描述一致吗？卖家沟通如何？"></textarea></div>
    <div class="modal-actions"><button class="btn line" onclick="closeModal()">取消</button><button class="btn orange" onclick="submitReview('${orderId}')">提交评价</button></div>
  </div>`;
  modalEl.classList.add('show');
  modalEl.onclick = closeModal;
}
function setReviewRating(n) {
  reviewRating = n;
  const stars = document.getElementById('stars');
  if (stars) [...stars.children].forEach((b, i) => b.classList.toggle('on', i < n));
}
async function submitReview(orderId) {
  const order = getOrder(orderId);
  if (!order || order.status !== 'completed' || order.reviewed) return closeModal();
  const text = (document.getElementById('review-text') || {}).value || '';
  try {
    await api('/api/reviews', { orderId, rating: reviewRating, text: text.trim() });
    await refreshState(false);
    closeModal();
    toast('评价已提交');
    render();
  } catch (err) {
    toast(err.message || '评价失败');
  }
}

/* ---------- boot ---------- */
(async function boot() {
  try {
    const data = await refreshState(false);
    if (!data) { renderLogin(); return; }
    ui.route = data.user && data.user.role === 'admin' ? 'admin' : 'home';
    render();
  } catch (err) {
    store.removeItem(SESSION_KEY);
    currentUserId = null;
    app.innerHTML = `<div class="empty" style="margin-top:60px">无法连接 MySQL 后端。<br>请先在项目目录运行 <b>start.bat</b> 或 <b>npm start</b>。<br><span class="small">${esc(err.message || '')}</span></div>`;
  }
})();
