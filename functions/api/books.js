// GET  /api/books   书架列表（搜索/标签/状态/排序/分页）
// POST /api/books   新建书籍（管理员）
import {
  ok,
  err,
  listBooks,
  putBook,
  readIndex,
  writeIndex,
  newId,
  clean,
  cleanText,
  normTags,
} from '../_lib/store.js';
import { requireSession, getSession } from '../_lib/auth.js';

const SORTS = {
  updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  title: (a, b) => String(a.title).localeCompare(String(b.title), 'zh'),
  views: (a, b) => (b.views || 0) - (a.views || 0),
  words: (a, b) => (b.words || 0) - (a.words || 0),
};

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q'), 60).toLowerCase();
  const tag = clean(url.searchParams.get('tag'), 30).toLowerCase();
  const status = clean(url.searchParams.get('status'), 12).toLowerCase();
  const sortKey = SORTS[clean(url.searchParams.get('sort'), 12)] ? clean(url.searchParams.get('sort'), 12) : 'updated';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const size = Math.min(48, Math.max(1, parseInt(url.searchParams.get('size') || '24', 10) || 24));
  const mine = url.searchParams.get('mine') === '1';

  let books = await listBooks(env.BOOKSTATION_KV);

  // 仅看「我自己的书」：创作者按 sub 过滤；管理员按 owner==='admin' 过滤（需登录）
  if (mine) {
    const s = await getSession(env, request);
    if (!s) return err('unauthorized', '请先登录', 401);
    const key = s.role === 'admin' ? 'admin' : s.sub;
    books = books.filter((b) => (b.owner || null) === key);
  }
  const tags = [...new Set(books.flatMap((b) => b.tags || []))].sort((a, b) => a.localeCompare(b, 'zh'));

  if (q) {
    books = books.filter((b) =>
      `${b.title} ${b.author} ${(b.tags || []).join(' ')} ${b.intro || ''}`.toLowerCase().includes(q)
    );
  }
  if (tag) {
    books = books.filter((b) => (b.tags || []).some((t) => String(t).toLowerCase() === tag));
  }
  if (status === 'ongoing' || status === 'done') {
    books = books.filter((b) => b.status === status);
  }
  books.sort(SORTS[sortKey]);

  const total = books.length;
  const start = (page - 1) * size;
  const slice = books.slice(start, start + size).map((b) => ({ ...b, intro: String(b.intro || '').slice(0, 160) }));

  return ok({
    total,
    page,
    size,
    pages: Math.max(1, Math.ceil(total / size)),
    sort: sortKey,
    tags,
    books: slice,
  });
}

export async function onRequestPost({ env, request }) {
  const s = await requireSession(env, request);
  if (s instanceof Response) return s;

  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_json', '请求体不是合法 JSON');
  }

  const title = clean(body.title, 80);
  if (!title) return err('missing_title', '书名不能为空');

  const now = Date.now();
  const book = {
    id: newId('b'),
    title,
    author: clean(body.author, 40) || '佚名',
    cover: clean(body.cover, 500),
    intro: cleanText(body.intro, 4000),
    tags: normTags(body.tags),
    status: body.status === 'done' ? 'done' : 'ongoing',
    owner: s.role === 'admin' ? 'admin' : s.sub, // 创作者归属到自己的小蓝页身份
    createdAt: now,
    updatedAt: now,
    chapterCount: 0,
    words: 0,
    views: 0,
  };

  await putBook(env.BOOKSTATION_KV, book);
  const ids = await readIndex(env.BOOKSTATION_KV);
  ids.unshift(book.id);
  await writeIndex(env.BOOKSTATION_KV, ids);

  return ok({ book }, 201);
}
