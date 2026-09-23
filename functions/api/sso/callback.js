// 书栈 · SSO 回调
// GET /api/sso/callback?code=&state=
// 用一次性 code 向小蓝页换身份（服务端到服务端），成功后在本域种 bs_sid 会话。
import {
  parseCookies,
  SSO_COOKIE,
  createSession,
  sessionCookie,
  clearSsoStateCookie,
  SSO_TTL,
} from '../../_lib/bsauth.js';

const IDP = 'https://mc-creator-jerry-webpage.pages.dev';
const CLIENT_ID = 'bookstation';

function safeNext(v) {
  const s = String(v || '');
  if (!s || s[0] !== '/' || s[1] === '/' || s.indexOf('\\') >= 0) return '/admin/';
  return s;
}

function redirect(location, cookies) {
  const h = new Headers();
  (cookies || []).forEach(function (c) {
    h.append('set-cookie', c);
  });
  h.set('location', location);
  h.set('cache-control', 'no-store');
  return new Response(null, { status: 302, headers: h });
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const kv = env.BOOKSTATION_KV;

  if (!code || !state) return redirect('/admin/?sso=bad_params', [clearSsoStateCookie()]);
  if (!kv) return redirect('/admin/?sso=not_ready', [clearSsoStateCookie()]);

  // state 双校验：HttpOnly Cookie + KV 记录，缺一不可（防 CSRF / 伪造回调）
  const cookieState = parseCookies(request)[SSO_COOKIE];
  if (!cookieState || cookieState !== state) {
    return redirect('/admin/?sso=bad_state', [clearSsoStateCookie()]);
  }

  let rec = null;
  try {
    rec = await kv.get('sso:state:' + state, { type: 'json' });
  } catch (e) {
    rec = null;
  }
  if (!rec) return redirect('/admin/?sso=bad_state', [clearSsoStateCookie()]);
  try {
    await kv.delete('sso:state:' + state);
  } catch (e) {
    /* 忽略 */
  }

  const secret = env.SSO_CLIENT_SECRET;
  if (!secret) return redirect('/admin/?sso=not_configured', [clearSsoStateCookie()]);

  let d = null;
  try {
    const r = await fetch(IDP + '/api/sso/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + secret,
      },
      body: JSON.stringify({ code: code, client_id: CLIENT_ID }),
    });
    const j = await r.json();
    if (r.ok && j && j.ok) d = j;
  } catch (e) {
    d = null;
  }

  if (!d) return redirect('/admin/?sso=token_failed', [clearSsoStateCookie()]);

  // 小蓝页管理员 → 书栈管理员；其余 → 创作者。
  // 两个分支都存完整档案（sub/login/name/avatar_url）：头像胶囊与管理台欢迎语都要用。
  const role = d.isAdmin ? 'admin' : 'creator';
  const sid = await createSession(
    env,
    {
      role: role,
      sub: d.sub,
      login: d.login,
      name: d.name,
      avatar_url: d.avatar_url || '',
      via: 'sso',
    },
    SSO_TTL
  );

  const next = safeNext(rec.next);
  return redirect(next, [sessionCookie(sid, SSO_TTL), clearSsoStateCookie()]);
}
