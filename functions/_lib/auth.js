// 书栈 · 鉴权（独立会话，Cookie 名 bs_sid）
// 会话角色两种：
//   role:'admin'    —— 站主（密码登录，或经小蓝页 SSO 且小蓝页那边 isAdmin）
//   role:'creator'  —— 小蓝页登录的创作者（只能改/删 owner===sub 的书）
// 安全要点：
//   1) 管理员密码未配置 = fail-closed（返回 500 not_configured，绝不是「人人可登」）
//   2) 密码比较 = 先 SHA-256 再逐字节异或累计（常量时间，且不泄露长度）
//   3) 会话存 KV；Cookie: HttpOnly + Secure + SameSite=Lax
import { err } from './store.js';

export const COOKIE = 'bs_sid';
export const SESSION_TTL = 60 * 60 * 12; // 12 小时（密码管理员）
export const SSO_TTL = 60 * 60 * 24 * 30; // 30 天（SSO 登录：创作者 / 小蓝页管理员）

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

export function sessionCookie(sid, maxAge) {
  const ttl = maxAge || SESSION_TTL;
  return `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env, data, ttl) {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let sid = '';
  for (const b of bytes) sid += b.toString(16).padStart(2, '0');
  const rec = Object.assign({ createdAt: Date.now() }, data || {});
  await env.BOOKSTATION_KV.put(`bs_sid:${sid}`, JSON.stringify(rec), {
    expirationTtl: ttl || SESSION_TTL,
  });
  return sid;
}

/** 读会话对象（含 role/sub 等）；无效返回 null */
export async function getSession(env, request) {
  const sid = parseCookies(request)[COOKIE];
  if (!sid || sid.length < 32) return null;
  const rec = await env.BOOKSTATION_KV.get(`bs_sid:${sid}`, { type: 'json' });
  return rec || null;
}

// 旧名字保留，供 me.js 等引用
export async function sessionValid(env, request) {
  return !!(await getSession(env, request));
}

export async function destroySession(env, request) {
  const sid = parseCookies(request)[COOKIE];
  if (sid) await env.BOOKSTATION_KV.delete(`bs_sid:${sid}`);
}

/** 仅管理员放行（role==='admin'）；否则 401/500 */
export async function requireAdmin(env, request) {
  const s = await getSession(env, request);
  if (s && s.role === 'admin') return null;
  if (!configured(env)) {
    return err('not_configured', '站点未设置管理员密码，请先在部署侧执行 pages secret put ADMIN_PASSWORD', 500);
  }
  return err('unauthorized', '需要管理员登录', 401);
}

/** 任何已登录会话（admin 或 creator）放行，返回会话对象；否则 401 */
export async function requireSession(env, request) {
  const s = await getSession(env, request);
  if (s) return s;
  return err('unauthorized', '请先登录', 401);
}

/** 写权限：admin 任意；creator 只能操作 owner===sub 的书；否则 401/403 */
export async function requireWrite(env, request, book) {
  const s = await getSession(env, request);
  if (!s) return err('unauthorized', '请先登录', 401);
  if (s.role === 'admin') return s;
  if (s.role === 'creator' && book && book.owner === s.sub) return s;
  return err('forbidden', '无权操作这本书（仅作者或管理员可修改）', 403);
}
