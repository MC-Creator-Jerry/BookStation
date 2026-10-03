/* 书栈 BookStation —— 中英双语引擎（复用 xl_lang 约定）
 * 用法：
 *   - 静态文案：元素加 data-i18n="key"，引擎按当前语言填 textContent
 *   - 动态文案：JS 里用 window.__t('key') 取译文
 *   - 切换按钮：加 data-lang-toggle 的元素，点击在中/EN 间切换
 *   - 语言持久化在 localStorage.xl_lang ('zh' | 'en')
 */
(function () {
  var LS_KEY = 'xl_lang';

  function getLang() {
    try { return localStorage.getItem(LS_KEY) === 'en' ? 'en' : 'zh'; }
    catch (e) { return 'zh'; }
  }

  // 书栈界面字典（持续补充）
  var DIC = {
    'nav.bookshelf': { zh: '书架', en: 'Bookshelf' },
    'nav.creator': { zh: '创作者中心', en: 'Creator Hub' },
    'nav.redeem': { zh: '兑换', en: 'Redeem' },
    'nav.home': { zh: '主页', en: 'Home' },
    'theme.toggle': { zh: '切换明暗', en: 'Toggle theme' },
    'hero.title': { zh: '书栈', en: 'BookStation' },
    'hero.sub': {
      zh: '免费读公版经典与开放授权好书 · 也能上传你自己的书',
      en: 'Read free public-domain classics & openly licensed books — or publish your own.'
    },
    'btn.browse': { zh: '📚 浏览书架', en: '📚 Browse Shelf' },
    'btn.publish': { zh: '✍️ 我要投书', en: '✍️ Publish a Book' },
    'why.title': { zh: '为什么是书栈', en: 'Why BookStation' },
    'why.classic': { zh: '公版经典', en: 'Public-Domain Classics' },
    'why.classic.desc': {
      zh: '名著、科幻、悬疑等公版书，合法免费阅读。',
      en: 'Famous novels, sci-fi, mysteries — legally free to read.'
    },
    'why.self': { zh: '自主投书', en: 'Publish Your Own' },
    'why.self.desc': {
      zh: '创作者可上传自己的书，管理章节与更新。',
      en: 'Creators can upload their own books and manage chapters & updates.'
    },
    'why.open': { zh: '开放授权', en: 'Openly Licensed' },
    'why.open.desc': {
      zh: 'CC / 公版等开放授权好书，尊重作者与版权。',
      en: 'CC / public-domain books that respect authors and copyright.'
    },
    'why.device': { zh: '全设备阅读', en: 'Read on Any Device' },
    'why.device.desc': {
      zh: '网页即读，手机 / 平板 / 电脑都顺手，进度本地保存。',
      en: 'Read right in the browser — phone, tablet, desktop; progress saved locally.'
    },
    'shelf.featured': { zh: '精选上架', en: 'Featured' },
    'shelf.all': { zh: '查看全部 →', en: 'View all →' },
    'footer.back': { zh: '返回书架', en: 'Back to Shelf' },
    'footer.motto': { zh: '一本一本地读。', en: 'One book at a time.' },
    'footer.main': { zh: '小蓝页（主站）', en: 'Xiaolan (main site)' },
    'book.lang': { zh: '语言', en: 'Language' },
    'book.lang.zh': { zh: '中文', en: 'Chinese' },
    'book.lang.en': { zh: '英文', en: 'English' },
    'book.source': { zh: '原作 / 出处', en: 'Original / Source' },
    'book.read': { zh: '开始阅读', en: 'Start Reading' },
    'book.continue': { zh: '继续阅读', en: 'Continue' },
    'book.noChapters': { zh: '这本书还没有章节', en: 'This book has no chapters yet' },
    'book.manage': { zh: '管理这本书', en: 'Manage this book' },
    'book.goTea': { zh: '💬 去茶馆讨论', en: '💬 Discuss on Teahouse' },
    'shelf.title': { zh: '书架', en: 'Bookshelf' },
    'shelf.empty': { zh: '书架还是空的，去主页投一本吧。', en: 'Your shelf is empty — publish a book from the home page.' },
    'redeem.title': { zh: '兑换码', en: 'Redeem Code' },
    'redeem.placeholder': { zh: '输入兑换码', en: 'Enter redeem code' },
    'redeem.btn': { zh: '兑换', en: 'Redeem' },
    'settings.title': { zh: '设置', en: 'Settings' },
    'admin.title': { zh: '创作者中心', en: 'Creator Hub' },
    'loading': { zh: '正在载入…', en: 'Loading…' }
  };

  function t(k) {
    var d = DIC[k];
    if (!d) return k;
    var l = getLang();
    return d[l] != null ? d[l] : (d.zh != null ? d.zh : k);
  }

  var mo = null;
  function apply() {
    if (mo) mo.disconnect();
    var l = getLang();
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
    document.documentElement.setAttribute('data-lang', l);
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      var txt = t(k);
      if (txt != null) nodes[i].textContent = txt;
    }
    var tg = document.querySelectorAll('[data-lang-toggle]');
    for (var j = 0; j < tg.length; j++) {
      tg[j].textContent = l === 'en' ? '中文' : 'EN';
      tg[j].setAttribute('title', l === 'en' ? '切换到中文' : 'Switch to English');
    }
    if (mo) mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function setLang(l) {
    try { localStorage.setItem(LS_KEY, l); } catch (e) {}
    apply();
  }

  window.__t = t;
  window.__lang = getLang;
  window.__setLang = setLang;
  window.__applyLang = apply;

  function observe() {
    if (!('MutationObserver' in window)) return;
    mo = new MutationObserver(function () { apply(); });
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-lang-toggle]') : null;
    if (el) { setLang(getLang() === 'en' ? 'zh' : 'en'); }
  });

  document.addEventListener('DOMContentLoaded', function () { observe(); apply(); });
  apply();
})();
