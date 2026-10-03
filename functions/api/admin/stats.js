// GET /api/admin/stats  仅管理员：全站概览（书籍数 / 总翻阅 / 创作者数 / 举报与待处理）
import { ok, listBooks } from '../../_lib/store.js';
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequestGet({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied instanceof Response) return denied;
  const kv = env.BOOKSTATION_KV;
  const books = await listBooks(kv);

  let views = 0;
  const owners = new Set();
  books.forEach(function (b) {
    views += Number(b.views || 0);
    if (b.owner) owners.add(b.owner);
  });

  let reports = 0;
  let pending = 0;
  try {
    const r = await kv.list({ prefix: 'report:' });
    reports = (r.keys || []).length;
    const got = await Promise.all((r.keys || []).map(function (k) { return kv.get(k.name, { type: 'json' }); }));
    pending = got.filter(function (x) { return x && x.status === 'pending'; }).length;
  } catch { /* 忽略列举异常 */ }

  return ok({
    books: books.length,
    views: views,
    creators: owners.size,
    reports: reports,
    pending: pending,
  });
}
