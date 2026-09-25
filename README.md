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
| `book:<bookId>` | `{id,title,author,cover,intro,tags,category,status,createdAt,updatedAt,chapterCount,words,views}` |

> 字段说明：`category`（类型/分类）取自精选词表 `['小说','文学','诗歌','散文','随笔','科幻','奇幻','悬疑','推理','历史','传记','武侠','仙侠','言情','同人','漫画','剧本','教材','其他']`（见 `functions/_lib/store.js` 的 `CATEGORIES` 与前端 `assets/bookstation.js` 的 `BS.CATEGORIES`，两处需同步）；未传时兜底为「其他」。`tags` 为自由标签（最多 8 个，用顿号/逗号分隔）。
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
- **每日上传上限**：创作者每个「北京时间自然日」最多新建 **6 本**书（`POST /api/books` 第 7 次返回 `429 quota_exceeded`）；管理员不限。计数键 `bs_quota:<日期>:<sub>`，TTL 2 天自动过期。
- **高级版（书栈专属赞助加成）**：书栈有**自己专属**的爱发电档位「书栈·发布功能升级」（¥13.25/月，plan_id `2927c56ab87911f188a65254001e7c00）——**不是**小蓝页茶馆。订阅后每日上传上限 **6 → 16 本**，并在管理台标「🌟 高级版」。**完全本地化、与小蓝页解耦**：状态存于书栈自己的 `BOOKSTATION_KV`（`bs_sponsor:<login>`），由 `functions/_lib/benefit.js` 直接读取，不再跨站调用小蓝页 `/api/sponsor-check`。**绑定方式**：爱发电付款人身份与书栈账号无天然关联，故用「一次性兑换码」——管理员在 `/api/admin/sponsor-codes` 生成码（明文只返回一次），贴进爱发电「自动随机回复」；用户付款后拿到码，在 `/api/redeem` 贴码即绑定并开权限；续费时平台再发新码、再兑一次即顺延。`GET /api/quota` 返回 `{ plan, limit, used, remaining, exp }`（admin 为 `unlimited:true`）。另含可选 `/api/afdian-webhook`：若把爱发电 webhook 指向书栈，付款后自动授权（未配置 `AFDIAN_*` 凭据时只挂起订单、绝不臆造权益；订单验真一律走带签名的官方 `query-order` 反查，不上信 webhook 推送本身）。`GET /api/afdian-webhook` 供管理员自检（看凭据配好没、有没有待认领订单）。
