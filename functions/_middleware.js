// root middleware · 每个请求都会先跑（先于静态资源）
//
// 做两件事：
//  1) 藏住构建/配置文件。wrangler 要求 wrangler.toml 必须放在部署根目录，
//     而 Pages 不支持 .assetsignore，所以这些文件默认可以被直接下载。
//     _redirects 挡不住「已存在的静态资源」，只有 Functions 先于静态资源执行 —— 所以在这里挡。
//     文件内容本身不算机密（项目名 + KV namespace id），属于卫生问题，但没必要送出去。
//  2) 挡掉针对 PHP / CMS 的批量扫描探测（.php、wp-login、.env、.git …）。
//     本站是「静态资源 + Pages Functions」，这些路径根本不存在，
//     挡掉可以减少日志噪音，也避免将来误放了什么被扫到。
//
// 刻意保持极简：它在每个请求上都会跑，所以任何异常都不得影响站点（见 try/catch 与 fail-open）。

const BLOCKED = new Set([
  '/wrangler.toml', '/wrangler.json', '/wrangler.jsonc', '/.assetsignore',
  '/.dev.vars', '/.env', '/.env.local', '/.env.production',
]);

// 扫描器探测特征（已小写）
const PROBE = [
  '/wp-login', '/wp-admin', '/xmlrpc.php', '/phpmyadmin',
  '/.git/', '/.aws/', '/.ssh/', '/.htpasswd', '/.htaccess', '/.DS_Store',
];

function isBad(path) {
  if (BLOCKED.has(path)) return true;
  for (const p of PROBE) {
    if (path.indexOf(p) >= 0) return true;
  }
  // 本站不存在 php / 数据库导出 / 备份文件
  return /\.(php|sql|bak|old|swp)$/.test(path);
}

export async function onRequest(context) {
  try {
    const path = new URL(context.request.url).pathname.toLowerCase();
    if (isBad(path)) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
  } catch (e) {
    // 守卫绝不能把站点搞挂：出错就放行
  }
  return context.next();
}
