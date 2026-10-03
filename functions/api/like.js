// GET    /api/like?target=<target>&guest=<guestId>   点赞状态（count + 当前身份是否已赞）
// POST   /api/like    body {target, guest?}           切换点赞（已赞则取消，未赞则点赞）
// target 形如：book:<bookId> | chapter:<bookId>:<cid> | comment:<commentId>
// 身份：登录用户用 session.sub；未登录访客用客户端下发的 guest 令牌（每浏览器一个）。
import { ok, err } from '../_lib/store.js';
import { getSession } from '../_lib/auth.js';
import { rateLimit } from '../_lib/rate.js';

const MAX_VOTERS = 5000; // 防无限膨胀

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

async function identity(env, request, guest) {
  const s = await getSession(env, request);
  if (s && s.sub) return 'u:' + s.sub;
  const g = clean(guest, 60);
  if (g) return 'g:' + g;
  return '';
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const target = clean(url.searchParams.get('target'), 120);
  if (!target) return err('bad_target', '缺少 target');
  const kv = env.BOOKSTATION_KV;
  const rec = await kv.get('like:' + target, { type: 'json' });
  const count = rec ? (Number(rec.count) || 0) : 0;
  const me = await identity(env, request, url.searchParams.get('guest'));
  const liked = !!(rec && rec.voters && me && rec.voters.includes(me));
  return ok({ target, count, liked });
}

export async function onRequestPost({ env, request }) {
  const kv = env.BOOKSTATION_KV;
  let body;
  try { body = await request.json(); } catch { return err('bad_json', '请求体不是合法 JSON'); }
  const target = clean(body.target, 120);
  if (!target) return err('bad_target', '缺少 target');

  const me = await identity(env, request, body.guest);
  if (!me) return err('bad_identity', '无法识别身份', 400);

  const r = await rateLimit(kv, 'like', me, { limit: 30, windowSec: 60 });
  if (!r.ok) return err('rate_limited', '操作太频繁，请 ' + r.retryAfter + ' 秒后再试', 429);

  const rec = (await kv.get('like:' + target, { type: 'json' })) || { count: 0, voters: [] };
  if (!Array.isArray(rec.voters)) rec.voters = [];
  const i = rec.voters.indexOf(me);
  let liked;
  if (i >= 0) {
    rec.voters.splice(i, 1);
    rec.count = Math.max(0, (Number(rec.count) || 0) - 1);
    liked = false;
  } else {
    rec.voters.push(me);
    if (rec.voters.length > MAX_VOTERS) rec.voters.shift();
    rec.count = (Number(rec.count) || 0) + 1;
    liked = true;
  }
  await kv.put('like:' + target, JSON.stringify(rec));
  return ok({ target, count: rec.count, liked });
}
