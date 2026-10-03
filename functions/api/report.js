// POST   /api/report   body {target, targetType, reason, detail, guest?}   提交举报（登录或访客均可）
// GET    /api/report                                               举报列表（仅管理员）
// PUT    /api/report?id=<id>  body {status}                       处理举报（仅管理员；pending|resolved|dismissed）
// target 形如：book:<bookId> | chapter:<bookId>:<cid> | comment:<commentId>
import { ok, err, newId, clean, cleanText } from '../_lib/store.js';
import { getSession, requireReviewerOrAdmin } from '../_lib/auth.js';
import { rateLimit, clientKey } from '../_lib/rate.js';

const REASONS = ['色情低俗', '侵权抄袭', '政治敏感', '暴力血腥', '垃圾广告', '其他'];

export async function onRequestPost({ env, request }) {
  const rl = await rateLimit(env.BOOKSTATION_KV, 'report', clientKey({ request }), { limit: 10, windowSec: 60 });
  if (!rl.ok) return err('rate_limited', '举报太频繁，请 ' + rl.retryAfter + ' 秒后再试', 429);

  let body;
  try { body = await request.json(); } catch { return err('bad_json', '请求体不是合法 JSON'); }
  const target = clean(body.target, 120);
  const targetType = clean(body.targetType, 20) || 'other';
  const reason = clean(body.reason, 20);
  if (!target) return err('bad_target', '缺少举报对象');
  if (!REASONS.includes(reason)) return err('bad_reason', '请选择举报理由');

  const detail = cleanText(body.detail, 500);
  const s = await getSession(env, request);
  let reporter;
  if (s && s.sub) reporter = 'u:' + s.sub;
  else {
    const g = clean(body.guest, 60);
    reporter = g ? 'g:' + g : 'anon';
  }

  const kv = env.BOOKSTATION_KV;
  const report = {
    id: newId('rp'),
    target: target,
    targetType: targetType,
    reason: reason,
    detail: detail,
    reporter: reporter,
    createdAt: Date.now(),
    status: 'pending',
  };
  await kv.put('report:' + report.id, JSON.stringify(report));
  return ok({ id: report.id });
}

export async function onRequestGet({ env, request }) {
  const denied = await requireReviewerOrAdmin(env, request);
  if (denied instanceof Response) return denied;
  const kv = env.BOOKSTATION_KV;
  let keys = [];
  try {
    const r = await kv.list({ prefix: 'report:' });
    keys = r.keys || [];
  } catch { keys = []; }
  const got = await Promise.all(keys.map(function (k) { return kv.get(k.name, { type: 'json' }); }));
  const reports = got.filter(Boolean).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  return ok({ reports: reports });
}

export async function onRequestPut({ env, request }) {
  const denied = await requireReviewerOrAdmin(env, request);
  if (denied instanceof Response) return denied;
  const url = new URL(request.url);
  const id = clean(url.searchParams.get('id'), 60);
  if (!id) return err('bad_param', '缺少 id');
  let body;
  try { body = await request.json(); } catch { return err('bad_json', '请求体不是合法 JSON'); }
  const status = clean(body.status, 20);
  if (!['pending', 'resolved', 'dismissed'].includes(status)) return err('bad_status', '状态不合法');
  const kv = env.BOOKSTATION_KV;
  const rep = await kv.get('report:' + id, { type: 'json' });
  if (!rep) return err('not_found', '举报不存在', 404);
  rep.status = status;
  rep.resolvedAt = Date.now();
  await kv.put('report:' + id, JSON.stringify(rep));
  return ok({ id: id, status: status });
}
