// GET /api/books/stats   创作概览聚合（创作者看自己，管理员看全部）
import { ok, listBooks } from '../../_lib/store.js';
import { getSession } from '../../_lib/auth.js';

// 灵感来自 B 站稿件中心的「数据概览」：把稿件维度的累计指标搬成书栈的作品维度。
export async function onRequestGet({ env, request }) {
  const s = await getSession(env, request);
  if (!s) return ok({ error: 'unauthorized', message: '请先登录' }, 401);

  let books = await listBooks(env.BOOKSTATION_KV);
  if (s.role !== 'admin') {
    // 创作者只看归属自己的书（owner === 小蓝页 sub）
    const key = s.sub;
    books = books.filter((b) => (b.owner || null) === key);
  }

  let words = 0;
  let views = 0;
  let chapters = 0;
  let ongoing = 0;
  let done = 0;
  for (const b of books) {
    words += Number(b.words) || 0;
    views += Number(b.views) || 0;
    chapters += Number(b.chapterCount) || 0;
    if (b.status === 'done') done++;
    else ongoing++;
  }

  return ok({
    total: books.length,
    ongoing,
    done,
    words,
    views,
    chapters,
  });
}
