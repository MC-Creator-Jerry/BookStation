/* 书栈 BookStation · 共享脚本（主题 / 接口 / 书架首页 / 书籍详情） */
window.BS = (function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  // 站主常量；与管理员判定（isAdmin || login === OWNER）保持一致。
  const OWNER = 'MC-Creator-Jerry';

  // 书栈「类型（分类）」精选词表（与 functions/_lib/store.js 的 CATEGORIES 同步）
  const CATEGORIES = [
    '小说', '文学', '诗歌', '散文', '随笔', '科幻', '奇幻', '悬疑', '推理',
    '历史', '传记', '武侠', '仙侠', '言情', '同人', '漫画', '剧本', '教材', '其他',
  ];
  function categoryText(c) { return CATEGORIES.includes(c) ? c : '其他'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = { credentials: 'same-origin', headers: {} };
    if (opts.method) init.method = opts.method;
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch('/api' + path, init);
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok || !data || data.ok === false) {
      const err = new Error((data && (data.message || data.error)) || 'HTTP ' + res.status);
      err.status = res.status;
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  /* ---------------- 主题 ---------------- */
  const THEME_KEY = 'bs_theme';
  function paintThemeBtn() {
    const btn = $('#themeBtn');
    if (btn) btn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem(THEME_KEY, t);
    paintThemeBtn();
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* 隐私模式 */ }
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    paintThemeBtn();
    const btn = $('#themeBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
      });
    }
  }

  /* ---------------- 小工具 ---------------- */
  let toastTimer = null;
  function toast(msg, bad) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast' + (bad ? ' bad' : ''); }, 2400);
  }

  function fmtWords(n) {
    n = Number(n) || 0;
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万字';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + ' 千字';
    return n + ' 字';
  }
  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function statusText(s) { return s === 'done' ? '已完结' : '连载中'; }
  function natureText(n) { return n === 'derivative' ? '二创' : n === 'repost' ? '搬运' : '原创'; }
  function qs(key) { return new URLSearchParams(location.search).get(key) || ''; }

  /* ---------------- 静态镜像提示（GitHub Pages 没有后端） ---------------- */
  const LIVE_SITE = 'https://jerrybookstation.pages.dev/';
  const MIRROR_TIP =
    '<div class="bs-empty">这里是 <strong>GitHub Pages 静态镜像</strong>：只有静态页面，没有后端接口，所以读不到书架数据。<br><br>' +
    '完整的书架与阅读请访问 <a class="bs-btn" href="' + LIVE_SITE + '">jerrybookstation.pages.dev</a></div>';

  /* ---------------- 阅读进度（本地） ---------------- */
  const PROG_PREFIX = 'bs_progress:';
  function saveProgress(bookId, info) {
    if (!bookId) return;
    try {
      localStorage.setItem(PROG_PREFIX + bookId, JSON.stringify(Object.assign({ ts: Date.now() }, info)));
    } catch (e) { /* 忽略 */ }
  }
  function getProgress(bookId) {
    try {
      const raw = localStorage.getItem(PROG_PREFIX + bookId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ---------------- 登录态（管理入口显隐） ---------------- */
  let meState = null;
  async function me() {
    if (meState) return meState;
    try { meState = await api('/admin/me'); } catch (e) { meState = { loggedIn: false, role: null, isAdmin: false, user: null }; }
    return meState;
  }
  function doLogout() {
    api('/admin/logout', { method: 'POST' })
      .catch(function () {})
      .then(function () { location.reload(); });
  }
  function avatarHtml(name, url) {
    const initial = esc((name || '客').charAt(0).toUpperCase());
    const fallback = '<span class="avatar-fallback">' + initial + '</span>';
    if (!url) return fallback;
    return '<img class="avatar" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer">';
  }

  function renderAuthBox(state) {
    const box = $('#bsAuthBox');
    if (!box) return;
    // /admin/ 下的页面相对链接需要回到站点根（GH 镜像子路径下同样成立）
    const pre = /^\/admin(\/|$)/.test(location.pathname) ? '../' : './';
    if (state.loggedIn) {
      const u = (state.user && state.user.name) || (state.user && state.user.login) || '已登录';
      box.innerHTML =
        '<button class="bs-user-pill" id="bsUserPill" type="button" title="' + esc(u) + '">' +
        avatarHtml(u, state.user && state.user.avatar_url) +
        '<span class="uname">' + esc(u) + '</span>' +
        '<span class="caret">▾</span></button>' +
        '<div class="bs-user-menu" id="bsUserMenu">' +
        '<a href="' + pre + 'admin/">📚 我的书</a>' +
        '<a href="' + pre + 'settings.html">⚙️ 设置</a>' +
        (state.isAdmin ? '<a href="' + pre + 'admin/?view=admin" class="bs-menu-admin">🛡️ 管理员面板</a>' : '') +
        '<a href="#" data-bs-logout>🚪 退出登录</a>' +
        '</div>';
      const pill = $('#bsUserPill');
      const menu = $('#bsUserMenu');
      pill.addEventListener('click', function (e) {
        e.stopPropagation();
        menu.classList.toggle('open');
      });
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      document.addEventListener('click', function () { menu.classList.remove('open'); });
      // 头像加载失败 → 换成首字母占位
      const img = box.querySelector('img.avatar');
      if (img) img.addEventListener('error', function () {
        img.outerHTML = '<span class="avatar-fallback">' + esc(u.charAt(0).toUpperCase()) + '</span>';
      });
      const lo = menu.querySelector('[data-bs-logout]');
      if (lo) lo.addEventListener('click', function (e) { e.preventDefault(); doLogout(); });
    } else {
      box.innerHTML =
        '<a class="bs-link" href="' + pre + 'api/sso/start?next=' +
        encodeURIComponent(location.pathname + location.search) +
        '">登录</a>';
    }
  }
  async function mountAuth() {
    const state = await me();
    $$('[data-bs-admin]').forEach(function (el) { el.classList.toggle('hidden', !state.isAdmin); });
    $$('[data-bs-creator]').forEach(function (el) { el.classList.toggle('hidden', !state.loggedIn); });
    $$('[data-bs-auth-state]').forEach(function (el) { el.textContent = state.loggedIn ? '已登录' : '未登录'; });
    renderAuthBox(state);
    return state;
  }

  /* ---------------- 书架首页 ---------------- */
  function coverHtml(book, cls) {
    const title = esc(book.title || '');
    if (book.cover) {
      return '<div class="' + (cls || 'bs-cover') + '"><img src="' + esc(book.cover) + '" alt="' + title + '" loading="lazy" onerror="this.style.display=\'none\'"><span class="bs-cover-fallback">' + title + '</span></div>';
    }
    return '<div class="' + (cls || 'bs-cover') + '"><div class="bs-cover-fallback">' + title + '</div></div>';
  }

  function cardHtml(b) {
    const tags = (b.tags || []).slice(0, 3).map(function (t) { return '<span class="bs-tag">' + esc(t) + '</span>'; }).join('');
    return '' +
      '<a class="bs-card" href="book.html?id=' + encodeURIComponent(b.id) + '">' +
      coverHtml(b) +
      '<div class="bs-card-body">' +
      '<div class="bs-card-title">' + esc(b.title) + '</div>' +
      '<div class="bs-card-meta"><span>' + esc(b.author || '佚名') + '</span><span class="bs-cat">' + esc(categoryText(b.category)) + '</span><span class="bs-nature nature-' + (b.nature || 'original') + '">' + esc(natureText(b.nature)) + '</span><span class="bs-badge' + (b.status === 'done' ? ' done' : '') + '">' + statusText(b.status) + '</span></div>' +
      '<div class="bs-card-meta"><span>' + (b.chapterCount || 0) + ' 章</span><span>' + fmtWords(b.words) + '</span></div>' +
      (b.intro ? '<div class="bs-card-intro">' + esc(b.intro) + '</div>' : '') +
      (tags ? '<div class="bs-card-meta">' + tags + '</div>' : '') +
      '</div></a>';
  }

  async function initIndex() {
    const grid = $('#grid');
    const tagBox = $('#tags');
    const countEl = $('#count');
    const state = { q: qs('q'), tag: qs('tag'), status: '', category: qs('category') || '', sort: 'updated', page: 1 };
    const searchInput = $('#search');
    const sortTabs = $('#sortTabs');
    const catSel = $('#catFilter');
    if (searchInput) searchInput.value = state.q;

    async function load() {
      grid.innerHTML = '<div class="bs-empty">正在载入书架…</div>';
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.tag) p.set('tag', state.tag);
      if (state.status) p.set('status', state.status);
      if (state.category) p.set('category', state.category);
      p.set('sort', state.sort);
      p.set('page', String(state.page));
      p.set('size', '48');
      let data;
      try {
        data = await api('/books?' + p.toString());
      } catch (e) {
        grid.innerHTML = e.status === 404 ? MIRROR_TIP : '<div class="bs-empty">书架载入失败：' + esc(e.message) + '</div>';
        return;
      }
      if (countEl) countEl.textContent = '共 ' + data.total + ' 本';
      if (tagBox) {
        tagBox.innerHTML = ['<button class="bs-chip' + (!state.tag ? ' is-on' : '') + '" data-tag="">全部</button>']
          .concat((data.tags || []).map(function (t) {
            return '<button class="bs-chip' + (state.tag === t ? ' is-on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
          })).join('');
        $$('.bs-chip', tagBox).forEach(function (btn) {
          btn.addEventListener('click', function () {
            state.tag = btn.dataset.tag; state.page = 1; load();
          });
        });
      }
      grid.innerHTML = data.books.length
        ? data.books.map(cardHtml).join('')
        : '<div class="bs-empty">书架还是空的 —— 先在上面搜索别的关键词，或去 <a href="admin/">管理台</a> 上传一本书。</div>';
    }

    if (searchInput) {
      let t = null;
      searchInput.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { state.q = searchInput.value.trim(); state.page = 1; load(); }, 260);
      });
    }
    if (sortTabs) {
      const sortBtns = sortTabs.querySelectorAll('.cc-tab');
      sortBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.sort = btn.dataset.sort;
          sortBtns.forEach(function (b) { b.classList.toggle('is-on', b === btn); });
          load();
        });
      });
    }
    if (catSel) {
      catSel.innerHTML = '<option value="">全部类型</option>' + CATEGORIES.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
      if (state.category) catSel.value = state.category;
      catSel.addEventListener('change', function () { state.category = catSel.value; state.page = 1; load(); });
    }
    $$('[data-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.status = state.status === btn.dataset.status ? '' : btn.dataset.status;
        $$('[data-status]').forEach(function (b) { b.classList.toggle('is-on', b === btn && !!state.status); });
        load();
      });
    });
    load();
  }

  // 书栈 → 茶馆：用书籍标题派生 teahouse 专区 slug（同名单本指向同一专区）
  var TEAHOUSE_BASE = 'https://jerryteahouse.pages.dev';
  function teahouseZoneSlug(title) {
    return String(title || '').trim().toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /* ---------------- 书籍详情 ---------------- */
  // 书的语言：优先用书的 lang 字段（创作者后台设置），缺省中文
  function bookLangOf(b) {
    return (b && b.lang === 'en') ? 'en' : 'zh';
  }
  function bookLangHtml(b) {
    var l = bookLangOf(b);
    var name = l === 'en' ? 'English' : '中文';
    return '<div class="bs-row" style="margin-top:6px"><span class="bs-muted"><span data-i18n="book.lang">语言</span>：<b>' + name + '</b></span></div>';
  }

  async function initBook() {
    const id = qs('id');
    const box = $('#book');
    if (!id) { box.innerHTML = '<div class="bs-empty">缺少书籍参数。</div>'; return; }
    let data;
    try {
      data = await api('/book?id=' + encodeURIComponent(id));
    } catch (e) {
      box.innerHTML = e.status === 404 ? MIRROR_TIP : '<div class="bs-empty">' + esc(e.message) + '</div>';
      return;
    }
    const b = data.book;
    document.title = b.title + ' · 书栈';
    const chapters = data.chapters || [];
    const prog = getProgress(b.id);
    const first = chapters[0];
    const readHref = first ? 'read.html?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(first.id) : '';
    const tags = (b.tags || []).map(function (t) { return '<a class="bs-tag" href="./?tag=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join(' ');

    box.innerHTML = '' +
      '<div class="bs-book">' +
      coverHtml(b) +
      '<div>' +
      '<h2>' + esc(b.title) + '</h2>' +
      '<div class="bs-row bs-muted"><span>' + esc(b.author || '佚名') + '</span>' +
'<span class="bs-cat">' + esc(categoryText(b.category)) + '</span>' +
'<span class="bs-nature nature-' + (b.nature || 'original') + '">' + esc(natureText(b.nature)) + '</span>' +
'<span class="bs-badge' + (b.status === 'done' ? ' done' : '') + '">' + statusText(b.status) + '</span>' +
      '<span>' + chapters.length + ' 章</span><span>' + fmtWords(b.words) + '</span>' +
      '<span>' + (b.views || 0) + ' 次翻阅</span><span>更新于 ' + fmtDate(b.updatedAt) + '</span></div>' +
(b.nature && b.nature !== 'original' && b.source ? '<div class="bs-row" style="margin-top:6px"><span class="bs-muted">原作 / 出处：' + esc(b.source) + '</span></div>' : '') +
      bookLangHtml(b) +
      (tags ? '<div class="bs-row" style="margin-top:10px">' + tags + '</div>' : '') +
      (b.intro ? '<div class="bs-book-intro">' + esc(b.intro) + '</div>' : '') +
      (function () {
        var teaSlug = teahouseZoneSlug(b.title);
        var teaCover = b.cover ? (new URL(b.cover, location.origin).href) : '';
        var teaHref = TEAHOUSE_BASE + '/posts/?zone=' + encodeURIComponent(teaSlug) +
          '&from=bookstation&title=' + encodeURIComponent(b.title) + '&cover=' + encodeURIComponent(teaCover);
        return '<div class="bs-row">' +
          (readHref ? '<a class="bs-btn" href="' + (prog && prog.c ? 'read.html?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(prog.c) : readHref) + '">' +
            (prog && prog.c ? '继续阅读 · ' + esc(prog.title || '') : '开始阅读') + '</a>' : '<span class="bs-muted">这本书还没有章节</span>') +
          '<a class="bs-btn plain" href="' + teaHref + '" target="_blank" rel="noopener">💬 去茶馆讨论</a>' +
          '<a class="bs-btn plain hidden" data-bs-admin href="admin/?book=' + encodeURIComponent(b.id) + '">管理这本书</a>' +
          '</div>';
      })() +
      '<div class="bs-orig-box" id="origBox" style="margin-top:12px"></div>' +
      '</div></div>' +
      '<div class="bs-panel" style="margin-bottom:40px">' +
      '<div class="bs-row"><strong>目录</strong><span class="bs-spacer"></span><span class="bs-muted">共 ' + chapters.length + ' 章</span></div>' +
      (chapters.length
        ? '<ul class="bs-toc">' + chapters.map(function (c) {
          const on = prog && prog.c === c.id ? ' style="color:var(--accent);font-weight:600"' : '';
          return '<li><a href="read.html?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(c.id) + '"' + on + '>' +
            '<span><span class="no">' + c.no + '</span>' + esc(c.title) + '</span><span class="bs-muted">' + fmtWords(c.words) + '</span></a></li>';
        }).join('') + '</ul>'
        : '<div class="bs-empty">还没有章节。</div>') +
      '</div>' +
      '<div class="bs-interact">' +
        '<div class="bs-interact-bar">' +
          '<button class="bs-like-btn" id="likeBtn" type="button"><span class="bs-like-ico">♡</span> <span id="likeCount">0</span> <span class="bs-like-label">喜欢</span></button>' +
          '<span class="bs-spacer"></span>' +
          '<button class="bs-link-btn" id="reportBookBtn" type="button">⚐ 举报</button>' +
        '</div>' +
        '<div class="bs-comments" id="bsComments">' +
          '<h3 class="bs-h">评论 <span class="bs-muted" id="cmCount"></span></h3>' +
          '<div id="cmList"></div>' +
          '<div id="cmForm"></div>' +
        '</div>' +
      '</div>';

    await mountAuth();
    initInteractions(b.id);
    initReportDecision();
    if (b.allowOriginal !== false) loadOrigBox(b.id);
  }

  // 书籍详情页：若允许，展示原文件下载入口
  async function loadOrigBox(id) {
    const box = $('#origBox');
    if (!box) return;
    try {
      const d = await api('/orig?id=' + encodeURIComponent(id));
      const files = d.files || [];
      if (!files.length) { box.remove(); return; }
      box.innerHTML = '<span class="bs-muted">📄 原文件：</span> ' + files.map(function (f) {
        const href = '/api/orig?id=' + encodeURIComponent(id) + '&n=' + encodeURIComponent(f.n);
        return '<a class="bs-btn plain sm" href="' + href + '" download="' + esc(f.name) + '">' + esc(f.name) + '</a>';
      }).join(' ');
    } catch (e) {
      box.remove(); // 无原文件则隐藏
    }
  }

  /* ---------------- 首页精选（介绍页用，不带动画筛选） ---------------- */
  async function initFeatured() {
    const grid = $('#grid');
    if (!grid) return;
    grid.innerHTML = '<div class="bs-empty">正在载入…</div>';
    try {
      const data = await api('/books?size=24&sort=views');
      const books = (data.books || []).slice();
      // 精选：浏览量最多优先；浏览量相同时按发布时间（新→旧）排序
      books.sort(function (a, b) {
        return (b.views || 0) - (a.views || 0) ||
          (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0);
      });
      const top = books.slice(0, 6);
      grid.innerHTML = top.length
        ? top.map(cardHtml).join('')
        : '<div class="bs-empty">书架还是空的。</div>';
    } catch (e) {
      grid.innerHTML = e.status === 404 ? MIRROR_TIP : '<div class="bs-empty">精选载入失败：' + esc(e.message) + '</div>';
    }
  }

  /* ---------------- 管理员「更改页面布局」按钮（仿小蓝页，仅站主可见） ---------------- */
  // 编辑器 editbar.js 站点无关：用 /api/page-edit 相对路径 + curPath()，一套代码覆盖四站。
  var EDITBAR_VER = '20260928-02';
  function loadEditbar() {
    if (window.XLEdit) return;
    var s = document.createElement('script');
    s.src = '/assets/editbar.js?v=' + EDITBAR_VER;
    s.async = true;
    document.head.appendChild(s);
  }
  function maybeInjectLayoutBtn() {
    if (document.getElementById('editLayoutBtn')) return;
    // 仅管理员 / 站主可见：role==='admin' 或站主本人（login === OWNER）。
    var isOwner = !!(meState && meState.user && meState.user.login === OWNER);
    if (!meState || (!meState.isAdmin && !isOwner)) return;
    var fa = document.querySelector('.float-actions');
    if (!fa) {
      fa = document.createElement('div');
      fa.className = 'float-actions';
      document.body.appendChild(fa);
    }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fab xl-edit-fab';
    b.id = 'editLayoutBtn';
    b.title = '更改当前页面布局';
    b.setAttribute('aria-label', '更改当前页面布局');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    b.addEventListener('click', function () { if (window.XLEdit) window.XLEdit.open(); });
    fa.appendChild(b);
  }

  /* ---------------- 社区互动：点赞 / 评论 / 举报 ---------------- */
  const REPORT_REASONS = ['色情低俗', '侵权抄袭', '政治敏感', '暴力血腥', '垃圾广告', '其他'];
  const GUEST_KEY = 'bs_guest';
  let reportChosen = REPORT_REASONS[0];

  function guestId() {
    try {
      let g = localStorage.getItem(GUEST_KEY);
      if (!g) { g = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem(GUEST_KEY, g); }
      return g;
    } catch (e) { return 'anon'; }
  }

  function initLike(target, btnSel, countSel) {
    const btn = $(btnSel);
    if (!btn) return;
    const countEl = countSel ? $(countSel) : null;
    const ico = btn.querySelector('.bs-like-ico');
    function paint(liked, count) {
      btn.classList.toggle('is-liked', !!liked);
      if (ico) ico.textContent = liked ? '♥' : '♡';
      const lbl = btn.querySelector('.bs-like-label');
      if (lbl) lbl.textContent = liked ? '已喜欢' : '喜欢';
      if (countEl) countEl.textContent = count || 0;
    }
    btn.addEventListener('click', function () {
      api('/like', { method: 'POST', body: { target: target, guest: guestId() } })
        .then(function (d) { paint(d.liked, d.count); })
        .catch(function (e) { toast(e.message || '操作失败', true); });
    });
    api('/like?target=' + encodeURIComponent(target) + '&guest=' + encodeURIComponent(guestId()))
      .then(function (d) { paint(d.liked, d.count); })
      .catch(function () { /* 忽略 */ });
  }

  function initReport(type, target, triggerSel) {
    const btn = $(triggerSel);
    if (!btn) return;
    btn.addEventListener('click', function () { openReportModal(type, target); });
  }

  function openReportModal(type, target) {
    let m = $('#bsReportModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'bsReportModal';
      m.className = 'bs-modal-mask hidden';
      m.innerHTML =
        '<div class="bs-modal">' +
        '<div class="bs-modal-head"><strong>举报内容</strong><span class="bs-spacer"></span><button class="bs-icon-btn" id="rpClose" type="button">✕</button></div>' +
        '<div class="bs-modal-body">' +
        '<label class="bs-field-label">举报理由</label>' +
        '<div class="bs-rp-reasons" id="rpReasons">' + REPORT_REASONS.map(function (r, i) {
          return '<button type="button" class="bs-chip' + (i === 0 ? ' is-on' : '') + '" data-reason="' + esc(r) + '">' + esc(r) + '</button>';
        }).join('') + '</div>' +
        '<label class="bs-field-label" style="margin-top:12px">补充说明（选填）</label>' +
        '<textarea class="bs-textarea" id="rpDetail" maxlength="500" placeholder="请描述具体问题…"></textarea>' +
        '</div>' +
        '<div class="bs-modal-foot"><span class="bs-spacer"></span><button class="bs-btn plain sm" id="rpCancel" type="button">取消</button><button class="bs-btn sm danger" id="rpSubmit" type="button">提交举报</button></div>' +
        '</div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m) closeReportModal(); });
      $('#rpClose', m).addEventListener('click', closeReportModal);
      $('#rpCancel', m).addEventListener('click', closeReportModal);
      const reasons = $$('.bs-chip', $('#rpReasons', m));
      reasons.forEach(function (b) {
        b.addEventListener('click', function () {
          reportChosen = b.dataset.reason;
          reasons.forEach(function (x) { x.classList.toggle('is-on', x === b); });
        });
      });
    }
    reportChosen = REPORT_REASONS[0];
    const reasonsNow = $$('.bs-chip', m);
    reasonsNow.forEach(function (x, i) { x.classList.toggle('is-on', i === 0); });
    const detail = $('#rpDetail', m); if (detail) detail.value = '';
    const submit = $('#rpSubmit', m);
    submit.onclick = function () {
      const d = (detail ? detail.value : '').trim();
      submit.disabled = true;
      api('/report', { method: 'POST', body: { target: target, targetType: type, reason: reportChosen, detail: d, guest: guestId() } })
        .then(function () { toast('举报已提交，感谢反馈'); closeReportModal(); })
        .catch(function (e) { toast(e.message || '提交失败', true); })
        .then(function () { submit.disabled = false; });
    };
    m.classList.remove('hidden');
  }
  function closeReportModal() { const m = $('#bsReportModal'); if (m) m.classList.add('hidden'); }

  async function initComments(target, wrapSel) {
    const wrap = $(wrapSel);
    if (!wrap) return;
    const listEl = $('#cmList', wrap);
    const formEl = $('#cmForm', wrap);
    const countEl = $('#cmCount', wrap);

    function commentHtml(c) {
      const av = avatarHtml(c.name, c.avatar);
      const del = c.canDelete ? '<button class="bs-link-btn bs-cm-del" data-del="' + esc(c.id) + '" type="button">删除</button>' : '';
      return '<div class="bs-comment">' +
        '<div class="bs-cm-av">' + av + '</div>' +
        '<div class="bs-cm-main">' +
        '<div class="bs-cm-head"><span class="bs-cm-name">' + esc(c.name) + '</span><span class="bs-cm-time">' + fmtDate(c.createdAt) + '</span>' + del + '</div>' +
        '<div class="bs-cm-text">' + esc(c.content) + '</div>' +
        '</div></div>';
    }
    async function load() {
      try {
        const d = await api('/comment?target=' + encodeURIComponent(target));
        const cs = d.comments || [];
        if (countEl) countEl.textContent = '(' + cs.length + ')';
        listEl.innerHTML = cs.length
          ? cs.map(commentHtml).join('')
          : '<div class="bs-comment-empty">还没有评论，来抢沙发～</div>';
        $$('.bs-cm-del', listEl).forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('确定删除这条评论？')) return;
            api('/comment?target=' + encodeURIComponent(target) + '&id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' })
              .then(function () { toast('已删除'); load(); })
              .catch(function (e) { toast(e.message || '删除失败', true); });
          });
        });
      } catch (e) {
        listEl.innerHTML = '<div class="bs-comment-empty">评论载入失败：' + esc(e.message) + '</div>';
      }
    }
    async function renderForm() {
      const st = await me();
      if (st.loggedIn) {
        const who = (st.user && (st.user.name || st.user.login)) || '我';
        formEl.innerHTML =
          '<div class="bs-cm-form">' +
          '<textarea class="bs-textarea" id="cmInput" maxlength="1000" placeholder="友善发言，理性讨论…"></textarea>' +
          '<div class="bs-cm-form-bar"><span class="bs-muted">以「' + esc(who) + '」的身份发表</span><span class="bs-spacer"></span><button class="bs-btn sm" id="cmSend" type="button">发表评论</button></div>' +
          '</div>';
        const input = $('#cmInput', formEl);
        $('#cmSend', formEl).addEventListener('click', function () {
          const content = input.value.trim();
          if (!content) { toast('评论内容不能为空', true); return; }
          api('/comment', { method: 'POST', body: { target: target, content: content } })
            .then(function () { input.value = ''; toast('评论成功'); load(); })
            .catch(function (e) { toast(e.message || '评论失败', true); });
        });
      } else {
        const pre = /^\/admin(\/|$)/.test(location.pathname) ? '../' : './';
        formEl.innerHTML = '<div class="bs-cm-login">登录后即可参与评论 · <a class="bs-link" href="' + pre +
          'api/sso/start?next=' + encodeURIComponent(location.pathname + location.search) + '">去登录</a></div>';
      }
    }
    await renderForm();
    await load();
  }

  async function initInteractions(bookId) {
    const target = 'book:' + bookId;
    initLike(target, '#likeBtn', '#likeCount');
    initReport('book', target, '#reportBookBtn');
    await initComments(target, '#bsComments');
  }

  function initChapterInteractions(bookId, cid) {
    const target = 'chapter:' + bookId + ':' + cid;
    const old = $('#rdInteract');
    if (old) old.remove();
    const bar = document.createElement('span');
    bar.id = 'rdInteract';
    bar.className = 'rd-interact';
    bar.innerHTML = '<button class="rd-like" id="rdLikeBtn" type="button"><span class="bs-like-ico">♡</span> <b id="rdLikeCount">0</b></button>' +
      '<button class="rd-report" id="rdReportBtn" type="button">举报</button>';
    const next = $('#pagerNext');
    if (next && next.parentNode) next.parentNode.insertBefore(bar, next);
    initLike(target, '#rdLikeBtn', '#rdLikeCount');
    initReport('chapter', target, '#rdReportBtn');
  }

  /* ---------------- 管理员：举报处理决策条（在内容页就地判定） ---------------- */
  async function initReportDecision() {
    const reportId = qs('report');
    if (!reportId) return;
    if (document.querySelector('.bs-report-decision')) return;
    const state = await me();
    if (!state.isAdmin) return; // 仅管理员可见

    const page = document.body.dataset.page;
    const bookId = qs('id');
    const cid = qs('c');
    let type = null, target = null;
    if (page === 'book' && bookId) { type = 'book'; target = 'book:' + bookId; }
    else if (page === 'read' && bookId && cid) { type = 'chapter'; target = 'chapter:' + bookId + ':' + cid; }
    if (!type) return;
    const reason = qs('reason') || '';

    const bar = document.createElement('div');
    bar.className = 'bs-report-decision';
    bar.innerHTML =
      '<div class="bs-rd-inner">' +
        '<span class="bs-rd-tag">🚩 举报处理中' + (reason ? ' · ' + esc(reason) : '') + '</span>' +
        '<span class="bs-spacer"></span>' +
        '<button class="bs-btn danger sm" id="rdApprove" type="button">举报通过 · 删除内容</button>' +
        '<button class="bs-btn plain sm" id="rdReject" type="button">举报不通过</button>' +
        '<a class="bs-link-btn" id="rdBack" href="/admin/">返回面板</a>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);

    const decide = async function (approve) {
      try {
        if (approve) {
          if (type === 'book') {
            await api('/book?id=' + encodeURIComponent(bookId), { method: 'DELETE' });
          } else if (type === 'chapter') {
            await api('/chapter?id=' + encodeURIComponent(bookId) + '&c=' + encodeURIComponent(cid), { method: 'DELETE' });
          }
          await api('/report?id=' + encodeURIComponent(reportId), { method: 'PUT', body: { status: 'resolved' } });
          toast('举报已通过，内容已删除');
        } else {
          await api('/report?id=' + encodeURIComponent(reportId), { method: 'PUT', body: { status: 'dismissed' } });
          toast('举报已驳回');
        }
        // 回到管理员面板：admin 页会据 sessionStorage 还原到举报列表位置
        location.href = '/admin/';
      } catch (e) {
        toast(e.message || '操作失败', true);
      }
    };
    $('#rdApprove', bar).addEventListener('click', function () { decide(true); });
    $('#rdReject', bar).addEventListener('click', function () { decide(false); });
  }

  return {
    $: $, $$: $$, esc: esc, api: api, toast: toast,
    initInteractions: initInteractions, initChapterInteractions: initChapterInteractions,
    initReportDecision: initReportDecision,
    fmtWords: fmtWords, fmtDate: fmtDate, statusText: statusText, qs: qs,
    setTheme: setTheme, initTheme: initTheme, mountAuth: mountAuth, me: me,
    saveProgress: saveProgress, getProgress: getProgress,
    CATEGORIES: CATEGORIES, categoryText: categoryText,
    coverHtml: coverHtml, cardHtml: cardHtml,
    initIndex: initIndex, initBook: initBook, initFeatured: initFeatured,
    loadEditbar: loadEditbar, maybeInjectLayoutBtn: maybeInjectLayoutBtn,
    LIVE_SITE: LIVE_SITE, MIRROR_TIP: MIRROR_TIP,
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  BS.initTheme();
  const page = document.body.dataset.page;
  if (page === 'bookshelf') { BS.initIndex(); BS.mountAuth(); }
  else if (page === 'book') { BS.initBook(); }
  else if (page === 'index') { BS.initFeatured(); BS.mountAuth(); }
  else if (page !== 'read') { BS.mountAuth(); }
  // 管理员「更改页面布局」按钮：所有页面加载编辑器，是否插入由 maybeInjectLayoutBtn 内部判定（isAdmin || 站主）
  BS.loadEditbar();
  BS.me().then(function (state) {
    BS.maybeInjectLayoutBtn();
  }).catch(function () {});
});

// 页脚年份统一填充（footer 里的 #yr）
(function () {
  function fillYear() {
    var y = document.getElementById('yr');
    if (y && !y.textContent) y.textContent = new Date().getFullYear();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillYear);
  else fillYear();
})();
