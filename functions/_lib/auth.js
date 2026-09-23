// 书栈 · 管理员鉴权（独立会话，Cookie 名 bs_sid）
// 安全要点：
//   1) 密钥未配置 = fail-closed（返回 500 not_configured，绝不是「人人可登」）
//   2) 密码比较 = 先 SHA-256 再逐字节异或累计（常量时间，且不泄露长度）
//   3) 会话存 KV，TTL 12h；Cookie: HttpOnly + Secure + SameSite=Lax
import { err } from './store.js';

export const COOKIE = 'bs_sid';
export const SESSION_TTL = 60 * 60 * 12; // 12 小时

export function configured(env) {
  return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length > 0;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return new Uint8Array(buf);
}

export async function verifyPassword(env, input) {
  if (!configured(env)) return false;
  const a = await sha256(input == null ? '' : input);
  const b = await sha256(env.ADMIN_PASSWORD);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function parseCookies(request) {
  const out = {};
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function sessionCookie(sid) {
  return `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env) {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let sid = '';
  for (const b of bytes) sid += b.toString(16).padStart(2, '0');
  await env.BOOKSTATION_KV.put(`bs_sid:${sid}`, JSON.stringify({ createdAt: Date.now() }), {
    expirationTtl: SESSION_TTL,
  });
  return sid;
}

export async function sessionValid(env, request) {
  const sid = parseCookies(request)[COOKIE];
  if (!sid || sid.length < 32) return false;
  const rec = await env.BOOKSTATION_KV.get(`bs_sid:${sid}`, { type: 'json' });
  return !!rec;
}

export async function destroySession(env, request) {
  const sid = parseCookies(request)[COOKIE];
  if (sid) await env.BOOKSTATION_KV.delete(`bs_sid:${sid}`);
}

/** 拒绝时返回 Response；放行时返回 null */
export async function requireAdmin(env, request) {
  if (!configured(env)) {
    return err('not_configured', '站点未设置管理员密码，请先在部署侧执行 pages secret put ADMIN_PASSWORD', 500);
  }
  if (!(await sessionValid(env, request))) {
    return err('unauthorized', '需要管理员登录', 401);
  }
  return null;
}
