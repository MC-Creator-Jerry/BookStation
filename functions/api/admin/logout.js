// POST /api/admin/logout -> 清会话
import { ok } from '../../_lib/store.js';
import { destroySession, clearCookie } from '../../_lib/auth.js';

export async function onRequestPost({ env, request }) {
  await destroySession(env, request);
  return ok({ loggedIn: false }, 200, { 'set-cookie': clearCookie() });
}
