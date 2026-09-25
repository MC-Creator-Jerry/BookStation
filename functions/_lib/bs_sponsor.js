// 书栈 · 本地赞助（书栈专属，存于 BOOKSTATION_KV，与小蓝页完全解耦）
//
// 档位只有一个：bookstation_pro（书栈·发布功能升级，¥13.25/月）。
// 生效效果：每日新书上传上限 6 → 16，并在管理台标「高级版」。
//
// 绑定方式（与小蓝页茶馆同款）：爱发电付款人身份与书栈账号无天然关联，
// 所以靠「一次性兑换码」绑定 —— 创作者在爱发电的自动随机回复里拿到码，回书栈贴码即绑定。
// 续费时平台再发一条新码，再兑一次即顺延。
//
// 另含可选 webhook（/api/afdian-webhook）：若 Jerry 把爱发电 webhook 指向书栈，则付款后自动授权；
// 未配置 AFDIAN 凭据时 webhook 只挂起订单、绝不臆造权益。
//
// KV 结构（全部在 BOOKSTATION_KV）：
//   bs_sponsor:<login>  -> { login, tier, exp, since, codes:[...] }
//   bs_code:<CODE>      -> { code, usedBy, usedAt, createdAt }
//   bs_codes:list       -> 本批生成的码（后台查看/导出，上限 500）
//   bs_sponsor:index    -> 赞助者 login 列表
//   afdian:order:<no>   -> 已处理订单（幂等）
//   afdian:pending:<no> -> 待认领订单（留言里没写用户名）
//
// 时间一律取服务器 Date.now()（Cloudflare Worker 运行时时钟）。
export const TIER = 'bookstation_pro';
export const TIER_LABEL = '书栈·发布功能升级';
export const SPAN_MS = 31 * 24 * 3600 * 1000;

// 书栈专属的爱发电套餐 plan_id（即 Jerry 提供的下单链接里的 plan_id）。
// webhook 验真时优先按 plan_id 匹配；金额 ¥13.25 作为兜底判定。
export const BS_PLAN_ID = '2927c56ab87911f188a65254001e7c00';
export const BS_PLAN_AMOUNT = 13.25;

const PREFIX = 'bs_code:';
const SPONSOR = 'bs_sponsor:';
const INDEX = 'bs_sponsor:index';
const CODE_LIST = 'bs_codes:list';
const ORDER_PREFIX = 'afdian:order:';
const PENDING_PREFIX = 'afdian:pending:';

