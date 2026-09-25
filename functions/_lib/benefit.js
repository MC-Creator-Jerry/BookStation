// 书栈 · 赞助加成（书栈专属，存于本地 BOOKSTATION_KV，与小蓝页完全解耦）
//
// 判断某用户是否处于「高级版」：读本地 bs_sponsor:<login> 记录。
//   - 生效 → 每日新书上限 6 → 16，并在 UI 标「🌟 高级版」；
//   - 无记录 / 已过期 → 免费版（6 本/天）。
//
// 不再调用小蓝页 /api/sponsor-check：书栈的赞助是书栈自己的事（书栈专属档位）。
const FREE_DAILY_LIMIT = 6;
const PRO_DAILY_LIMIT = 16;

// 北京时间（UTC+8）自然日配额键
export function quotaDayKeyFor(sub) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const day = d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
  return 'bs_quota:' + day + ':' + (sub || 'anon');
}

// 返回 { plan: 'free'|'pro', limit, exp }
export async function getBenefit(env, login, sub) {
  const kv = env.BOOKSTATION_KV;
  if (!kv) return { plan: 'free', limit: FREE_DAILY_LIMIT, exp: null };
  try {
    const rec = await kv.get('bs_sponsor:' + (login || ''), { type: 'json' });
    if (rec && rec.exp && Date.now() < rec.exp) {
      return { plan: 'pro', limit: PRO_DAILY_LIMIT, exp: rec.exp };
    }
  } catch (e) {
    /* 读取失败 → 安全降级为免费版 */
  }
  return { plan: 'free', limit: FREE_DAILY_LIMIT, exp: null };
}
