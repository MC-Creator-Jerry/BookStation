/* 书栈 · 管理台（登录 + 书籍/章节管理） */
(function () {
  const $ = function (s) { return document.querySelector(s); };
  // 「书栈·发布功能升级」爱发电订阅入口（书栈专属档位，存于书栈自己的 KV，与小蓝页解耦）
  const UPGRADE_URL = 'https://ifdian.net/order/create?plan_id=2927c56ab87911f188a65254001e7c00';
  let books = [];
  let cur = null;          // 当前书籍
  let curChapters = [];     // 当前书籍章节列表
  let editingChapter = null; // null = 新增
  let meState = null;       // 当前登录态（role / user）
  const selected = new Set();  // 批量勾选的书籍 id
  let ccStatus = '';           // 当前状态筛选（'' / ongoing / done）
  let ccCategory = '';         // 当前类型筛选
  let ccQ = '';                // 当前搜索词
  let ccSort = 'updated';       // 当前排序
  let adminBooks = [];          // 管理员：全站书籍列表
  let rpFilter = 'all';         // 举报筛选（all/pending/resolved/dismissed）
  let pendingReportReturn = null; // 从举报跳转去内容页处理后，回来要还原的位置

  function show(view) {
    $('#loginView').classList.toggle('hidden', view !== 'login');
    $('#panelView').classList.toggle('hidden', view !== 'panel');
  }

  /* ---------- 侧栏视图切换（总览 / 我的书 / 投书 / 赞助码） ---------- */
  const CC_VIEWS = ['overview', 'books', 'compose', 'sponsor', 'reports'];
  function showView(name) {
    CC_VIEWS.forEach(function (v) {
      const el = $('#view' + v.charAt(0).toUpperCase() + v.slice(1));
      if (el) el.classList.toggle('hidden', v !== name);
    });
    document.querySelectorAll('.cc-nav-item').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.view === name);
    });
  }

  async function refreshQuota() {
    const box = $('#quotaBox');
    if (!box) return;
    box.className = 'quota-box hidden';
    box.innerHTML = '';
    try {
      const q = await BS.api('/quota');
      const expStr = q.exp ? '（有效期至 ' + BS.fmtDate(q.exp) + '）' : '';
      if (q.unlimited) {
        box.className = 'quota-box admin';
        box.innerHTML = '🛡️ 管理员：上传不限量。';
      } else if (q.plan === 'pro') {
        box.className = 'quota-box pro';
        box.innerHTML = '🌟 高级版 · 今日已发布 ' + q.used + ' / ' + q.limit + ' 本' +
          (q.remaining > 0 ? '（剩余 ' + q.remaining + '）' : '（已达上限，明天再来）') + expStr;
      } else {
        box.className = 'quota-box free';
        box.innerHTML = '📖 免费版 · 今日已发布 ' + q.used + ' / ' + q.limit + ' 本 · ' +
          '<a href="' + UPGRADE_URL + '" target="_blank" rel="noopener">升级高级版（日上限 +10）</a>';
      }
    } catch (e) {
      /* 配额查询失败不阻断管理台 */
    }
  }

  async function refreshAuth() {
    const state = await BS.me();
    meState = state;
    const sb = $('#sponsorBox');
    const sab = $('#sponsorAdminBox');
    if (state.loggedIn) {
      show('panel');
      paintRoleBanner(state);
      await refreshQuota();
      await loadStats();
      await loadBooks();
      if (sb) sb.classList.remove('hidden');
      if (sab) sab.classList.toggle('hidden', !state.isAdmin);
      // 「🛡️ 管理」侧栏入口：管理员或审核员可见（reviewer 可进举报处理台）
      const rpNav = document.querySelector('.cc-nav-item[data-view="reports"]');
      if (rpNav) rpNav.classList.toggle('hidden', !(state.isAdmin || state.isReviewer));
      showView('overview');
    } else {
      show('login');
      if (sb) sb.classList.add('hidden');
      if (sab) sab.classList.add('hidden');
    }
  }

  // 创作者：粘贴赞助码解锁高级版
  async function doRedeem() {
    const input = $('#redeemCodeInput');
    const btn = $('#redeemBtn');
    const code = (input && input.value || '').trim();
    if (!code) { BS.toast('请输入赞助码', true); return; }
    btn.disabled = true;
    try {
      const d = await BS.api('/redeem', { method: 'POST', body: { code: code } });
      BS.toast(d.reason === 'already' ? '你已兑换过该码' : '🎉 已解锁高级版！');
      input.value = '';
      await refreshQuota();
    } catch (e) {
      BS.toast(e.message || '兑换失败', true);
    } finally {
      btn.disabled = false;
    }
  }

  // 管理员：生成一批赞助码
  async function doGenerateCodes() {
    const btn = $('#genCodesBtn');
    const out = $('#genCodesOut');
    const n = Math.min(500, Math.max(1, parseInt($('#genCount').value, 10) || 20));
    btn.disabled = true;
    try {
      const d = await BS.api('/admin/sponsor-codes?count=' + n);
      const lines = (d.codes || []).join('\n');
      out.value = lines + (d.codes && d.codes.length ? '\n\n（以上为一次性码，贴进爱发电「自动随机回复」，用户付款后获取并回书栈兑换）' : '');
      out.classList.remove('hidden');
      BS.toast('已生成 ' + (d.count || 0) + ' 个赞助码');
    } catch (e) {
      BS.toast(e.message || '生成失败', true);
    } finally {
      btn.disabled = false;
    }
  }

  function paintRoleBanner(state) {
    const el = $('#roleBanner');
    if (!el) return;
    if (state.isAdmin) {
      el.className = 'role-banner admin';
      el.style.display = '';
      el.textContent = '🛡️ 管理员模式：可管理全部书籍与章节。';
    } else if (state.isReviewer) {
      el.className = 'role-banner reviewer';
      el.style.display = '';
      el.textContent = '🛡️ 审核员模式：可处理用户举报（小说/评论）。';
    } else {
      el.className = 'role-banner creator';
      el.style.display = '';
      const who = (state.user && state.user.name) || '创作者';
      el.textContent = '✍️ ' + who + ' · 创作者模式：可创建并管理你自己的书。';
    }
  }

  /* 退出登录统一走 bookstation.js 顶栏用户菜单（data-bs-logout） */

  /* ---------- 创作概览（稿件中心式数据概览） ---------- */
  async function loadStats() {
    try {
      const d = await BS.api('/books/stats');
      $('#stTotal').textContent = d.total;
      $('#stSplit').textContent = '连载中 ' + d.ongoing + ' · 已完结 ' + d.done;
      $('#stWords').textContent = BS.fmtWords(d.words);
      $('#stViews').textContent = (d.views || 0).toLocaleString('zh-CN');
      $('#stChaps').textContent = d.chapters;
      $('#tabAll').textContent = d.total;
      $('#tabOngoing').textContent = d.ongoing;
      $('#tabDone').textContent = d.done;
    } catch (e) { /* 概览失败不阻断管理台 */ }
  }

  /* ---------- 作品列表（支持状态/搜索/排序） ---------- */
  // 仅高亮列表里被选中的书，避免重拉全量列表触发 selectBook 造成无限递归回填
  function highlightSelected(id) {
    const ul = $('#bookList');
    if (!ul) return;
    ul.querySelectorAll('.cc-row').forEach(function (li) {
      li.classList.toggle('is-on', li.dataset.id === id);
    });
  }

  async function loadBooks(selectId) {
    const p = new URLSearchParams();
    if (ccStatus) p.set('status', ccStatus);
    if (ccCategory) p.set('category', ccCategory);
    if (ccQ) p.set('q', ccQ);
    p.set('sort', ccSort);
    p.set('size', '48');
    const prefix = meState && meState.role === 'creator' ? '?mine=1&' : '?';
    try {
      const d = await BS.api('/books' + prefix + p.toString());
      books = d.books || [];
    } catch (e) {
      BS.toast('书籍列表载入失败：' + e.message, true);
      books = [];
    }
    renderBookList();
    if (selectId) selectBook(selectId);
  }

  function renderBookList() {
    const ul = $('#bookList');
    if (!ul) return;
    if (!books.length) {
      ul.innerHTML = '<li class="cc-empty"><span class="cc-empty-emoji">📭</span>' +
        (ccQ || ccStatus ? '没有符合条件的书。' : '还没有书，点左侧「投书」按钮开始创作。') + '</li>';
      updateSelCount();
      return;
    }
    ul.innerHTML = books.map(function (b) {
      const on = cur && cur.id === b.id ? ' is-on' : '';
      const checked = selected.has(b.id) ? ' checked' : '';
      const cover = BS.coverHtml(b, 'cc-cover');
      return '<li class="cc-row' + on + '" data-id="' + BS.esc(b.id) + '">' +
        '<label class="cc-check" onclick="event.stopPropagation()"><input type="checkbox" class="cc-sel" data-id="' + BS.esc(b.id) + '"' + checked + '></label>' +
        cover +
        '<div class="cc-row-main">' +
          '<div class="cc-row-top"><a class="cc-title" href="book.html?id=' + encodeURIComponent(b.id) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + BS.esc(b.title) + '</a>' +
          '<span class="bs-badge' + (b.status === 'done' ? ' done' : '') + '">' + BS.statusText(b.status) + '</span></div>' +
          '<div class="cc-row-meta">' + BS.esc(b.author || '佚名') + ' · <span class="bs-cat">' + BS.esc(BS.categoryText(b.category)) + '</span> · ' + (b.chapterCount || 0) + ' 章 · ' + BS.fmtWords(b.words) + ' · ' + (b.views || 0) + ' 翻阅 · 更新于 ' + BS.fmtDate(b.updatedAt) + '</div>' +
        '</div>' +
        '<div class="cc-actions">' +
          '<button class="bs-btn plain sm" data-act="edit">编辑</button>' +
          '<button class="bs-btn plain sm" data-act="chapters">章节</button>' +
          '<button class="bs-btn plain sm" data-act="view">查看</button>' +
          '<button class="bs-btn danger sm" data-act="del">删除</button>' +
        '</div>' +
      '</li>';
    }).join('');

    ul.querySelectorAll('.cc-row').forEach(function (li) {
      const id = li.dataset.id;
      li.addEventListener('click', function (e) {
        if (e.target.closest('.cc-actions') || e.target.closest('.cc-check') || e.target.closest('a')) return;
        selectBook(id);
      });
      li.querySelectorAll('.cc-sel').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) selected.add(id); else selected.delete(id);
          updateSelCount();
        });
      });
      li.querySelectorAll('.cc-actions button').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'edit' || act === 'chapters') { selectBook(id); }
          else if (act === 'view') { window.open('book.html?id=' + encodeURIComponent(id), '_blank'); }
          else if (act === 'del') { askDeleteById(id); }
        });
      });
    });
    updateSelCount();
  }

  function updateSelCount() {
    const el = $('#ccSelCount');
    if (el) el.textContent = '已选 ' + selected.size + ' 项';
    const all = $('#ccSelectAll');
    if (all) all.checked = books.length > 0 && books.every(function (b) { return selected.has(b.id); });
  }

  async function batchDelete() {
    if (!selected.size) { BS.toast('请先勾选要删除的书', true); return; }
    const ids = Array.from(selected);
    if (!window.confirm('确认删除选中的 ' + ids.length + ' 本书？将同时删除它们的全部章节，且不可恢复。')) return;
    let okN = 0, failN = 0;
    const deleted = new Set();
    for (const id of ids) {
      try {
        await BS.api('/book?id=' + encodeURIComponent(id), { method: 'DELETE' });
        okN++; deleted.add(id);
      } catch (e) { failN++; }
    }
    selected.clear();
    BS.toast('已删除 ' + okN + ' 本' + (failN ? '，' + failN + ' 本失败' : ''), failN > 0);
    await loadStats();
    if (cur && deleted.has(cur.id)) { newBookForm(); }
    else { await loadBooks(cur ? cur.id : null); }
  }

  function askDeleteById(id) {
    const b = books.find(function (x) { return x.id === id; });
    const title = b ? b.title : id;
    const box = $('#delBox');
    box.classList.remove('hidden');
    box.innerHTML =
      '<div class="bs-panel" style="border-color:var(--danger)">' +
      '<strong style="color:var(--danger)">确认删除《' + BS.esc(title) + '》？</strong>' +
      '<div class="hint" style="margin:8px 0">将同时删除它的全部章节，且不可恢复。</div>' +
      '<div class="bs-row"><button class="bs-btn danger" id="delYes">确认删除</button><button class="bs-btn plain" id="delNo">取消</button></div></div>';
    $('#delYes').addEventListener('click', async function () {
      try {
        const d = await BS.api('/book?id=' + encodeURIComponent(id), { method: 'DELETE' });
        BS.toast('已删除《' + d.title + '》');
        box.classList.add('hidden');
        selected.delete(id);
        if (cur && cur.id === id) newBookForm();
        else { await loadStats(); await loadBooks(cur ? cur.id : null); }
      } catch (e) { BS.toast(e.message, true); }
    });
    $('#delNo').addEventListener('click', function () { box.classList.add('hidden'); });
  }

  function newBookForm() {
    cur = null;
    selected.clear();
    $('#bookFormTitle').textContent = '新建书籍';
    $('#bookForm') && $('#bookForm').reset();
    $('#bookId').value = '';
    $('#fTitle').value = '';
    $('#fAuthor').value = '';
    $('#fCover').value = '';
    $('#fTags').value = '';
    $('#fStatus').value = 'ongoing';
    $('#fCategory').value = '';
    $('#fIntro').value = '';
    $('#fNature').value = 'original';
    $('#fSource').value = '';
    $('#fAllowOriginal').checked = true;
    toggleSourceField();
    $('#deleteBookBtn').classList.add('hidden');
    $('#chapArea').classList.add('hidden');
    $('#delBox').classList.add('hidden');
    showView('compose');
    loadBooks();
  }

  async function selectBook(id) {
    try {
      const d = await BS.api('/book?id=' + encodeURIComponent(id));
      cur = d.book;
      curChapters = d.chapters || [];
    } catch (e) { BS.toast(e.message, true); return; }
    $('#bookFormTitle').textContent = '编辑书籍';
    $('#bookId').value = cur.id;
    $('#fTitle').value = cur.title || '';
    $('#fAuthor').value = cur.author || '';
    $('#fCover').value = cur.cover || '';
    $('#fTags').value = (cur.tags || []).join('、');
    $('#fStatus').value = cur.status || 'ongoing';
    $('#fCategory').value = cur.category || '';
    $('#fIntro').value = cur.intro || '';
    $('#fNature').value = cur.nature || 'original';
    $('#fLang').value = cur.lang || 'zh';
    $('#fSource').value = cur.source || '';
    $('#fAllowOriginal').checked = cur.allowOriginal !== false; // 默认开
    toggleSourceField();
    $('#chapArea').classList.remove('hidden');
    // 删除按钮：管理员可见；创作者仅对自己拥有的书可见
    const canDelete = meState && (meState.isAdmin || (meState.role === 'creator' && cur.owner === (meState.user && meState.user.sub)));
    $('#deleteBookBtn').classList.toggle('hidden', !canDelete);
    renderChapters();
    highlightSelected(id);
    showPanelTab();
    showView('compose');
  }

  async function saveBook() {
    const payload = {
      title: $('#fTitle').value.trim(),
      author: $('#fAuthor').value.trim(),
      cover: $('#fCover').value.trim(),
      tags: $('#fTags').value.trim(),
      category: $('#fCategory').value,
      status: $('#fStatus').value,
      nature: $('#fNature').value,
      lang: $('#fLang').value || 'zh',
      source: $('#fSource').value.trim(),
      allowOriginal: $('#fAllowOriginal').checked,
      intro: $('#fIntro').value,
    };
    if (!payload.title) { BS.toast('书名不能为空', true); return; }
    try {
      const id = $('#bookId').value;
      if (id) {
        await BS.api('/book?id=' + encodeURIComponent(id), { method: 'PUT', body: payload });
        BS.toast('已保存');
        await selectBook(id);
      } else {
        const d = await BS.api('/books', { method: 'POST', body: payload });
        BS.toast('已新建《' + d.book.title + '》');
        await selectBook(d.book.id);
        refreshQuota();
      }
    } catch (e) { BS.toast(e.message, true); }
  }

  /* ---------- 删除书（两步确认，列出影响面） ---------- */
  function askDelete() {
    if (!cur) return;
    $('#delBox').classList.remove('hidden');
    $('#delBox').innerHTML =
      '<div class="bs-panel" style="border-color:var(--danger)">' +
      '<strong style="color:var(--danger)">确认删除《' + BS.esc(cur.title) + '》？</strong>' +
      '<div class="hint" style="margin:8px 0">将同时删除它的 <strong>' + curChapters.length + '</strong> 个章节（共 ' + BS.fmtWords(cur.words) + '），且不可恢复。</div>' +
      '<div class="bs-row"><button class="bs-btn danger" id="delYes">确认删除</button><button class="bs-btn plain" id="delNo">取消</button></div></div>';
    $('#delYes').addEventListener('click', async function () {
      try {
        const d = await BS.api('/book?id=' + encodeURIComponent(cur.id), { method: 'DELETE' });
        BS.toast('已删除《' + d.title + '》及 ' + d.chapters + ' 章');
        $('#delBox').classList.add('hidden');
        newBookForm();
      } catch (e) { BS.toast(e.message, true); }
    });
    $('#delNo').addEventListener('click', function () { $('#delBox').classList.add('hidden'); });
  }

  /* ---------- 章节 ---------- */
  function renderChapters() {
    $('#chapList').innerHTML = curChapters.length
      ? curChapters.map(function (c, i) {
        return '<div class="chap-item ' + (editingChapter === c.id ? 'is-on' : '') + '" data-cid="' + BS.esc(c.id) + '">' +
          '<span class="bs-muted" style="min-width:30px">' + c.no + '</span>' +
          '<span class="t">' + BS.esc(c.title) + '</span>' +
          '<span class="bs-muted">' + BS.fmtWords(c.words) + '</span>' +
          '<button class="bs-btn plain sm" data-act="up">↑</button>' +
          '<button class="bs-btn plain sm" data-act="down">↓</button>' +
          '<button class="bs-btn plain sm" data-act="edit">编辑</button>' +
          '<button class="bs-btn danger sm" data-act="del">删</button>' +
          '</div>';
      }).join('')
      : '<div class="hint" style="padding:10px">还没有章节，下面新增第一章。</div>';

    $('#chapList').querySelectorAll('.chap-item').forEach(function (row) {
      const cid = row.dataset.cid;
      row.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () { chapterAction(btn.dataset.act, cid); });
      });
    });
  }

  async function chapterAction(act, cid) {
    if (act === 'up' || act === 'down') {
      try {
        await BS.api('/chapter?id=' + encodeURIComponent(cur.id) + '&c=' + encodeURIComponent(cid) + '&action=move&dir=' + act, { method: 'POST' });
        await selectBook(cur.id);
      } catch (e) { BS.toast(e.message, true); }
      return;
    }
    if (act === 'edit') {
      try {
        const d = await BS.api('/chapter?id=' + encodeURIComponent(cur.id) + '&c=' + encodeURIComponent(cid));
        editingChapter = cid;
        $('#cTitle').value = d.chapter.title || '';
        $('#cBody').value = d.chapter.content || '';
        $('#chapEditorTitle').textContent = '编辑：' + d.chapter.title + '（第 ' + d.chapter.no + ' 章）';
        renderChapters();
        $('#cBody').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) { BS.toast(e.message, true); }
      return;
    }
    if (act === 'del') {
      const item = curChapters.find(function (c) { return c.id === cid; });
      $('#delBox').classList.remove('hidden');
      $('#delBox').innerHTML =
        '<div class="bs-panel" style="border-color:var(--danger)">' +
        '<strong style="color:var(--danger)">确认删除章节「' + BS.esc(item ? item.title : cid) + '」？</strong>' +
        '<div class="hint" style="margin:8px 0">该章正文（' + BS.fmtWords(item ? item.words : 0) + '）将被永久删除，不可恢复。</div>' +
        '<div class="bs-row"><button class="bs-btn danger" id="delYes">确认删除</button><button class="bs-btn plain" id="delNo">取消</button></div></div>';
      $('#delYes').addEventListener('click', async function () {
        try {
          await BS.api('/chapter?id=' + encodeURIComponent(cur.id) + '&c=' + encodeURIComponent(cid), { method: 'DELETE' });
          BS.toast('已删除该章');
          $('#delBox').classList.add('hidden');
          if (editingChapter === cid) resetChapterEditor();
          await selectBook(cur.id);
        } catch (e) { BS.toast(e.message, true); }
      });
      $('#delNo').addEventListener('click', function () { $('#delBox').classList.add('hidden'); });
    }
  }

  function resetChapterEditor() {
    editingChapter = null;
    $('#cTitle').value = '';
    $('#cBody').value = '';
    $('#chapEditorTitle').textContent = '新增章节';
    renderChapters();
  }

  async function saveChapter() {
    if (!cur) { BS.toast('先选一本书', true); return; }
    const title = $('#cTitle').value.trim();
    const content = $('#cBody').value;
    if (!content.trim()) { BS.toast('章节正文不能为空', true); return; }
    try {
      if (editingChapter) {
        await BS.api('/chapter?id=' + encodeURIComponent(cur.id) + '&c=' + encodeURIComponent(editingChapter), { method: 'PUT', body: { title: title, content: content } });
        BS.toast('章节已更新');
      } else {
        const d = await BS.api('/chapter?id=' + encodeURIComponent(cur.id), { method: 'POST', body: { title: title, content: content } });
        BS.toast('已新增：' + d.chapter.title);
      }
      resetChapterEditor();
      await selectBook(cur.id);
    } catch (e) { BS.toast(e.message, true); }
  }

  function showPanelTab() {
    $('#delBox').classList.add('hidden');
  }

  /* ---------- 举报处理（仅管理员） ---------- */
  function reportTargetLink(r) {
    const t = r.target || '';
    if (t.indexOf('book:') === 0) {
      const id = t.slice(5);
      return '<a class="bs-link" href="../book.html?id=' + encodeURIComponent(id) + '" target="_blank" rel="noopener">书籍</a>';
    }
    if (t.indexOf('chapter:') === 0) {
      const parts = t.slice(8).split(':');
      const id = parts[0]; const cid = parts[1];
      return '<a class="bs-link" href="../read.html?id=' + encodeURIComponent(id) + '&c=' + encodeURIComponent(cid) + '" target="_blank" rel="noopener">章节</a>';
    }
    if (t.indexOf('comment:') === 0) return '评论(' + BS.esc(t.slice(8)) + ')';
    return BS.esc(t);
  }

  async function loadReports() {
    const listEl = $('#rpList');
    const countEl = $('#rpCount');
    if (!listEl) return;
    listEl.innerHTML = '<div class="bs-comment-empty">正在载入举报…</div>';
    try {
      const d = await BS.api('/report');
      const all = d.reports || [];
      const rs = rpFilter === 'all' ? all : all.filter(function (r) { return r.status === rpFilter; });
      const pending = all.filter(function (r) { return r.status === 'pending'; }).length;
      if (countEl) countEl.textContent = '共 ' + all.length + ' 条' + (pending ? '（' + pending + ' 待处理）' : '');
      if (!rs.length) { listEl.innerHTML = '<div class="bs-comment-empty">该分类下没有举报。</div>'; return; }
      listEl.innerHTML = rs.map(function (r) {
        const st = r.status === 'pending'
          ? '<span class="bs-badge" style="color:var(--accent)">待处理</span>'
          : (r.status === 'resolved' ? '<span class="bs-badge done">已处理</span>' : '<span class="bs-badge">已忽略</span>');
        const act = r.status === 'pending'
          ? '<button class="bs-btn plain sm" data-rp="resolved" data-id="' + BS.esc(r.id) + '">标记已处理</button><button class="bs-btn plain sm" data-rp="dismissed" data-id="' + BS.esc(r.id) + '">忽略</button>'
          : '<button class="bs-btn plain sm" data-rp="pending" data-id="' + BS.esc(r.id) + '">重新打开</button>';
        const reporter = BS.esc((r.reporter || 'anon').replace(/^u:/, '用户 ').replace(/^g:/, '访客 '));
        const t = r.target || '';
        let jumpHref = '';
        if (t.indexOf('book:') === 0) {
          jumpHref = '../book.html?id=' + encodeURIComponent(t.slice(5)) + '&report=' + encodeURIComponent(r.id) + '&reason=' + encodeURIComponent(r.reason);
        } else if (t.indexOf('chapter:') === 0) {
          const p = t.slice(8).split(':');
          jumpHref = '../read.html?id=' + encodeURIComponent(p[0]) + '&c=' + encodeURIComponent(p[1]) + '&report=' + encodeURIComponent(r.id) + '&reason=' + encodeURIComponent(r.reason);
        }
        const jumpBtn = jumpHref ? '<a class="bs-btn plain sm" href="' + jumpHref + '" data-rp-jump="1">跳转查看</a>' : '';
        return '<div class="bs-comment"><div class="bs-cm-main" style="flex:1">' +
          '<div class="bs-cm-head"><span class="bs-cm-name">' + BS.esc(r.reason) + '</span>' + st + '<span class="bs-cm-time">' + BS.fmtDate(r.createdAt) + '</span></div>' +
          '<div class="bs-cm-text">对象：' + reportTargetLink(r) + '<br>举报人：' + reporter + (r.detail ? '<br>说明：' + BS.esc(r.detail) : '') + '</div>' +
          '<div class="bs-row" style="margin-top:8px">' + jumpBtn + act + '</div>' +
          '</div></div>';
      }).join('');
      listEl.querySelectorAll('button[data-rp]').forEach(function (b) {
        b.addEventListener('click', async function () {
          try {
            await BS.api('/report?id=' + encodeURIComponent(b.dataset.id), { method: 'PUT', body: { status: b.dataset.rp } });
            BS.toast('已更新举报状态'); loadReports(); loadAdminStats();
          } catch (e) { BS.toast(e.message, true); }
        });
      });
      listEl.querySelectorAll('a[data-rp-jump]').forEach(function (a) {
        a.addEventListener('click', function () {
          try { sessionStorage.setItem('bs_rp_return', JSON.stringify({ filter: rpFilter, scroll: window.scrollY })); } catch (e) {}
        });
      });
    } catch (e) {
      listEl.innerHTML = '<div class="bs-comment-empty">举报载入失败：' + BS.esc(e.message) + '</div>';
    }
  }

  /* ---------- 管理员面板：站点概览 ---------- */
  async function loadAdminStats() {
    try {
      const d = await BS.api('/admin/stats');
      const set = function (id, v) { const el = $('#' + id); if (el) el.textContent = v; };
      set('stBooks', d.books);
      set('stViews2', (d.views || 0).toLocaleString('zh-CN'));
      set('stCreators', d.creators);
      set('stPending', (d.pending || 0) + ' / ' + (d.reports || 0));
    } catch (e) { /* 概览失败不阻断 */ }
  }

  function loadAdminPanel() {
    loadAdminStats();
    loadReports();
  }

  /* ---------- 管理员面板：全站内容管理 ---------- */
  async function loadAdminBooks() {
    const ul = $('#adminBookList');
    if (!ul) return;
    ul.innerHTML = '<li class="cc-empty">正在载入…</li>';
    try {
      const d = await BS.api('/books?size=200&sort=updated');
      adminBooks = d.books || [];
      renderAdminBooks(adminBooks);
    } catch (e) {
      ul.innerHTML = '<li class="cc-empty">载入失败：' + BS.esc(e.message) + '</li>';
    }
  }

  function renderAdminBooks(list) {
    const ul = $('#adminBookList');
    const cnt = $('#adminBookCount');
    if (!ul) return;
    if (!list.length) {
      ul.innerHTML = '<li class="cc-empty">没有符合条件的书籍。</li>';
      if (cnt) cnt.textContent = '';
      return;
    }
    ul.innerHTML = list.map(function (b) {
      return '<li class="cc-row" data-id="' + BS.esc(b.id) + '">' +
        BS.coverHtml(b, 'cc-cover') +
        '<div class="cc-row-main">' +
          '<div class="cc-row-top"><a class="cc-title" href="book.html?id=' + encodeURIComponent(b.id) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + BS.esc(b.title) + '</a>' +
          '<span class="bs-badge' + (b.status === 'done' ? ' done' : '') + '">' + BS.statusText(b.status) + '</span></div>' +
          '<div class="cc-row-meta">' + BS.esc(b.author || '佚名') + ' · <span class="bs-cat">' + BS.esc(BS.categoryText(b.category)) + '</span> · ' + BS.fmtWords(b.words) + ' · ' + (b.views || 0) + ' 翻阅 · 归属 ' + BS.esc(b.owner || '—') + '</div>' +
        '</div>' +
        '<div class="cc-actions"><button class="bs-btn danger sm" data-act="del" data-id="' + BS.esc(b.id) + '">删除</button></div>' +
      '</li>';
    }).join('');
    ul.querySelectorAll('button[data-act="del"]').forEach(function (btn) {
      btn.addEventListener('click', function () { adminDeleteBook(btn.dataset.id); });
    });
    if (cnt) cnt.textContent = '共 ' + list.length + ' 本';
  }

  async function adminDeleteBook(id) {
    const b = adminBooks.find(function (x) { return x.id === id; });
    const title = b ? b.title : id;
    if (!window.confirm('管理员操作：确认删除《' + title + '》及其全部章节？此操作不可恢复。')) return;
    try {
      await BS.api('/book?id=' + encodeURIComponent(id), { method: 'DELETE' });
      BS.toast('已删除《' + title + '》');
      loadAdminBooks();
      loadAdminStats();
    } catch (e) { BS.toast(e.message, true); }
  }

  function toggleSourceField() {
    const f = $('#fNature');
    const box = $('#fSourceField');
    if (!f || !box) return;
    box.classList.toggle('hidden', f.value === 'original');
  }

  /* ---------- 本地书籍导入（支持 .txt/.md/.docx/.pdf/.epub/.fb2/.rtf/.mobi/.azw/.azw3/.prc） ---------- */
  function fileExt(name) {
    const i = (name || '').lastIndexOf('.');
    return i < 0 ? '' : (name || '').slice(i).toLowerCase();
  }
  function readFileAsBuffer(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      r.readAsArrayBuffer(file);
    });
  }
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result || ''); };
      r.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      r.readAsText(file, 'UTF-8');
    });
  }
  // 读取原文件字节并转 base64，供「原文件」存储使用（大文件由调用方按 size 过滤）
  function readFileAsOrig(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () {
        const bytes = new Uint8Array(r.result);
        let bin = '';
        const chunk = 0x8000;
        for (let p = 0; p < bytes.length; p += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(p, p + chunk));
        resolve({ name: file.name, mime: file.type || 'application/octet-stream', b64: btoa(bin) });
      };
      r.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      r.readAsArrayBuffer(file);
    });
  }

  // 魔数嗅探：从文件头几个字节判断真实类型，扩展名不可靠时以此为准（增强识别度）
  function sniffFormat(buf) {
    const u = new Uint8Array(buf);
    if (u.length >= 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46) return 'pdf';   // %PDF
    if (u.length >= 4 && u[0] === 0x50 && u[1] === 0x4B && u[2] === 0x03 && u[3] === 0x04) return 'zip';     // PK..
    if (u.length >= 5 && u[0] === 0x7B && u[1] === 0x5C && u[2] === 0x72 && u[3] === 0x74 && u[4] === 0x66) return 'rtf'; // {\rtf
    if (u.length >= 200) {
      const head = String.fromCharCode.apply(null, u.subarray(0, 200));
      if (head.indexOf('MOBI') >= 0) return 'mobi';
    }
    return null;
  }
  // 只读前 256 字节做嗅探，避免为所有文件都读全量
  function sniffFirstBytes(file) {
    return new Promise(function (resolve) {
      const r = new FileReader();
      r.onload = function () { resolve({ sig: sniffFormat(r.result), headBuf: r.result }); };
      r.onerror = function () { resolve({ sig: null, headBuf: null }); };
      const blob = (file.slice ? file.slice(0, 256) : file);
      r.readAsArrayBuffer(blob);
    });
  }
  function resolveFormat(ext, sig) {
    const extMap = {
      '.docx': 'docx', '.pdf': 'pdf', '.epub': 'epub', '.fb2': 'fb2', '.fb2.zip': 'fb2zip',
      '.rtf': 'rtf', '.mobi': 'mobi', '.azw': 'mobi', '.azw3': 'mobi', '.prc': 'mobi',
      '.txt': 'text', '.md': 'text'
    };
    const byExt = extMap[ext] || null;
    // 嗅探到的具体类型优先（处理改扩展名/无扩展名场景），ZIP 家族仍靠扩展名细分
    if (sig === 'pdf') return 'pdf';
    if (sig === 'rtf') return 'rtf';
    if (sig === 'mobi') return 'mobi';
    if (sig === 'zip') {
      if (byExt === 'docx' || byExt === 'epub' || byExt === 'fb2' || byExt === 'fb2zip') return byExt;
      return 'zip-unknown'; // 扩展名不是已知 ZIP 子类型（含 .txt 误命名）
    }
    return byExt || 'unsupported';
  }

  // 抽取单个文件为纯文本（{name, text}）；不支持的格式标记为 skipped，不阻断其它文件
  async function extractFile(file) {
    const ext = fileExt(file.name);
    const sniff = await sniffFirstBytes(file);
    const format = resolveFormat(ext, sniff.sig);

    if (format === 'text') {
      try { return { name: file.name, text: await readFileAsText(file), skipped: false }; }
      catch (e) { return { name: file.name, text: '', skipped: true, reason: '读取失败：' + e.message }; }
    }

    let buf = sniff.headBuf;
    try { if (!buf) buf = await readFileAsBuffer(file); }
    catch (e) { return { name: file.name, text: '', skipped: true, reason: '读取失败：' + e.message }; }

    const dispatch = {
      docx: function () { return extractDocxText(buf); },
      pdf: function () { return extractPdfText(buf); },
      epub: function () { return extractEpubText(buf); },
      fb2: function () { return extractFb2Text(buf, ext); },
      fb2zip: function () { return extractFb2Text(buf, '.fb2.zip'); },
      rtf: function () { return extractRtfText(buf); },
      mobi: function () { return extractMobiText(buf); }
    };
    const label = { docx: 'docx', pdf: 'PDF', epub: 'EPUB', fb2: 'FB2', fb2zip: 'FB2(zip)', rtf: 'RTF', mobi: 'MOBI' }[format];

    if (!dispatch[format] || format === 'zip-unknown') {
      const msg = format === 'zip-unknown'
        ? '文件头是 ZIP 压缩包，但扩展名不是 docx/epub/fb2，无法识别（请确认真实格式）'
        : '不支持的格式（支持 .txt/.md/.docx/.pdf/.epub/.fb2/.fb2.zip/.rtf/.mobi/.azw/.azw3/.prc）';
      return { name: file.name, text: '', skipped: true, reason: msg };
    }
    try {
      return { name: file.name, text: await dispatch[format](), skipped: false };
    } catch (e) {
      return { name: file.name, text: '', skipped: true, reason: (label || '文件') + ' 解析失败：' + e.message };
    }
  }
  function readAllFiles(files) {
    return Promise.all(Array.prototype.slice.call(files).map(extractFile));
  }

  /* ===== .docx：浏览器原生解压 + XML 抽取（无需第三方库） ===== */
  async function extractDocxText(buffer) {
    const zip = await readZip(buffer);
    if (!zip.has('word/document.xml')) throw new Error('未找到 word/document.xml（可能不是 .docx）');
    const xmlBytes = await zip.get('word/document.xml');
    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    return docxXmlToText(xml);
  }

  async function inflateZipEntry(view, dv, e) {
    const p0 = e.localOffset;
    if (dv.getUint32(p0, true) !== 0x04034b50) throw new Error('ZIP 本地头损坏');
    const lNameLen = dv.getUint16(p0 + 26, true);
    const lExtraLen = dv.getUint16(p0 + 28, true);
    const dataStart = p0 + 30 + lNameLen + lExtraLen;
    const compBytes = view.subarray(dataStart, dataStart + e.compSize);
    if (e.compMethod === 0) return new Uint8Array(compBytes);
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压（需支持 DecompressionStream 的较新版本）');
    // ZIP 标准 DEFLATE 为 zlib 封装（RFC1950）；少数非合规包用裸 deflate，做兜底
    try {
      return await inflateWith(compBytes, 'deflate');
    } catch (err) {
      return await inflateWith(compBytes, 'deflate-raw');
    }
  }
  function inflateWith(compBytes, fmt) {
    const ds = new DecompressionStream(fmt);
    const stream = new Response(compBytes).body.pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // 通用 ZIP 读取器：惰性解压，按需取条目（供 .docx / .epub / .fb2.zip 复用）
  async function readZip(buffer) {
    const view = new Uint8Array(buffer);
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    let eocd = -1;
    const maxBack = Math.min(view.length, 22 + 65535);
    for (let i = view.length - 22; i >= Math.max(0, view.length - maxBack); i--) {
      if (view[i] === 0x50 && view[i + 1] === 0x4b && view[i + 2] === 0x05 && view[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('找不到 ZIP 目录（文件可能不是压缩包）');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);
    let p = cdOffset;
    const entries = new Map();
    for (let n = 0; n < cdCount; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const compMethod = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const fileNameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(view.subarray(p + 46, p + 46 + fileNameLen));
      if (!entries.has(name)) entries.set(name, { compMethod: compMethod, compSize: compSize, localOffset: localOffset, _bytes: null });
      p += 46 + fileNameLen + extraLen + commentLen;
    }
    return {
      has: function (nm) { return entries.has(nm); },
      names: function () { return Array.from(entries.keys()); },
      get: async function (nm) {
        const e = entries.get(nm);
        if (!e) return undefined;
        if (e._bytes) return e._bytes;
        const b = await inflateZipEntry(view, dv, e);
        e._bytes = b;
        return b;
      }
    };
  }

  function docxXmlToText(xml) {
    let s = String(xml || '');
    s = s.replace(/<w:p\b[^>]*>/gi, '\n');
    s = s.replace(/<\/w:p>/gi, '');
    s = s.replace(/<w:br\b[^>]*\/?>/gi, '\n');
    s = s.replace(/<w:cr\b[^>]*\/?>/gi, '\n');
    s = s.replace(/<w:tab\b[^>]*\/?>/gi, '\t');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  /* ===== .pdf：本地内置 pdf.js（/assets/vendor）抽取文本 ===== */
  let _pdfJsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (_pdfJsPromise) return _pdfJsPromise;
    _pdfJsPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = '/assets/vendor/pdf.min.js?v=2026092802';
      s.onload = function () {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.js?v=2026092802';
          resolve(window.pdfjsLib);
        } else { reject(new Error('pdf.js 未暴露全局对象')); }
      };
      s.onerror = function () { reject(new Error('pdf.js 脚本加载失败（请确认已部署 /assets/vendor/pdf.min.js）')); };
      document.head.appendChild(s);
    });
    return _pdfJsPromise;
  }
  // 把 pdf.js 的散落文本项按版面坐标（y 行、x 列）重排成可读文本：补齐词间距、分行
  function groupPdfItemsToLines(items) {
    if (!items || !items.length) return [];
    const rows = items.map(function (it) {
      return {
        x: (it.transform && it.transform[4]) || 0,
        y: (it.transform && it.transform[5]) || 0,
        w: (typeof it.width === 'number') ? it.width : ((it.str || '').length * 5),
        h: (typeof it.height === 'number') ? it.height : 10,
        str: it.str || ''
      };
    });
    rows.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); }); // 上→下、左→右
    const lines = [];
    let cur = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!cur) { cur = { y: r.y, h: r.h, items: [r] }; lines.push(cur); continue; }
      if (Math.abs(cur.y - r.y) <= Math.max(2, cur.h * 0.6)) cur.items.push(r); // 同一行
      else { cur = { y: r.y, h: r.h, items: [r] }; lines.push(cur); }
    }
    return lines.map(function (line) {
      line.items.sort(function (a, b) { return a.x - b.x; });
      let s = '';
      let endX = null;
      for (let j = 0; j < line.items.length; j++) {
        const it = line.items[j];
        if (endX !== null) {
          const gap = it.x - endX;
          const unit = Math.max(2, it.h * 0.25);
          if (gap > unit * 1.2) s += (gap > unit * 4 ? '  ' : ' '); // 列间距大则双空格
        }
        s += it.str;
        endX = it.x + it.w;
      }
      return s;
    });
  }

  async function extractPdfText(buffer) {
    const pdfjsLib = await loadPdfJs();
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data: data, isEvalSupported: false }).promise;
    const pageTexts = [];
    let totalChars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = groupPdfItemsToLines(content.items);
      const text = lines.join('\n');
      pageTexts.push(text);
      totalChars += text.replace(/\s/g, '').length;
      if (page.cleanup) page.cleanup();
    }
    await doc.destroy();
    // 扫描版/图片型 PDF：几乎抽不到文字，提前给出明确提示（而非静默空结果）
    if (doc.numPages > 0 && totalChars < Math.max(40, doc.numPages * 12)) {
      throw new Error('PDF 内几乎没有可提取的文字，疑似扫描版/图片型 PDF（需 OCR 才能识别，当前不支持）');
    }
    let out = pageTexts.join('\n\n');
    out = out.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    return out;
  }

  /* ===== 通用 HTML/XML 文本清理 ===== */
  function decodeXmlEntities(s) {
    return String(s || '')
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
      .replace(/&#(\d+);/g, function (m, d) { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  function stripHtmlToText(html) {
    let s = String(html || '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<\s*(br|p|div|tr|li|h[1-6]|hr|pagebreak|mbp:pagebreak|bookmark)[^>]*>/gi, '\n');
    s = s.replace(/<\s*\/\s*(p|div|tr|li|h[1-6])[^>]*>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = decodeXmlEntities(s);
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  /* ===== .epub：ZIP + OPF spine 顺序抽取 XHTML 正文 ===== */
  async function extractEpubText(buffer) {
    const zip = await readZip(buffer);
    if (!zip.has('META-INF/container.xml')) throw new Error('EPUB 缺少 META-INF/container.xml');
    const cdoc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(await zip.get('META-INF/container.xml')), 'application/xml');
    const rootfile = cdoc.querySelector('rootfile');
    if (!rootfile) throw new Error('container.xml 缺少 rootfile');
    const opfPath = rootfile.getAttribute('full-path');
    if (!opfPath) throw new Error('未找到 OPF 路径');
    if (!zip.has(opfPath)) throw new Error('未找到 OPF：' + opfPath);
    const opfDoc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(await zip.get(opfPath)), 'application/xml');
    const manifest = {};
    opfDoc.querySelectorAll('manifest > item').forEach(function (it) {
      const id = it.getAttribute('id'); const href = it.getAttribute('href');
      const mt = (it.getAttribute('media-type') || '').toLowerCase();
      if (id && href) manifest[id] = { href: href, media: mt };
    });
    const spineIds = [];
    opfDoc.querySelectorAll('spine > itemref').forEach(function (ir) {
      const idref = ir.getAttribute('idref'); if (idref) spineIds.push(idref);
    });
    const opfDir = opfPath.indexOf('/') >= 0 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    let out = '';
    for (const id of spineIds) {
      const item = manifest[id];
      if (!item) continue;
      const href = item.href;
      if (item.media.indexOf('image/') === 0) continue;
      if (!(/\.x?html?$/i.test(href) || /html|xhtml|xml/.test(item.media))) continue;
      const full = resolvePath(opfDir, decodeURIComponent(href));
      let bytes = await zip.get(full);
      if (!bytes) bytes = await zip.get(full.replace(/\.x?html?$/i, '.html'));
      if (!bytes) continue;
      out += stripHtmlToText(new TextDecoder('utf-8').decode(bytes)) + '\n\n';
    }
    out = out.replace(/\n{4,}/g, '\n\n').trim();
    if (!out) throw new Error('EPUB 未解析出正文（可能仅含图片）');
    return out;
  }
  function resolvePath(base, rel) {
    if (/^[a-z]+:\/\//i.test(rel)) return rel;
    const stack = [];
    (base + rel).split('/').forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') stack.pop();
      else stack.push(p);
    });
    return stack.join('/');
  }

  /* ===== .fb2（FictionBook2，XML） ===== */
  async function extractFb2Text(buffer, ext) {
    let xmlBytes;
    if (ext === '.fb2.zip') {
      const zip = await readZip(buffer);
      let name = null;
      for (const nm of zip.names()) { if (/\.fb2$/i.test(nm)) { name = nm; break; } }
      if (!name) throw new Error('压缩包内未找到 .fb2 文件');
      xmlBytes = await zip.get(name);
    } else {
      xmlBytes = new Uint8Array(buffer);
    }
    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const body = doc.querySelector('body') || doc.documentElement;
    if (!body) throw new Error('FB2 解析失败：未找到 body');
    const parts = [];
    body.querySelectorAll('title, subtitle, p, text-author, line, stanza, epigraph, poem').forEach(function (el) {
      if (el.querySelector('title, subtitle, p, text-author, line')) return; // 含子结构的容器交由子节点处理，避免重复
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    });
    let out = parts.join('\n\n');
    out = out.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!out) throw new Error('FB2 未解析出正文');
    return out;
  }

  /* ===== .rtf（富文本，控制字剥离） ===== */
  function extractRtfText(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    let out = '';
    let i = 0;
    const n = s.length;
    let depth = 0;
    const skipStack = [];
    while (i < n) {
      const c = s[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') {
        if (skipStack.length && skipStack[skipStack.length - 1] === depth) skipStack.pop();
        depth = Math.max(0, depth - 1);
        i++; continue;
      }
      if (c === '\\') {
        i++;
        if (i >= n) break;
        const nc = s[i];
        if (nc === '\\' || nc === '{' || nc === '}' || nc === ';' || nc === ':' || nc === '~' || nc === '_' || nc === '%' || nc === '|' || nc === ' ' || nc === "'") {
          if (nc === '*') { skipStack.push(depth); i++; continue; }
          if (nc === "'") {
            const h1 = s[i + 1], h2 = s[i + 2];
            if (h1 !== undefined && h2 !== undefined && /[0-9a-fA-F]/.test(h1) && /[0-9a-fA-F]/.test(h2)) {
              if (skipStack.length === 0) out += String.fromCharCode(parseInt(h1 + h2, 16));
              i += 3;
            } else { i++; }
            continue;
          }
          if (skipStack.length === 0) {
            if (nc === '~') out += ' ';
            else if (nc === ' ') out += ' ';
            else if (nc !== '-') out += nc;
          }
          i++; continue;
        }
        // 控制字（字母开头）
        let w = '';
        while (i < n && /[a-zA-Z]/.test(s[i])) { w += s[i]; i++; }
        let param = '';
        while (i < n && /[0-9-]/.test(s[i])) { param += s[i]; i++; }
        if (s[i] === ' ') i++; // 分隔符空格
        if (w === '*') { skipStack.push(depth); continue; }
        if (skipStack.length) continue;
        if (w === 'par' || w === 'line' || w === 'page' || w === 'pard' || w === 'sect' || w === 'row') out += '\n';
        else if (w === 'tab') out += '\t';
        else if (w === 'u') {
          let code = parseInt(param, 10);
          if (!isNaN(code)) { if (code < 0) code += 65536; out += String.fromCodePoint(code); }
          if (i < n && s[i] !== '\\' && s[i] !== '{' && s[i] !== '}') i++; // 跳过随附的回退字符
        }
        else if (w === 'ldblquote' || w === 'rdblquote') out += '"';
        else if (w === 'lquote' || w === 'rquote') out += '\'';
        else if (w === 'emdash') out += '—';
        else if (w === 'endash') out += '–';
        else if (w === 'bullet') out += '•';
        continue;
      }
      if (skipStack.length === 0) out += c;
      i++;
    }
    out = out.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return out;
  }

  /* ===== .mobi / .azw / .azw3 / .prc：PDB + PalmDOC 解压 ===== */
  function extractMobiText(buffer) {
    const view = new Uint8Array(buffer);
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    if (view.length < 78) throw new Error('文件太小，不是有效的 MOBI');
    const numRecords = dv.getUint16(76, true);
    if (numRecords < 2) throw new Error('MOBI 记录数异常');
    const recOffsets = [];
    for (let r = 0; r < numRecords; r++) recOffsets.push(dv.getUint32(78 + r * 8, true));
    const rec0 = recOffsets[0];
    const compression = dv.getUint16(rec0, true);
    const palmdocRecordCount = dv.getUint16(rec0 + 8, true);
    const mobiStart = rec0 + 16;
    const mobiId = String.fromCharCode(view[mobiStart], view[mobiStart + 1], view[mobiStart + 2], view[mobiStart + 3]);
    if (mobiId !== 'MOBI') throw new Error('未找到 MOBI 标识（可能不是 MOBI/AZW 文件）');
    const firstNonBookIndex = dv.getUint32(mobiStart + 0x50, true);
    let textRecCount = (firstNonBookIndex > 1) ? (firstNonBookIndex - 1) : palmdocRecordCount;
    textRecCount = Math.max(1, Math.min(textRecCount, numRecords - 1));
    if (compression !== 1 && compression !== 2) {
      throw new Error('MOBI 使用了不支持的压缩方式（' + compression + '，仅支持 none/PalmDOC）');
    }
    let raw = '';
    for (let r = 1; r <= textRecCount; r++) {
      const off = recOffsets[r];
      const end = (r + 1 < numRecords) ? recOffsets[r + 1] : view.length;
      const recBytes = view.subarray(off, end);
      let text;
      if (compression === 1) text = new TextDecoder('utf-8').decode(recBytes);
      else text = palmdocDecompress(recBytes);
      raw += text;
    }
    return stripHtmlToText(raw);
  }
  function palmdocDecompress(bytes) {
    const out = [];
    let i = 0;
    const n = bytes.length;
    while (i < n) {
      const b = bytes[i++];
      if (b === 0) out.push(0);
      else if (b <= 8) { for (let k = 0; k < b && i < n; k++) out.push(bytes[i++]); }
      else if (b < 0x80) out.push(b);
      else {
        if (b <= 0xbf) {
          const c = bytes[i++];
          if (c === undefined) break;
          const code = (b << 8) | c;
          const distance = (code >> 3) & 0x7FF;
          const length = (code & 0x07) + 3;
          const start = out.length - distance;
          for (let k = 0; k < length; k++) {
            out.push((start + k >= 0 && start + k < out.length) ? out[start + k] : 0);
          }
        } else {
          // 0xc0..0xff：单字节「字节对」= 空格 + (b ^ 0x80)
          out.push(0x20);
          out.push(b ^ 0x80);
        }
      }
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(out));
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // 自动分章：识别常见章节标题行；其余按正文累积
  function splitChaptersAuto(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const headRe = /^(第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回节卷部篇集]|Chapter\s+\d+|CHAPTER\s+\d+|序章|引子|楔子|后记|番外|尾声)/i;
    const out = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line && headRe.test(line)) {
        if (cur) out.push(cur);
        cur = { title: line.slice(0, 80) || '未命名章节', content: '' };
      } else {
        if (!cur) cur = { title: '正文', content: '' };
        cur.content += raw + '\n';
      }
    }
    if (cur) out.push(cur);
    out.forEach(function (c) { c.content = c.content.replace(/\n{3,}/g, '\n\n').trim(); });
    if (!out.length) out.push({ title: '正文', content: String(text || '').replace(/\r\n?/g, '\n').trim() });
    return out;
  }
  function splitBySep(text, sep) {
    const s = String(sep || '').trim();
    if (!s) return splitChaptersAuto(text);
    const parts = String(text || '').replace(/\r\n?/g, '\n').split(new RegExp(escapeRegExp(s)));
    return parts
      .map(function (p) { return { title: '', content: p.replace(/\r\n?/g, '\n').trim() }; })
      .filter(function (c) { return c.content; });
  }
  function fileTitle(name) {
    return (name || '').replace(/\.[^.]+$/, '').slice(0, 80) || '未命名章节';
  }
  function parseImportFiles(files, mode, sep) {
    const chapters = [];
    Array.prototype.slice.call(files).forEach(function (f) {
      if (mode === 'perfile') {
        const t = f.text.replace(/\r\n?/g, '\n').trim();
        if (t) chapters.push({ title: fileTitle(f.name), content: t });
      } else {
        splitBySep(f.text, mode === 'sep' ? sep : '').forEach(function (c) { chapters.push(c); });
      }
    });
    return chapters;
  }

  async function previewImport() {
    const pv = $('#impPreview');
    if (!pv) return;
    const files = ($('#impFiles') && $('#impFiles').files) || [];
    if (!files.length) { pv.textContent = ''; return; }
    const mode = $('#impMode').value;
    const sep = $('#impSep').value;
    try {
      const texts = await readAllFiles(files);
      const skipped = texts.filter(function (t) { return t.skipped; });
      const usable = texts.filter(function (t) { return !t.skipped; });
      const chapters = parseImportFiles(usable, mode, sep);
      let head = '';
      if (skipped.length) {
        head = '⚠️ 已跳过 ' + skipped.length + ' 个不支持的文件：' + skipped.map(function (s) { return s.name; }).join('、') + '\n';
      }
      if (!chapters.length) { pv.textContent = head + '未能从文件中解析出章节，请换个拆分方式试试。'; return; }
      const sample = chapters.slice(0, 5).map(function (c, i) { return (i + 1) + '. ' + (c.title || '(无标题)'); }).join('　');
      pv.textContent = head + '预计拆出 ' + chapters.length + ' 章。示例：' + sample + (chapters.length > 5 ? ' …' : '');
    } catch (e) { pv.textContent = e.message; }
  }

  async function doImport() {
    const btn = $('#impBtn');
    const prog = $('#impProgress');
    const files = ($('#impFiles') && $('#impFiles').files) || [];
    if (!files.length) { BS.toast('请先选择要上传的文件', true); return; }
    const fileList = Array.prototype.slice.call(files);
    if (!$('#fTitle').value.trim()) { BS.toast('请先填写书名', true); return; }
    if (!window.confirm('确认从本地文件导入章节到《' + $('#fTitle').value.trim() + '》？\n（已有章节会保留在后面，建议先确认书已保存。）')) return;
    try { await saveBook(); } catch (e) { /* saveBook 自带提示 */ }
    if (!cur) { BS.toast('请先保存书籍基本信息', true); return; }

    const mode = $('#impMode').value;
    const sep = $('#impSep').value;
    let chapters = [];
    let skippedNames = [];
    try {
      const texts = await readAllFiles(files);
      skippedNames = texts.filter(function (t) { return t.skipped; }).map(function (t) { return t.name; });
      const usable = texts.filter(function (t) { return !t.skipped; });
      chapters = parseImportFiles(usable, mode, sep);
    } catch (e) { BS.toast(e.message, true); return; }
    if (!chapters.length) {
      BS.toast('未从文件中解析出任何章节' + (skippedNames.length ? '（已跳过 ' + skippedNames.length + ' 个不支持的文件）' : ''), true);
      return;
    }
    if (skippedNames.length) { BS.toast('已跳过 ' + skippedNames.length + ' 个不支持的文件：' + skippedNames.join('、'), true); }
    if (chapters.length > 2000) { BS.toast('章节数超过 2000 上限，仅导入前 2000 章', true); chapters = chapters.slice(0, 2000); }

    btn.disabled = true;
    if (prog) prog.textContent = '导入中…';
    try {
      const d = await BS.api('/import', { method: 'POST', body: { id: cur.id, chapters: chapters } });
      if (prog) prog.textContent = '';
      BS.toast('已导入 ' + d.imported + ' 章' + (d.truncated ? '（截断 ' + d.truncated + ' 章）' : ''));

      // 允许阅读者查看原文件：把上传的源文件存到 KV（≤22MB 才存，过大的跳过）
      const allowOrig = $('#fAllowOriginal') && $('#fAllowOriginal').checked;
      if (allowOrig) {
        try {
          const MAX = 22 * 1024 * 1024;
          const oversize = fileList.filter(function (f) { return f.size > MAX; }).map(function (f) { return f.name + '（>22MB）'; });
          const under = fileList.filter(function (f) { return f.size <= MAX; });
          const origFiles = await Promise.all(under.map(readFileAsOrig));
          const od = await BS.api('/orig', { method: 'POST', body: { id: cur.id, files: origFiles } });
          const skipAll = (od.skipped || []).concat(oversize);
          if (skipAll.length) BS.toast('原文件已保存 ' + od.stored + ' 个；跳过 ' + skipAll.length + ' 个（过大或失败）：' + skipAll.join('、'), true);
          else if (od.stored) BS.toast('已保存原文件 ' + od.stored + ' 个，阅读者可在书籍页下载');
        } catch (e) { BS.toast('原文件保存失败：' + e.message, true); }
      }
      await selectBook(cur.id);
    } catch (e) {
      if (prog) prog.textContent = '';
      BS.toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    // 若是从举报跳转去内容页处理后回来的，记下要还原的位置
    try {
      const raw = sessionStorage.getItem('bs_rp_return');
      if (raw) { sessionStorage.removeItem('bs_rp_return'); pendingReportReturn = JSON.parse(raw); }
    } catch (e) { pendingReportReturn = null; }

    // 类型下拉：表单 + 工具栏筛选
    const fcat = $('#fCategory');
    const ccat = $('#ccCategory');
    const opts = '<option value="">未分类</option>' + BS.CATEGORIES.map(function (c) {
      return '<option value="' + BS.esc(c) + '">' + BS.esc(c) + '</option>';
    }).join('');
    if (fcat) fcat.innerHTML = opts;
    if (ccat) ccat.innerHTML = '<option value="">全部类型</option>' + BS.CATEGORIES.map(function (c) {
      return '<option value="' + BS.esc(c) + '">' + BS.esc(c) + '</option>';
    }).join('');

    $('#newBookBtn').addEventListener('click', newBookForm);
    // 侧栏导航：总览 / 我的书 / 赞助码（「投书」主按钮走 newBookForm → compose）
    document.querySelectorAll('.cc-nav-item').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); if (b.dataset.view === 'reports') loadAdminPanel(); });
    });
    // 管理员面板：分区切换（举报 / 全站内容）
    const atabs = $('#adminTabs');
    if (atabs) atabs.querySelectorAll('.cc-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        atabs.querySelectorAll('.cc-tab').forEach(function (x) { x.classList.toggle('is-on', x === t); });
        const which = t.dataset.atab;
        $('#adminReports').classList.toggle('hidden', which !== 'reports');
        $('#adminContent').classList.toggle('hidden', which !== 'content');
        if (which === 'content') loadAdminBooks();
      });
    });
    // 举报筛选
    const rpf = $('#rpFilter');
    if (rpf) rpf.querySelectorAll('.cc-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        rpFilter = t.dataset.f;
        rpf.querySelectorAll('.cc-tab').forEach(function (x) { x.classList.toggle('is-on', x === t); });
        loadReports();
      });
    });
    // 全站内容：搜索（防抖）
    const asearch = $('#adminSearch');
    if (asearch) {
      let st = null;
      asearch.addEventListener('input', function () {
        clearTimeout(st);
        st = setTimeout(function () {
          const q = asearch.value.trim().toLowerCase();
          const filtered = q
            ? adminBooks.filter(function (b) { return (b.title + ' ' + (b.author || '')).toLowerCase().includes(q); })
            : adminBooks;
          renderAdminBooks(filtered);
        }, 220);
      });
    }
    $('#saveBookBtn').addEventListener('click', saveBook);
    $('#deleteBookBtn').addEventListener('click', askDelete);
    $('#saveChapBtn').addEventListener('click', saveChapter);
    $('#newChapBtn').addEventListener('click', resetChapterEditor);
    $('#redeemBtn').addEventListener('click', doRedeem);

    // 本地书籍导入：文件选择 / 拆分方式 / 分隔符 / 导入 / 清除
    const impFiles = $('#impFiles');
    if (impFiles) impFiles.addEventListener('change', previewImport);
    const impMode = $('#impMode');
    if (impMode) impMode.addEventListener('change', function () {
      const sf = $('#impSepField');
      if (sf) sf.classList.toggle('hidden', impMode.value !== 'sep');
      previewImport();
    });
    const impSep = $('#impSep');
    if (impSep) impSep.addEventListener('input', previewImport);
    const impBtn = $('#impBtn');
    if (impBtn) impBtn.addEventListener('click', doImport);
    const impClear = $('#impClear');
    if (impClear) impClear.addEventListener('click', function () {
      if (impFiles) impFiles.value = '';
      const pv = $('#impPreview'); if (pv) pv.textContent = '';
      const prog = $('#impProgress'); if (prog) prog.textContent = '';
    });
    const rci = $('#redeemCodeInput');
    if (rci) rci.addEventListener('keydown', function (e) { if (e.key === 'Enter') doRedeem(); });
    $('#genCodesBtn').addEventListener('click', doGenerateCodes);

    // 状态 tabs
    const tabs = $('#ccTabs');
    if (tabs) tabs.querySelectorAll('.cc-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        ccStatus = t.dataset.status || '';
        tabs.querySelectorAll('.cc-tab').forEach(function (x) { x.classList.toggle('is-on', x === t); });
        loadBooks();
      });
    });
    // 搜索（防抖）
    const search = $('#ccSearch');
    if (search) {
      let st = null;
      search.addEventListener('input', function () {
        clearTimeout(st);
        st = setTimeout(function () { ccQ = search.value.trim(); loadBooks(); }, 260);
      });
    }
    // 排序
    const sortSel = $('#ccSort');
    if (sortSel) sortSel.addEventListener('change', function () { ccSort = sortSel.value; loadBooks(); });
    // 类型筛选
    const catSel = $('#ccCategory');
    if (catSel) catSel.addEventListener('change', function () { ccCategory = catSel.value; loadBooks(); });
    // 作品性质：二创/搬运时显示「原作/出处」
    const fNature = $('#fNature');
    if (fNature) fNature.addEventListener('change', toggleSourceField);
    // 全选
    const selAll = $('#ccSelectAll');
    if (selAll) selAll.addEventListener('change', function () {
      if (this.checked) books.forEach(function (b) { selected.add(b.id); });
      else selected.clear();
      renderBookList();
    });
    // 批量删除
    const batchDel = $('#ccBatchDel');
    if (batchDel) batchDel.addEventListener('click', batchDelete);

    refreshAuth().then(function () {
      // 深链：从顶栏头像菜单「🛡️ 管理员面板」进入，直接打开管理面板视图
      const viewParam = new URLSearchParams(location.search).get('view');
      if (viewParam === 'admin' || viewParam === 'reports') {
        showView('reports');
        loadAdminPanel();
        return;
      }
      // 从举报处理回来：还原到举报列表 + 之前的筛选与滚动位置
      if (pendingReportReturn) {
        const o = pendingReportReturn; pendingReportReturn = null;
        rpFilter = o.filter || 'all';
        showView('reports');
        const rpf = $('#rpFilter');
        if (rpf) rpf.querySelectorAll('.cc-tab').forEach(function (x) { x.classList.toggle('is-on', x.dataset.f === rpFilter); });
        loadAdminStats();
        loadReports().then(function () { window.scrollTo({ top: o.scroll || 0, behavior: 'auto' }); });
      }
    }).catch(function () {});
  });
})();
