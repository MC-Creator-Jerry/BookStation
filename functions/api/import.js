// POST /api/import   批量导入章节（需对书籍有写权限）
// 请求体：{ id: <bookId>, chapters: [{ title?, content }] }
// 与逐章 POST /chapter 相比：一次性读改写，避免并发追加丢章；适合「整本上传」。
import {
  ok,
  err,
  getBook,
  putBook,
  getChapterList,
  putChapterList,
  putChapter,
  refreshBookStats,
  newId,
  clean,
  cleanText,
  wordCount,
} from '../_lib/store.js';
import { requireWrite } from '../_lib/auth.js';

const MAX_CHAPTERS = 2000;

export async function onRequestPost({ env, request }) {
  const kv = env.BOOKSTATION_KV;

  let body;
  try {
    body = await request.json();
  } catch {
    return err('bad_json', '请求体不是合法 JSON');
  }

  const bookId = clean(body.id, 60);
  const book = await getBook(kv, bookId);
  if (!book) return err('not_found', '没有这本书', 404);

  const denied = await requireWrite(env, request, book);
  if (denied instanceof Response) return denied;

  const incoming = Array.isArray(body.chapters) ? body.chapters : [];
  if (!incoming.length) return err('no_chapters', '没有提供任何章节');

  // 规整 + 截断（前端也应给提示）
  const parsed = [];
  for (const c of incoming) {
    const chapter = c && typeof c === 'object' ? c : null;
    const title = clean(chapter && chapter.title, 80) || ('第 ' + (parsed.length + 1) + ' 章');
    const content = cleanText(chapter && chapter.content, 200000);
    if (!content.trim()) continue; // 跳过空章
    parsed.push({ title, content });
    if (parsed.length >= MAX_CHAPTERS) break;
  }
  if (!parsed.length) return err('empty', '所有章节正文均为空');

  const list = await getChapterList(kv, bookId);
  const now = Date.now();
  const writes = [];
  for (const c of parsed) {
    const id = newId('c');
    writes.push(putChapter(kv, bookId, {
      id,
      bookId,
      title: c.title,
      content: c.content,
      createdAt: now,
      updatedAt: now,
    }));
    list.push({ id, title: c.title, words: wordCount(c.content), createdAt: now, updatedAt: now });
  }
  await Promise.all(writes);
  await putChapterList(kv, bookId, list);
  await refreshBookStats(kv, book);

  return ok({
    imported: parsed.length,
    total: list.length,
    truncated: incoming.length - parsed.length,
    book,
  }, 201);
}
