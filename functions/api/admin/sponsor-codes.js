// 书栈 · 管理员生成「书栈·发布功能升级」赞助兑换码
// GET /api/admin/sponsor-codes?count=20  -> { ok, tier, count, codes }
// 仅管理员（小蓝页 SSO 管理员）可调用。明文码只在此返回一次。
import { ok, err } from '../../_lib/store.js';
import { requireAdmin } from '../../_lib/auth.js';
import { generateCodes } from '../../_lib/bs_sponsor.js';

export async function onRequestGet({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied instanceof Response) return denied;

  const url = new URL(request.url);
  const count = Math.min(500, Math.max(1, parseInt(url.searchParams.get('count') || '20', 10) || 20));
  const r = await generateCodes({ env }, count);
  return ok(r);
}
