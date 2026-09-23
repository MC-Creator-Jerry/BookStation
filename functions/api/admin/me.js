// GET /api/admin/me -> {ok, loggedIn, configured, role, isAdmin, user}
// 统一返回 200（前端判断简单），登录态 + 角色由会话决定
import { ok } from '../../_lib/store.js';
import { configured, getSession } from '../../_lib/auth.js';

export async function onRequestGet({ env, request }) {
  const isConfigured = configured(env);
  const s = await getSession(env, request);
  const user = s
    ? {
        login: s.login || null,
        name: s.name || s.login || null,
        avatar_url: s.avatar_url || '',
        sub: s.sub || null,
      }
    : null;
  return ok({
    loggedIn: !!s,
    configured: isConfigured,
    role: s ? s.role : null,
    isAdmin: s ? s.role === 'admin' : false,
    user,
    site: 'jerrybookstation',
  });
}
