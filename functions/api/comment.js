// GET    /api/comment?target=<target>          评论列表（按时间正序）
// POST   /api/comment   body {target, content}  发表评论（需登录）
// DELETE /api/comment?target=<target>&id=<cid>  删除评论（作者本人或管理员）
// target 形如：book:<bookId> | chapter:<bookId>:<cid>
import { ok, err, newId, clean, cleanText } from '../_lib/store.js';
import { getSession, requireSession } from '../_lib/auth.js';
import { rateLimit, clientKey } from '../_lib/rate.js';

const MAX_COMMENTS = 800;

function anonName() { return '书友'; }

export async function onRequestGet({ env, request }) {
  const target = clean(new URL(request.url).searchParams.get('target'), 120);
  if (!target) return err('bad_target', '缺少 target');
  const kv = env.BOOKSTATION_KV;
  const list = await kv.get('comments:' + target, { type: 'json' });
  const comments = Array.isArray(list) ? list : [];
  const s = await getSession(env, request);
  const me = s && s.sub ? 'u:' + s.sub : '';
  const out = comments.map(function (c) {
    const canDelete = me ? (c.userId === me || (s && s.role === 'admin')) : false;
    return Object.assign({}, c, { mine: me ? c.userId === me : false, canDelete: canDelete });
  });
  return ok({ target, comments: out });
}

export async function onRequestPost({ env, request }) {
  const s = await requireSession(env, request);
  if (s instanceof Response) return s;

  const rl = await rateLimit(env.BOOKSTATION_KV, 'comment', clientKey({ request }), { limit: 6, windowSec: 60 });
  if (!rl.ok) return err('rate_limited', '评论太频繁，请 ' + rl.retryAfter + ' 秒后再试', 429);

  let body;
  try { body = await request.json(); } catch { return err('bad_json', '请求体不是合法 JSON'); }
  const target = clean(body.target, 120);
  const content = cleanText(body.content, 1000).trim();
  if (!target) return err('bad_target', '缺少 target');
  if (!content) return err('empty_content', '评论内容不能为空');

  const kv = env.BOOKSTATION_KV;
  const list = (await kv.get('comments:' + target, { type: 'json' })) || [];
  const user = s.user || {};
  const name = clean(user.name || user.login || anonName(), 30) || anonName();
  const avatar = clean(user.avatar_url || '', 500);
  const comment = {
    id: newId('cm'),
    target: target,
    userId: 'u:' + (s.sub || ''),
    name: name,
    avatar: avatar,
    content: content,
    createdAt: Date.now(),
  };
  list.push(comment);
  if (list.length > MAX_COMMENTS) list.splice(0, list.length - MAX_COMMENTS);
  await kv.put('comments:' + target, JSON.stringify(list));

  return ok({ comment: Object.assign({}, comment, { mine: true, canDelete: true }) }, 201);
}

export async function onRequestDelete({ env, request }) {
  const s = await requireSession(env, request);
  if (s instanceof Response) return s;
  const url = new URL(request.url);
  const target = clean(url.searchParams.get('target'), 120);
  const cid = clean(url.searchParams.get('id'), 60);
  if (!target || !cid) return err('bad_param', '缺少 target 或 id');
  const kv = env.BOOKSTATION_KV;
  const list = (await kv.get('comments:' + target, { type: 'json' })) || [];
  const idx = list.findIndex(function (c) { return c.id === cid; });
  if (idx < 0) return err('not_found', '评论不存在', 404);
  const isMine = list[idx].userId === ('u:' + (s.sub || ''));
  if (!isMine && s.role !== 'admin') return err('forbidden', '只能删除自己的评论', 403);
  const removed = list.splice(idx, 1)[0];
  await kv.put('comments:' + target, JSON.stringify(list));
  return ok({ deleted: removed.id, target: target });
}
