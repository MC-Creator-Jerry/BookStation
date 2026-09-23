// GET    /api/book?id=<bookId>   书籍详情 + 章节目录（并计一次浏览量）
// PUT    /api/book?id=<bookId>   修改书籍资料（管理员）
// DELETE /api/book?id=<bookId>   删除书籍及其全部章节（管理员）
import {
  ok,
  err,
  getBook,
  putBook,
  getChapterList,
  deleteBookCompletely,
  clean,
  cleanText,
  normTags,
} from '../_lib/store.js';
import { requireWrite } from '../_lib/auth.js';

export async function onRequestGet({ env, request, waitUntil }) {
  const id = clean(new URL(request.url).searchParams.get('id'), 60);
  const kv = env.BOOKSTATION_KV;
  const book = await getBook(kv, id);
  if (!book) return err('not_found', '没有这本书', 404);

  const chapters = (await getChapterList(kv, id)).map((c, i) => ({
    id: c.id,
    title: c.title,
    words: c.words || 0,
    no: i + 1,
  }));

  // 浏览量 +1（不阻塞响应）
  const bump = (async () => {
    book.views = (Number(book.views) || 0) + 1;
    await putBook(kv, book);
  })();
  if (typeof waitUntil === 'function') waitUntil(bump);

  return ok({ book, chapters });
}

export async function onRequestPut({ env, request }) {
  const id = clean(new URL(request.url).searchParams.get('id'), 60);
  const kv = env.BOOKSTATION_KV;
  const book = await getBook(kv, id);
  if (!book) return err('not_found', '没有这本书', 404);

  const denied = await requireWrite(env, request, book);
  if (denied instanceof Response) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_json', '请求体不是合法 JSON');
  }

  if ('title' in body) {
    const title = clean(body.title, 80);
    if (!title) return err('missing_title', '书名不能为空');
    book.title = title;
  }
  if ('author' in body) book.author = clean(body.author, 40) || '佚名';
  if ('cover' in body) book.cover = clean(body.cover, 500);
  if ('intro' in body) book.intro = cleanText(body.intro, 4000);
  if ('tags' in body) book.tags = normTags(body.tags);
  if ('status' in body) book.status = body.status === 'done' ? 'done' : 'ongoing';
  book.updatedAt = Date.now();

  await putBook(kv, book);
  return ok({ book });
}

export async function onRequestDelete({ env, request }) {
  const id = clean(new URL(request.url).searchParams.get('id'), 60);
  const book = await getBook(env.BOOKSTATION_KV, id);
  if (!book) return err('not_found', '没有这本书', 404);

  const denied = await requireWrite(env, request, book);
  if (denied instanceof Response) return denied;

  const removed = await deleteBookCompletely(env.BOOKSTATION_KV, id);
  return ok({ deleted: book.id, title: book.title, chapters: removed });
}
