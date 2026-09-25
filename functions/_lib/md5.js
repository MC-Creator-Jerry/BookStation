// 纯 JS 的 MD5 实现（十六进制小写）。
//
// 为什么需要：爱发电开放平台的签名算法是 MD5，但 Cloudflare Workers 的
// WebCrypto（crypto.subtle.digest）**不支持 MD5**，只支持 SHA-1 / SHA-256 等。
// 所以这里自带一份实现，零依赖、可在 Worker 运行时直接跑。
//
// 输入按 UTF-8 编码处理（中文不会算错），返回 32 位十六进制字符串。

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i+1)) * 2^32)
const K = new Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

const encoder = new TextEncoder();

export function md5Hex(input) {
  const msg = input instanceof Uint8Array ? input : encoder.encode(String(input));
  const bitLen = msg.length * 8;

  // 填充：0x80 + 若干 0x00 + 64 位原始长度（小端）
  const padLen = ((56 - ((msg.length + 1) % 64)) + 64) % 64;
  const buf = new Uint8Array(msg.length + 1 + padLen + 8);
  buf.set(msg, 0);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, bitLen >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);

    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * j) % 16; }

      const tmp = (F + A + K[j] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((tmp << S[j]) | (tmp >>> (32 - S[j])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // 注意：最终摘要的 4 个字要按【小端字节序】输出，
  // 直接 toString(16) 会变成大端、结果与标准 MD5 不符。
  const out = [];
  for (const x of [a0, b0, c0, d0]) {
    out.push(x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff);
  }
  return out.map((b) => b.toString(16).padStart(2, '0')).join('');
}
