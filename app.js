/* ============================================================
   蕙心网 · 女性生理期健康护理平台
   app.js
   - 核心功能一：情绪健康智能护理（情绪识别 → 趋势预测 → 风险分级 → 分级干预）
   - 核心功能二：生理知识科普（分类 / 搜索 / 详情）
   - 工具：周期记录与预测、经期健康自检清单
   ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     0. 通用工具
     --------------------------------------------------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* 内部护理流程只作为实现依据（见 docs/flow-spec.js），页面不展示流程本身。
     这里保留内部节点名称，仅用于生成面向用户的「本次护理计划」与评估路径文案。 */
  const NODE_LABEL = {
    start: '开始自评', input: '填写感受', identify: '情绪识别', emotype: '识别情绪类型',
    emoCheck: '判断负面情绪是否过多', bless: '健康祝福与激励短语',
    trend: '预测情绪趋势', heathfeat: '健康特征匹配', trendCheck: '判断是否持续负面情绪',
    suggest: '正念冥想建议',
    severe: '情绪重度异常评估', risk: '健康风险评估报告', medCheck: '判断是否适合正念冥想',
    medOut: '生成冥想引导内容', soothe: '情绪抚平安慰', counselCheck: '判断是否需要心理咨询',
    counselOut: '心理咨询与生活支持推荐', lifeHappy: '祝福生活愉快'
  };

  const LS = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式忽略 */ }
    },
    remove(k) {
      try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ }
    }
  };

  /* ---------------------------------------------------------
     0.5 账号体系（注册 / 登录 / 会话 / 角色）
     本平台为纯静态站点，账号信息保存在浏览器本地，属于本地
     演示级认证；历史查看、卡片审核等操作在数据层做角色校验。
     --------------------------------------------------------- */
  const USERS_KEY = 'hx_users';
  const SESSION_KEY = 'hx_session';
  const ADMIN_NAME = 'admin';
  const ADMIN_PWD = 'Huixin@2026';

  function makeSalt() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* 加盐多轮散列：仅避免明文保存，非加密级安全 */
  function hashPwd(pwd, salt) {
    const s = salt + '::huixin::' + pwd;
    let h = 5381;
    for (let r = 0; r < 8; r++) {
      for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
    }
    return h.toString(16);
  }

  /* 首次使用时生成管理员账号 */
  function initUsers() {
    let users = LS.get(USERS_KEY, null);
    if (!Array.isArray(users)) {
      const salt = makeSalt();
      users = [{
        name: ADMIN_NAME, role: 'admin', salt: salt,
        pwdHash: hashPwd(ADMIN_PWD, salt), createdAt: new Date().toISOString()
      }];
      LS.set(USERS_KEY, users);
    }
    return users;
  }

  function findUser(name) {
    const users = LS.get(USERS_KEY, []);
    return Array.isArray(users) ? users.filter((u) => u.name === name)[0] || null : null;
  }

  function currentUser() {
    const sess = LS.get(SESSION_KEY, null);
    return sess && sess.name ? findUser(sess.name) : null;
  }

  /* 数据层：注册 */
  function register(name, pwd) {
    name = String(name || '').trim();
    if (!/^[一-龥A-Za-z0-9_]{2,16}$/.test(name)) {
      return { ok: false, msg: '用户名需为 2～16 位中文、字母、数字或下划线' };
    }
    if (String(pwd || '').length < 6) return { ok: false, msg: '密码至少需要 6 位' };
    if (findUser(name)) return { ok: false, msg: '该用户名已被注册' };
    const users = LS.get(USERS_KEY, []);
    const salt = makeSalt();
    users.push({
      name: name, role: 'user', salt: salt,
      pwdHash: hashPwd(pwd, salt), createdAt: new Date().toISOString()
    });
    LS.set(USERS_KEY, users);
    LS.set(SESSION_KEY, { name: name });
    return { ok: true };
  }

  /* 数据层：登录 */
  function login(name, pwd) {
    const u = findUser(String(name || '').trim());
    if (!u || u.pwdHash !== hashPwd(String(pwd || ''), u.salt)) {
      return { ok: false, msg: '用户名或密码不正确' };
    }
    LS.set(SESSION_KEY, { name: u.name });
    return { ok: true };
  }

  function logout() { LS.remove(SESSION_KEY); }

  /* 数据层：管理员角色校验（审核操作统一入口校验） */
  function requireAdmin() {
    const u = currentUser();
    return u && u.role === 'admin' ? u : null;
  }

  /* ---------------------------------------------------------
     0.6 统一服务层：远程后端可用时走 API，否则自动回退本地模式
     所有 API 地址均使用相对路径（如 'api/cards'），相对于当前
     页面解析，站点部署到任意端口或目录层级均可正常工作。
     --------------------------------------------------------- */
  const TOKEN_KEY = 'hx_token';
  let svcMode = 'local';           // 'remote' | 'local'
  let svc = null;
  let me = null;
  let token = LS.get(TOKEN_KEY, '');

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['X-Auth-Token'] = token;
    const res = await fetch(path, Object.assign({}, opts, { headers: headers }));
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) {
      const er = new Error((data && data.error) || ('请求失败（' + res.status + '）'));
      er.status = res.status;
      throw er;
    }
    return data;
  }

  /* ---------- 本地服务 ---------- */
  const localSvc = {
    mode: 'local',
    async me() { return currentUser(); },
    async login(name, pwd) {
      const r = login(name, pwd);
      if (!r.ok) throw new Error(r.msg);
      return currentUser();
    },
    async register(name, pwd) {
      const r = register(name, pwd);
      if (!r.ok) throw new Error(r.msg);
      return currentUser();
    },
    async logout() { logout(); },

    async cards() {
      const base = KB.map((k) => ({
        id: k.id, cat: k.cat, title: k.title, summary: k.summary,
        tags: k.tags, body: k.body, source: 'builtin', status: 'approved'
      }));
      return base.concat(LS.get('hx_cards_extra', []));
    },
    async card(id) {
      const all = await this.cards();
      return all.filter((k) => String(k.id) === String(id))[0] || null;
    },
    async click(type, target) {
      const rows = LS.get('hx_clicks', []);
      rows.unshift({ type: type, target: String(target), at: new Date().toISOString() });
      LS.set('hx_clicks', rows.slice(0, 2000));
      return { ok: true };
    },
    async submitCard(p) {
      const rows = LS.get('hx_submissions', []);
      rows.unshift({
        id: 'u' + Date.now().toString(36), cat: p.cat, title: p.title,
        summary: p.summary || '', tags: p.tags || [], body: p.body || [],
        author: currentUser() ? currentUser().name : '匿名',
        status: 'pending', reason: '', created_at: new Date().toISOString()
      });
      LS.set('hx_submissions', rows);
      return rows[0];
    },
    async myCards() {
      const name = currentUser() ? currentUser().name : '';
      const subs = LS.get('hx_submissions', []).filter((r) => r.author === name);
      const extra = LS.get('hx_cards_extra', []).filter((r) => r.author === name);
      return subs.concat(extra);
    },
    admin: {
      async pending() {
        return LS.get('hx_submissions', []).filter((r) => r.status === 'pending');
      },
      async allCards(status) {
        const subs = LS.get('hx_submissions', []);
        const extra = LS.get('hx_cards_extra', []);
        if (status === 'pending') return subs.filter((r) => r.status === 'pending');
        if (status === 'rejected') return subs.filter((r) => r.status === 'rejected');
        return extra;
      },
      async approve(id) {
        const subs = LS.get('hx_submissions', []);
        const i = subs.findIndex((r) => String(r.id) === String(id));
        if (i < 0) throw new Error('投稿不存在');
        const r = subs[i];
        const extra = LS.get('hx_cards_extra', []);
        extra.unshift({
          id: r.id, cat: r.cat, title: r.title, summary: r.summary,
          tags: r.tags, body: r.body, source: 'user', author: r.author,
          status: 'approved', created_at: r.created_at
        });
        subs.splice(i, 1);
        LS.set('hx_submissions', subs);
        LS.set('hx_cards_extra', extra);
        return extra[0];
      },
      async reject(id, reason) {
        const subs = LS.get('hx_submissions', []);
        const i = subs.findIndex((r) => String(r.id) === String(id));
        if (i < 0) throw new Error('投稿不存在');
        subs[i].status = 'rejected';
        subs[i].reason = reason || '';
        LS.set('hx_submissions', subs);
        return subs[i];
      },
      async createCard(p) {
        const extra = LS.get('hx_cards_extra', []);
        const card = {
          id: 'a' + Date.now().toString(36), cat: p.cat, title: p.title,
          summary: p.summary || '', tags: p.tags || [], body: p.body || [],
          source: 'admin', author: 'admin', status: 'approved',
          created_at: new Date().toISOString()
        };
        extra.unshift(card);
        LS.set('hx_cards_extra', extra);
        return card;
      },
      async updateCard(id, p) {
        const extra = LS.get('hx_cards_extra', []);
        const i = extra.findIndex((r) => String(r.id) === String(id));
        if (i < 0) throw new Error('仅可管理用户或管理员新建的卡片，内置卡片请通过新增覆盖');
        ['cat', 'title', 'summary', 'tags', 'body'].forEach((k) => {
          if (p[k] !== undefined) extra[i][k] = p[k];
        });
        LS.set('hx_cards_extra', extra);
        return extra[i];
      },
      async deleteCard(id) {
        const before = LS.get('hx_cards_extra', []);
        const after = before.filter((r) => String(r.id) !== String(id));
        if (after.length === before.length) throw new Error('卡片不存在');
        LS.set('hx_cards_extra', after);
        return { ok: true };
      },
      async users() {
        return LS.get(USERS_KEY, []).map((u) => ({
          id: u.name, name: u.name, role: u.role,
          created_at: u.createdAt, assess_count: LS.get('hx_history', []).length
        }));
      },
      async stats() {
        const clicks = LS.get('hx_clicks', []);
        const count = (rows) => {
          const m = {};
          rows.forEach((r) => { m[r.target] = (m[r.target] || 0) + 1; });
          return Object.keys(m).map((t) => ({ target: t, count: m[t] }))
            .sort((a, b) => b.count - a.count);
        };
        const all = await localSvc.cards();
        const dmap = {};
        clicks.forEach((c) => {
          const d = (c.at || '').slice(0, 10);
          dmap[d] = (dmap[d] || 0) + 1;
        });
        return {
          totals: {
            users: LS.get(USERS_KEY, []).length,
            cards_approved: all.length,
            cards_pending: LS.get('hx_submissions', []).filter((r) => r.status === 'pending').length,
            cards_rejected: LS.get('hx_submissions', []).filter((r) => r.status === 'rejected').length,
            assessments: LS.get('hx_history', []).length,
            clicks: clicks.length
          },
          sections: count(clicks.filter((c) => c.type === 'section')),
          cards: count(clicks.filter((c) => c.type === 'card'))
            .map((x) => {
              const k = all.filter((c) => String(c.id) === x.target)[0];
              return { id: x.target, title: k ? k.title : x.target, cat: k ? k.cat : '', count: x.count };
            }),
          daily: Object.keys(dmap).sort().map((d) => ({ date: d, count: dmap[d] }))
        };
      }
    },
    async syncAssess(items) { return { inserted: 0, total: LS.get('hx_history', []).length }; },
    async assessments() { return LS.get('hx_history', []); }
  };

  /* ---------- 远程服务 ---------- */
  const remoteSvc = {
    mode: 'remote',
    me: async () => (await api('api/auth/me')).user,
    login: async (name, pwd) => {
      const r = await api('api/auth/login', {
        method: 'POST', body: JSON.stringify({ name: name, password: pwd })
      });
      token = r.token; LS.set(TOKEN_KEY, token); return r.user;
    },
    register: async (name, pwd) => {
      const r = await api('api/auth/register', {
        method: 'POST', body: JSON.stringify({ name: name, password: pwd })
      });
      token = r.token; LS.set(TOKEN_KEY, token); return r.user;
    },
    logout: async () => {
      try { await api('api/auth/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
      token = ''; LS.remove(TOKEN_KEY);
    },
    cards: async () => (await api('api/cards')).cards,
    card: async (id) => api('api/cards/' + encodeURIComponent(id)),
    click: async (type, target) => api('api/clicks', {
      method: 'POST', body: JSON.stringify({ type: type, target: target })
    }),
    submitCard: async (p) => api('api/cards/submit', {
      method: 'POST', body: JSON.stringify(p)
    }),
    myCards: async () => (await api('api/my/cards')).cards,
    admin: {
      pending: async () => (await api('api/admin/cards?status=pending')).cards,
      allCards: async (status) => (await api('api/admin/cards' + (status ? '?status=' + status : ''))).cards,
      approve: async (id) => api('api/admin/cards/' + id + '/approve', { method: 'POST' }),
      reject: async (id, reason) => api('api/admin/cards/' + id + '/reject', {
        method: 'POST', body: JSON.stringify({ reason: reason || '' })
      }),
      createCard: async (p) => api('api/admin/cards', {
        method: 'POST', body: JSON.stringify(p)
      }),
      updateCard: async (id, p) => api('api/admin/cards/' + id, {
        method: 'PUT', body: JSON.stringify(p)
      }),
      deleteCard: async (id) => api('api/admin/cards/' + id, { method: 'DELETE' }),
      users: async () => (await api('api/admin/users')).users,
      stats: async () => api('api/admin/stats')
    },
    syncAssess: async (items) => api('api/assessments/sync', {
      method: 'POST', body: JSON.stringify({ items: items })
    }),
    assessments: async () => (await api('api/assessments')).assessments
  };

  /* 启动探测：远程后端可用则用远程，否则本地回退 */
  async function bootstrap() {
    initUsers();
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch('api/health', { signal: ctrl.signal });
      if (res.ok) svcMode = 'remote';
    } catch (e) { svcMode = 'local'; }
    svc = svcMode === 'remote' ? remoteSvc : localSvc;
    try { me = await svc.me(); } catch (e) { me = null; }
    if (!me) { token = ''; LS.remove(TOKEN_KEY); }
  }

  /* 自评记录云端同步 */
  async function cloudSync(silent) {
    if (svcMode !== 'remote' || !me) return null;
    const items = LS.get('hx_history', []).map((r) => ({ at: r.at, data: r }));
    const r = await svc.syncAssess(items);
    LS.set('hx_lastsync', new Date().toISOString());
    if (!silent) toast('云端同步完成 · 云端共 ' + r.total + ' 条记录');
    return r;
  }

  let authTab = 'login';

  function renderAuthArea() {
    const box = $('#authArea');
    if (!box) return;
    const u = me;
    if (u) {
      box.innerHTML =
        '<span class="auth-name">你好，' + esc(u.name) + '</span>' +
        '<span class="role-badge' + (u.role === 'admin' ? ' admin' : '') + '">' +
        (u.role === 'admin' ? '管理员' : '用户') + '</span>' +
        '<button type="button" class="auth-btn" id="logoutBtn">退出</button>';
      $('#logoutBtn').addEventListener('click', doLogout);
    } else {
      box.innerHTML =
        '<button type="button" class="auth-btn" id="navLogin">登录</button>' +
        '<button type="button" class="auth-btn primary" id="navRegister">注册</button>';
      $('#navLogin').addEventListener('click', () => openAuth('login'));
      $('#navRegister').addEventListener('click', () => openAuth('register'));
    }
  }

  function openAuth(tab) {
    authTab = tab || 'login';
    renderAuthModal();
    $('#authModal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeAuth() {
    $('#authModal').hidden = true;
    document.body.style.overflow = '';
  }

  $$('#authModal [data-auth-close]').forEach((el) =>
    el.addEventListener('click', closeAuth));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#authModal').hidden) closeAuth();
  });

  function renderAuthModal() {
    const body = $('#authModalBody');
    body.innerHTML =
      '<h2 id="authTitle" style="margin-bottom:16px">' +
      (authTab === 'login' ? '登录蕙心网' : '注册新账号') + '</h2>' +
      '<div class="auth-tabs">' +
        '<button type="button" data-tab="login"' + (authTab === 'login' ? ' class="is-on"' : '') + '>登录</button>' +
        '<button type="button" data-tab="register"' + (authTab === 'register' ? ' class="is-on"' : '') + '>注册</button>' +
      '</div>' +
      '<form class="auth-form" id="authForm" novalidate>' +
        '<label>用户名' +
          '<input type="text" id="authName" autocomplete="username" required></label>' +
        '<label>密码' +
          '<input type="password" id="authPwd"' +
          (authTab === 'login' ? ' autocomplete="current-password"' : ' autocomplete="new-password"') + ' required></label>' +
        (authTab === 'register'
          ? '<label>确认密码<input type="password" id="authPwd2" autocomplete="new-password" required></label>'
          : '') +
        '<p class="auth-error" id="authError"></p>' +
        '<button type="submit" class="btn btn-primary" id="authSubmit">' +
        (authTab === 'login' ? '登录' : '注册并登录') + '</button>' +
        '<p class="auth-note">未登录也可以完成情绪自评、浏览生理知识科普；登录后可查看自评历史。' +
        '登录后生成的科普卡片将署名提交，经管理员审核后加入知识库。</p>' +
      '</form>';

    $$('.auth-tabs button', body).forEach((b) => b.addEventListener('click', () => {
      authTab = b.getAttribute('data-tab');
      renderAuthModal();
    }));

    $('#authForm', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#authError', body);
      const submitBtn = $('#authSubmit', body);
      err.textContent = '';
      const name = $('#authName', body).value;
      const pwd = $('#authPwd', body).value;
      if (authTab === 'register' && pwd !== $('#authPwd2', body).value) {
        err.textContent = '两次输入的密码不一致';
        return;
      }
      submitBtn.disabled = true;
      try {
        me = authTab === 'register'
          ? await svc.register(name, pwd)
          : await svc.login(name, pwd);
        const wasRegister = authTab === 'register';
        closeAuth();
        await applyRoleUI();
        await refreshHistoryView();
        toast((wasRegister ? '注册成功，' : '') + '欢迎你，' + me.name);
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        submitBtn.disabled = false;
      }
    });

    setTimeout(() => {
      const n = $('#authName', body);
      if (n) n.focus();
    }, 0);
  }

  async function doLogout() {
    const u = me;
    await svc.logout();
    me = null;
    await applyRoleUI();
    await refreshHistoryView();
    toast('已退出登录' + (u ? '（' + u.name + '）' : ''));
  }

  /* 根据登录角色刷新所有权限相关 UI */
  async function applyRoleUI() {
    renderAuthArea();
    const isAdmin = !!(me && me.role === 'admin');
    if ($('#adminLink')) $('#adminLink').hidden = !isAdmin;
    if ($('#kbReview')) $('#kbReview').hidden = !isAdmin;
    if ($('#admin')) $('#admin').hidden = !isAdmin;
    updateReviewBadge();
  }

  /* ---------------------------------------------------------
     1. 面向用户的「本次护理计划」（内部流程对用户隐藏）
     --------------------------------------------------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const PLAN_COPY = [
    { title: '第 1 步 · 先说说你的感受', lead: '写下今天的一句话（可跳过），选中最接近此刻的情绪标签，并勾选身体感受。这些信息只用来判断你当下的情绪状态。' },
    { title: '第 2 步 · 结合身体情况看趋势', lead: '补充周期、睡眠、疼痛与压力信息，用来区分情绪是阶段性波动还是持续困扰。' },
    { title: '第 3 步 · 风险核对', lead: '这几项是需要优先就医的信号，勾选后会优先给出就医与心理支持建议。' },
    { title: '第 4 步 · 你的护理建议', lead: '根据前面的判断给出分级护理方案；建议只保存在本地，可随时重新自评。' }
  ];

  function renderPlan(step, path) {
    const idx = Math.min(Math.max(step, 1), PLAN_COPY.length) - 1;
    const copy = PLAN_COPY[idx];
    const title = $('#planTitle');
    const lead = $('#planLead');
    const list = $('#planList');
    if (title) title.textContent = copy.title;
    if (lead) lead.textContent = copy.lead;
    if (!list) return;

    let items;
    if (step >= 4 && path && path.length) {
      items = path.map((id, i) => ({
        text: NODE_LABEL[id] || id,
        state: i === path.length - 1 ? 'current' : 'done'
      }));
    } else {
      items = PLAN_COPY.map((c, i) => ({
        text: c.title.replace(/^第 \d 步 · /, ''),
        state: i < step - 1 ? 'done' : (i === step - 1 ? 'current' : 'todo')
      }));
    }
    list.innerHTML = items.map((it) =>
      '<li class="is-' + it.state + '">' + esc(it.text) + '</li>').join('');
  }

  /* ---------------------------------------------------------
     2. 核心功能一：情绪自评状态机
     --------------------------------------------------------- */
  const NEG = ['焦虑', '低落', '烦躁', '疲惫', '委屈想哭', '易怒失控'];
  const DIARY_NEG = ['焦虑', '难过', '想哭', '哭', '烦', '累', '失眠', '睡不着', '崩溃', '压力', '低落', '没意思', '痛', '难受', '委屈', '生气', '紧张', '害怕', '空', '麻木', '焦躁', '不安'];

  /* 疼痛等级 → 0～10 数值（用于趋势曲线）与文案 */
  const PAIN_SCORE = { none: 0, mild: 3, mid: 6, severe: 9 };
  const PAIN_TEXT = { none: '无痛', mild: '轻微疼痛', mid: '中度疼痛', severe: '重度疼痛' };

  const state = {
    step: 1,
    diary: '',
    diarySkipped: false,
    symptoms: [],
    emotions: [],
    duration: 'hours',
    intensity: 5,
    lastPeriod: '',
    cycleLen: 28,
    periodLen: 5,
    sleep: '7-9',
    pain: 'none',
    stress: 'low',
    extra: '',
    flags: { selfHarm: false, heavyBleed: false, missedPeriod: false, faint: false },
    visited: ['start', 'input'],
    current: 'identify',
    result: null
  };

  const TOTAL_STEPS = 4;

  function readStep1() {
    state.diary = ($('#diary').value || '').trim();
    state.symptoms = $$('input[name="symptom"]:checked').map((i) => i.value);
    if (state.diary) state.diarySkipped = false;
  }
  function readStep2() {
    state.emotions = $$('input[name="emotion"]:checked').map((i) => i.value);
    state.duration = $('#duration').value;
    state.intensity = Number($('#intensity').value);
  }
  function readStep3() {
    state.lastPeriod = $('#lastPeriod').value;
    state.cycleLen = clampNum($('#cycleLen').value, 18, 60, 28);
    state.periodLen = clampNum($('#periodLen').value, 1, 12, 5);
    state.sleep = $('#sleep').value;
    state.pain = $('#pain').value;
    state.stress = $('#stress').value;
    state.extra = ($('#extraNote').value || '').trim();
  }
  function readStep4() {
    state.flags = {
      selfHarm: $('#selfHarm').checked,
      heavyBleed: $('#heavyBleed').checked,
      missedPeriod: $('#missedPeriod').checked,
      faint: $('#faint').checked
    };
  }
  function clampNum(v, min, max, dft) {
    const n = Number(v);
    if (!isFinite(n)) return dft;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function dayOfCycle(lastPeriod, cycleLen) {
    if (!lastPeriod) return null;
    const start = new Date(lastPeriod + 'T00:00:00');
    if (isNaN(start.getTime())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today - start) / 86400000);
    if (diff < 0) return { day: 0, stage: '未知', note: '记录的日期在未来，请检查。' };
    const day = (diff % cycleLen) + 1;
    return { day: day, stage: stageOf(day, cycleLen), raw: diff };
  }

  function stageOf(day, cycleLen) {
    const ovu = Math.round(cycleLen / 2);
    if (day <= 5) return '月经期';
    if (day < ovu - 1) return '卵泡期';
    if (day <= ovu + 1) return '排卵期';
    return '黄体期（经前期）';
  }

  function analyze() {
    readStep1(); readStep2(); readStep3(); readStep4();

    const negs = state.emotions.filter((e) => NEG.indexOf(e) >= 0);
    const poss = state.emotions.filter((e) => NEG.indexOf(e) < 0);
    const diaryHitWords = DIARY_NEG.filter((w) => state.diary.indexOf(w) >= 0);
    const diaryHit = diaryHitWords.length > 0;
    const intensity = state.intensity;
    const intHigh = intensity >= 7;
    const durPersist = ['3-5d', 'week', 'weeks'].indexOf(state.duration) >= 0;
    const durLong = ['week', 'weeks'].indexOf(state.duration) >= 0;
    const negScore = negs.length + (diaryHit ? 1 : 0) + (intHigh ? 1 : 0);
    const posOnly = negs.length === 0 && !diaryHit;
    const redFlag = state.flags.selfHarm || state.flags.heavyBleed || state.flags.missedPeriod || state.flags.faint;
    const psychFlag = state.flags.selfHarm;
    /* 高危红旗（自伤念头 / 大出血 / 急性症状）必须进入评估分支，不能被「情绪不多」提前结束 */
    const emoOver = redFlag || negScore >= 2 || intensity >= 5;
    const severeScore = negs.length * 2 + (intHigh ? 2 : 0) + (durLong ? 3 : 0) + (durPersist ? 1 : 0);
    const persistent = redFlag || durPersist || (intHigh && state.stress === 'high');
    /* 高风险条件（红旗项 / 影响 ≥ 9 / 重度异常评分）直接进入风险评估分支，避免高危信号被"影响程度"漏判 */
    const forceSevere = redFlag || intensity >= 9 || severeScore >= 6;
    const abnormal = severeScore >= 6;
    const riskHigh = redFlag || (durLong && intHigh) || intensity >= 9 || abnormal;
    const riskMid = !riskHigh && (durPersist || intHigh || state.stress === 'high' || state.pain === 'severe');
    const riskLevel = riskHigh ? 'high' : (riskMid ? 'mid' : 'low');

    const cyc = dayOfCycle(state.lastPeriod, state.cycleLen);
    const pmsWindow = cyc && cyc.day >= Math.max(1, state.cycleLen - 6);

    const counseling = riskLevel === 'high' || psychFlag || intensity >= 8 || state.duration === 'weeks';
    const meditation = riskLevel !== 'high' && !psychFlag;

    const path = ['start', 'input', 'identify', 'emotype', 'emoCheck'];
    if (posOnly && !emoOver) {
      path.push('bless');
      return finish(path, {
        level: 'good', branch: 'bless', negs: negs, poss: poss, diaryHitWords: diaryHitWords,
        emoOver: false, counseling: false, meditation: false, riskLevel: 'low', cyc: cyc, pmsWindow: pmsWindow
      });
    }
    if (!emoOver) {
      path.push('bless');
      return finish(path, {
        level: 'good', branch: 'bless', negs: negs, poss: poss, diaryHitWords: diaryHitWords,
        emoOver: false, counseling: false, meditation: false, riskLevel: 'low', cyc: cyc, pmsWindow: pmsWindow
      });
    }

    path.push('trend', 'heathfeat', 'trendCheck');
    if (!persistent && !forceSevere) {
      path.push('suggest');
      return finish(path, {
        level: 'mild', branch: 'suggest', negs: negs, poss: poss, diaryHitWords: diaryHitWords,
        emoOver: true, counseling: false, meditation: true, riskLevel: riskLevel, cyc: cyc, pmsWindow: pmsWindow
      });
    }

    path.push('severe', 'risk', 'medCheck');
    if (meditation) {
      path.push('medOut', 'counselCheck');
    } else {
      path.push('soothe', 'counselCheck');
    }
    if (counseling) {
      path.push('counselOut');
    } else {
      path.push('lifeHappy');
    }
    return finish(path, {
      level: riskLevel === 'high' ? 'high' : (riskLevel === 'mid' ? 'mid' : 'mild'),
      branch: 'severe', negs: negs, poss: poss, diaryHitWords: diaryHitWords,
      emoOver: true, persistent: true, counseling: counseling, meditation: meditation,
      riskLevel: riskLevel, abnormal: abnormal, severeScore: severeScore, cyc: cyc, pmsWindow: pmsWindow
    });
  }

  function finish(path, res) {
    res.path = path;
    state.result = res;
    state.visited = path;
    return res;
  }

  /* ---------------- 报告渲染 ----------------
     s 为数据快照；当前自评用全局 state，历史记录用存储的 snap */
  function decisionSummary(res) {
    const items = [
      ['负面情绪是否过多', res.emoOver ? '是' : '否', res.emoOver ? '' : 'is-no']
    ];
    if (res.emoOver) {
      items.push(['是否持续负面情绪', res.branch === 'severe' ? '是' : '否', res.branch === 'severe' ? '' : 'is-no']);
    } else {
      items.push(['是否持续负面情绪', '未进入', 'skip']);
    }
    if (res.branch === 'severe') {
      items.push(['是否进入正念冥想', res.meditation ? '是' : '否', res.meditation ? '' : 'is-no']);
      items.push(['是否需要心理咨询', res.counseling ? '是' : '否', res.counseling ? '' : 'is-no']);
    } else {
      items.push(['是否进入正念冥想', '未进入', 'skip']);
      items.push(['是否需要心理咨询', '未进入', 'skip']);
    }
    return '<div class="decide">' + items.map((it) =>
      '<span class="' + it[2] + '">' + esc(it[0]) + '：<b>' + esc(it[1]) + '</b></span>').join('') + '</div>';
  }

  function renderReport(res, s) {
    s = s || state;
    const durText = { hours: '几个小时内', '1-2d': '1～2 天', '3-5d': '3～5 天', week: '一周及以上', weeks: '两周以上且反复出现' }[s.duration];
    const levelTag = { good: '<span class="tag tag-ok">情绪状态平稳</span>', mild: '<span class="tag tag-warn">轻度情绪波动</span>', mid: '<span class="tag tag-warn">中度情绪困扰</span>', high: '<span class="tag tag-bad">需要重点关注</span>' }[res.level];
    const riskTag = { low: '<span class="tag tag-ok">低风险</span>', mid: '<span class="tag tag-warn">中等风险</span>', high: '<span class="tag tag-bad">高风险</span>' }[res.riskLevel];

    let html = '<div class="report">';

    /* 风险提醒置顶 */
    if (s.flags.selfHarm || s.flags.faint || s.flags.heavyBleed || s.flags.missedPeriod) {
      html += '<div class="alert"><b>请优先就医或寻求专业支持</b>' +
        '你勾选了需要警惕的情况。请尽快到妇科或精神心理科门诊评估；若出现自伤念头，请联系全国心理援助热线 <b>12356</b>，紧急情况拨打 <b>120</b>。以下自助建议不替代诊疗。</div>';
    }

    /* 流程判定摘要（四个判断节点结论一览） */
    html += decisionSummary(res);

    /* 1 情绪识别 */
    html += '<section class="rpt-block"><h5>① 情绪识别结果</h5>' +
      '<p>' + levelTag + '<span class="tag tag-soft">识别到 ' + (res.negs.length + res.poss.length) + ' 类情绪</span></p>' +
      '<ul class="rpt-list">' +
      '<li>负面情绪类型：' + (res.negs.length ? esc(res.negs.join('、')) : '未识别到明显负面情绪') + '</li>' +
      '<li>正向 / 平稳情绪：' + (res.poss.length ? esc(res.poss.join('、')) : '无') + '</li>' +
      '<li>情绪持续时间：' + durText + '；影响程度：' + s.intensity + ' / 10</li>' +
      (res.diaryHitWords.length ? '<li class="warn">日记中命中情绪线索词：' + esc(res.diaryHitWords.join('、')) + '</li>'
        : (s.diarySkipped ? '<li>本次自评<b>跳过了文字日记</b>，依据情绪标签与身体感受判断</li>' : '<li>日记中未命中明显负面线索词</li>')) +
      '<li>判断结论：负面情绪' + (res.emoOver ? '<b>偏多</b>，需要进入趋势预测分支' : '<b>不多</b>，输出健康祝福与激励短语') + '</li>' +
      '</ul></section>';

    /* 2 健康特征与趋势 */
    if (res.emoOver) {
      const cycLine = res.cyc && res.cyc.day
        ? '周期第 <b>' + res.cyc.day + '</b> 天，处于<b>' + res.cyc.stage + '</b>'
        : '尚未填写最近一次月经开始日期（建议补全以获得更准确的趋势预测）';
      html += '<section class="rpt-block"><h5>② 健康特征匹配与趋势预测</h5>' +
        '<ul class="rpt-list">' +
        '<li>' + cycLine + '</li>' +
        '<li>近一周睡眠：' + esc({ '7-9': '7～9 小时，尚可', '6-7': '6～7 小时，略少', 'lt6': '不足 6 小时', 'gt9': '超过 9 小时仍困' }[s.sleep]) + '</li>' +
        '<li>经期疼痛：' + esc({ none: '基本不痛', mild: '轻微', mid: '中度，需热敷或止痛药', severe: '重度，影响学习工作' }[s.pain]) + '；生活压力：' + esc({ low: '较小', mid: '一般', high: '较大' }[s.stress]) + '</li>' +
        (s.symptoms.length ? '<li>身体感受：' + esc(s.symptoms.join('、')) + '</li>' : '') +
        (s.extra ? '<li>其他说明：' + esc(s.extra) + '</li>' : '') +
        '<li>趋势判断：' + (res.persistent ? '<b>属于持续负面情绪</b>，需要进入风险评估分支' : '<b>属于阶段性波动</b>，先给正念冥想建议即可') + '</li>' +
        (res.pmsWindow ? '<li class="warn">当前处于经前期（PMS）情绪易波动窗口，情绪起伏与激素波动高度相关，可优先使用非药物调节</li>' : '') +
        '</ul></section>';
    }

    /* 3 风险评估 */
    if (res.branch === 'severe') {
      const pct = Math.min(100, Math.round((res.severeScore / 16) * 100));
      html += '<section class="rpt-block"><h5>③ 健康风险评估报告</h5>' +
        '<p>综合风险等级：' + riskTag + '<span class="tag tag-soft">情绪重度异常判定分 ' + res.severeScore + ' / 16</span></p>' +
        '<div class="meter"><span style="width:' + pct + '%"></span></div>' +
        '<ul class="rpt-list">' +
        '<li>是否进入正念冥想干预：<b>' + (res.meditation ? '是（风险等级未达高危，优先非药物干预）' : '否（先做情绪安抚与陪伴，再评估）') + '</b></li>' +
        '<li>是否需要心理咨询：<b>' + (res.counseling ? '建议安排' : '暂不需要，可先自助调节并持续观察') + '</b></li>' +
        '<li>下次自评建议：' + (res.riskLevel === 'high' ? '3 天内复评一次' : '一周后复评一次') + '</li>' +
        '</ul></section>';
    }

    /* 4 干预方案 */
    html += '<section class="rpt-block"><h5>④ 分级干预方案</h5><div class="reco-grid">';
    if (res.branch === 'bless') {
      html += reco('健康祝福 · 继续保持', '你的情绪状态整体平稳。记录下今天让你感觉不错的 1 件小事，它会成为下次低落时的锚点。');
      html += reco('激励短语', '「身体的每一次潮汐都在告诉你：你比自己以为的更有韧性。」——蕙心网');
      html += reco('日常保养', '保持规律作息与每周 3 次中等强度运动，经期前后适当补充含铁与镁的食物水。');
    } else if (res.branch === 'suggest') {
      html += reco('正念冥想建议 · 4-7-8 呼吸', '吸气 4 秒 → 屏息 7 秒 → 缓慢呼气 8 秒，做 4 轮，可快速降低交感神经兴奋。');
      html += reco('身体扫描冥想', '睡前平躺，从脚趾到头顶逐段放松，每段停留 3 次呼吸，约 10 分钟。');
      html += reco('情绪日记', '把此刻的感受写成 3 句话，不评价、不修改，只做记录。');
    } else {
      if (res.meditation) {
        html += reco('小程序输出冥想内容', '已为你匹配 10 分钟正念冥想引导：坐姿放松 → 关注呼吸 → 觉察情绪命名 → 回到身体。建议每天固定时间练习。');
      } else {
        html += reco('情绪抚平安慰', '你现在的感受是真实的，也是可以被接住的。先做 3 次慢呼吸，再喝一杯温水，把注意力放回身体。');
        html += reco('即时舒缓三步', '① 双脚踩地，感受支撑；② 双手抱住自己 20 秒；③ 给信任的人发一条消息。');
      }
      if (res.counseling) {
        if (s.flags.selfHarm) {
          html += reco('请立即寻求专业帮助', '你提到过伤害自己的念头，这是需要被认真对待的信号。请联系全国心理援助热线 12356，或前往医院急诊／精神心理科；也可以现在就告诉一位你信任的人，让别人陪着你。');
        }
        html += reco('心理咨询推荐', '建议预约学校心理中心或正规医院精神心理科／临床心理科。若情绪持续两周以上并影响睡眠、进食、学习工作，请尽早面询。');
        html += reco('生活需求商品优惠券', '蕙心安心券 HX-CARE20：热敷贴、暖宫贴、低糖黑巧克力、助眠眼罩等生活护理商品可用（示例券码，仅作功能演示）。');
        html += reco('就医科别提示', '妇科（月经异常、痛经）、精神心理科（情绪与睡眠）。就诊时可带上本页自评结果与周期记录。');
      } else {
        html += reco('祝福生活愉快', '你已经做完了今天最需要的一步——正视自己的情绪。愿接下来的日子里，身体轻一点，心也松一点。');
      }
    }
    html += '</div></section>';

    /* 5 本次评估路径（文字化，供用户理解建议是怎么得出的） */
    html += '<section class="rpt-block"><h5>⑤ 本次评估路径</h5><div class="trace">' +
      res.path.map((id) => '<span>' + esc(NODE_LABEL[id] || id) + '</span>').join('<i>→</i>') +
      '</div></section>';

    if (res.emoOver && res.branch !== 'severe') {
      html += '<section class="rpt-block"><h5>⑥ 生活建议</h5><ul class="rpt-list">' +
        '<li>经期前后减少咖啡因与高盐食物，可减轻乳房胀痛与烦躁。</li>' +
        '<li>保证 7 小时以上睡眠，固定起床时间比固定入睡时间更有效。</li>' +
        '<li>每周 3～5 次、每次 30 分钟的快走或瑜伽，可显著改善经前情绪症状。</li>' +
        '<li>若下个周期同一时段再次出现类似情绪，请打开「周期工具」记录并复评一次。</li>' +
        '</ul></section>';
    }

    html += '</div>';
    return html;
  }

  function reco(title, text) {
    return '<div class="reco"><h6>' + esc(title) + '</h6><p>' + esc(text) + '</p></div>';
  }

  /* ---------------- 步骤切换 ---------------- */
  function setStep(n) {
    if (n < 1 || n > TOTAL_STEPS) return;
    state.step = n;
    $$('.step-panel').forEach((p) => p.classList.toggle('is-active', Number(p.getAttribute('data-step')) === n));
    $$('#stepNav li').forEach((li) => {
      const s = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
    $('#progressBar').style.width = ((n - 1) / (TOTAL_STEPS - 1) * 100) + '%';
    $('#prevBtn').disabled = n === 1;
    $('#nextBtn').textContent = n === 3 ? '生成护理建议' : (n === 4 ? '已完成' : '下一步');
    $('#nextBtn').hidden = n === 4;
    $('#resetBtn').hidden = n !== 4;
    $('#formError').hidden = true;
    renderPlan(n, state.result ? state.result.path : null);
  }

  function showError(msg) {
    const el = $('#formError');
    el.textContent = msg;
    el.hidden = false;
  }

  $('#nextBtn').addEventListener('click', () => {
    if (state.step === 1) {
      readStep1();
      readStep2();
      if (!state.emotions.length) { showError('请至少选择一种此刻的情绪类型（例如「平静」或「焦虑」）。'); return; }
      setStep(2); return;
    }
    if (state.step === 2) { readStep3(); setStep(3); return; }
    if (state.step === 3) {
      readStep4();
      const res = analyze();
      $('#reportMount').innerHTML = renderReport(res);
      saveHistory(res);
      resetFb();
      setStep(4);
      $('#reportMount').scrollIntoView({ behavior: 'smooth', block: 'start' });
      /* 登录状态下刷新历史并自动同步云端 */
      Promise.resolve().then(async () => {
        await refreshHistoryView();
        if (me) cloudSync(true).catch(() => {});
      });
      return;
    }
  });

  $('#prevBtn').addEventListener('click', () => setStep(state.step - 1));

  $('#resetBtn').addEventListener('click', () => {
    $('#reportMount').innerHTML = '';
    $('#fbBlock').hidden = true;
    state.result = null;
    state.diarySkipped = false;
    setStep(1);
    $('#assessment').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* 跳过文字日记：清空日记并停留在第 1 步，滚动到情绪标签区 */
  $('#skipDiary').addEventListener('click', () => {
    $('#diary').value = '';
    state.diary = '';
    state.diarySkipped = true;
    $('#emoChips').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#intensity').addEventListener('input', (e) => { $('#intensityOut').textContent = e.target.value; });

  /* ---------------- 护理建议反馈（可选） ---------------- */
  function resetFb() {
    const block = $('#fbBlock');
    if (!block) return;
    block.hidden = false;
    $$('input[name="fbChoice"]').forEach((r) => { r.checked = false; });
    $('#fbText').value = '';
    $('#fbWorse').hidden = true;
    $('#fbDone').hidden = true;
    $('#fbSubmit').disabled = false;
  }

  $$('input[name="fbChoice"]').forEach((r) => r.addEventListener('change', (e) => {
    $('#fbWorse').hidden = e.target.value !== 'worse';
    /* 修改反馈后允许再次提交 */
    $('#fbDone').hidden = true;
    $('#fbSubmit').disabled = false;
  }));

  $('#fbText').addEventListener('input', () => {
    $('#fbDone').hidden = true;
    $('#fbSubmit').disabled = false;
  });

  $('#fbSubmit').addEventListener('click', () => {
    const choice = ($('input[name="fbChoice"]:checked') || {}).value || '';
    const fbText = ($('#fbText').value || '').trim();
    if (!choice && !fbText) { showError('反馈不是必填的：可以先选择一个选项或填写一句评价，再提交。'); return; }
    $('#formError').hidden = true;
    /* 写入最近一次自评记录（本地 localStorage），登录时随云端同步一起上传 */
    const hist = LS.get('hx_history', []);
    if (hist.length) {
      hist[0].fb = { choice: choice, text: fbText, at: new Date().toISOString() };
      LS.set('hx_history', hist.slice(0, HIST_LIMIT));
    }
    $('#fbDone').hidden = false;
    $('#fbSubmit').disabled = true;
    if (me) cloudSync(true).catch(() => {});
  });

  /* ---------------- 自评历史（最近 30 次） ---------------- */
  const HIST_LIMIT = 30;
  const LEVEL_TAG = {
    good: ['tag-ok', '情绪平稳'],
    mild: ['tag-warn', '轻度波动'],
    mid: ['tag-warn', '中度困扰'],
    high: ['tag-bad', '重点关注']
  };

  function saveHistory(res) {
    const hist = LS.get('hx_history', []);
    const snap = {
      diary: state.diary, symptoms: state.symptoms, emotions: state.emotions,
      duration: state.duration, intensity: state.intensity, lastPeriod: state.lastPeriod,
      cycleLen: state.cycleLen, periodLen: state.periodLen, sleep: state.sleep,
      pain: state.pain, stress: state.stress, extra: state.extra,
      flags: state.flags, diarySkipped: !!state.diarySkipped
    };
    hist.unshift({
      at: new Date().toISOString(),
      level: res.level, branch: res.branch, risk: res.riskLevel,
      emotions: state.emotions, intensity: state.intensity,
      painScore: PAIN_SCORE[state.pain] != null ? PAIN_SCORE[state.pain] : null,
      snap: snap, res: res
    });
    LS.set('hx_history', hist.slice(0, HIST_LIMIT));
  }

  function fmtDT(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 合并本地与云端自评记录（按自评时间去重；本地优先，云端补缺） */
  async function getMergedRecords() {
    const local = LS.get('hx_history', []);
    let cloud = [];
    if (svcMode === 'remote' && me) {
      try { cloud = await svc.assessments(); } catch (e) { cloud = []; }
    }
    const map = new Map();
    cloud.forEach((r) => { if (r && r.at) map.set(r.at, r); });
    local.forEach((r) => { if (r && r.at) map.set(r.at, r); });
    return Array.from(map.values()).sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /* 历史区总入口：未登录显示锁定态；已登录显示曲线与列表 */
  async function refreshHistoryView() {
    const lock = $('#historyLock');
    const inner = $('#historyInner');
    if (!lock || !inner) return;

    if (!me) {
      lock.hidden = false;
      inner.hidden = true;
      return;
    }
    lock.hidden = true;
    inner.hidden = false;

    const hist = await getMergedRecords();

    /* 同步控件与状态说明 */
    const isRemote = svcMode === 'remote';
    if ($('#syncCloud')) $('#syncCloud').hidden = !isRemote;
    const note = $('#syncNote');
    if (note) {
      if (isRemote) {
        const ls = LS.get('hx_lastsync', '');
        note.textContent = '云端模式：本地与云端记录合并显示' +
          (ls ? ' · 上次同步 ' + fmtDT(ls) : ' · 尚未同步，点击「云端同步」上传本地记录');
      } else {
        note.textContent = '本地模式（未连接后端）：记录仅保存在本浏览器。';
      }
    }

    const list = $('#historyList');
    const empty = $('#historyEmpty');
    const clearBtn = $('#clearHistory');
    empty.hidden = hist.length > 0;
    clearBtn.disabled = hist.length === 0;
    renderTrendChart(hist);

    list.innerHTML = hist.map((r) => {
      const lt = LEVEL_TAG[r.level] || ['tag-soft', r.level];
      const s = r.snap || {};
      const emotions = (s.emotions || r.emotions || []).slice(0, 4).join('、');
      const pain = s.pain ? PAIN_TEXT[s.pain] : '';
      const inten = s.intensity != null ? s.intensity : r.intensity;
      const hasDetail = !!r.res && !!r.snap;
      return '<li><button type="button" class="hist-item" data-at="' + esc(r.at) + '"' +
        (hasDetail ? '' : ' disabled title="早期记录未保存详情"') + '>' +
        '<span class="hist-time">' + esc(fmtDT(r.at)) + '</span>' +
        '<span class="tag ' + lt[0] + '">' + lt[1] + '</span>' +
        '<span class="hist-meta">' + esc(emotions || '未记录情绪') + '</span>' +
        (pain ? '<span class="hist-meta">痛苦：' + esc(pain) + '</span>' : '') +
        '<span class="hist-meta">情绪影响 ' + esc(String(inten)) + ' / 10</span>' +
        '<span class="go">' + (hasDetail ? '查看报告 →' : '无详情') + '</span>' +
        '</button></li>';
    }).join('');

    $$('.hist-item:not([disabled])', list).forEach((b) => b.addEventListener('click', () => {
      const at = b.getAttribute('data-at');
      hist.some((r) => {
        if (r.at !== at || !r.res) return false;
        $('#modalBody').innerHTML =
          '<div class="modal-body"><span class="cat tag tag-rose">历史自评 · ' + esc(fmtDT(r.at)) + '</span>' +
          renderReport(r.res, r.snap) +
          '<p class="modal-foot">本记录来自自评历史，不代表当前状态；内容为健康教育参考，不构成诊断。</p></div>';
        $('#modal').hidden = false;
        document.body.style.overflow = 'hidden';
        $('.modal-close').focus();
        return true;
      });
    }));
  }

  /* 兼容旧调用点 */
  const renderHistory = refreshHistoryView;

  $('#clearHistory').addEventListener('click', async () => {
    LS.set('hx_history', []);
    await refreshHistoryView();
    if (svcMode === 'remote') toast('本地记录已清空，云端记录仍保留');
    else toast('已清空自评记录');
  });

  if ($('#syncCloud')) {
    $('#syncCloud').addEventListener('click', async () => {
      const btn = $('#syncCloud');
      btn.disabled = true;
      try {
        await cloudSync(false);
      } catch (e) {
        toast('同步失败：' + e.message);
      } finally {
        await refreshHistoryView();
        btn.disabled = false;
      }
    });
  }

  if ($('#lockLogin')) $('#lockLogin').addEventListener('click', () => openAuth('login'));

  /* ---------------- 痛苦 & 情绪趋势 SVG 曲线图 ---------------- */
  function renderTrendChart(hist) {
    const box = $('#trendChart');
    if (!box) return;
    if (!hist.length) { box.innerHTML = ''; return; }

    /* 时间正序（旧 → 新） */
    const rows = hist.slice().reverse().map((r) => ({
      at: r.at,
      pain: r.snap ? PAIN_SCORE[r.snap.pain] : (r.painScore != null ? r.painScore : null),
      emo: r.snap ? r.snap.intensity : (r.intensity != null ? r.intensity : null)
    }));
    const n = rows.length;
    const W = 720, H = 300, PL = 46, PR = 22, PT = 44, PB = 42;
    const pw = W - PL - PR, ph = H - PT - PB;
    const X = (i) => PL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = (v) => PT + ph - (v / 10) * ph;

    let svg = '<svg viewBox="0 0 720 300" role="img" aria-label="痛苦与情绪趋势曲线图">';

    /* 网格 + 纵轴刻度 */
    for (let v = 0; v <= 10; v += 2) {
      const y = Y(v);
      svg += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '" stroke="#e6eeec"/>';
      svg += '<text x="' + (PL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#8aa0a2">' + v + '</text>';
    }
    /* 横轴方向提示 */
    svg += '<text x="' + PL + '" y="' + (H - 8) + '" font-size="11" fill="#6d8388">← 较早</text>';
    svg += '<text x="' + (W - PR) + '" y="' + (H - 8) + '" text-anchor="end" font-size="11" fill="#6d8388">最近 →</text>';
    /* 日期刻度（最多约 8 个） */
    const tickStep = Math.max(1, Math.ceil(n / 8));
    rows.forEach((r, i) => {
      if (i % tickStep !== 0 && i !== n - 1) return;
      const d = new Date(r.at);
      if (isNaN(d)) return;
      svg += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 24) + '" text-anchor="middle" font-size="10.5" fill="#8aa0a2">' +
        (d.getMonth() + 1) + '/' + d.getDate() + '</text>';
    });

    /* 折线（缺失值处分段） + 数据点（hover 显示数值） */
    const drawLine = (key, color, label) => {
      let out = '';
      let seg = [];
      const flush = () => {
        if (seg.length >= 2) {
          out += '<polyline points="' + seg.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        seg = [];
      };
      rows.forEach((r, i) => {
        const v = r[key];
        if (v == null) { flush(); return; }
        seg.push(X(i).toFixed(1) + ',' + Y(v).toFixed(1));
      });
      flush();
      rows.forEach((r, i) => {
        const v = r[key];
        if (v == null) return;
        const d = new Date(r.at);
        const tip = (isNaN(d) ? '' : ((d.getMonth() + 1) + '/' + d.getDate() + ' ')) + label + ' ' + v + ' / 10';
        out += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="3.4" fill="#fff" stroke="' + color + '" stroke-width="2"><title>' + esc(tip) + '</title></circle>';
      });
      return out;
    };
    svg += drawLine('pain', '#d1708c', '痛苦程度');
    svg += drawLine('emo', '#37a08d', '情绪影响');

    /* 图例 */
    svg += '<g font-size="12.5">' +
      '<rect x="' + PL + '" y="12" width="158" height="22" rx="11" fill="#f6faf9" stroke="#e2ebe9"/>' +
      '<line x1="' + (PL + 10) + '" y1="23" x2="' + (PL + 30) + '" y2="23" stroke="#d1708c" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="' + (PL + 20) + '" cy="23" r="3" fill="#fff" stroke="#d1708c" stroke-width="1.6"/>' +
      '<text x="' + (PL + 38) + '" y="27" fill="#41585c">痛苦程度</text>' +
      '<line x1="' + (PL + 96) + '" y1="23" x2="' + (PL + 116) + '" y2="23" stroke="#37a08d" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="' + (PL + 106) + '" cy="23" r="3" fill="#fff" stroke="#37a08d" stroke-width="1.6"/>' +
      '<text x="' + (PL + 124) + '" y="27" fill="#41585c">情绪影响</text>' +
      '</g>';

    svg += '</svg>';
    box.innerHTML = svg +
      '<p class="trend-note">纵轴 0～10 分；痛苦程度按经期疼痛等级换算（无痛 0 · 轻微 3 · 中度 6 · 重度 9），情绪影响取自评影响程度。共 ' + n + ' 次记录' +
      (n < 2 ? '，建议再完成 1 次自评以观察趋势。' : '，鼠标悬停数据点可查看具体数值。') + '</p>';
  }

  /* 未填日期时，尝试用周期记录补全 */
  (function prefillDate() {
    const recs = LS.get('hx_records', []);
    if (recs.length) {
      $('#lastPeriod').value = recs[0].date;
      $('#toolDate').value = new Date().toISOString().slice(0, 10);
    } else {
      $('#toolDate').value = new Date().toISOString().slice(0, 10);
      const d = new Date(); d.setDate(d.getDate() - 14);
      $('#lastPeriod').value = d.toISOString().slice(0, 10);
    }
  })();

  /* ---------------------------------------------------------
     3. 核心功能二：生理知识科普
     --------------------------------------------------------- */
  const KB = [
    /* ---- 周期基础 ---- */
    {
      id: 'cycle-basics', cat: '周期基础', title: '月经周期是怎样运转的', tags: ['激素', '周期', '基础'],
      summary: '一次周期平均 28 天，由下丘脑—垂体—卵巢轴调控，分为月经期、卵泡期、排卵期、黄体期四个阶段。',
      body: [
        ['p', '月经是子宫内膜在激素周期性变化下脱落出血的现象。周期从月经第 1 天算起，到下次月经前一天结束。'],
        ['h', '四个阶段与主要激素'],
        ['ul', [
          '月经期（第 1～5 天）：雌激素、孕激素降至最低，内膜脱落出血，常伴小腹坠胀与疲乏。',
          '卵泡期（第 6～13 天）：卵泡发育，雌激素逐步升高，情绪与体力通常回升。',
          '排卵期（约第 14 天）：LH 峰触发排卵，部分人出现一侧下腹短暂疼痛或分泌物变多、拉丝。',
          '黄体期（第 15～28 天）：黄体分泌孕激素，基础体温升高 0.3～0.5℃，经前出现 PMS 症状。'
        ]],
        ['note', '周期 21～35 天都属常见范围；初潮后 1～2 年和围绝经期波动更大。']
      ]
    },
    {
      id: 'cycle-length', cat: '周期基础', title: '周期多少天算正常', tags: ['周期长度', '异常'],
      summary: '21～35 天为常见范围，周期长度前后波动 7 天以内都算规律。',
      body: [
        ['ul', [
          '＜ 21 天为周期过短，可能与黄体功能不足、甲状腺功能异常有关。',
          '＞ 35 天为周期过长，常见于多囊卵巢综合征、高泌乳素血症、体重剧烈变化。',
          '连续 3 个周期都超出范围，或周期突然改变超过 7 天，建议就诊。'
        ]],
        ['note', '压力、熬夜、节食、剧烈运动都会让周期暂时紊乱，通常调整生活节律后可恢复。']
      ]
    },
    {
      id: 'menarche-menopause', cat: '周期基础', title: '初潮与围绝经期的特殊变化', tags: ['初潮', '围绝经期'],
      summary: '初潮后 2 年内和围绝经期，周期不规律多为生理现象，但需排除其他病因。',
      body: [
        ['ul', [
          '初潮多在 10～15 岁；初潮后 1～2 年排卵不规律，周期可短可长。',
          '16 岁仍无月经、或 14 岁无第二性征发育，建议就诊。',
          '围绝经期常见周期缩短或延长、经量变化、潮热出汗、情绪波动。',
          '绝经后再次出血必须尽快就诊，排除内膜病变。'
        ]]
      ]
    },
    {
      id: 'normal-blood', cat: '周期基础', title: '正常的经量与经血颜色', tags: ['经量', '颜色'],
      summary: '一次经期总失血约 20～60 mL，颜色从暗红到鲜红都可见，血块少量属正常。',
      body: [
        ['ul', [
          '经量 ＜ 5 mL 为月经过少，＞ 80 mL 为月经过多；可用卫生巾更换频率粗略判断。',
          '每 1 小时就湿透一片日用卫生巾、或出现大量大血块，属于经量过多。',
          '经血偏暗、发棕多见于经期开始或结束时，是血液氧化所致，不必紧张。',
          '持续鲜红大量出血伴头晕心慌，应尽快就医。'
        ]]
      ]
    },
    {
      id: 'ovulation-signs', cat: '周期基础', title: '如何判断自己是否排卵', tags: ['排卵', '备孕', '体温'],
      summary: '基础体温双相、分泌物拉丝、排卵试纸由强阳转弱，都是排卵的间接证据。',
      body: [
        ['ol', [
          '每天醒来未活动前测基础体温，排卵后升高 0.3～0.5℃ 并维持到月经前。',
          '观察宫颈黏液：排卵期变得清亮、量多、可拉丝。',
          '排卵试纸在 LH 峰后 24～48 小时内排卵，强阳转弱提示即将或已经排卵。',
          '排卵期一侧下腹短暂刺痛（排卵痛）或少量出血也可作为参考。'
        ]],
        ['note', '安全期推算不可靠，不能作为避孕方法。']
      ]
    },

    /* ---- 经期护理 ---- */
    {
      id: 'pad-change', cat: '经期护理', title: '卫生巾多久换一次', tags: ['卫生巾', '感染', '卫生'],
      summary: '建议每 2～4 小时更换一次，无论血量多少，夜间不超过 8 小时。',
      body: [
        ['ul', [
          '经血是细菌的良好培养基，长时间不换会升高外阴阴道感染与异味风险。',
          '经量少的日子也应保持 3～4 小时更换一次。',
          '更换前洗手，由前向后擦拭，避免把肛周细菌带到阴道口。',
          '经期避免盆浴、泡温泉与泳池长时间浸泡。'
        ]],
        ['note', '出现瘙痒、灼痛、分泌物异味，停止使用当前品牌并就诊，可能是过敏或感染。']
      ]
    },
    {
      id: 'tss-warning', cat: '经期护理', title: '警惕中毒性休克综合征（TSS）', tags: ['TSS', '卫生棉条', '急症'],
      summary: '卫生棉条放置过久可能引发 TSS，表现为高热、皮疹、呕吐、头晕，属急症。',
      body: [
        ['ul', [
          '棉条建议 4～8 小时内更换，夜间改用卫生巾。',
          'TSS 早期表现：突发高热 ＞ 38.9℃、晒伤样皮疹、肌肉酸痛、呕吐腹泻、头晕甚至晕厥。',
          '一旦怀疑，立即取出棉条并急诊就医，不要等待观察。'
        ]]
      ]
    },
    {
      id: 'sleep-cycle', cat: '经期护理', title: '经期睡不好怎么办', tags: ['睡眠', '护理'],
      summary: '经期疼痛、激素波动和体温变化都会影响睡眠，可用热敷、规律作息和减少刺激改善。',
      body: [
        ['ul', [
          '睡前 1 小时热敷下腹 15～20 分钟，有助于缓解痛经与促进入睡。',
          '固定起床时间，午睡不超过 30 分钟。',
          '下午后避免咖啡、浓茶与酒精，睡前减少屏幕蓝光。',
          '疼痛明显时可在医生或药师指导下提前 1 天使用止痛药，效果优于忍痛。'
        ]]
      ]
    },

    /* ---- 痛经与不适 ---- */
    {
      id: 'dysmenorrhea', cat: '痛经与不适', title: '痛经的分类与应对', tags: ['痛经', '前列腺素'],
      summary: '原发性痛经由前列腺素升高引起，继发性痛经多由子宫内膜异位症、腺肌症等疾病导致。',
      body: [
        ['h', '原发性痛经'],
        ['ul', [
          '多在初潮后 1～2 年内出现，疼痛集中在月经第 1～2 天，呈痉挛性。',
          '热敷、规律有氧运动、充足睡眠可缓解。',
          '非甾体抗炎药（如布洛芬）在疼痛刚开始时使用效果最好，需按说明书或医嘱。'
        ]],
        ['h', '继发性痛经的信号'],
        ['ul', [
          '疼痛逐年加重、经期外也痛、性交痛、经量明显增多。',
          '止痛药效果越来越差，或伴随不孕。',
          '出现以上情况应做妇科检查与超声，明确是否有子宫内膜异位症、腺肌症、子宫肌瘤。'
        ]]
      ]
    },
    {
      id: 'heat-therapy', cat: '痛经与不适', title: '热敷为什么能缓解痛经', tags: ['热敷', '非药物'],
      summary: '持续 39～40℃ 局部热敷可改善盆腔血流、放松子宫平滑肌，效果接近部分止痛药。',
      body: [
        ['ul', [
          '使用热水袋或暖宫贴，隔一层衣物，每次 20～30 分钟。',
          '注意防止低温烫伤，糖尿病或感觉减退者慎用。',
          '泡温水脚、喝温热的姜枣茶也有辅助放松作用。'
        ]]
      ]
    },
    {
      id: 'headache-backpain', cat: '痛经与不适', title: '经期头痛、腰酸、乳房胀痛', tags: ['头痛', '腰酸', '乳房胀痛'],
      summary: '多为激素波动与前列腺素作用所致，可通过规律作息、减盐、适度运动减轻。',
      body: [
        ['ul', [
          '经期头痛与雌激素骤降有关，规律睡眠与充足饮水有帮助，必要时就医用药。',
          '腰酸可做温和的骨盆前后倾与猫牛式拉伸，避免久坐。',
          '乳房胀痛可换无钢圈支撑内衣、减少咖啡因与高盐饮食。',
          '若乳房出现固定肿块或单侧溢液，需乳腺专科检查。'
        ]]
      ]
    },

    /* ---- 经期营养 ---- */
    {
      id: 'iron-rich', cat: '经期营养', title: '经期补铁怎么吃', tags: ['补铁', '贫血', '饮食'],
      summary: '经量多的人容易缺铁，红肉、动物血、肝脏搭配维生素 C 可提高吸收率。',
      body: [
        ['ul', [
          '血红素铁（红肉、动物血、肝脏）吸收率高于植物铁（菠菜、黑木耳、红豆）。',
          '同餐搭配富含维生素 C 的果蔬（彩椒、猕猴桃、橙子）可提升吸收。',
          '茶、咖啡中的鞣酸会抑制铁吸收，建议与正餐间隔 1 小时以上。',
          '出现乏力、心慌、面色苍白、指甲脆薄，建议查血常规与铁蛋白。'
        ]]
      ]
    },
    {
      id: 'magnesium-b6', cat: '经期营养', title: '镁、钙与维生素 B6 对经前症状的帮助', tags: ['PMS', '镁', '钙'],
      summary: '多项研究提示补充钙、镁与维生素 B6 可减轻经前情绪波动、腹胀与乳房胀痛。',
      body: [
        ['ul', [
          '富含镁：坚果、深绿色蔬菜、全谷物、黑巧克力（≥70%）。',
          '富含钙：奶制品、豆制品、小鱼干、芝麻。',
          '富含维生素 B6：香蕉、鸡肉、鱼类、土豆、鹰嘴豆。',
          '优先从饮食获取，需要补充剂时请咨询医生或药师。'
        ]]
      ]
    },
    {
      id: 'salt-caffeine', cat: '经期营养', title: '经期要少盐少咖啡因', tags: ['水钠潴留', '咖啡因'],
      summary: '高盐加重水肿与乳房胀痛，咖啡因可能加重焦虑、心悸与乳房敏感。',
      body: [
        ['ul', [
          '经前一周减少腌制食品、外卖重口味、含钠饮料。',
          '咖啡因每日控制在 200 mg 以内（约 1 杯美式）。',
          '多喝温水有助于减轻水钠潴留带来的浮肿感。'
        ]]
      ]
    },
    {
      id: 'warm-diet', cat: '经期营养', title: '经期能喝冷饮、吃冰吗', tags: ['冷饮', '误区'],
      summary: '没有证据表明所有女性经期必须忌冰，但若你每次吃冰后痛经加重，就应避免。',
      body: [
        ['ul', [
          '不适反应存在明显个体差异，可自我观察 2～3 个周期再决定。',
          '若痛经明显、容易腹泻或有胃肠道敏感，建议改成温热饮品。',
          '真正影响更大的是睡眠不足、压力与不规律饮食。'
        ]]
      ]
    },

    /* ---- 经期运动 ---- */
    {
      id: 'exercise-period', cat: '经期运动', title: '经期能不能运动', tags: ['运动', '瑜伽'],
      summary: '可以，而且适度运动能减轻痛经和经前情绪症状；以中低强度、自己舒服为准。',
      body: [
        ['ul', [
          '推荐：快走、慢跑、游泳（用棉条）、瑜伽、普拉提、拉伸。',
          '避免：大重量深蹲硬拉、倒立、剧烈跳跃、腹部高压动作。',
          '经量最多的前 2 天可降低强度，把运动变成散步与拉伸。',
          '出现头晕、心慌、剧痛立即停止。'
        ]]
      ]
    },
    {
      id: 'yoga-routine', cat: '经期运动', title: '缓解痛经的 5 个瑜伽动作', tags: ['瑜伽', '痛经'],
      summary: '婴儿式、猫牛式、仰卧束角式、靠墙抬腿、骨盆倾斜，每天 10 分钟即可。',
      body: [
        ['ol', [
          '婴儿式：跪坐前俯，额头贴垫，保持 5 次深呼吸。',
          '猫牛式：四足跪姿，随呼吸交替拱背与塌腰，10 组。',
          '仰卧束角式：脚掌相对、膝向两侧打开，垫高背部，休息 2 分钟。',
          '靠墙抬腿：臀部贴墙、双腿向上，5 分钟，减轻下肢沉重感。',
          '骨盆倾斜：仰卧屈膝，缓慢前后倾骨盆，15 次。'
        ]]
      ]
    },
    {
      id: 'pelvic-floor', cat: '经期运动', title: '凯格尔运动与盆底健康', tags: ['盆底肌', '凯格尔'],
      summary: '规律的盆底肌训练有助于改善经期坠胀感、产后漏尿与性生活质量。',
      body: [
        ['ol', [
          '找到盆底肌：想象排尿中途憋住所用的肌肉，不要屏气或收紧腹部与臀部。',
          '收紧 3～5 秒，完全放松 3～5 秒，为一组。',
          '每天 3 组、每组 10 次，坚持 8～12 周见效。',
          '经量最多的日子可减量，不必完全停止。'
        ]]
      ]
    },

    /* ---- 情绪与 PMS ---- */
    {
      id: 'pms', cat: '情绪与 PMS', title: '经前综合征（PMS）是什么', tags: ['PMS', '情绪', '黄体期'],
      summary: '黄体期出现的情绪、身体与行为症状群，月经来潮后缓解，影响生活时需干预。',
      body: [
        ['ul', [
          '常见表现：易怒、低落、焦虑、注意力差、乳房胀痛、腹胀、水肿、食欲改变、痘痘。',
          '关键特征是「周期性出现、月经后缓解」，可连续记录 2～3 个周期来确认。',
          '规律运动、减盐减咖啡因、保证睡眠、补充钙镁 B6 是基础措施。',
          '症状严重影响工作与人际关系时，需就医评估是否为 PMDD（经前焦虑障碍）。'
        ]]
      ]
    },
    {
      id: 'pmdd', cat: '情绪与 PMS', title: '经前焦虑障碍（PMDD）需要专业帮助', tags: ['PMDD', '抑郁', '就医'],
      summary: 'PMDD 是 PMS 的严重形式，情绪症状突出，需要精神心理科与妇科协作治疗。',
      body: [
        ['ul', [
          '表现为明显的抑郁、易怒、焦虑、绝望感，甚至出现自伤念头。',
          '症状在黄体期出现、月经开始后数天内明显缓解。',
          '治疗包括认知行为治疗、SSRI 类药物、激素治疗等，需医生评估。',
          '出现自伤念头请立即联系心理援助热线 12356 或前往急诊。'
        ]]
      ]
    },
    {
      id: 'emotion-cycle', cat: '情绪与 PMS', title: '情绪随周期起伏是正常的', tags: ['情绪', '激素', '自我观察'],
      summary: '雌激素与孕激素的波动会影响神经递质，情绪随周期变化有明确的生理基础。',
      body: [
        ['ul', [
          '雌激素影响血清素与多巴胺，黄体期激素骤降时情绪更容易低落、易怒。',
          '记录「日期 + 情绪 + 睡眠 + 疼痛」4 项，2 个月就能看出自己的规律。',
          '知道「这是激素在起作用」本身就能降低一部分焦虑。',
          '把重要决定尽量安排在卵泡期，是很多人用过的小技巧。'
        ]]
      ]
    },
    {
      id: 'mindfulness', cat: '情绪与 PMS', title: '经期可用的 3 个正念练习', tags: ['正念', '冥想', '呼吸'],
      summary: '4-7-8 呼吸、身体扫描、情绪命名，都是随时可做、无需设备的方法。',
      body: [
        ['ol', [
          '4-7-8 呼吸：吸气 4 秒、屏息 7 秒、呼气 8 秒，做 4 轮。',
          '身体扫描：从脚趾到头顶逐段觉察，每段停留 3 次呼吸。',
          '情绪命名：说出「我现在感到焦虑」，把情绪从「我」中分离出来。'
        ]],
        ['note', '蕙心网核心功能一的正念冥想分支，就是把这三种练习按当下状态推荐给你。']
      ]
    },

    /* ---- 经期卫生用品 ---- */
    {
      id: 'product-compare', cat: '卫生用品', title: '卫生巾、棉条、月经杯怎么选', tags: ['卫生巾', '棉条', '月经杯'],
      summary: '按经量、活动场景与个人舒适度选择，注意更换时间与清洁。',
      body: [
        ['table', [['类型', '优点', '注意'], ['卫生巾', '易上手、无内置风险', '每 2～4 小时更换'], ['卫生棉条', '可游泳运动、体感干爽', '4～8 小时必须更换，警惕 TSS'], ['月经杯', '可重复使用、经济环保', '需消毒、容量与放置技巧有学习成本'], ['安睡裤', '夜间防漏省心', '不宜长期连续穿着过久']]]
      ]
    },
    {
      id: 'pad-allergy', cat: '卫生用品', title: '外阴瘙痒、过敏怎么办', tags: ['过敏', '瘙痒', '护理'],
      summary: '先停用可疑产品，保持清洁干燥，避免搔抓与热水烫洗，必要时就医。',
      body: [
        ['ul', [
          '换用无香型、棉柔表层的产品，避免含药物或香精的护垫。',
          '每天用温水清洗外阴一次即可，不要冲洗阴道内部。',
          '穿宽松透气的纯棉内裤，勤换洗并在阳光下晾晒。',
          '症状持续 3 天以上或伴异常分泌物，请做白带常规检查。'
        ]]
      ]
    },
    {
      id: 'disposal', cat: '卫生用品', title: '用过的卫生用品的正确处理', tags: ['卫生', '环保'],
      summary: '卷起包好再丢弃，不冲入马桶；月经杯按说明清洗消毒后重复使用。',
      body: [
        ['ul', [
          '卫生巾与棉条应包裹后丢入垃圾桶，冲入马桶易造成堵塞与污染。',
          '月经杯每次倒空后用清水冲洗，经期结束后煮沸消毒 5 分钟。',
          '公共场所注意手部清洁，减少感染机会。'
        ]]
      ]
    },

    /* ---- 常见误区 ---- */
    {
      id: 'myth-wash', cat: '常见误区', title: '误区：经期不能洗头洗澡', tags: ['误区', '洗澡'],
      summary: '可以洗，而且应该洗；用温水淋浴、及时吹干头发即可，避免盆浴与受凉。',
      body: [
        ['ul', [
          '经期保持清洁能降低感染风险，淋浴比盆浴更安全。',
          '水温以 38～40℃ 为宜，时间不宜过长，避免空腹或疲劳时洗澡。',
          '洗后及时擦干、吹干头发，注意保暖，不必因此忍着不洗。'
        ]]
      ]
    },
    {
      id: 'myth-cold', cat: '常见误区', title: '误区：经期一定不能吃冰、不能运动', tags: ['误区', '运动', '饮食'],
      summary: '没有普适禁令，个体耐受差异大，关键是观察自己的反应而不是硬套禁忌。',
      body: [
        ['ul', [
          '没有证据表明经期吃冰对所有女性有害。',
          '适度运动反而能缓解痛经与经前情绪症状。',
          '真正需要避免的是熬夜、酗酒、剧烈减重等打乱内分泌的行为。'
        ]]
      ]
    },
    {
      id: 'myth-pain', cat: '常见误区', title: '误区：痛经忍一忍就过去了', tags: ['误区', '痛经', '就医'],
      summary: '原发性痛经可有效治疗，继发性痛经越早诊断越好，忍耐不是美德。',
      body: [
        ['ul', [
          '止痛药在疼痛开始时使用效果最好，不必强忍到极限。',
          '疼痛逐年加重、经期外也痛，提示可能存在子宫内膜异位症等疾病。',
          '长期忍痛会影响睡眠、情绪与工作效率，还会延误诊断。'
        ]]
      ]
    },
    {
      id: 'myth-safety', cat: '常见误区', title: '误区：安全期避孕很可靠', tags: ['误区', '避孕'],
      summary: '排卵受压力、疾病、作息影响会提前或推迟，安全期推算失败率很高。',
      body: [
        ['ul', [
          '精子在体内可存活 3～5 天，排卵日前后都是高风险期。',
          '可靠方式包括避孕套、短效口服避孕药、宫内节育器、皮下埋植等。',
          '需要避孕方案建议咨询妇科医生，按自身健康状况选择。'
        ]]
      ]
    },
    {
      id: 'myth-detox', cat: '常见误区', title: '误区：经血是「排毒」', tags: ['误区', '经血'],
      summary: '经血是子宫内膜脱落与血液的混合物，与体内毒素无关，量的多少不代表排毒效果。',
      body: [
        ['ul', [
          '人体代谢废物主要由肝脏、肾脏处理，通过尿液与粪便排出。',
          '经量过少或过多都可能是内分泌或器质性问题的信号。',
          '不必购买宣称「排毒养颜」的经期产品。'
        ]]
      ]
    },
    {
      id: 'myth-3days', cat: '常见误区', title: '误区：经期只有 3 天才算正常', tags: ['误区', '经期长度'],
      summary: '经期 2～7 天都属正常，关键是与自己以往比较是否发生明显改变。',
      body: [
        ['ul', [
          '经期长度受年龄、激素、体重、用药影响。',
          '经期 ＞ 10 天或 ＜ 1 天，建议就诊评估。',
          '关注趋势变化比追求某个「标准天数」更有意义。'
        ]]
      ]
    },

    /* ---- 就医与检查 ---- */
    {
      id: 'when-to-see', cat: '就医与检查', title: '什么情况必须去看妇科', tags: ['就医指征', '红旗信号'],
      summary: '大量出血、剧痛、发热、晕厥、绝经后出血、周期长期紊乱，都需要及时就诊。',
      body: [
        ['ul', [
          '1 小时湿透一片卫生巾并持续 2 小时以上，或经期超过 10 天。',
          '突发剧烈下腹痛，伴发热、呕吐或晕厥。',
          '月经推迟超过 10 天且有性生活史（需排除妊娠相关情况）。',
          '继发性闭经：原本规律，连续 3 个周期以上无月经。',
          '绝经后任何阴道出血。',
          '痛经逐年加重、性交痛、经量突然大幅增多。'
        ]],
        ['note', '就诊时带上 2～3 个周期的记录（日期、经量、疼痛、情绪），能显著提高沟通效率。']
      ]
    },
    {
      id: 'checkups', cat: '就医与检查', title: '常见妇科检查有哪些', tags: ['检查', '超声', '激素'],
      summary: '妇科超声、白带常规、性激素六项、甲状腺功能、血常规是月经问题的常用检查。',
      body: [
        ['table', [['检查', '用途', '时机'], ['妇科超声', '看子宫、内膜、卵巢与肌瘤囊肿', '经期结束 3～7 天'], ['性激素六项', '评估卵巢功能与内分泌', '月经第 2～5 天（按医嘱）'], ['甲状腺功能', '排除甲减/甲亢导致的月经紊乱', '任意时间'], ['血常规 + 铁蛋白', '判断是否缺铁性贫血', '任意时间'], ['白带常规', '判断阴道感染类型', '非经期']]]
      ]
    },
    {
      id: 'pcos', cat: '就医与检查', title: '多囊卵巢综合征（PCOS）', tags: ['PCOS', '内分泌', '月经稀发'],
      summary: '以月经稀发、高雄激素表现和卵巢多囊样改变为特征，需要长期管理。',
      body: [
        ['ul', [
          '常见表现：周期 ＞ 35 天或闭经、痤疮、多毛、体重增加、备孕困难。',
          '诊断需结合月经史、激素检查与超声，并排除其他疾病。',
          '管理核心：体重管理、规律运动、必要时用药物调整周期与代谢。',
          'PCOS 与胰岛素抵抗、远期代谢风险相关，建议定期随访。'
        ]]
      ]
    },
    {
      id: 'endo', cat: '就医与检查', title: '子宫内膜异位症与腺肌症', tags: ['内异症', '腺肌症', '痛经'],
      summary: '子宫内膜样组织出现在子宫腔以外，典型表现是进行性加重的痛经与不孕。',
      body: [
        ['ul', [
          '常见症状：痛经逐年加重、性交痛、排便痛、慢性盆腔痛、备孕困难。',
          '诊断依靠病史、妇科检查与影像，必要时腹腔镜。',
          '治疗包括止痛药、激素药物、手术等，需个体化方案。',
          '长期拖延可能影响生育与生活质量，早诊早治很重要。'
        ]]
      ]
    },
    {
      id: 'abnormal-bleeding', cat: '就医与检查', title: '异常子宫出血的常见原因', tags: ['异常出血', 'AUB'],
      summary: '按 PALM-COEIN 分类，结构性原因（息肉、肌瘤、腺肌症、恶性）与功能性原因并存。',
      body: [
        ['ul', [
          '结构性问题：子宫内膜息肉、子宫肌瘤、腺肌症、内膜病变。',
          '功能性问题：排卵障碍、凝血功能异常、内膜局部止血异常、医源性（如避孕药、节育器）。',
          '评估包括血常规、凝血、激素、超声，必要时内膜活检。',
          '出现大出血伴头晕心慌请直接急诊。'
        ]]
      ]
    },
    {
      id: 'mental-support', cat: '就医与检查', title: '什么时候该找心理咨询', tags: ['心理咨询', '支持资源'],
      summary: '情绪持续两周以上、影响睡眠进食与工作，或出现自伤念头时，应尽快寻求专业支持。',
      body: [
        ['ul', [
          '可及资源：学校心理健康中心、正规医院精神心理科／临床心理科、全国心理援助热线 12356。',
          '就医时可携带蕙心网的自评结果与周期记录，帮助医生了解情绪与月经的关联。',
          '心理咨询不是「脆弱」的表现，而是有效的健康管理方式。',
          '若出现自伤或自杀念头，请立即联系热线或前往急诊，不要独自承受。'
        ]]
      ]
    }
  ];

  /* ---------------- 科普卡展示状态 ---------------- */
  let allCards = [];
  let kbCat = '全部';
  let kbQ = '';
  let kbView = LS.get('hx_kbview', 'grid');   // grid | carousel
  let carIndex = 0;
  let carPlaying = true;
  let carTimer = null;

  function kbCats() {
    const seen = [];
    allCards.forEach((k) => { if (seen.indexOf(k.cat) < 0) seen.push(k.cat); });
    return seen.sort();
  }

  function filteredCards() {
    const q = kbQ.trim().toLowerCase();
    return allCards.filter((k) => {
      if (kbCat !== '全部' && k.cat !== kbCat) return false;
      if (!q) return true;
      return (k.title + k.summary + k.tags.join('') + k.cat).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderFilters() {
    const box = $('#kbFilters');
    const cats = kbCats();
    let html = '<button type="button" data-cat="全部"' +
      (kbCat === '全部' ? ' class="is-on"' : '') + '>全部</button>';
    cats.forEach((c) => {
      const n = allCards.filter((k) => k.cat === c).length;
      html += '<button type="button" data-cat="' + esc(c) + '"' +
        (kbCat === c ? ' class="is-on"' : '') + '>' + esc(c) +
        ' <span aria-hidden="true">' + n + '</span></button>';
    });
    box.innerHTML = html;
  }

  function hl(text, q) {
    if (!q) return esc(text);
    const t = String(text);
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }

  function gridCardHtml(k, q) {
    return '<button type="button" class="kb-card" data-id="' + esc(String(k.id)) + '">' +
      '<span class="cat">' + esc(k.cat) + '</span>' +
      '<h3>' + hl(k.title, q) + '</h3>' +
      '<p>' + hl(k.summary, q) + '</p>' +
      '<span class="more">查看详情 →</span>' +
      '</button>';
  }

  /* ---------------- 轮播 ---------------- */
  function stopAuto() {
    if (carTimer) { clearInterval(carTimer); carTimer = null; }
  }

  function startAuto() {
    stopAuto();
    if (!carPlaying) return;
    carTimer = setInterval(() => advanceCar(1), 4500);
  }

  function advanceCar(dir) {
    const list = filteredCards();
    if (!list.length) return;
    carIndex = (carIndex + dir + list.length) % list.length;
    renderCarousel(list);
  }

  function renderCarousel(list) {
    const stage = $('#carStage');
    const k = list[carIndex];
    if (!k) {
      stage.innerHTML = '';
      $('#carDots').innerHTML = '';
      $('#carPos').textContent = '';
      return;
    }
    stage.innerHTML =
      '<button type="button" class="car-card" data-id="' + esc(String(k.id)) + '">' +
      '<span class="cat">' + esc(k.cat) + '</span>' +
      '<h3>' + esc(k.title) + '</h3>' +
      '<p>' + esc(k.summary) + '</p>' +
      '<span class="more">查看详情 →</span>' +
      '</button>';
    $('.car-card', stage).addEventListener('click', () => openArticle(k.id));

    $('#carDots').innerHTML = list.map((x, i) =>
      '<button type="button" data-i="' + i + '"' +
      (i === carIndex ? ' class="is-on" aria-label="第 ' + (i + 1) + ' 张（当前）"' :
                        ' aria-label="第 ' + (i + 1) + ' 张"') + '></button>').join('');
    $$('#carDots button').forEach((b) => b.addEventListener('click', () => {
      carIndex = Number(b.getAttribute('data-i'));
      renderCarousel(list);
      startAuto();
    }));
    $('#carPos').textContent = '第 ' + (carIndex + 1) + ' / ' + list.length + ' 张';
    $('#carPlay').textContent = carPlaying ? '暂停自动播放' : '开始自动播放';
  }

  /* ---------------- 渲染（两种视图同时产出，由 hidden 控制） ---------------- */
  function renderKB() {
    const q = kbQ.trim();
    const list = filteredCards();
    $('#kbCount').textContent = '共 ' + list.length + ' 条知识' +
      (kbCat === '全部' ? '' : ' · 分类：' + kbCat) +
      (q ? ' · 关键词：' + q : '');
    $('#kbEmpty').hidden = list.length > 0;

    $('#kbGrid').innerHTML = list.map((k) => gridCardHtml(k, q)).join('');
    $$('.kb-card', $('#kbGrid')).forEach((b) => {
      b.addEventListener('click', () => openArticle(b.getAttribute('data-id')));
    });

    if (carIndex > list.length - 1) carIndex = Math.max(0, list.length - 1);
    renderCarousel(list);
  }

  function setKBView(v) {
    kbView = v;
    LS.set('hx_kbview', v);
    $$('#kbViewToggle button').forEach((b) =>
      b.classList.toggle('is-on', b.getAttribute('data-view') === v));
    $('#kbGrid').hidden = v !== 'grid';
    $('#kbCarousel').hidden = v !== 'carousel';
    if (v === 'carousel') startAuto();
    else stopAuto();
  }

  function blocksToHtml(blocks) {
    let out = '';
    blocks.forEach((b) => {
      const type = b[0], val = b[1];
      if (type === 'p') out += '<p>' + esc(val) + '</p>';
      else if (type === 'h') out += '<h3>' + esc(val) + '</h3>';
      else if (type === 'note') out += '<blockquote>' + esc(val) + '</blockquote>';
      else if (type === 'ul') out += '<ul>' + val.map((li) => '<li>' + esc(li) + '</li>').join('') + '</ul>';
      else if (type === 'ol') out += '<ol>' + val.map((li) => '<li>' + esc(li) + '</li>').join('') + '</ol>';
      else if (type === 'table') out += '<table><thead><tr>' + val[0].map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
        val.slice(1).map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    });
    return out;
  }

  async function openArticle(id) {
    /* 记录卡片点击量 */
    Promise.resolve(svc.click('card', String(id))).catch(() => {});
    let k = allCards.filter((x) => String(x.id) === String(id))[0];
    if (!k) return;
    if (!k.body) {
      try {
        const detail = await svc.card(k.id);
        const idx = allCards.indexOf(k);
        if (idx >= 0) allCards[idx] = detail;
        k = detail;
      } catch (e) { /* 使用已有摘要 */ }
    }
    $('#modalBody').innerHTML =
      '<div class="modal-body">' +
      '<span class="cat tag tag-rose">' + esc(k.cat) + '</span>' +
      '<h2 id="modalTitle">' + esc(k.title) + '</h2>' +
      '<p class="muted">' + esc(k.summary) + '</p>' +
      '<div class="modal-tags">' + k.tags.map((t) => '<span class="tag tag-soft">#' + esc(t) + '</span>').join('') + '</div>' +
      (k.body ? blocksToHtml(k.body) : '<p class="muted">正文暂未加载。</p>') +
      '<p class="modal-foot">本条目为健康教育内容，不构成诊断或处方。个体差异较大，具体问题请咨询执业医师。</p>' +
      '</div>';
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('.modal-close').focus();
  }

  function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }

  $$('#modal [data-close]').forEach((el) => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  $('#kbSearch').addEventListener('input', (e) => {
    kbQ = e.target.value;
    renderKB();
  });

  $('#kbFilters').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    kbCat = b.getAttribute('data-cat');
    renderFilters();
    renderKB();
    if (kbView === 'carousel') startAuto();
  });

  $('#kbViewToggle').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    setKBView(b.getAttribute('data-view'));
  });
  $('#carPrev').addEventListener('click', () => advanceCar(-1));
  $('#carNext').addEventListener('click', () => advanceCar(1));
  $('#carPlay').addEventListener('click', () => {
    carPlaying = !carPlaying;
    if (carPlaying) startAuto(); else stopAuto();
    $('#carPlay').textContent = carPlaying ? '暂停自动播放' : '开始自动播放';
  });

  /* ---------------- 投稿：生成知识卡片 ---------------- */
  let submitView = 'form';    // form | mine

  function openSubmit() {
    if (!me) {
      toast('请先登录，再生成知识卡片');
      openAuth('login');
      return;
    }
    submitView = 'form';
    renderSubmitModal();
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function renderSubmitModal() {
    if (submitView === 'mine') { renderMySubmissions(); return; }
    const cats = kbCats();
    $('#modalBody').innerHTML =
      '<div class="modal-body">' +
      '<span class="cat tag tag-rose">用户投稿</span>' +
      '<h2>生成生理知识卡片</h2>' +
      '<p class="muted">投稿通过管理员审核后会加入知识库，对全体用户可见。</p>' +
      '<form class="kb-form" id="submitForm" novalidate>' +
        '<div class="form-row">' +
          '<label>所属分类' +
            '<select id="fCat">' + cats.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select>' +
          '</label>' +
          '<label>卡片标题（2～60 字）<input type="text" id="fTitle" maxlength="60" placeholder="例如：经期可以洗头吗"></label>' +
        '</div>' +
        '<label>一句话摘要（可选，≤200 字）<input type="text" id="fSummary" maxlength="200"></label>' +
        '<label>标签（用逗号分隔，最多 6 个）<input type="text" id="fTags" placeholder="经期, 护理"></label>' +
        '<label>核心要点（每行一条，将以要点列表展示）' +
          '<textarea id="fPoints" rows="3"></textarea></label>' +
        '<label>详细说明（每行一段；将以正文段落展示）' +
          '<textarea id="fDetail" rows="4"></textarea></label>' +
        '<label>温馨提示（可选）<input type="text" id="fTip" placeholder="例如：症状持续请及时就医"></label>' +
        '<p class="form-error" id="fError"></p>' +
        '<button type="submit" class="btn btn-primary" id="fSubmitBtn">提交审核</button>' +
        '<button type="button" class="link-btn" id="fMyLink" style="justify-self:start">查看我的投稿状态 →</button>' +
      '</form></div>';

    $('#fMyLink').addEventListener('click', () => { submitView = 'mine'; renderSubmitModal(); });
    $('#submitForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#fError');
      err.textContent = '';
      const title = $('#fTitle').value.trim();
      if (title.length < 2) { err.textContent = '请填写至少 2 个字的标题'; return; }
      const pts = $('#fPoints').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const paras = $('#fDetail').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const tip = $('#fTip').value.trim();
      const body = [];
      if (pts.length) body.push(['ul', pts]);
      paras.forEach((t) => body.push(['p', t]));
      if (tip) body.push(['note', tip]);
      if (!body.length) { err.textContent = '请至少填写「核心要点」或「详细说明」'; return; }

      const tags = $('#fTags').value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      const payload = {
        cat: $('#fCat').value,
        title: title,
        summary: $('#fSummary').value.trim() || (paras[0] || pts[0] || '').slice(0, 80),
        tags: tags, body: body
      };
      const btn = $('#fSubmitBtn');
      btn.disabled = true;
      try {
        await svc.submitCard(payload);
        closeModal();
        toast('卡片已提交，等待管理员审核');
        updateReviewBadge();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  const STATUS_TAG = {
    pending: ['tag-soft', '待审核'],
    approved: ['tag', '已通过'],
    rejected: ['tag tag-rose', '未通过']
  };

  async function renderMySubmissions() {
    let cards = [];
    try { cards = await svc.myCards(); } catch (e) { /* */ }
    $('#modalBody').innerHTML =
      '<div class="modal-body">' +
      '<span class="cat tag tag-rose">我的投稿</span>' +
      '<h2>我的投稿状态</h2>' +
      (cards.length === 0
        ? '<p class="muted">还没有投稿，去生成第一张知识卡片吧。</p>'
        : '<div class="review-list">' + cards.map((k) => {
            const st = STATUS_TAG[k.status] || STATUS_TAG.pending;
            return '<div class="review-item"><div class="review-head">' +
              '<b>' + esc(k.title) + '</b>' +
              '<span class="tag ' + st[0] + '">' + st[1] + '</span>' +
              '<span class="muted">' + esc(k.cat) + ' · ' + esc(fmtDT(k.created_at)) + '</span></div>' +
              (k.status === 'rejected' && k.reject_reason
                ? '<p class="muted">未通过原因：' + esc(k.reject_reason) + '</p>' : '') +
              '</div>';
          }).join('') + '</div>') +
      '<button type="button" class="btn btn-primary" id="fBackForm">＋ 生成新卡片</button>' +
      '</div>';
    $('#fBackForm').addEventListener('click', () => { submitView = 'form'; renderSubmitModal(); });
  }

  $('#kbSubmit').addEventListener('click', openSubmit);

  /* ---------------- 待审核角标 ---------------- */
  async function updateReviewBadge() {
    const badge = $('#kbReviewBadge');
    if (!badge) return;
    let n = 0;
    if (me && me.role === 'admin') {
      try { n = (await svc.admin.pending()).length; } catch (e) { n = 0; }
    }
    badge.textContent = String(n);
    badge.setAttribute('data-zero', n === 0 ? '1' : '0');
  }

  /* ---------------- 板块点击量统计 ---------------- */
  const SECTION_MAP = {
    '#top': 'hero', '#hero': 'hero', '#feature1': 'feature1',
    '#assessment': 'feature1', '#feature2': 'feature2',
    '#tools': 'tools', '#admin': 'admin'
  };
  document.addEventListener('click', (e) => {
    if (!svc) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    const t = SECTION_MAP[a.getAttribute('href')];
    if (!t) return;
    Promise.resolve(svc.click('section', t)).catch(() => {});
  });

  /* ---------------- KB 初始化 ---------------- */
  async function initKB() {
    try {
      allCards = await svc.cards();
    } catch (e) {
      allCards = [];
      toast('科普内容加载失败：' + e.message);
    }
    renderFilters();
    $$('#kbViewToggle button').forEach((b) =>
      b.classList.toggle('is-on', b.getAttribute('data-view') === kbView));
    $('#kbGrid').hidden = kbView !== 'grid';
    $('#kbCarousel').hidden = kbView !== 'carousel';
    renderKB();
    if (kbView === 'carousel') startAuto();

    /* #kb-xxx 直达：先匹配 slug，再匹配 id */
    const h = location.hash;
    if (h.indexOf('#kb-') === 0) {
      const key = h.slice(4);
      const k = allCards.filter((x) => x.slug === key || String(x.id) === key)[0];
      if (k) openArticle(k.id);
    }
  }

  /* ---------------------------------------------------------
     4. 周期工具
     --------------------------------------------------------- */
  const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parse = (s) => { const d = new Date(s + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; };
  const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);

  function loadRecords() { return LS.get('hx_records', []).filter((r) => r && r.date); }

  function renderRecords() {
    const recs = loadRecords();
    const box = $('#recordList');
    $('#toolClear').hidden = recs.length === 0;
    if (!recs.length) { box.innerHTML = '<li class="muted" style="justify-content:center">还没有记录</li>'; return; }
    box.innerHTML = recs.map((r, i) =>
      '<li><span>' + esc(r.date) + ' · 周期 ' + esc(String(r.cycle)) + ' 天 · 经期 ' + esc(String(r.period)) + ' 天</span>' +
      '<button class="del" type="button" data-i="' + i + '" aria-label="删除该记录">×</button></li>'
    ).join('');
    $$('#recordList .del').forEach((b) => b.addEventListener('click', () => {
      const recs2 = loadRecords();
      recs2.splice(Number(b.getAttribute('data-i')), 1);
      LS.set('hx_records', recs2);
      renderRecords(); renderPredict();
    }));
  }

  function renderPredict() {
    const box = $('#toolResult');
    const recs = loadRecords();
    if (!recs.length) {
      box.innerHTML = '<h3>预测结果</h3><p class="muted">还没有记录，先录入一次月经开始日期吧。</p>';
      return;
    }
    const sorted = recs.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const last = parse(sorted[0].date);
    const cycle = Number(sorted[0].cycle) || 28;
    const period = Number(sorted[0].period) || 5;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const next = addDays(last, cycle);
    const inDays = daysBetween(today, next);
    const ovu = addDays(last, Math.round(cycle / 2) - 1);
    const fertStart = addDays(ovu, -4);
    const fertEnd = addDays(ovu, 1);
    const pmsStart = addDays(next, -6);
    const curDay = ((daysBetween(last, today) % cycle) + cycle) % cycle + 1;
    const curStage = stageOf(curDay, cycle);

    let avgLine = '';
    if (sorted.length >= 2) {
      const gaps = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = parse(sorted[i + 1].date), b = parse(sorted[i].date);
        if (a && b) gaps.push(daysBetween(a, b));
      }
      if (gaps.length) {
        const avg = Math.round(gaps.reduce((s, x) => s + x, 0) / gaps.length);
        const min = Math.min.apply(null, gaps), max = Math.max.apply(null, gaps);
        avgLine = '<p class="muted small">根据 ' + recs.length + ' 次记录实测：平均周期 ' + avg + ' 天（' + min + '～' + max + ' 天）。波动超过 7 天建议就医评估。</p>';
      }
    }

    box.innerHTML =
      '<h3>预测结果</h3>' +
      '<div class="pred-grid">' +
      '<div class="pred"><b>' + fmt(next) + '</b><span>预计下次月经</span></div>' +
      '<div class="pred"><b>' + (inDays >= 0 ? ('还有 ' + inDays + ' 天') : ('已推迟 ' + Math.abs(inDays) + ' 天')) + '</b><span>距离下次经期</span></div>' +
      '<div class="pred"><b>' + fmt(ovu) + '</b><span>预计排卵日</span></div>' +
      '<div class="pred"><b>' + fmt(fertStart) + ' ～ ' + fmt(fertEnd) + '</b><span>易孕期（推算）</span></div>' +
      '<div class="pred"><b>' + fmt(pmsStart) + ' 起</b><span>PMS 情绪易波动窗口</span></div>' +
      '<div class="pred"><b>第 ' + curDay + ' 天</b><span>今天处于：' + curStage + '</span></div>' +
      '</div>' +
      phaseBars(curDay, cycle) +
      avgLine +
      '<p class="muted small" style="margin-top:10px">预测基于历史平均推算，个体差异大，不能用于避孕或备孕决策。若周期突然改变超过 7 天或经量明显异常，请就诊。</p>';
  }

  function phaseBars(day, cycle) {
    const period = 5;
    const ovu = Math.round(cycle / 2);
    const segs = [
      { name: '月经期', from: 1, to: period, color: '#e58ba6' },
      { name: '卵泡期', from: period + 1, to: ovu - 1, color: '#8fd6c6' },
      { name: '排卵期', from: ovu, to: ovu + 1, color: '#f0c46a' },
      { name: '黄体期', from: ovu + 2, to: cycle, color: '#b6c9d6' }
    ];
    return '<div class="phase-bars">' + segs.filter((s) => s.to >= s.from).map((s) => {
      const left = ((s.from - 1) / cycle) * 100;
      const width = ((s.to - s.from + 1) / cycle) * 100;
      const current = day >= s.from && day <= s.to;
      return '<div class="phase-row"><span>' + s.name + (current ? ' · 现在' : '') + '</span>' +
        '<span class="phase-track"><i style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%;background:' + s.color + '"></i></span>' +
        '<span class="muted">第' + s.from + '～' + s.to + '天</span></div>';
    }).join('') + '</div>';
  }

  $('#toolAdd').addEventListener('click', () => {
    const date = $('#toolDate').value;
    if (!date) { toast('请选择本次月经开始日期'); return; }
    const rec = {
      date: date,
      cycle: clampNum($('#toolCycle').value, 18, 60, 28),
      period: clampNum($('#toolPeriod').value, 1, 12, 5)
    };
    const recs = loadRecords().filter((r) => r.date !== date);
    recs.push(rec);
    recs.sort((a, b) => (a.date < b.date ? 1 : -1));
    LS.set('hx_records', recs);
    $('#lastPeriod').value = recs[0].date;
    $('#cycleLen').value = recs[0].cycle;
    $('#periodLen').value = recs[0].period;
    renderRecords(); renderPredict();
    toast('已保存并更新预测');
  });

  $('#toolClear').addEventListener('click', () => {
    LS.set('hx_records', []);
    renderRecords(); renderPredict();
    toast('已清空记录');
  });

  /* ---------------------------------------------------------
     5. 经期健康自检清单
     --------------------------------------------------------- */
  const CHECKS = [
    '周期在 21～35 天之间，且与自己以往相比波动不超过 7 天',
    '经期长度 2～7 天，经量没有突然明显增多或减少',
    '痛经可以通过热敷、休息或常规止痛药缓解，没有逐年加重',
    '非经期没有异常阴道出血或褐色分泌物',
    '没有出现 1 小时湿透一片卫生巾的大出血',
    '没有突发剧烈下腹痛、发热、晕厥等急性症状',
    '乳房、外阴没有新出现的肿块、溃疡或持续瘙痒',
    '近一个月情绪、睡眠、食欲基本稳定，能正常工作学习'
  ];

  function renderChecks() {
    $('#checklist').innerHTML = CHECKS.map((c, i) =>
      '<li><b>' + (i + 1) + '</b><span>' + esc(c) + '</span></li>'
    ).join('');
  }

  /* ---------------------------------------------------------
     6. Toast 与初始化
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     7. 管理后台（审核 / 卡片管理 / 用户 / 统计）
     --------------------------------------------------------- */
  let adminTab = 'review';

  const SECTION_LABEL = {
    hero: '首页', feature1: '核心功能一 · 情绪自评',
    feature2: '核心功能二 · 生理科普', tools: '周期工具', admin: '管理后台'
  };

  async function initAdmin() {
    $('#adminTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      adminTab = b.getAttribute('data-tab');
      $$('#adminTabs button').forEach((x) =>
        x.classList.toggle('is-on', x === b));
      renderAdmin();
    });
    if ($('#kbReview')) {
      $('#kbReview').addEventListener('click', () => {
        adminTab = 'review';
        $$('#adminTabs button').forEach((x) =>
          x.classList.toggle('is-on', x.getAttribute('data-tab') === 'review'));
        renderAdmin();
      });
    }
    await renderAdmin();
  }

  async function renderAdmin() {
    const box = $('#adminBody');
    if (!me || me.role !== 'admin') { box.innerHTML = ''; return; }
    try {
      if (adminTab === 'review') await renderAdminReview(box);
      else if (adminTab === 'cards') await renderAdminCards(box);
      else if (adminTab === 'users') await renderAdminUsers(box);
      else await renderAdminStats(box);
    } catch (e) {
      box.innerHTML = '<p class="form-error">加载失败：' + esc(e.message) + '</p>';
    }
  }

  /* ---------- 待审投稿 ---------- */
  async function renderAdminReview(box) {
    let list = [];
    try { list = await svc.admin.pending(); } catch (e) { /* */ }
    if (!list.length) {
      box.innerHTML = '<div class="chart-box"><h3>待审投稿</h3>' +
        '<p class="admin-muted">暂无待审核卡片，所有投稿均已处理。</p></div>';
      return;
    }
    box.innerHTML =
      '<div class="chart-box"><h3>待审投稿（' + list.length + '）</h3>' +
      '<p class="admin-muted">请核对内容科学性：通过后立即进入知识库；未通过可填写原因，用户可在「我的投稿」中看到。</p></div>' +
      list.map((k) =>
        '<div class="admin-card" data-id="' + esc(String(k.id)) + '">' +
        '<div class="review-head">' +
          '<b>' + esc(k.title) + '</b>' +
          '<span class="tag tag-soft">' + esc(k.cat) + '</span>' +
          '<span class="admin-muted">投稿人：' +
            esc(String(k.author != null ? k.author : (k.author_id != null ? k.author_id : '未知'))) +
          ' · ' + esc(fmtDT(k.created_at)) + '</span>' +
        '</div>' +
        (k.summary ? '<p class="admin-muted">' + esc(k.summary) + '</p>' : '') +
        '<div class="review-preview">' + blocksToHtml(k.body) + '</div>' +
        '<div class="review-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="approve">通过并发布</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="reject">未通过</button>' +
        '</div></div>').join('');

    $$('.admin-card', box).forEach((card) => {
      const id = card.getAttribute('data-id');
      $$('button[data-act]', card).forEach((b) => b.addEventListener('click', async () => {
        const act = b.getAttribute('data-act');
        b.disabled = true;
        try {
          if (act === 'approve') {
            await svc.admin.approve(id);
            toast('已通过，卡片已加入知识库');
          } else {
            const reason = prompt('请填写未通过原因（用户可见，可留空）：', '');
            if (reason === null) { b.disabled = false; return; }
            await svc.admin.reject(id, reason);
            toast('已标记为未通过');
          }
          await renderAdmin();
          updateReviewBadge();
        } catch (e) {
          toast('操作失败：' + e.message);
          b.disabled = false;
        }
      }));
    });
  }

  /* ---------- 卡片管理 ---------- */
  async function renderAdminCards(box) {
    let list = [];
    try { list = await svc.admin.allCards('approved'); } catch (e) { /* */ }
    box.innerHTML =
      '<div class="review-actions" style="margin:0 0 14px">' +
        '<button type="button" class="btn btn-primary btn-sm" id="adminNewCard">＋ 新建卡片</button>' +
        '<span class="admin-muted">共 ' + list.length + ' 张可管理卡片（本地模式下内置卡片不可编辑，可新建替代卡片）</span>' +
      '</div>' +
      '<table class="admin-table"><thead><tr>' +
        '<th>标题</th><th>分类</th><th>来源</th><th>创建时间</th><th>操作</th>' +
      '</tr></thead><tbody>' +
      list.map((k) =>
        '<tr><td>' + esc(k.title) + '</td><td>' + esc(k.cat) + '</td>' +
        '<td>' + esc(k.source === 'builtin' ? '内置' :
                      (k.source === 'admin' ? '管理员新建' : '用户投稿')) + '</td>' +
        '<td>' + esc(fmtDT(k.created_at)) + '</td>' +
        '<td class="review-actions" style="margin:0">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(String(k.id)) + '">编辑</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-del="' + esc(String(k.id)) + '">删除</button>' +
        '</td></tr>').join('') +
      '</tbody></table>';

    $('#adminNewCard').addEventListener('click', () => openCardEditor(null));
    $$('button[data-edit]', box).forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-edit');
      const k = list.filter((x) => String(x.id) === id)[0];
      openCardEditor(k);
    }));
    $$('button[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-del');
      const k = list.filter((x) => String(x.id) === id)[0];
      if (!confirm('确定删除卡片「' + k.title + '」？此操作不可恢复。')) return;
      try {
        await svc.admin.deleteCard(id);
        toast('卡片已删除');
        renderAdmin();
      } catch (e) { toast('删除失败：' + e.message); }
    }));
  }

  /* 卡片编辑器（新建 / 编辑同一表单） */
  function openCardEditor(k) {
    const isEdit = !!k;
    const cats = kbCats();
    $('#modalBody').innerHTML =
      '<div class="modal-body">' +
      '<span class="cat tag tag-rose">' + (isEdit ? '编辑卡片' : '新建卡片') + '</span>' +
      '<h2>' + (isEdit ? '编辑科普卡片' : '新建科普卡片') + '</h2>' +
      '<form class="kb-form" id="cardEditorForm" novalidate>' +
        '<div class="form-row">' +
          '<label>所属分类<input type="text" id="eCat" maxlength="10" list="catList" required>' +
            '<datalist id="catList">' + cats.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
          '<label>标题（2～60 字）<input type="text" id="eTitle" maxlength="60" required></label>' +
        '</div>' +
        '<label>摘要<input type="text" id="eSummary" maxlength="200"></label>' +
        '<label>标签（逗号分隔）<input type="text" id="eTags"></label>' +
        '<label>正文（每行一段；以「- 」开头的连续行会成为要点列表；以「&gt; 」开头的行成为提示框）' +
          '<textarea id="eBody" rows="9" required></textarea></label>' +
        '<p class="form-error" id="eError"></p>' +
        '<button type="submit" class="btn btn-primary">' + (isEdit ? '保存修改' : '创建并发布') + '</button>' +
      '</form></div>';

    if (isEdit) {
      $('#eCat').value = k.cat;
      $('#eTitle').value = k.title;
      $('#eSummary').value = k.summary || '';
      $('#eTags').value = (k.tags || []).join(', ');
      $('#eBody').value = bodyToText(k.body || []);
    }

    $('#cardEditorForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#eError');
      err.textContent = '';
      const cat = $('#eCat').value.trim();
      const title = $('#eTitle').value.trim();
      if (!(1 <= cat.length <= 10)) { err.textContent = '分类需为 1～10 个字'; return; }
      if (!(2 <= title.length <= 60)) { err.textContent = '标题需为 2～60 个字'; return; }
      const body = textToBody($('#eBody').value);
      if (!body.length) { err.textContent = '正文不能为空'; return; }
      const tags = $('#eTags').value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      const payload = {
        cat: cat, title: title, summary: $('#eSummary').value.trim(),
        tags: tags, body: body
      };
      try {
        if (isEdit) await svc.admin.updateCard(k.id, payload);
        else await svc.admin.createCard(payload);
        closeModal();
        toast(isEdit ? '卡片已更新' : '卡片已创建并发布');
        renderAdmin();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });

    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  /* body 结构 ↔ 可编辑文本 */
  function bodyToText(body) {
    const lines = [];
    body.forEach((b) => {
      const t = b[0], v = b[1];
      if (t === 'p') lines.push(v);
      else if (t === 'h') lines.push('# ' + v);
      else if (t === 'note') lines.push('> ' + v);
      else if (t === 'ul') v.forEach((x) => lines.push('- ' + x));
      else if (t === 'ol') v.forEach((x, i) => lines.push((i + 1) + '. ' + x));
      else if (t === 'table') lines.push('[表格内容请直接改写为文字段落]');
    });
    return lines.join('\n');
  }

  function textToBody(text) {
    const raw = text.split('\n').map((s) => s.replace(/\s+$/, ''));
    const body = [];
    let bullets = [];
    const flush = () => {
      if (bullets.length) { body.push(['ul', bullets]); bullets = []; }
    };
    raw.forEach((line) => {
      if (/^-\s+/.test(line)) {
        bullets.push(line.replace(/^-\s+/, '').trim());
      } else {
        flush();
        const t = line.trim();
        if (!t) return;
        if (/^>\s?/.test(t)) body.push(['note', t.replace(/^>\s?/, '').trim()]);
        else if (/^#\s?/.test(t)) body.push(['h', t.replace(/^#\s?/, '').trim()]);
        else body.push(['p', t]);
      }
    });
    flush();
    return body;
  }

  /* ---------- 用户管理 ---------- */
  async function renderAdminUsers(box) {
    let users = [];
    try { users = await svc.admin.users(); } catch (e) { /* */ }
    box.innerHTML =
      '<table class="admin-table"><thead><tr>' +
        '<th>用户名</th><th>角色</th><th>注册时间</th><th>自评记录数</th>' +
      '</tr></thead><tbody>' +
      users.map((u) =>
        '<tr><td>' + esc(u.name) + '</td>' +
        '<td>' + (u.role === 'admin'
          ? '<span class="role-badge admin">管理员</span>'
          : '<span class="role-badge">用户</span>') + '</td>' +
        '<td>' + esc(fmtDT(u.created_at)) + '</td>' +
        '<td>' + esc(String(u.assess_count)) + '</td></tr>').join('') +
      '</tbody></table>';
  }

  /* ---------- 数据统计 ---------- */
  function barsHtml(rows, labelKey) {
    const max = Math.max.apply(null, [1].concat(rows.map((r) => r.count)));
    if (!rows.length) return '<p class="admin-muted">暂无数据。用户产生点击后这里会出现统计。</p>';
    return rows.map((r) => {
      const label = r[labelKey];
      return '<div class="bar-row">' +
        '<span title="' + esc(label) + '">' + esc(label) + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' +
          Math.round((r.count / max) * 100) + '%"></div></div>' +
        '<span class="bar-n">' + r.count + '</span></div>';
    }).join('');
  }

  async function renderAdminStats(box) {
    let s = null;
    try { s = await svc.admin.stats(); } catch (e) { /* */ }
    if (!s) return;
    const t = s.totals;
    const mini = [
      [t.users, '注册用户'], [t.cards_approved, '已发布卡片'],
      [t.cards_pending, '待审投稿'], [t.assessments, '云端自评记录'],
      [t.clicks, '总点击量']
    ];
    const secRows = s.sections.map((r) => ({
      target: SECTION_LABEL[r.target] || r.target, count: r.count
    }));
    box.innerHTML =
      '<div class="stat-cards">' + mini.map((m) =>
        '<div class="stat-mini"><b>' + m[0] + '</b><span>' + m[1] + '</span></div>').join('') +
      '</div>' +
      '<div class="chart-box"><h3>各板块点击量</h3>' + barsHtml(secRows, 'target') + '</div>' +
      '<div class="chart-box"><h3>科普卡片点击量（全部条目）</h3>' +
        barsHtml(s.cards, 'title') + '</div>' +
      '<div class="chart-box"><h3>近 14 天每日点击量</h3>' +
        barsHtml(s.daily.map((r) => ({
          target: r.date.slice(5).replace('-', '/'), count: r.count
        })), 'target') + '</div>';
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  async function main() {
    await bootstrap();
    renderRecords();
    renderPredict();
    renderChecks();
    setStep(1);
    await initKB();
    await initAdmin();
    await applyRoleUI();
    await refreshHistoryView();
  }

  main().catch((e) => {
    console.error(e);
    toast('页面启动失败：' + (e && e.message ? e.message : e));
  });
})();
