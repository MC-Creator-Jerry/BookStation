// GET /api/quota -> { ok, plan, limit, used, remaining, unlimited? }
// 返回当前登录用户「今日新书」配额现状（含赞助加成）。
//   plan: 'free' | 'pro' | 'admin'
//   limit: 每日上限（free=6, pro=16）；admin 为 0 且 unlimited=true
//   used/remaining: 今日已用 / 剩余
import { ok } from '../_lib/store.js';
import { requireSession } from '../_lib/auth.js';
import { getBenefit, quotaDayKeyFor } from '../_lib/benefit.js';

export async function onRequestGet({ env, request }) {
  const s = await requireSession(env, request);
  if (s instanceof Response) return s;

  // 管理员不受限
  if (s.role === 'admin') {
    return ok({ plan: 'admin', limit: 0, used: 0, remaining: -1, unlimited: true });
  }

  const benefit = await getBenefit(env, s.login, s.sub);
  const used = Number((await env.BOOKSTATION_KV.get(quotaDayKeyFor(s.sub))) || 0);
  const remaining = Math.max(0, benefit.limit - used);
  return ok({ plan: benefit.plan, limit: benefit.limit, used, remaining, exp: benefit.exp || null });
}