// 去掉易看错的 I/O/0/1，共 32 字符，均匀无偏。
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function safeJSON(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function safeArr(raw) {
  const v = safeJSON(raw, []);
  return Array.isArray(v) ? v : [];
}

function randCode() {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function normalizeCode(raw) {
  return String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code) {
  const c = normalizeCode(code);
  return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c;
}

// ---------------------------------------------------------------------------
// 生成码（创作者贴进爱发电「自动随机回复」，用户付款后拿到）
// ---------------------------------------------------------------------------
export async function generateCodes(context, count, tier) {
  const kv = context.env.BOOKSTATION_KV;
  let n = parseInt(count, 10);
  if (!Number.isFinite(n) || n <= 0) n = 20;
  n = Math.min(n, 500);
  const now = Date.now();

  const made = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    let code = randCode();
    let guard = 0;
    while (seen.has(code) && guard++ < 8) code = randCode();
    seen.add(code);
    const rec = { code, usedBy: null, usedAt: 0, createdAt: now };
    try {
      await kv.put(PREFIX + code, JSON.stringify(rec));
    } catch (e) {
      continue;
    }
    made.push(code);
  }

  if (made.length) {
    const prev = safeArr(await kv.get(CODE_LIST).catch(() => null))
      .filter((x) => x && x.code);
    const merged = prev.concat(made.map((c) => ({ code: c, createdAt: now })));
    const trimmed = merged.slice(-500);
    try { await kv.put(CODE_LIST, JSON.stringify(trimmed)); } catch (e) {}
  }
  return { tier: TIER, count: made.length, codes: made.map(formatCode) };
}

// ---------------------------------------------------------------------------
// 读取赞助者（过期则顺手清理）
// ---------------------------------------------------------------------------
export async function readSponsor(context, login) {
  if (!login) return null;
  const kv = context.env.BOOKSTATION_KV;
  const raw = await kv.get(SPONSOR + login).catch(() => null);
  if (!raw) return null;
  const rec = safeJSON(raw, null);
  if (!rec) return null;
  const now = Date.now();
  if (rec.exp && now > rec.exp) {
    try { await kv.delete(SPONSOR + login); } catch (e) {}
    try { await removeFromIndex(kv, login); } catch (e) {}
    return null;
  }
  return rec;
}

export function publicSponsor(rec) {
  if (!rec) return null;
  return { tier: rec.tier, label: TIER_LABEL, exp: rec.exp, since: rec.since };
}

async function removeFromIndex(kv, login) {
  const idx = safeArr(await kv.get(INDEX).catch(() => null));
  const next = idx.filter((l) => l !== login);
  if (next.length !== idx.length) await kv.put(INDEX, JSON.stringify(next));
}

async function addToIndex(kv, login) {
  const idx = safeArr(await kv.get(INDEX).catch(() => null));
  if (!idx.includes(login)) {
    idx.push(login);
    await kv.put(INDEX, JSON.stringify(idx));
  }
}

// ---------------------------------------------------------------------------
// 兑换（绑定动作：把一次性码贴进来，才知道给谁开权限）
// ---------------------------------------------------------------------------
export async function redeemCode(context, rawCode, login) {
  const kv = context.env.BOOKSTATION_KV;
  const code = normalizeCode(rawCode);
  if (!login) return { ok: false, reason: 'unauthorized' };
  if (code.length !== 8) return { ok: false, reason: 'format' };

  const key = PREFIX + code;
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return { ok: false, reason: 'notfound' };
  const rec = safeJSON(raw, null);
  if (!rec) return { ok: false, reason: 'notfound' };

  if (rec.usedBy && rec.usedBy !== login) return { ok: false, reason: 'used' };
  if (rec.usedBy === login) {
    const cur = await readSponsor(context, login);
    return { ok: true, reason: 'already', sponsor: publicSponsor(cur) };
  }

  // 占位 + 回读确认（尽力互斥，防并发撞码）
  const claim = Object.assign({}, rec, { usedBy: login, usedAt: Date.now() });
  try {
    await kv.put(key, JSON.stringify(claim));
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
  const back = safeJSON(await kv.get(key).catch(() => null), null);
  if (!back || back.usedBy !== login) return { ok: false, reason: 'used' };

  const tp = await grantSponsor(context, login, 1, 'code:' + formatCode(code));
  return { ok: true, reason: 'new', sponsor: tp };
}

// ---------------------------------------------------------------------------
// 发放/顺延（months 为月数；webhook 或兑换码都走同一份记录）
// ---------------------------------------------------------------------------
export async function grantSponsor(context, login, months, ref) {
  const kv = context.env.BOOKSTATION_KV;
  if (!login) return null;
  const n = Math.max(1, Math.min(36, parseInt(months, 10) || 1));
  const prev = await readSponsor(context, login);
  const now = Date.now();
  const base = prev && prev.exp && prev.exp > now ? prev.exp : now;
  const next = {
    login,
    tier: TIER,
    exp: base + SPAN_MS * n,
    since: (prev && prev.since) || now,
    codes: ((prev && prev.codes) || []).concat([ref ? String(ref) : 'direct']).slice(-20),
  };
  await kv.put(SPONSOR + login, JSON.stringify(next));
  await addToIndex(kv, login);
  return publicSponsor(next);
}

export async function revokeSponsor(context, login) {
  const kv = context.env.BOOKSTATION_KV;
  if (!login) return false;
  await kv.delete(SPONSOR + login).catch(() => {});
  await removeFromIndex(kv, login).catch(() => {});
  return true;
}

export async function listSponsors(context) {
  const kv = context.env.BOOKSTATION_KV;
  const idx = safeArr(await kv.get(INDEX).catch(() => null));
  const out = [];
  const alive = [];
  for (const login of idx) {
    const rec = await readSponsor(context, login);
    if (rec) {
      out.push({ login: rec.login, tier: TIER, label: TIER_LABEL, exp: rec.exp, since: rec.since, codes: rec.codes || [] });
      alive.push(login);
    }
  }
  if (alive.length !== idx.length) {
    try { await kv.put(INDEX, JSON.stringify(alive)); } catch (e) {}
  }
  out.sort((a, b) => (b.since || 0) - (a.since || 0));
  return out;
}

// ---------------------------------------------------------------------------
// webhook 用：订单幂等与待认领
// ---------------------------------------------------------------------------
export async function isOrderProcessed(context, outTradeNo) {
  const kv = context.env.BOOKSTATION_KV;
  const raw = await kv.get(ORDER_PREFIX + outTradeNo).catch(() => null);
  return safeJSON(raw, null);
}

export async function markOrderProcessed(context, outTradeNo, login, months, tier) {
  const kv = context.env.BOOKSTATION_KV;
  await kv.put(ORDER_PREFIX + outTradeNo, JSON.stringify({
    out_trade_no: outTradeNo, login: login || '', tier: tier || '', months: months || 1, ts: Date.now(),
  }));
}

export async function addPending(context, order) {
  const kv = context.env.BOOKSTATION_KV;
  const no = String(order.out_trade_no || '');
  if (!no) return null;
  const MAX_PENDING = 100;
  try {
    const listed = await kv.list({ prefix: PENDING_PREFIX });
    const keys = (listed.keys || []).map((k) => k.name);
    if (keys.length >= MAX_PENDING) {
      const rows = [];
      for (const k of keys) {
        const r = safeJSON(await kv.get(k).catch(() => null), null);
        if (r) rows.push({ k, ts: r.ts || 0 });
      }
      rows.sort((a, b) => a.ts - b.ts);
      const drop = rows.slice(0, Math.max(1, keys.length - MAX_PENDING + 1));
      for (const d of drop) await kv.delete(d.k).catch(() => {});
    }
  } catch (e) { /* list 不可用时跳过 */ }
  const rec = {
    out_trade_no: no,
    user_id: order.user_id || '',
    plan_id: order.plan_id || '',
    amount: order.total_amount || order.show_amount || '',
    month: order.month || 1,
    status: order.status,
    remark: String(order.remark || '').slice(0, 200),
    ts: Date.now(),
  };
  await kv.put(PENDING_PREFIX + no, JSON.stringify(rec));
  return rec;
}

export async function listPending(context) {
  const kv = context.env.BOOKSTATION_KV;
  const out = [];
  try {
    const listed = await kv.list({ prefix: PENDING_PREFIX });
    for (const k of listed.keys || []) {
      const rec = safeJSON(await kv.get(k.name).catch(() => null), null);
      if (rec) out.push(rec);
    }
  } catch (e) { /* list 不可用时忽略 */ }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

// 是否需要为这笔订单授予书栈高级版：plan_id 命中，或金额达到档位门槛。
export function orderMatchesBookstationPlan(order) {
  if (!order) return false;
  if (order.plan_id && String(order.plan_id) === BS_PLAN_ID) return true;
  const amt = parseFloat(order.total_amount || order.show_amount);
  return Number.isFinite(amt) && amt >= BS_PLAN_AMOUNT;
}
