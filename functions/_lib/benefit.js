// 书栈 · 赞助加成（复用小蓝页「茶馆·发布功能升级」叠加权益，跨站生效）
//
// 设计：书栈不自建爱发电订阅。订阅发生在小蓝页侧（同一个 plan_id：
// 2927c56ab87911f188a65254001e7c00，即 ¥13.25 的「茶馆·发布功能升级」）。
// 书栈在「创建书」与「查配额」时，服务端到服务端调用小蓝页 /api/sponsor-check
// 读取该用户的 teahouse_plus 状态：
//   - 生效 → 高级版：每日新书上限 6 → 16，并在 UI 标「高级版」。
//   - 失效/查不到 → 免费版（6 本/天）。
//
// 安全 & 韧性：
//   - 查询走 Bearer SSO_CLIENT_SECRET（与小蓝页 SSO 同一把密钥），仅返回该用户赞助事实。
//   - 查询失败（网络/超时/小蓝页宕机）一律安全降级为免费版，绝不凭空授额。
//   - 远程确认生效时，把到期时间写进书栈本地 KV（bsplus:<sub>）作为「宕机兜底」：
//     仅当远程失败且本地缓存未过期时才回退到高级版；正常情况每次请求都先问远程。
const IDP = 'https://mc-creator-jerry-webpage.pages.dev';
const FREE_DAILY_LIMIT = 6;
const PRO_DAILY_LIMIT = 16;
const CHECK_TIMEOUT_MS = 1500;
const CACHE_PREFIX = 'bsplus:';
const CACHE_MAX_TTL = 12 * 60 * 60; // 本地兜底缓存最长 12 小时

// 北京时间（UTC+8）自然日配额键
export function quotaDayKeyFor(sub) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const day = d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
  return 'bs_quota:' + day + ':' + (sub || 'anon');
}

// 返回 { plan: 'free'|'pro', limit, teahouse_exp }
export async function getBenefit(env, login, sub) {
  const kv = env.BOOKSTATION_KV;
  const key = CACHE_PREFIX + (sub || login || 'anon');
  const secret = env.SSO_CLIENT_SECRET;

  let active = false;
  let exp = null;
  let remoteOk = false;
  if (secret && login) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () { ctrl.abort(); }, CHECK_TIMEOUT_MS);
      const r = await fetch(IDP + '/api/sponsor-check?login=' + encodeURIComponent(login), {
        method: 'GET',
        headers: { authorization: 'Bearer ' + secret },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json().catch(function () { return null; });
        remoteOk = true;
        if (j && j.ok && j.teahouse_plus && j.teahouse_plus.active) {
          active = true;
          exp = j.teahouse_plus.exp || null;
        }
      }
    } catch (e) {
      remoteOk = false; // 查询失败 → 走缓存或降级
    }
  }

  if (active) {
    if (kv) {
      const ttl = exp && exp > Date.now()
        ? Math.min(CACHE_MAX_TTL, Math.round((exp - Date.now()) / 1000))
        : CACHE_MAX_TTL;
      try {
        await kv.put(key, JSON.stringify({ exp: exp || 0 }), { expirationTtl: Math.max(60, ttl) });
      } catch (e) { /* 忽略缓存写入失败 */ }
    }
    return { plan: 'pro', limit: PRO_DAILY_LIMIT, teahouse_exp: exp };
  }

  // 远程明确未生效：若远程查询本身失败，用本地缓存兜底（宕机保护）
  if (!remoteOk && kv) {
    try {
      const raw = await kv.get(key, { type: 'json' });
      if (raw && raw.exp && Date.now() < raw.exp) {
        return { plan: 'pro', limit: PRO_DAILY_LIMIT, teahouse_exp: raw.exp };
      }
    } catch (e) { /* 忽略 */ }
  }
  return { plan: 'free', limit: FREE_DAILY_LIMIT, teahouse_exp: null };
}
