# Railway 部署 / 复现清单

这份清单是给“过几天又忘了怎么部署”的情况用的。照着从上到下做即可。

## 当前线上信息

- 线上地址：<https://work-production-e1c5e2db.up.railway.app>
- GitHub：<https://github.com/WenTing548/work>
- Railway 项目：`daring-flexibility`
- Node 服务：`work`
- 数据库服务：`MySQL`
- 数据库名：`railway`
- 演示账号：`student1 / 123456`、`student2 / 123456`、`admin / admin123`

> 数据库密码不要写进仓库，只在 Railway 的 Variables 和本地密码管理器里保存。

---

## 一、日常更新（最常用）

修改代码后：

```bash
git add .
git commit -m "你的修改说明"
git push origin main
```

Railway 会自动重新部署。打开：

```text
Railway → work → Deployments
```

等状态变成：

```text
ACTIVE
```

如果只改了环境变量：

```text
work → Variables → 修改 → Update Variables → Deployments → Redeploy
```

---

## 二、从零部署

### 1. 准备 GitHub

确认仓库是公开的：

```text
https://github.com/WenTing548/work
```

代码在 `main` 分支。

### 2. Railway 导入仓库

```text
New Project
→ Deploy from GitHub repo
→ 选择 WenTing548/work
```

如果列表是空的，直接在搜索框粘贴：

```text
https://github.com/WenTing548/work
```

### 3. 让 Railway 从仓库根目录启动

仓库根目录必须有一个 `package.json`：

```json
{
  "name": "shiguangji-work",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node fullstack/server.js"
  },
  "dependencies": {
    "mysql2": "^3.11.5"
  }
}
```

这个文件的作用是告诉 Railway：

```text
在根目录 npm install
然后 node fullstack/server.js
```

> 如果 Railway 界面里找不到 Root Directory，不要纠结；根目录的 `package.json` 已经解决了这个问题。

### 4. 添加 MySQL

项目画布：

```text
+ Add → Database → MySQL
```

等 MySQL 变成 `ACTIVE`。

### 5. 打开 MySQL 公网访问（只为本地导表）

```text
MySQL → Connect → Public Network → Add Public Access
```

如果提示：

```text
A public endpoint is staged. Deploy it to activate.
```

就去 MySQL 的 `Deployments` 点一次 `Deploy`。

生成后记下：

```text
Host
Port
Username
Password
Database
```

### 6. 用 Navicat 导入表结构

用上面的 Host / Port / Username / Password 建连接。

不要用 `运行 SQL 文件` 那个窗口，它经常显示数据库 `N/A`。直接在查询窗口执行：

```sql
USE railway;
```

然后把 `fullstack/schema.sql` 的全部内容粘贴到下面，执行。

成功后刷新，应该有 6 张表：

```text
users
items
orders
payments
reviews
audits
```

### 7. 给 work 配数据库变量

```text
work → Variables → Raw Editor
```

粘贴：

```text
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_SSL=false
PORT=8080
```

点击 `Update Variables`。

> `PORT=8080` 要和 Railway 域名的 Target Port 一致。
> 如果日志显示应用监听 3000，就把这里和 Target Port 都改成 3000。

### 8. 重新部署

```text
work → Deployments → Redeploy
```

等状态变成：

```text
ACTIVE
```

### 9. 生成域名

```text
work → Settings → Networking → Public Networking
→ Generate Domain
```

端口填：

```text
8080
```

如果已经有域名，只检查 Target Port 是否是 8080。

### 10. 验证

打开：

```text
https://你的域名/api/health
```

应该返回：

```json
{"ok":true,"service":"shiguangji-mysql"}
```

再打开首页，用：

```text
student1 / 123456
```

登录，能浏览、下单、支付就说明成功。

---

## 三、常见报错对照

| 报错 | 原因 | 处理 |
|---|---|---|
| `Railpack failed to prepare the build` | 仓库根目录没有 `package.json` | 确认根目录 `package.json` 存在，`start` 指向 `node fullstack/server.js` |
| `connect ECONNREFUSED 127.0.0.1:3306` | 没有配数据库变量 | 加 `DB_HOST/DB_PORT/...`，Redeploy |
| `502 Application failed to respond` | 应用端口和域名 Target Port 不一致 | 日志里的端口和 Target Port 都改成 8080 |
| `No repositories found` | GitHub App 没授权 | 点 `Configure GitHub App`，勾选 `work`；或直接粘贴仓库 URL |
| Navicat 显示数据库 `N/A` | 在连接层级运行 SQL 文件 | 用查询窗口先执行 `USE railway;`，再粘贴 `schema.sql` |
| `Unknown database 'railway'` | 库名不对 | 在 Navicat 看实际数据库名，或看 Railway MySQL 的 `MYSQLDATABASE` |
| 登录报 `Access denied` | 数据库账号/密码不对 | 用 MySQL 的 Variables 重新填 |
| 域名打开是 Railway 502 页面 | 服务没起来或端口错 | 先看 Deploy Logs，再对 Target Port |

---

## 四、验收清单

- [ ] `/api/health` 返回 `ok:true`
- [ ] `student1 / 123456` 能登录
- [ ] 首页能看到商品
- [ ] 能下单、支付
- [ ] `student2` 能交付
- [ ] `student1` 能确认收货
- [ ] 订单状态变成“已完成”
- [ ] `admin / admin123` 能进运营后台

---

## 五、注意

- Railway 是试用实例，`30 days or $5.00 left` 到期后可能停服。
- 免费实例长时间不访问会休眠，第一次打开慢是正常的。
- 公网 MySQL 访问会产生 egress 费用；导完表后可以在 `Networking settings` 删除 Public Access。
- 这是课程演示版，不要放真实用户数据。
- 生产环境一般不会用 Railway，而是阿里云/腾讯云/K8s + RDS；Railway 适合快速演示。
