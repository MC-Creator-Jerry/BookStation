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

  function show(view) {
    $('#loginView').classList.toggle('hidden', view !== 'login');
    $('#panelView').classList.toggle('hidden', view !== 'panel');
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
    $('#logoutBtn').classList.toggle('hidden', !state.loggedIn);
    const sb = $('#sponsorBox');
    const sab = $('#sponsorAdminBox');
    if (state.loggedIn) {
      show('panel');
      paintRoleBanner(state);
      await refreshQuota();
      await loadBooks();
      if (sb) sb.classList.remove('hidden');
      if (sab) sab.classList.toggle('hidden', !state.isAdmin);
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
    } else {
      el.className = 'role-banner creator';
      el.style.display = '';
      const who = (state.user && state.user.name) || '创作者';
      el.textContent = '✍️ ' + who + ' · 创作者模式：可创建并管理你自己的书。';
    }
  }

  async function doLogout() {
    try { await BS.api('/admin/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
    location.reload();
  }

  /* ---------- 书籍列表 ---------- */
  async function loadBooks(selectId) {
    const q = meState && meState.role === 'creator' ? '?size=48&sort=updated&mine=1' : '?size=48&sort=updated';
    try {
      const d = await BS.api('/books' + q);
      books = d.books || [];
    } catch (e) {
      BS.toast('书籍列表载入失败：' + e.message, true);
      books = [];
    }
    $('#bookList').innerHTML = books.length
      ? books.map(function (b) {
        return '<li data-id="' + BS.esc(b.id) + '" class="' + (cur && cur.id === b.id ? 'is-on' : '') + '">' +
          '<div class="t">' + BS.esc(b.title) + '</div>' +
          '<div class="m">' + BS.esc(b.author || '佚名') + ' · ' + (b.chapterCount || 0) + ' 章 · ' + (b.status === 'done' ? '已完结' : '连载中') + '</div>' +
          '</li>';
      }).join('')
      : '<li class="bs-muted" style="cursor:default">还没有书，右边新建一本。</li>';
    $('#bookList').querySelectorAll('li[data-id]').forEach(function (li) {
      li.addEventListener('click', function () { selectBook(li.dataset.id); });
    });
    if (selectId) selectBook(selectId);
  }

  function newBookForm() {
    cur = null;
    $('#bookFormTitle').textContent = '新建书籍';
    $('#bookForm') && $('#bookForm').reset();
    $('#bookId').value = '';
    $('#fTitle').value = '';
    $('#fAuthor').value = '';
    $('#fCover').value = '';
    $('#fTags').value = '';
    $('#fStatus').value = 'ongoing';
    $('#fIntro').value = '';
    $('#deleteBookBtn').classList.add('hidden');
    $('#chapArea').classList.add('hidden');
    $('#delBox').classList.add('hidden');
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
    $('#fIntro').value = cur.intro || '';
    $('#chapArea').classList.remove('hidden');
    // 删除按钮：管理员可见；创作者仅对自己拥有的书可见
    const canDelete = meState && (meState.isAdmin || (meState.role === 'creator' && cur.owner === (meState.user && meState.user.sub)));
    $('#deleteBookBtn').classList.toggle('hidden', !canDelete);
    renderChapters();
    loadBooks(id);
    showPanelTab();
  }

  async function saveBook() {
    const payload = {
      title: $('#fTitle').value.trim(),
      author: $('#fAuthor').value.trim(),
      cover: $('#fCover').value.trim(),
      tags: $('#fTags').value.trim(),
      status: $('#fStatus').value,
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

  document.addEventListener('DOMContentLoaded', function () {
    $('#logoutBtn').addEventListener('click', doLogout);
    $('#newBookBtn').addEventListener('click', newBookForm);
    $('#saveBookBtn').addEventListener('click', saveBook);
    $('#deleteBookBtn').addEventListener('click', askDelete);
    $('#saveChapBtn').addEventListener('click', saveChapter);
    $('#newChapBtn').addEventListener('click', resetChapterEditor);
    $('#redeemBtn').addEventListener('click', doRedeem);
    const rci = $('#redeemCodeInput');
    if (rci) rci.addEventListener('keydown', function (e) { if (e.key === 'Enter') doRedeem(); });
    $('#genCodesBtn').addEventListener('click', doGenerateCodes);
    refreshAuth();
  });
})();
