// 书栈 · 爱发电 Webhook 回调（可选）
// POST：爱发电「订单推送」通知地址。必须返回 {ec:200,em:""} 否则平台会重试。
//
// ⚠️ 安全：爱发电 Webhook 推送【不带签名】，任何人都能伪造 POST。
// 所以只信一件事：用【带签名的】官方 query-order 反查订单，确认 status===2 才发放。
// 伪造的订单号在官方那边查不到，自然被挡。
//
// 绑定：订单留言（remark）里写站内登录名（如 @MC-Creator-Jerry 或纯用户名）才能自动绑定；
// 没写则挂起，等管理员在后台确认（本文件 GET 自检可看 pending）。
//
// 注意：爱发电一个账号通常只能配一个 webhook 地址。若 Jerry 的 webhook 已指向小蓝页，
// 则书栈请用「兑换码」方式（生成码贴进爱发电自动回复），无需此 webhook。
// 本端点未配 AFDIAN_USER_ID/AFDIAN_TOKEN 时只挂起订单、绝不臆造权益。
import { queryOrder } from '../_lib/bs_afdian.js';
import {
  isOrderProcessed, markOrderProcessed, grantSponsor, addPending, listPending,
  orderMatchesBookstationPlan,
} from '../_lib/bs_sponsor.js';

const OK = { ec: 200, em: '' };

function extractLogin(remark) {
  const s = String(remark == null ? '' : remark).trim();
  if (!s) return '';
  const m = s.match(/@([A-Za-z0-9][A-Za-z0-9-]{1,38})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9][A-Za-z0-9-]{1,38}$/.test(s)) return s;
  return '';
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  const order = (body && body.data && body.data.order) || null;
  const no = order && String(order.out_trade_no || '').trim();
  if (!no) return json(OK, 200);

  // 幂等：同一订单只处理一次
  if (await isOrderProcessed(context, no)) return json(OK);

  const hasCreds = !!(context.env.AFDIAN_USER_ID && context.env.AFDIAN_TOKEN);

  // 没配凭据：无法验真，一律挂起等管理员确认，绝不放行
  if (!hasCreds) {
    await addPending(context, Object.assign({}, order, {
      out_trade_no: no,
      remark: String(order.remark || '') + ' [未配置 AFDIAN_TOKEN，未验真]',
    }));
    return json(OK);
  }

  // 反查验真（唯一可信判定）
  const q = await queryOrder(context.env, no);
  if (!q.ok || !q.order) {
    await addPending(context, Object.assign({}, order, {
      out_trade_no: no,
      remark: String(order.remark || '') + ' [官方反查未确认]',
    }));
    return json(OK);
  }

  const o = q.order;
  if (String(o.status) !== '2') return json(OK); // 非「交易成功」不处理

  // 只处理书栈专属套餐（plan_id 命中或金额达到门槛），其余纯打赏不解锁
  if (!orderMatchesBookstationPlan(o)) {
    await markOrderProcessed(context, no, '', o.month || 1, 'other');
    return json(OK);
  }

  const months = Math.max(1, parseInt(o.month, 10) || 1);
  const login = extractLogin(o.remark);
  if (login) {
    await grantSponsor(context, login, months, o.out_trade_no);
    await markOrderProcessed(context, no, login, months, 'bookstation_pro');
  } else {
    await addPending(context, o);
  }
  return json(OK);
}

// GET：自检（仅管理员）。看凭据配好没、有没有待认领订单。
export async function onRequestGet(context) {
  const s = await (await import('../_lib/auth.js')).getSession(context.env, context.request);
  if (!s || s.role !== 'admin') return json({ error: 'forbidden' }, 403);
  const pending = await listPending(context);
  return json({
    ok: true,
    configured: {
      user_id: !!context.env.AFDIAN_USER_ID,
      token: !!context.env.AFDIAN_TOKEN,
    },
    pending: { count: pending.length, list: pending.slice(0, 50) },
  });
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
