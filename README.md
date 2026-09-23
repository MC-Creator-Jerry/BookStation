# 书栈 BookStation

一个**独立**的小说站：独立 Cloudflare Pages 项目、独立 KV、独立后端 Functions、独立 GitHub 仓库。

- 线上：**https://jerrybookstation.pages.dev/**
- Pages 项目：`jerrybookstation`
- KV：`BOOKSTATION_KV`（id `d1d243224f6c47dc95c9ab09df3db8c9`）
- GitHub 镜像：`MC-Creator-Jerry/BookStation`
- 管理员会话 Cookie：`bs_sid`（HttpOnly + Secure + SameSite=Lax，TTL 12h）

## 架构

```
bookstation-site/
├─ index.html            书架（搜索 / 标签 / 状态 / 排序）
├─ book.html             书籍详情 + 章节目录
├─ read.html             阅读页（字号 / 行距 / 明暗 / 进度 / 键盘翻页）
├─ admin/index.html      管理台（登录 + 书籍 / 章节管理）
├─ 404.html
├─ assets/               bookstation.css · bookstation.js · reader.js · admin.js · favicon.svg
├─ _headers              HTML 不缓存 + 基础安全头
└─ functions/            独立后端
   ├─ _lib/store.js      KV 数据层（books:index / book: / chaps: / chap:）
   ├─ _lib/auth.js       管理员鉴权（管理员仅经小蓝页 SSO 获得；角色 role:'admin'/'creator'）
   └─ api/
      ├─ books.js        GET 列表(搜索/标签/排序/分页) · POST 新建(admin)
      ├─ book.js         GET 详情(含目录) · PUT 改(admin) · DELETE 删(admin)
      ├─ chapter.js      GET 正文(含上下章) · POST 追加/移动(admin) · PUT/DELETE(admin)
      └─ admin/login.js · logout.js · me.js
```

## 数据键位（KV: BOOKSTATION_KV）

| 键 | 值 |
|---|---|
| `books:index` | `[bookId, ...]` 书架索引（顺序即展示顺序） |
| `book:<bookId>` | `{id,title,author,cover,intro,tags,status,createdAt,updatedAt,chapterCount,words,views}` |
| `chaps:<bookId>` | `[{id,title,words,createdAt,updatedAt}, ...]` 章节顺序 = 数组顺序 |
| `chap:<bookId>:<cid>` | `{id,bookId,title,content,createdAt,updatedAt}` |
| `bs_sid:<sid>` | 管理员会话（TTL 12h） |

章节顺序用「数组顺序」表达，删除某章**不需要重排**任何 idx。

## 部署

```powershell
# 部署（脚本内部会 Set-Location 到本站目录，保证不串到别的站的 Functions）
powershell -ExecutionPolicy Bypass -File ..\deploy-bookstation.ps1
powershell -ExecutionPolicy Bypass -File ..\deploy-bookstation-gh.ps1
```

> 管理员不需要站点密码：管理员身份由「小蓝页 SSO」授予（小蓝页那边 isAdmin=站主即本站管理员）。部署前请确认小蓝页与书栈两侧的 SSO 配对密钥（`SSO_SECRET_BOOKSTATION` / `SSO_CLIENT_SECRET`）已设置且相等。

## 隔离

本站 `wrangler.toml` 只绑 `BOOKSTATION_KV`，Functions 只从本站目录读取。线上核验：小蓝页 / 茶馆 / 片屿的路由（`/api/post`、`/api/me`、`/api/stats`、`/api/points`）在本站必须全部 404。

## 安全

- 章节正文按**纯文本**渲染（`textContent` 级别转义），不执行任何 HTML/脚本。
- 管理接口一律 `requireAdmin`：`/api/admin/*` 之外，书籍与章节的**写操作**全部需要登录。
- 管理员**不设站点密码**：管理员身份仅经小蓝页 SSO 授予（小蓝页管理员＝本站管理员，普通用户＝创作者）。
- `/api/admin/login` 已停用，调用一律返回 `use_sso`（400），引导改用 SSO 入口。
