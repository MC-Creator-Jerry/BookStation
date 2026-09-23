// 书栈 · SSO 客户端辅助（一次性 state 双保险 + 复用会话工具）
import { createSession, sessionCookie, parseCookies, SESSION_TTL, SSO_TTL } from './auth.js';

export const SSO_COOKIE = 'bs_sso_state';

export function randomId(bytes) {
  const n = bytes || 16;
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}

export function ssoStateCookie(state, ttl) {
  return `${SSO_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
}

export function clearSsoStateCookie() {
  return `${SSO_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export { createSession, sessionCookie, parseCookies, SESSION_TTL, SSO_TTL };
