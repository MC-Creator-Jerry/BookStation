/* 书栈 · 管理台（登录 + 书籍/章节管理） */
(function () {
  const $ = function (s) { return document.querySelector(s); };
  let books = [];
  let cur = null;          // 当前书籍
  let curChapters = [];     // 当前书籍章节列表
  let editingChapter = null; // null = 新增

  function show(view) {
    $('#loginView').classList.toggle('hidden', view !== 'login');
    $('#panelView').classList.toggle('hidden', view !== 'panel');
  }

  async function refreshAuth() {
    const state = await BS.me();
    if (!state.configured) {
      show('login');
      $('#loginHint').innerHTML = '⚠️ 本站还没设置管理员密码。先执行：<br><code>wrangler pages secret put ADMIN_PASSWORD --project-name jerrybookstation</code><br>（设置后需要重新部署一次才生效）';
      $('#loginBtn').disabled = true;
      return;
    }
    $('#loginHint').innerHTML = '';
    $('#loginBtn').disabled = false;
    if (state.loggedIn) { show('panel'); await loadBooks(); }
    else show('login');
  }

  async function doLogin() {
    const pwd = $('#pwd').value;
    if (!pwd) { BS.toast('请输入密码', true); return; }
    $('#loginBtn').disabled = true;
    try {
      await BS.api('/admin/login', { method: 'POST', body: { password: pwd } });
      $('#pwd').value = '';
      location.reload();
    } catch (e) {
      BS.toast(e.message || '登录失败', true);
      $('#loginBtn').disabled = false;
    }
  }

  async function doLogout() {
    try { await BS.api('/admin/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
    location.reload();
  }

  /* ---------- 书籍列表 ---------- */
  async function loadBooks(selectId) {
    try {
      const d = await BS.api('/books?size=48&sort=updated');
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
    $('#deleteBookBtn').classList.remove('hidden');
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
    $('#loginBtn').addEventListener('click', doLogin);
    $('#pwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('#logoutBtn').addEventListener('click', doLogout);
    $('#newBookBtn').addEventListener('click', newBookForm);
    $('#saveBookBtn').addEventListener('click', saveBook);
    $('#deleteBookBtn').addEventListener('click', askDelete);
    $('#saveChapBtn').addEventListener('click', saveChapter);
    $('#newChapBtn').addEventListener('click', resetChapterEditor);
    refreshAuth();
  });
})();
