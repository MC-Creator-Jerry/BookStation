// GET    /api/orig?id=<bookId>           列出原文件 [{n,name,mime}]
// GET    /api/orig?id=<bookId>&n=<index> 返回文件字节（附件下载）；book.allowOriginal 为 false 时 403
// POST   /api/orig                        保存原文件 {id, files:[{name,mime,b64}]}，单文件 ≤22MB，超限跳过
import {
  ok,
  err,
  getBook,
  clean,
} from '../_lib/store.js';
import { requireWrite } from '../_lib/auth.js';

const ORIG = 'orig:';        // orig:<bookId>:<n>     -> 原始文件字节
const META = 'origmeta:';    // origmeta:<bookId>:<n> -> JSON {name,mime}
const MAX_BYTES = 22 * 1024 * 1024; // KV 单值 25MB 上限，留余量

function b64ToBytes(b64) {
  const bin = atob(String(b64));
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const id = clean(url.searchParams.get('id'), 60);
  const kv = env.BOOKSTATION_KV;
  const book = await getBook(kv, id);
  if (!book) return err('not_found', '没有这本书', 404);
  if (book.allowOriginal === false) return err('disabled', '本书未允许阅读者查看原文件', 403);

  const n = url.searchParams.get('n');
  if (n !== null) {
    const bytes = await kv.get(ORIG + id + ':' + n, { type: 'arrayBuffer' });
    if (!bytes) return err('not_found', '没有这个原文件', 404);
    const metaRaw = await kv.get(META + id + ':' + n, { type: 'json' });
    const meta = metaRaw || {};
    const name = meta.name || ('original-' + n);
    const mime = meta.mime || 'application/octet-stream';
    return new Response(bytes, {
      headers: {
        'content-type': mime,
        'content-disposition': 'attachment; filename="' + encodeURIComponent(name) + '"',
        'cache-control': 'public, max-age=86400',
      },
    });
  }

  const list = await kv.list({ prefix: META + id + ':' });
  const files = [];
  for (const k of (list.keys || [])) {
    const nIdx = k.name.slice((META + id + ':').length);
    const metaRaw = await kv.get(k.name, { type: 'json' });
    const meta = metaRaw || {};
    files.push({ n: nIdx, name: meta.name || ('original-' + nIdx), mime: meta.mime || 'application/octet-stream' });
  }
  files.sort(function (a, b) { return String(a.n).localeCompare(String(b.n), undefined, { numeric: true }); });
  return ok({ files });
}

export async function onRequestPost({ env, request }) {
  const kv = env.BOOKSTATION_KV;
  let body;
  try { body = await request.json(); } catch { return err('bad_json', '请求体不是合法 JSON'); }

  const bookId = clean(body.id, 60);
  const book = await getBook(kv, bookId);
  if (!book) return err('not_found', '没有这本书', 404);
  const denied = await requireWrite(env, request, book);
  if (denied instanceof Response) return denied;

  const incoming = Array.isArray(body.files) ? body.files : [];
  // 先清旧的，避免残留
  const oldO = await kv.list({ prefix: ORIG + bookId + ':' });
  const oldM = await kv.list({ prefix: META + bookId + ':' });
  await Promise.all((oldO.keys || []).map(function (k) { return kv.delete(k.name); }));
  await Promise.all((oldM.keys || []).map(function (k) { return kv.delete(k.name); }));

  let stored = 0;
  const skipped = [];
  let i = 0;
  for (const f of incoming) {
    if (!f || !f.b64) continue;
    let bytes;
    try { bytes = b64ToBytes(f.b64); } catch { skipped.push((f.name || ('file' + i)) + '（解码失败）'); continue; }
    if (bytes.length > MAX_BYTES) { skipped.push((f.name || ('file' + i)) + '（>22MB）'); continue; }
    const name = clean(f.name || ('original-' + i), 160) || ('original-' + i);
    const mime = clean(f.mime || 'application/octet-stream', 120) || 'application/octet-stream';
    await kv.put(ORIG + bookId + ':' + i, bytes);
    await kv.put(META + bookId + ':' + i, JSON.stringify({ name: name, mime: mime }));
    i++; stored++;
  }
  return ok({ stored, skipped });
}
