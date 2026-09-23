// GET    /api/chapter?id=<bookId>&c=<chapterId>   读正文（含上一章/下一章/书籍信息）
// POST   /api/chapter?id=<bookId>                 追加新章节（管理员）
//        POST ?id=<bookId>&c=<cid>&action=move&dir=up|down   调整章节顺序（管理员）
// PUT    /api/chapter?id=<bookId>&c=<cid>         改章节（管理员）
// DELETE /api/chapter?id=<bookId>&c=<cid>         删章节（管理员）
import {
  ok,
  err,
  getBook,
  putBook,
  getChapterList,
  putChapterList,
  getChapter,
  putChapter,
  deleteChapterKey,
  refreshBookStats,
  newId,
  clean,
  cleanText,
  wordCount,
} from '../_lib/store.js';
import { requireAdmin } from '../_lib/auth.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const bookId = clean(url.searchParams.get('id'), 60);
  const cid = clean(url.searchParams.get('c'), 60);
  const kv = env.BOOKSTATION_KV;

  const book = await getBook(kv, bookId);
  if (!book) return err('not_found', '没有这本书', 404);

  const list = await getChapterList(kv, bookId);
  if (!list.length) return err('no_chapters', '这本书还没有章节', 404);

  let pos = list.findIndex((c) => c.id === cid);
  if (pos < 0) pos = 0; // 不带 c（或 c 失效）时读第一章

  const meta = list[pos];
  const chapter = await getChapter(kv, bookId, meta.id);
  if (!chapter) return err('not_found', '章节不存在', 404);

  const brief = (i) => (i >= 0 && i < list.length ? { id: list[i].id, title: list[i].title, no: i + 1 } : null);

  return ok({
    book: { id: book.id, title: book.title, author: book.author, status: book.status, tags: book.tags || [] },
    chapter: { id: chapter.id, title: chapter.title, content: chapter.content || '', no: pos + 1, words: meta.words || 0 },
    total: list.length,
    prev: brief(pos - 1),
    next: brief(pos + 1),
    index: list.map((c, i) => ({ id: c.id, title: c.title, no: i + 1 })),
  });
}

export async function onRequestPost({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied) return denied;

  const url = new URL(request.url);
  const kv = env.BOOKSTATION_KV;
  const bookId = clean(url.searchParams.get('id'), 60);
  const cid = clean(url.searchParams.get('c'), 60);
  const action = clean(url.searchParams.get('action'), 20);

  const book = await getBook(kv, bookId);
  if (!book) return err('not_found', '没有这本书', 404);

  const list = await getChapterList(kv, bookId);

  // --- 调整顺序 ---
  if (action === 'move') {
    const dir = clean(url.searchParams.get('dir'), 8);
    const i = list.findIndex((c) => c.id === cid);
    if (i < 0) return err('not_found', '章节不存在', 404);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return err('out_of_range', '已经到边界了');
    [list[i], list[j]] = [list[j], list[i]];
    await putChapterList(kv, bookId, list);
    book.updatedAt = Date.now();
    await putBook(kv, book);
    return ok({ moved: cid, from: i + 1, to: j + 1 });
  }

  // --- 追加新章节 ---
  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_json', '请求体不是合法 JSON');
  }

  const title = clean(body.title, 80) || `第 ${list.length + 1} 章`;
  const content = cleanText(body.content, 200000);
  if (!content.trim()) return err('empty_content', '章节正文不能为空');

  const now = Date.now();
  const chapter = {
    id: newId('c'),
    bookId,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  };

  await putChapter(kv, bookId, chapter);
  list.push({ id: chapter.id, title, words: wordCount(content), createdAt: now, updatedAt: now });
  await putChapterList(kv, bookId, list);
  book.updatedAt = now;
  await refreshBookStats(kv, book);

  return ok({ chapter: { id: chapter.id, title, no: list.length, words: wordCount(content) }, book }, 201);
}

export async function onRequestPut({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied) return denied;

  const url = new URL(request.url);
  const kv = env.BOOKSTATION_KV;
  const bookId = clean(url.searchParams.get('id'), 60);
  const cid = clean(url.searchParams.get('c'), 60);

  const book = await getBook(kv, bookId);
  if (!book) return err('not_found', '没有这本书', 404);

  const chapter = await getChapter(kv, bookId, cid);
  if (!chapter) return err('not_found', '章节不存在', 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_json', '请求体不是合法 JSON');
  }

  if ('title' in body) chapter.title = clean(body.title, 80) || chapter.title;
  if ('content' in body) {
    const content = cleanText(body.content, 200000);
    if (!content.trim()) return err('empty_content', '章节正文不能为空');
    chapter.content = content;
  }
  chapter.updatedAt = Date.now();

  await putChapter(kv, bookId, chapter);

  const list = await getChapterList(kv, bookId);
  const idx = list.findIndex((c) => c.id === cid);
  if (idx >= 0) {
    list[idx] = { ...list[idx], title: chapter.title, words: wordCount(chapter.content), updatedAt: chapter.updatedAt };
    await putChapterList(kv, bookId, list);
  }
  book.updatedAt = chapter.updatedAt;
  await refreshBookStats(kv, book);

  return ok({ chapter: { id: chapter.id, title: chapter.title, words: wordCount(chapter.content) }, book });
}

export async function onRequestDelete({ env, request }) {
  const denied = await requireAdmin(env, request);
  if (denied) return denied;

  const url = new URL(request.url);
  const kv = env.BOOKSTATION_KV;
  const bookId = clean(url.searchParams.get('id'), 60);
  const cid = clean(url.searchParams.get('c'), 60);

  const book = await getBook(kv, bookId);
  if (!book) return err('not_found', '没有这本书', 404);

  const list = await getChapterList(kv, bookId);
  if (!list.some((c) => c.id === cid)) return err('not_found', '章节不存在', 404);

  await deleteChapterKey(kv, bookId, cid);
  const left = list.filter((c) => c.id !== cid);
  await putChapterList(kv, bookId, left);
  book.updatedAt = Date.now();
  await refreshBookStats(kv, book);

  return ok({ deleted: cid, left: left.length, book });
}
