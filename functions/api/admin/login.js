// POST /api/admin/login  {password}  -> 种会话 Cookie
import { ok, err } from '../../_lib/store.js';
import { configured, verifyPassword, createSession, sessionCookie, parseCookies, COOKIE } from '../../_lib/auth.js';

export async function onRequestPost({ env, request }) {
  if (!configured(env)) {
    return err('not_configured', '站点未设置管理员密码，请先执行 pages secret put ADMIN_PASSWORD', 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const password = String(body.password == null ? '' : body.password);
  if (!password) return err('missing_password', '请输入密码');

  // 防爆破：先清掉旧会话，再校验
  const old = parseCookies(request)[COOKIE];
  if (old) await env.BOOKSTATION_KV.delete(`bs_sid:${old}`);

  if (!(await verifyPassword(env, password))) {
    return err('bad_password', '密码不正确', 401);
  }

  const sid = await createSession(env, { role: 'admin', via: 'password' });
  return ok({ loggedIn: true }, 200, { 'set-cookie': sessionCookie(sid) });
}
