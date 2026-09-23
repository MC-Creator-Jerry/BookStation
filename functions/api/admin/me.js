// GET /api/admin/me -> {ok, loggedIn, configured}
// 统一返回 200（前端判断简单），登录态由会话决定
import { ok } from '../../_lib/store.js';
import { configured, sessionValid } from '../../_lib/auth.js';

export async function onRequestGet({ env, request }) {
  const isConfigured = configured(env);
  const loggedIn = isConfigured ? await sessionValid(env, request) : false;
  return ok({ loggedIn, configured: isConfigured, site: 'jerrybookstation' });
}
