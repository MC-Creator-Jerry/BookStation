// 书栈 · 赞助兑换码兑换入口
// GET  -> { ok, sponsor }           当前登录用户的赞助状态（未登录 401）
// POST { code } -> { ok, reason, sponsor }  兑换/顺延
//
// reason：new / extended / already / notfound / used / format / error
import { ok, err } from '../_lib/store.js';
import { getSession } from '../_lib/auth.js';
import { redeemCode, readSponsor, publicSponsor } from '../_lib/bs_sponsor.js';

const MSG = {
  notfound: '兑换码不存在或已失效',
  used: '该兑换码已被他人使用',
  format: '兑换码格式不正确',
  error: '兑换失败，请稍后再试',
  unauthorized: '请先登录',
};

export async function onRequestGet(context) {
  const s = await getSession(context.env, context.request);
  if (!s) return err('unauthorized', '请先登录', 401);
  const rec = await readSponsor(context, s.login);
  return ok({ sponsor: publicSponsor(rec) });
}

export async function onRequestPost(context) {
  const s = await getSession(context.env, context.request);
  if (!s) return err('unauthorized', '请先登录', 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return err('bad_json', '请求体不是合法 JSON', 400);
  }

  const r = await redeemCode(context, body && body.code, s.login);
  if (!r.ok) {
    const status = r.reason === 'format' ? 400 : 200;
    return err(r.reason, MSG[r.reason] || '兑换失败', status);
  }
  return ok({ reason: r.reason, sponsor: r.sponsor });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}
