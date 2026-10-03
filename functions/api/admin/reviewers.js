// 书栈 · 审核员管理（仅管理员）
// GET  /api/admin/reviewers -> { ok, reviewers:[login,...] }
// POST /api/admin/reviewers -> { action:'addReviewer'|'removeReviewer', login }
// 审核员基于小蓝页 SSO 登录名（reviewer:list）；审核员可进举报处理台，
// 不能管全站内容、也不能增删其他审核员（仅管理员可）。
import { ok, err } from '../../_lib/store.js';
import { requireAdmin } from '../../_lib/auth.js';

async function readReviewers(env) {
  const raw = await env.BOOKSTATION_KV.get('reviewer:list');
  let list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) list = [];
  return list.filter((x) => typeof x === 'string' && x);
}

export async function onRequestGet({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied instanceof Response) return denied;
  return ok({ reviewers: await readReviewers(env) });
}

export async function onRequestPost({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied instanceof Response) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_json', '请求体不是合法 JSON');
  }
  const action = String(body.action || '');
  const login = String(body.login || '').trim();
  if (!login) return err('bad_param', '缺少 login');
  let list = await readReviewers(env);
  if (action === 'addReviewer') {
    if (!list.includes(login)) list.push(login);
  } else if (action === 'removeReviewer') {
    list = list.filter((x) => x !== login);
  } else {
    return err('bad_action', '未知操作');
  }
  await env.BOOKSTATION_KV.put('reviewer:list', JSON.stringify(list));
  return ok({ reviewers: list });
}
