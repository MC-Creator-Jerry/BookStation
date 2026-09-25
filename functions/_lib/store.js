// 书栈 BookStation · KV 数据层（独立 KV：BOOKSTATION_KV）
// 键位：
//   books:index                  -> [bookId, ...]        书架索引（顺序=展示顺序）
//   book:<bookId>                -> {id,title,author,cover,intro,tags,status,createdAt,updatedAt,words,views}
//   chaps:<bookId>               -> [{id,title,words,createdAt,updatedAt}, ...]  章节顺序 = 数组顺序
//   chap:<bookId>:<cid>          -> {id,bookId,title,content,createdAt,updatedAt}
//   bs_sid:<sid>                 -> {createdAt}          管理员会话（见 _lib/auth.js）

const INDEX_KEY = 'books:index';

// 书栈「类型（分类）」精选词表（前端 bookstation.js 存有同一份，改动需同步）
export const CATEGORIES = [
  '小说', '文学', '诗歌', '散文', '随笔', '科幻', '奇幻', '悬疑', '推理',
  '历史', '传记', '武侠', '仙侠', '言情', '同人', '漫画', '剧本', '教材', '其他',
];

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function ok(data = {}, status = 200, headers = {}) {
  return json({ ok: true, ...data }, status, headers);
}

export function err(code, message = '', status = 400) {
  return json({ ok: false, error: code, message }, status);
}

export function newId(prefix) {
  const ts = Date.now().toString(36);
  let rand = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) rand += b.toString(36).padStart(2, '0');
  return `${prefix}_${ts}${rand.slice(0, 8)}`;
}

/** 单行短文本：折叠空白 + 截断 */
export function clean(v, max = 200) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 正文/简介：保留换行、去 CR 与非法字符、限长 */
export function cleanText(v, max = 200000) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .slice(0, max);
}

/** 字数：按非空白字符计（中文习惯） */
export function wordCount(text) {
  return String(text || '').replace(/\s/g, '').length;
}

export function normTags(v) {
  const arr = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,，、\s]+/);
  const out = [];
  for (const t of arr) {
    const s = clean(t, 20);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

export async function readIndex(kv) {
  const raw = await kv.get(INDEX_KEY, { type: 'json' });
  return Array.isArray(raw) ? raw : [];
}

export async function writeIndex(kv, ids) {
  await kv.put(INDEX_KEY, JSON.stringify(ids));
}

export async function getBook(kv, id) {
  if (!id) return null;
  return await kv.get(`book:${id}`, { type: 'json' });
}

export async function putBook(kv, book) {
  await kv.put(`book:${book.id}`, JSON.stringify(book));
}

/** 取全部书籍（并发读，避免串行等待） */
export async function listBooks(kv) {
  const ids = await readIndex(kv);
  const got = await Promise.all(ids.map((id) => getBook(kv, id)));
  return got.filter(Boolean);
}

export async function getChapterList(kv, bookId) {
  const raw = await kv.get(`chaps:${bookId}`, { type: 'json' });
  return Array.isArray(raw) ? raw : [];
}

export async function putChapterList(kv, bookId, list) {
  await kv.put(`chaps:${bookId}`, JSON.stringify(list));
}

export async function getChapter(kv, bookId, cid) {
  if (!bookId || !cid) return null;
  return await kv.get(`chap:${bookId}:${cid}`, { type: 'json' });
}

export async function putChapter(kv, bookId, chapter) {
  await kv.put(`chap:${bookId}:${chapter.id}`, JSON.stringify(chapter));
}

export async function deleteChapterKey(kv, bookId, cid) {
  await kv.delete(`chap:${bookId}:${cid}`);
}

/** 书籍统计（章节数/总字数）按当前章节列表回写 */
export async function refreshBookStats(kv, book) {
  const list = await getChapterList(kv, book.id);
  book.chapterCount = list.length;
  book.words = list.reduce((n, c) => n + (Number(c.words) || 0), 0);
  await putBook(kv, book);
  return book;
}

/** 彻底删除一本书：章节 + 列表 + 索引 */
export async function deleteBookCompletely(kv, bookId) {
  const list = await getChapterList(kv, bookId);
  await Promise.all(list.map((c) => deleteChapterKey(kv, bookId, c.id)));
  await kv.delete(`chaps:${bookId}`);
  await kv.delete(`book:${bookId}`);
  const ids = await readIndex(kv);
  await writeIndex(kv, ids.filter((id) => id !== bookId));
  return list.length;
}
