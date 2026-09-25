// 书栈 · 爱发电开放平台客户端（仅 Webhook 验真用的查订单）。
// 与小蓝页的 afdian.js 同款实现，但独立存放于书栈项目，不依赖小蓝页。
//
// 安全事实（务必看懂）：爱发电 Webhook 推送【不带签名】，任何人都能伪造「订单」POST。
// 所以 Webhook 只当「有新订单」的通知，真正判定一律用这里带签名的 query-order 反查。
//
// 需要的环境变量（Cloudflare Pages 加密 Secret）：
//   AFDIAN_USER_ID  爱发电开发者后台的 user_id
//   AFDIAN_TOKEN   爱发电开发者后台生成的 API Token（机密，不进源码）
import { md5Hex } from './md5.js';

const API_BASE = 'https://afdian.com/api/open';

export function afdianSign(token, userId, params, ts) {
  return md5Hex(token + 'params' + params + 'ts' + ts + 'user_id' + userId);
}

async function call(env, path, params) {
  const userId = env.AFDIAN_USER_ID;
  const token = env.AFDIAN_TOKEN;
  if (!userId || !token) return { ok: false, error: 'not_configured' };

  const p = JSON.stringify(params || {});
  const ts = Math.floor(Date.now() / 1000);
  const sign = afdianSign(token, userId, p, ts);

  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, params: p, ts, sign }),
  }).catch(() => null);
  if (!r) return { ok: false, error: 'network' };

  const j = await r.json().catch(() => null);
  if (!j) return { ok: false, error: 'bad_json' };
  if (j.ec !== 200) return { ok: false, error: 'ec_' + j.ec, em: j.em || '' };
  return { ok: true, data: j.data };
}

// 用订单号反查官方订单 —— Webhook 验真的唯一可信依据。
export async function queryOrder(env, outTradeNo) {
  const r = await call(env, '/query-order', { out_trade_no: outTradeNo });
  if (!r.ok) return r;
  const list = (r.data && r.data.list) || [];
  const hit = list.find((o) => o && String(o.out_trade_no) === String(outTradeNo));
  return { ok: true, order: hit || null };
}

export async function ping(env) {
  return call(env, '/ping', {});
}
