/* 书栈 BookStation · 共享脚本（主题 / 接口 / 书架首页 / 书籍详情） */
window.BS = (function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

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
    if (btn) btn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾';
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
  function qs(key) { return new URLSearchParams(location.search).get(key) || ''; }

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
    try { meState = await api('/admin/me'); } catch (e) { meState = { loggedIn: false, configured: false }; }
    return meState;
  }
  async function mountAuth() {
    const state = await me();
    $$('[data-bs-admin]').forEach(function (el) { el.classList.toggle('hidden', !state.loggedIn); });
    $$('[data-bs-auth-state]').forEach(function (el) { el.textContent = state.loggedIn ? '已登录' : '未登录'; });
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
      '<a class="bs-card" href="/book?id=' + encodeURIComponent(b.id) + '">' +
      coverHtml(b) +
      '<div class="bs-card-body">' +
      '<div class="bs-card-title">' + esc(b.title) + '</div>' +
      '<div class="bs-card-meta"><span>' + esc(b.author || '佚名') + '</span><span class="bs-badge' + (b.status === 'done' ? ' done' : '') + '">' + statusText(b.status) + '</span></div>' +
      '<div class="bs-card-meta"><span>' + (b.chapterCount || 0) + ' 章</span><span>' + fmtWords(b.words) + '</span></div>' +
      (b.intro ? '<div class="bs-card-intro">' + esc(b.intro) + '</div>' : '') +
      (tags ? '<div class="bs-card-meta">' + tags + '</div>' : '') +
      '</div></a>';
  }

  async function initIndex() {
    const grid = $('#grid');
    const tagBox = $('#tags');
    const countEl = $('#count');
    const state = { q: qs('q'), tag: qs('tag'), status: '', sort: 'updated', page: 1 };
    const searchInput = $('#search');
    const sortSel = $('#sort');
    if (searchInput) searchInput.value = state.q;

    async function load() {
      grid.innerHTML = '<div class="bs-empty">正在载入书架…</div>';
      const p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.tag) p.set('tag', state.tag);
      if (state.status) p.set('status', state.status);
      p.set('sort', state.sort);
      p.set('page', String(state.page));
      p.set('size', '48');
      let data;
      try {
        data = await api('/books?' + p.toString());
      } catch (e) {
        grid.innerHTML = '<div class="bs-empty">书架载入失败：' + esc(e.message) + '</div>';
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
        : '<div class="bs-empty">书架还是空的 —— 先在上面搜索别的关键词，或去 <a href="/admin">管理台</a> 上传一本书。</div>';
    }

    if (searchInput) {
      let t = null;
      searchInput.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { state.q = searchInput.value.trim(); state.page = 1; load(); }, 260);
      });
    }
    if (sortSel) {
      sortSel.addEventListener('change', function () { state.sort = sortSel.value; load(); });
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

  /* ---------------- 书籍详情 ---------------- */
  async function initBook() {
    const id = qs('id');
    const box = $('#book');
    if (!id) { box.innerHTML = '<div class="bs-empty">缺少书籍参数。</div>'; return; }
    let data;
    try {
      data = await api('/book?id=' + encodeURIComponent(id));
    } catch (e) {
      box.innerHTML = '<div class="bs-empty">' + esc(e.message) + '</div>';
      return;
    }
    const b = data.book;
    document.title = b.title + ' · 书栈';
    const chapters = data.chapters || [];
    const prog = getProgress(b.id);
    const first = chapters[0];
    const readHref = first ? '/read?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(first.id) : '';
    const tags = (b.tags || []).map(function (t) { return '<a class="bs-tag" href="/?tag=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join(' ');

    box.innerHTML = '' +
      '<div class="bs-book">' +
      coverHtml(b) +
      '<div>' +
      '<h2>' + esc(b.title) + '</h2>' +
      '<div class="bs-row bs-muted"><span>' + esc(b.author || '佚名') + '</span>' +
      '<span class="bs-badge' + (b.status === 'done' ? ' done' : '') + '">' + statusText(b.status) + '</span>' +
      '<span>' + chapters.length + ' 章</span><span>' + fmtWords(b.words) + '</span>' +
      '<span>' + (b.views || 0) + ' 次翻阅</span><span>更新于 ' + fmtDate(b.updatedAt) + '</span></div>' +
      (tags ? '<div class="bs-row" style="margin-top:10px">' + tags + '</div>' : '') +
      (b.intro ? '<div class="bs-book-intro">' + esc(b.intro) + '</div>' : '') +
      '<div class="bs-row">' +
      (readHref ? '<a class="bs-btn" href="' + (prog && prog.c ? '/read?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(prog.c) : readHref) + '">' +
        (prog && prog.c ? '继续阅读 · ' + esc(prog.title || '') : '开始阅读') + '</a>' : '<span class="bs-muted">这本书还没有章节</span>') +
      '<a class="bs-btn plain hidden" data-bs-admin href="/admin?book=' + encodeURIComponent(b.id) + '">管理这本书</a>' +
      '</div>' +
      '</div></div>' +
      '<div class="bs-panel" style="margin-bottom:40px">' +
      '<div class="bs-row"><strong>目录</strong><span class="bs-spacer"></span><span class="bs-muted">共 ' + chapters.length + ' 章</span></div>' +
      (chapters.length
        ? '<ul class="bs-toc">' + chapters.map(function (c) {
          const on = prog && prog.c === c.id ? ' style="color:var(--accent);font-weight:600"' : '';
          return '<li><a href="/read?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(c.id) + '"' + on + '>' +
            '<span><span class="no">' + c.no + '</span>' + esc(c.title) + '</span><span class="bs-muted">' + fmtWords(c.words) + '</span></a></li>';
        }).join('') + '</ul>'
        : '<div class="bs-empty">还没有章节。</div>') +
      '</div>';

    mountAuth();
  }

  return {
    $: $, $$: $$, esc: esc, api: api, toast: toast,
    fmtWords: fmtWords, fmtDate: fmtDate, statusText: statusText, qs: qs,
    setTheme: setTheme, initTheme: initTheme, mountAuth: mountAuth, me: me,
    saveProgress: saveProgress, getProgress: getProgress,
    coverHtml: coverHtml, cardHtml: cardHtml,
    initIndex: initIndex, initBook: initBook,
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  BS.initTheme();
  const page = document.body.dataset.page;
  if (page === 'index') { BS.initIndex(); BS.mountAuth(); }
  else if (page === 'book') { BS.initBook(); }
  else if (page !== 'read' && page !== 'admin') { BS.mountAuth(); }
});
