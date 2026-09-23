/* 书栈 · 阅读页（正文渲染 / 上一章下一章 / 目录抽屉 / 字号 / 进度） */
(function () {
  const SIZE_KEY = 'bs_rd_size';
  const LH_KEY = 'bs_rd_lh';
  let data = null;
  const id = BS.qs('id');
  const cid = BS.qs('c');

  function paragraphs(text) {
    let blocks = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!blocks) return ['<p class="no-indent bs-muted">（本章暂无正文）</p>'];
    if (!/\n{2,}/.test(blocks)) blocks = blocks.replace(/\n/g, '\n\n');
    return blocks.split(/\n{2,}/).map(function (raw) {
      const t = raw.trim();
      if (!t) return '';
      if (/^(-{3,}|—{3,}|\*{3,})$/.test(t)) return '<hr>';
      if (t.charAt(0) === '>') return '<blockquote>' + BS.esc(t.replace(/^>\s?/gm, '')) + '</blockquote>';
      if (/^(作者的话|作者说|PS[:：]|ps[:：])/.test(t)) return '<p class="no-indent"><strong>' + BS.esc(t) + '</strong></p>';
      return '<p>' + BS.esc(t).replace(/\n/g, '<br>') + '</p>';
    }).filter(Boolean).join('');
  }

  function applyReadStyle() {
    let size = Number(localStorage.getItem(SIZE_KEY)) || 19;
    let lh = Number(localStorage.getItem(LH_KEY)) || 1.95;
    const root = document.documentElement;
    root.style.setProperty('--rd-size', size + 'px');
    root.style.setProperty('--rd-lh', String(lh));
    const label = BS.$('#sizeLabel');
    if (label) label.textContent = size + 'px';
  }

  function bumpSize(delta) {
    let size = (Number(localStorage.getItem(SIZE_KEY)) || 19) + delta;
    size = Math.min(30, Math.max(15, size));
    localStorage.setItem(SIZE_KEY, String(size));
    applyReadStyle();
  }
  function bumpLh(delta) {
    let lh = (Number(localStorage.getItem(LH_KEY)) || 1.95) + delta;
    lh = Math.min(2.6, Math.max(1.5, Math.round(lh * 20) / 20));
    localStorage.setItem(LH_KEY, String(lh));
    applyReadStyle();
  }

  function openDrawer(open) {
    const d = BS.$('#drawer');
    if (d) d.classList.toggle('open', !!open);
  }

  function updatePct() {
    const doc = document.documentElement;
    const total = doc.scrollHeight - window.innerHeight;
    const pct = total <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((window.scrollY / total) * 100)));
    const bar = BS.$('#pctBar');
    const txt = BS.$('#pctText');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = pct + '%';
  }

  function navBtn(label, target, dir) {
    if (!target) return '<span class="bs-btn plain" style="opacity:.45;pointer-events:none">' + dir + '没有' + label + '</span>';
    return '<a class="bs-btn plain" href="/read?id=' + encodeURIComponent(id) + '&c=' + encodeURIComponent(target.id) + '">' + dir + esc1(target.title) + '</a>';
  }
  function esc1(s) { return BS.esc(s).slice(0, 24); }

  async function load(keepScroll) {
    const area = BS.$('#content');
    area.innerHTML = '<p class="no-indent bs-muted">正在载入…</p>';
    try {
      data = await BS.api('/chapter?id=' + encodeURIComponent(id) + '&c=' + encodeURIComponent(cid));
    } catch (e) {
      area.innerHTML = '<div class="bs-empty">' + BS.esc(e.message) + '<br><br><a class="bs-btn plain" href="/book?id=' + encodeURIComponent(id) + '">返回书籍页</a></div>';
      return;
    }
    const b = data.book;
    const ch = data.chapter;
    document.title = ch.title + ' · ' + b.title + ' · 书栈';
    BS.$('#bookTitle').textContent = b.title;
    BS.$('#bookTitle').href = '/book?id=' + encodeURIComponent(b.id);
    BS.$('#chapterTitle').textContent = ch.title;

    area.innerHTML = '<h1>' + BS.esc(ch.title) + '</h1>' +
      '<div class="read-meta">' + BS.esc(b.author || '佚名') + ' · 第 ' + ch.no + ' / ' + data.total + ' 章 · ' + BS.fmtWords(ch.words) + '</div>' +
      paragraphs(ch.content) +
      '<div class="read-nav">' + navBtn('上一章', data.prev, '← ') + navBtn('下一章', data.next, '') + '</div>';

    // 目录
    BS.$('#drawerTitle').textContent = b.title + ' · 目录';
    BS.$('#drawerList').innerHTML = (data.index || []).map(function (c) {
      return '<a href="/read?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(c.id) + '" class="' + (c.id === ch.id ? 'is-on' : '') + '">' +
        '<span class="bs-muted" style="min-width:34px">' + c.no + '</span><span>' + BS.esc(c.title) + '</span></a>';
    }).join('');

    // 底部翻页条
    const prev = data.prev, next = data.next;
    BS.$('#pagerPrev').outerHTML = prev
      ? '<a id="pagerPrev" class="bs-btn plain sm" href="/read?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(prev.id) + '">← 上一章</a>'
      : '<span id="pagerPrev" class="bs-btn plain sm" style="opacity:.4">← 上一章</span>';
    BS.$('#pagerNext').outerHTML = next
      ? '<a id="pagerNext" class="bs-btn sm" href="/read?id=' + encodeURIComponent(b.id) + '&c=' + encodeURIComponent(next.id) + '">下一章 →</a>'
      : '<span id="pagerNext" class="bs-btn sm" style="opacity:.4">下一章 →</span>';

    BS.saveProgress(b.id, { c: ch.id, title: ch.title, no: ch.no });

    if (keepScroll) {
      const key = 'bs_scroll:' + b.id + ':' + ch.id;
      const y = Number(sessionStorage.getItem(key) || 0);
      if (y > 40) window.scrollTo(0, y);
    } else {
      window.scrollTo(0, 0);
    }
    updatePct();
  }

  function go(dir) {
    if (!data) return;
    const t = dir > 0 ? data.next : data.prev;
    if (!t) { BS.toast(dir > 0 ? '已经是最后一章' : '已经是第一章'); return; }
    location.href = '/read?id=' + encodeURIComponent(id) + '&c=' + encodeURIComponent(t.id);
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyReadStyle();
    load(true);
    window.addEventListener('scroll', updatePct, { passive: true });
    window.addEventListener('beforeunload', function () {
      if (data) sessionStorage.setItem('bs_scroll:' + data.book.id + ':' + data.chapter.id, String(window.scrollY));
    });

    const bind = function (sel, fn) { const el = BS.$(sel); if (el) el.addEventListener('click', fn); };
    bind('#sizeUp', function () { bumpSize(1); });
    bind('#sizeDown', function () { bumpSize(-1); });
    bind('#lhUp', function () { bumpLh(0.05); });
    bind('#lhDown', function () { bumpLh(-0.05); });
    bind('#tocBtn', function () { openDrawer(true); });
    bind('#drawerClose', function () { openDrawer(false); });
    bind('#drawerMask', function () { openDrawer(false); });

    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); }
      else if (e.key === 'Escape') { openDrawer(false); }
    });
  });
})();
