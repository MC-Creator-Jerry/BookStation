/* 书栈 · 设置页（账户 + 升级状态：成员类型、到期时间；付费成员 = pro-member） */
(function () {
  const $ = function (s) { return document.querySelector(s); };
  const UPGRADE_URL = 'https://ifdian.net/order/create?plan_id=2927c56ab87911f188a65254001e7c00';

  // exp 是毫秒时间戳，按本地时区显示「年-月-日 时:分」
  function fmtDateTime(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function roleText(state) {
    if (state.isAdmin) return '管理员';
    if (state.role === 'creator') return '创作者';
    return '已登录用户';
  }

  function show(view) {
    $('#loginRequired').classList.toggle('hidden', view !== 'login');
    $('#settingsView').classList.toggle('hidden', view !== 'settings');
    $('#settingsErr').classList.toggle('hidden', view !== 'err');
  }

  async function loadAccount(state) {
    if (!state.loggedIn) { show('login'); return; }
    show('settings');
    $('#setName').textContent = (state.user && state.user.name) || '—';
    $('#setLogin').textContent = (state.user && state.user.login) || '—';
    $('#setRole').textContent = roleText(state);
  }

  async function loadProMember() {
    const statusEl = $('#promemberStatus');
    const detailEl = $('#promemberDetail');
    const actionsEl = $('#promemberActions');
    statusEl.className = 'promember-status';
    detailEl.innerHTML = '';
    actionsEl.innerHTML = '';
    try {
      const q = await BS.api('/quota');

      const isAdmin = !!q.unlimited;
      const isProMember = isAdmin || q.plan === 'pro';
      const expStr = q.exp ? fmtDateTime(q.exp) : '';
      const expLabel = isAdmin ? '永久有效' : (expStr ? '有效期至 ' + expStr : '—');

      // 状态徽标
      if (isProMember) {
        statusEl.className = 'promember-status is-promember';
        statusEl.innerHTML = isAdmin
          ? '🛡️ 管理员成员'
          : '🌟 升级-付费成员（暂时） 已生效';
      } else {
        statusEl.className = 'promember-status not-promember';
        statusEl.innerHTML = '📖 普通-免费成员';
      }

      // 明细
      const daily = isAdmin
        ? '上传不限量'
        : '今日已发布 ' + q.used + ' / ' + q.limit + ' 本' +
          (q.remaining > 0 ? '（剩余 ' + q.remaining + '）' : '（已达上限，明天再来）');
      const openPlan = q.plan === 'pro' ? '书栈·发布功能升级' : '';
      detailEl.innerHTML =
        '<div class="bs-row bs-meta"><span class="bs-muted">成员类型</span><span>' +
          (isAdmin ? '管理员成员' : (q.plan === 'pro' ? '升级-付费成员（暂时）' : '普通-免费成员')) + '</span></div>' +
        '<div class="bs-row bs-meta"><span class="bs-muted">是否 升级-付费成员</span><span>' +
          (q.plan === 'pro' ? '是' : '否') + '</span></div>' +
        (openPlan ? '<div class="bs-row bs-meta"><span class="bs-muted">已开通套餐</span><span>' + openPlan + '</span></div>' : '') +
        '<div class="bs-row bs-meta"><span class="bs-muted">到期时间</span><span>' + expLabel + '</span></div>' +
        '<div class="bs-row bs-meta"><span class="bs-muted">每日上传额度</span><span>' + daily + '</span></div>';

      // 行动入口
      if (isProMember) {
        actionsEl.innerHTML = '<p class="hint" style="margin:10px 0 0">在 <a href="redeem.html">兑换页</a> 粘贴续费赞助码即可顺延有效期。</p>';
      } else {
        actionsEl.innerHTML =
          '<a class="bs-btn" href="' + UPGRADE_URL + '" target="_blank" rel="noopener">订阅「书栈·发布功能升级」</a>' +
          '<p class="hint" style="margin:10px 0 0">付款后在 <a href="redeem.html">兑换页</a> 粘贴赞助码即可解锁高级版（每日上限 6 → 16 本）。</p>';
      }
    } catch (e) {
      if (e.status === 401) { show('login'); return; }
      show('err');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    BS.initTheme();
    BS.me()
      .then(function (state) { return loadAccount(state).then(loadProMember); })
      .catch(function () { show('err'); });
    BS.mountAuth();
  });
})();
