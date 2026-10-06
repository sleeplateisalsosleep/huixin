/* ============================================================
   蕙心 MVP · app.js
   本地优先：localStorage 存储，无网络依赖（知识 JSON 由 SW 缓存）
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 存储层 ---------------- */
  var K_SET = 'hx_mvp_settings';
  var K_ENTRIES = 'hx_mvp_entries';
  var MAX_ENTRIES = 365;

  function readJSON(k, dft) {
    try {
      var raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : dft;
    } catch (e) { return dft; }
  }
  function writeJSON(k, v) {
    localStorage.setItem(k, JSON.stringify(v));
  }

  var settings = readJSON(K_SET, null);
  var entries = readJSON(K_ENTRIES, []);

  function saveSettings() { writeJSON(K_SET, settings); }
  function saveEntries() {
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    writeJSON(K_ENTRIES, entries);
  }

  /* ---------------- 小工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var todayIso = function () { return Cycle.isoDate(new Date()); };

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* ---------------- 路由 ---------------- */
  var TABS = ['today', 'trend', 'knowledge', 'me'];
  function currentTab() {
    var h = (location.hash || '').replace('#', '');
    return TABS.indexOf(h) >= 0 ? h : 'today';
  }
  function showTab(name) {
    TABS.forEach(function (t) {
      var v = $('#view-' + t);
      if (v) v.hidden = (t !== name);
    });
    $all('.tab').forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-tab') === name);
    });
    window.scrollTo(0, 0);
    if (name === 'trend') renderTrend();
    if (name === 'knowledge') renderKnowledge();
    if (name === 'me') fillSettingsForm();
  }
  window.addEventListener('hashchange', function () { showTab(currentTab()); });

  /* ---------------- 首次设置 ---------------- */
  function isOnboarded() { return !!(settings && settings.lastPeriod); }

  function renderToday() {
    var onboard = $('#onboard');
    var checkin = $('#checkin');
    if (!isOnboarded()) {
      onboard.hidden = false;
      checkin.hidden = true;
      $('#onboardDate').max = todayIso();
      return;
    }
    onboard.hidden = true;
    checkin.hidden = false;
    renderCycleCard();
    prefillToday();
  }

  function renderCycleCard() {
    var info = Cycle.cycleInfo(settings.lastPeriod, settings.cycleLen || 28, new Date());
    var d = new Date();
    var wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    $('#todayDate').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + wk;
    if (!info || info.future) {
      $('#cycleDay').textContent = '';
      $('#cycleStage').textContent = '请检查设置的日期';
      $('#cycleNext').textContent = '';
      return;
    }
    $('#cycleDay').textContent = '周期第 ' + info.day + ' 天';
    $('#cycleStage').textContent = info.stage;
    $('#cycleNext').textContent = info.daysToNext <= 1
      ? '预计月经就在这一两天'
      : '距下次经期约 ' + info.daysToNext + ' 天';
  }

  function applyOnboard() {
    var date = $('#onboardDate').value;
    var len = parseInt($('#onboardLen').value, 10);
    if (!date) { toast('请选择上次月经开始日期'); return; }
    if (date > todayIso()) { toast('日期不能晚于今天'); return; }
    if (!len || len < 21 || len > 40) len = 28;
    settings = { lastPeriod: date, cycleLen: len, onboarded: true };
    saveSettings();
    toast('设置完成');
    renderToday();
  }

  /* ---------------- 打卡 ---------------- */
  /* 注意：selMood/selBody 只原地修改（push/splice），不可整体重新赋值，
     否则 bindChips 闭包持有的旧数组引用会与提交时读取的新数组脱节。 */
  var selMood = [];
  var selBody = [];
  function resetSel(arr, values) {
    arr.length = 0;
    (values || []).forEach(function (v) { arr.push(v); });
  }

  /* 用户自定义标签（localStorage 持久化，key 与预设分开） */
  var K_CUSTOM = 'hx_mvp_custom';
  var customTags = readJSON(K_CUSTOM, { mood: [], body: [] });
  function saveCustomTags() { writeJSON(K_CUSTOM, customTags); }

  function renderCustomChips(kind) {
    var box = $('#' + (kind === 'mood' ? 'moodChips' : 'bodyChips'));
    if (!box) return;
    // 清掉旧自定义 chip（保留预设与「自定义」按钮）
    $all('.chip[data-custom]', box).forEach(function (c) { c.parentNode.removeChild(c); });
    var addBtn = $('.chip-add[data-kind="' + kind + '"]', box);
    var sel = kind === 'mood' ? selMood : selBody;
    (customTags[kind] || []).forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('data-v', v);
      b.setAttribute('data-custom', '1');
      b.textContent = v;
      if (sel.indexOf(v) >= 0) b.classList.add('is-on');
      box.insertBefore(b, addBtn);
    });
  }

  function addCustomTag(kind) {
    var input = $(kind === 'mood' ? '#moodCustomInput' : '#bodyCustomInput');
    var v = (input.value || '').trim().replace(/[<>&"']/g, '');
    if (!v) { toast('请输入内容'); return; }
    if (v.length > 6) { toast('不超过 6 个字'); return; }
    var sel = kind === 'mood' ? selMood : selBody;
    // 与预设查重
    var exists = $all('.chip', $(kind === 'mood' ? '#moodChips' : '#bodyChips')).some(function (c) {
      return c.getAttribute('data-v') === v;
    });
    if (exists) { toast('「' + v + '」已存在'); return; }
    customTags[kind] = customTags[kind] || [];
    customTags[kind].push(v);
    saveCustomTags();
    // 新标签自动选中
    if (kind === 'body') {
      var i = selBody.indexOf('无不适');
      if (i >= 0) selBody.splice(i, 1);
    }
    sel.push(v);
    input.value = '';
    $(kind === 'mood' ? '#moodCustomRow' : '#bodyCustomRow').hidden = true;
    renderCustomChips(kind);
  }

  function bindChips(containerId, store, afterToggle) {
    var box = $('#' + containerId);
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      // 「自定义」按钮打开输入框
      if (btn.classList.contains('chip-add')) {
        var kind = btn.getAttribute('data-kind');
        var row = $(kind === 'mood' ? '#moodCustomRow' : '#bodyCustomRow');
        row.hidden = !row.hidden;
        if (!row.hidden) $(kind === 'mood' ? '#moodCustomInput' : '#bodyCustomInput').focus();
        return;
      }
      var v = btn.getAttribute('data-v');
      // 「无不适」与其他身体标签互斥
      if (containerId === 'bodyChips') {
        if (v === '无不适') {
          selBody.length = 0;
          if (store.indexOf(v) < 0) store.push(v);
        } else {
          var i = store.indexOf('无不适');
          if (i >= 0) store.splice(i, 1);
          toggleVal(store, v);
        }
      } else {
        toggleVal(store, v);
      }
      syncChipUI(box, store);
      if (afterToggle) afterToggle();
    });
  }
  function toggleVal(arr, v) {
    var i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }
  function syncChipUI(box, values) {
    $all('.chip', box).forEach(function (c) {
      c.classList.toggle('is-on', values.indexOf(c.getAttribute('data-v')) >= 0);
    });
  }

  function findEntry(date) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].date === date) return entries[i];
    }
    return null;
  }

  function prefillToday() {
    var e = findEntry(todayIso());
    resetSel(selMood, e ? e.moodTags : []);
    resetSel(selBody, e ? e.bodyTags : []);
    renderCustomChips('mood');
    renderCustomChips('body');
    syncChipUI($('#moodChips'), selMood);
    syncChipUI($('#bodyChips'), selBody);
    $('#noteInput').value = e ? (e.note || '') : '';
    $('#noteWrap').open = !!(e && e.note);
    $('#checkinSubmit').textContent = e ? '更新今日记录' : '保存今日记录';
  }

  function submitCheckin(ev) {
    ev.preventDefault();
    if (!isOnboarded()) return;
    if (selMood.length === 0 && selBody.length === 0 && !$('#noteInput').value.trim()) {
      toast('至少选择一项情绪或身体感受');
      return;
    }
    var date = todayIso();
    var info = Cycle.cycleInfo(settings.lastPeriod, settings.cycleLen || 28, new Date());
    var rec = {
      date: date,
      moodTags: selMood.slice(),
      bodyTags: selBody.slice(),
      note: $('#noteInput').value.trim().slice(0, 200),
      phase: info && !info.future ? info.stage : '',
      daysToNext: info ? info.daysToNext : null,
      createdAt: new Date().toISOString()
    };
    var ex = findEntry(date);
    if (ex) {
      var idx = entries.indexOf(ex);
      rec.createdAt = ex.createdAt;
      rec.updatedAt = rec.createdAt;
      entries[idx] = rec;
    } else {
      entries.push(rec);
    }
    saveEntries();
    $('#checkinSubmit').textContent = '更新今日记录';
    showFeedback(rec, info);
  }

  /* 规则化反馈文案 + 相关科普推荐 */
  function buildFeedback(rec, info) {
    var moodNeg = ['焦虑', '低落', '烦躁', '疲惫'];
    var hasNeg = rec.moodTags.some(function (m) { return moodNeg.indexOf(m) >= 0; });
    var stage = rec.phase || '';
    var pms = Cycle.inPmsWindow(info);
    var lines = [];
    var kbId = null;

    if (!hasNeg && rec.bodyTags.indexOf('无不适') >= 0) {
      lines.push('今天状态不错，继续保持规律作息就好。');
      kbId = 'emotion-cycle';
    } else if (stage.indexOf('黄体') >= 0 && (hasNeg || pms)) {
      lines.push('你正处于黄体期（经前期），情绪波动在这个阶段比较常见，不是你「想太多」。');
      lines.push('今晚可以试试缓慢呼吸 3 分钟，或早点休息。');
      kbId = rec.moodTags.indexOf('焦虑') >= 0 || rec.moodTags.indexOf('烦躁') >= 0 ? 'pms' : 'emotion-cycle';
    } else if (stage === '月经期') {
      if (rec.bodyTags.indexOf('腹痛') >= 0) {
        lines.push('经期腹痛时，39～40℃ 热敷小腹能帮助放松、缓解不适；疼得明显也不必硬扛。');
        kbId = 'heat-therapy';
      } else if (hasNeg) {
        lines.push('经期激素处于低谷，情绪和体力偏低是正常的生理现象，对自己温柔一点。');
        kbId = 'emotion-cycle';
      } else {
        lines.push('经期注意保暖和休息，避免过量咖啡因。');
        kbId = 'salt-caffeine';
      }
    } else if (rec.bodyTags.indexOf('失眠') >= 0) {
      lines.push('睡不好时试试睡前热敷、固定作息，减少手机和咖啡因刺激。');
      kbId = 'sleep-cycle';
    } else if (rec.moodTags.indexOf('焦虑') >= 0) {
      lines.push('感到焦虑时，可以试一组 4-7-8 呼吸：吸气 4 秒、屏息 7 秒、呼气 8 秒，重复 4 轮。');
      kbId = 'mindfulness';
    } else if (hasNeg) {
      lines.push('情绪没有对错。记录本身就是在照顾自己，明天我们再看看它的变化。');
      kbId = 'emotion-cycle';
    } else {
      lines.push('已记录。身体的小信号值得留意，规律观察会帮你更了解自己。');
      kbId = 'emotion-cycle';
    }

    // 急症兜底提示（不制造恐慌，仅在勾选红旗症状时出现）
    if (rec.note && /(自伤|不想活|撑不下去)/.test(rec.note)) {
      lines.push('如果你出现了伤害自己的念头，请立即联系信任的人或拨打心理援助热线 12356。');
      kbId = 'mental-support';
    }
    return { text: lines.join('\n'), kbId: kbId };
  }

  function showFeedback(rec, info) {
    var fb = buildFeedback(rec, info);
    var html =
      '<div class="fb-emoji">🌿</div>' +
      '<div class="fb-title">已为你记下今天</div>' +
      '<div class="fb-text">' + esc(fb.text).replace(/\n/g, '<br>') + '</div>' +
      '<button class="btn-primary" id="fbKbBtn">看看相关科普</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn-secondary" id="fbCloseBtn">关闭</button>';
    $('#feedbackBody').innerHTML = html;
    $('#feedbackMask').hidden = false;
    $('#fbCloseBtn').onclick = closeFeedback;
    $('#fbKbBtn').onclick = function () {
      closeFeedback();
      location.hash = 'knowledge';
      setTimeout(function () { openKbById(fb.kbId); }, 120);
    };
  }
  function closeFeedback() { $('#feedbackMask').hidden = true; }

  /* ---------------- 趋势 ---------------- */
  /* 情绪→颜色：消极红、焦虑橙、积极绿、自定义粉绿混合 */
  var KNOWN_MOODS = { '焦虑': 1, '低落': 1, '烦躁': 1, '疲惫': 1, '平静': 1, '开心': 1 };
  function moodColorOf(tags) {
    if (!tags || tags.length === 0) return '';
    var hasNeg = false, hasAnx = false, hasPos = false, hasCustom = false;
    tags.forEach(function (t) {
      if (t === '低落' || t === '疲惫') hasNeg = true;
      else if (t === '焦虑' || t === '烦躁') hasAnx = true;
      else if (t === '平静' || t === '开心') hasPos = true;
      else if (!KNOWN_MOODS[t]) hasCustom = true;
    });
    if (hasNeg) return 'c-rose';
    if (hasAnx) return 'c-amber';
    if (hasCustom) return 'c-mix';   /* 自定义 → 粉绿混合 */
    if (hasPos) return 'c-teal';
    return '';
  }
  function bandClass(stage) {
    if (stage === '月经期') return 'band-period';
    if (stage === '排卵期') return 'band-ovu';
    if (stage.indexOf('黄体') >= 0) return 'band-luteal';
    if (stage === '卵泡期') return 'band-follic';
    return '';
  }

  function renderTrend() {
    var grid = $('#weekGrid');
    grid.innerHTML = '';
    var dows = ['日', '一', '二', '三', '四', '五', '六'];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var iso = Cycle.isoDate(d);
      var rec = findEntry(iso);
      var color = rec ? moodColorOf(rec.moodTags) : '';
      var stage = isOnboarded()
        ? Cycle.cycleInfo(settings.lastPeriod, settings.cycleLen, d).stage
        : '';
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'week-cell';
      cell.setAttribute('data-date', iso);
      cell.innerHTML =
        '<span class="week-dow">' + (i === 0 ? '今天' : dows[d.getDay()]) + '</span>' +
        '<div class="week-dot ' + color + '">' + (color ? '♥' : '') + '</div>' +
        '<span class="week-num">' + (d.getMonth() + 1) + '/' + d.getDate() + '</span>' +
        '<span class="week-band ' + bandClass(stage) + '"></span>';
      cell.addEventListener('click', function () { openRecordSheet(iso); });
      grid.appendChild(cell);
    }

    var list = $('#recordList');
    var recent = entries.slice(-30).reverse();
    $('#trendCount').textContent = recent.length ? '共 ' + recent.length + ' 次' : '';
    if (recent.length === 0) {
      list.innerHTML = '<div class="empty">还没有记录。<br>回到「今日」完成第一次打卡吧。</div>';
      return;
    }
    list.innerHTML = recent.map(function (r) {
      var mood = r.moodTags.map(function (t) {
        var neg = ['焦虑', '低落', '烦躁', '疲惫'].indexOf(t) >= 0;
        return '<span class="t ' + (neg ? 'mood-neg' : '') + '">' + esc(t) + '</span>';
      }).join('');
      var body = r.bodyTags.filter(function (t) { return t !== '无不适'; })
        .map(function (t) { return '<span class="t">' + esc(t) + '</span>'; }).join('');
      return '<button type="button" class="record-item" data-date="' + r.date + '">' +
        '<div class="record-head"><span>' + r.date + '</span>' +
        '<span class="record-stage">' + esc(r.phase || '') + '</span></div>' +
        '<div class="record-tags">' + mood + body + '</div>' +
        (r.note ? '<p class="record-note">' + esc(r.note) + '</p>' : '') +
        '<div class="record-more">点击查看详情 ›</div>' +
        '</button>';
    }).join('');
    $all('.record-item', list).forEach(function (el) {
      el.addEventListener('click', function () { openRecordSheet(el.getAttribute('data-date')); });
    });
  }

  /* 某日记录详情弹层 */
  function openRecordSheet(dateIso) {
    var rec = findEntry(dateIso);
    var body = $('#kbSheetBody');
    if (!rec) {
      body.innerHTML =
        '<h2 class="kb-detail-title">' + dateIso + '</h2>' +
        '<div class="empty">这一天没有记录</div>' +
        '<button class="btn-secondary" id="kbCloseBtn">关闭</button>';
    } else {
      var mood = rec.moodTags.length
        ? rec.moodTags.map(function (t) {
            var neg = ['焦虑', '低落', '烦躁', '疲惫'].indexOf(t) >= 0;
            return '<span class="t ' + (neg ? 'mood-neg' : '') + '">' + esc(t) + '</span>';
          }).join('')
        : '<span class="muted">未选择</span>';
      var bodyTags = rec.bodyTags.length
        ? rec.bodyTags.map(function (t) { return '<span class="t">' + esc(t) + '</span>'; }).join('')
        : '<span class="muted">未选择</span>';
      body.innerHTML =
        '<h2 class="kb-detail-title">' + dateIso + '</h2>' +
        '<div class="record-head" style="margin-bottom:10px"><span></span>' +
        '<span class="record-stage">' + esc(rec.phase || '') + '</span></div>' +
        '<h3>情绪</h3><div class="record-tags">' + mood + '</div>' +
        '<h3>身体感受</h3><div class="record-tags">' + bodyTags + '</div>' +
        (rec.note ? '<h3>日记</h3><p class="record-note">' + esc(rec.note) + '</p>' : '') +
        '<button class="btn-secondary" id="kbCloseBtn" style="margin-top:14px">关闭</button>';
    }
    $('#kbSheetMask').hidden = false;
    $('#kbCloseBtn').onclick = function () { $('#kbSheetMask').hidden = true; };
  }

  /* ---------------- 知识 ---------------- */
  var kbCache = null;
  var kbCat = '全部';
  var kbQuery = '';

  function loadKb() {
    return fetch('assets/knowledge.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (list) { kbCache = list; return list; })
      .catch(function () { kbCache = []; return []; });
  }

  function renderKnowledge() {
    var done = kbCache ? Promise.resolve(kbCache) : loadKb();
    done.then(function (list) {
      var q = kbQuery.trim().toLowerCase();
      var filtered = list.filter(function (x) {
        var catOk = kbCat === '全部' ||
          (kbCat === '情绪与 PMS' && x.cat === '情绪与 PMS') ||
          (kbCat === '痛经不适' && x.cat === '痛经与不适') ||
          (kbCat === '睡眠护理' && x.cat === '经期护理') ||
          (x.cat === kbCat);
        if (!catOk) return false;
        if (!q) return true;
        var hay = (x.title + x.summary + x.tags.join('')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      var box = $('#kbList');
      if (filtered.length === 0) {
        box.innerHTML = '<div class="empty">没有找到相关内容</div>';
        return;
      }
      box.innerHTML = filtered.map(function (x) {
        return '<button class="kb-item" data-id="' + esc(x.id) + '">' +
          '<div class="kb-cat">' + esc(x.cat) + '</div>' +
          '<div class="kb-title">' + esc(x.title) + '</div>' +
          '<p class="kb-sum">' + esc(x.summary) + '</p></button>';
      }).join('');
    });
  }

  function renderKbBody(blocks) {
    return blocks.map(function (b) {
      if (b[0] === 'p') return '<p>' + esc(b[1]) + '</p>';
      if (b[0] === 'h') return '<h>' + esc(b[1]) + '</h>';
      if (b[0] === 'ul') {
        return '<ul>' + b[1].map(function (li) { return '<li>' + esc(li) + '</li>'; }).join('') + '</ul>';
      }
      return '';
    }).join('');
  }

  function openKbById(id) {
    var list = kbCache || [];
    var x = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { x = list[i]; break; }
    }
    if (!x) {
      var done = kbCache ? Promise.resolve() : loadKb();
      done.then(function () { openKbById(id); });
      return;
    }
    $('#kbSheetBody').innerHTML =
      '<div class="kb-detail-cat">' + esc(x.cat) + '</div>' +
      '<h2 class="kb-detail-title">' + esc(x.title) + '</h2>' +
      '<div class="kb-detail-body">' + renderKbBody(x.body || []) + '</div>' +
      '<button class="btn-secondary" id="kbCloseBtn">关闭</button>';
    $('#kbSheetMask').hidden = false;
    $('#kbCloseBtn').onclick = function () { $('#kbSheetMask').hidden = true; };
  }

  /* ---------------- 我的：设置 / 导入导出 / 清除 ---------------- */
  function fillSettingsForm() {
    if (!settings) return;
    $('#setDate').value = settings.lastPeriod || '';
    $('#setLen').value = settings.cycleLen || 28;
    $('#setDate').max = todayIso();
  }
  function saveSettingsForm() {
    var date = $('#setDate').value;
    var len = parseInt($('#setLen').value, 10);
    if (!date) { toast('请选择日期'); return; }
    if (date > todayIso()) { toast('日期不能晚于今天'); return; }
    if (!len || len < 21 || len > 40) len = 28;
    settings = { lastPeriod: date, cycleLen: len, onboarded: true };
    saveSettings();
    toast('设置已保存');
    renderToday();
  }

  function exportData() {
    var payload = {
      app: 'hx-mvp', version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings, entries: entries
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hx-mvp-backup-' + todayIso() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('已导出备份文件');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (data.app !== 'hx-mvp' || !Array.isArray(data.entries)) {
          toast('文件格式不正确'); return;
        }
        if (!confirm('导入将覆盖当前全部本地数据，确定继续吗？')) return;
        settings = data.settings || settings;
        entries = data.entries;
        saveSettings(); saveEntries();
        toast('导入成功，共 ' + entries.length + ' 条记录');
        renderToday();
      } catch (e) {
        toast('文件解析失败');
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm('将清除周期设置与全部打卡记录，且无法恢复。\n建议先导出备份。确定清除吗？')) return;
    localStorage.removeItem(K_SET);
    localStorage.removeItem(K_ENTRIES);
    localStorage.removeItem(K_CUSTOM);
    settings = null; entries = [];
    customTags = { mood: [], body: [] };
    $('#noteInput').value = '';
    toast('本地数据已清除');
    renderToday();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('#onboardSave').addEventListener('click', applyOnboard);
    $('#onboardDate').max = todayIso();

    bindChips('moodChips', selMood);
    bindChips('bodyChips', selBody);
    $('#checkinForm').addEventListener('submit', submitCheckin);

    $('#feedbackMask').addEventListener('click', function (e) {
      if (e.target === this) closeFeedback();
    });
    $('#kbSheetMask').addEventListener('click', function (e) {
      if (e.target === this) this.hidden = true;
    });

    $('#kbList').addEventListener('click', function (e) {
      var item = e.target.closest('.kb-item');
      if (item) openKbById(item.getAttribute('data-id'));
    });
    $('#catChips').addEventListener('click', function (e) {
      var btn = e.target.closest('.chip');
      if (!btn) return;
      kbCat = btn.getAttribute('data-cat');
      $all('.chip', this).forEach(function (c) {
        c.classList.toggle('is-on', c === btn);
      });
      renderKnowledge();
    });
    var searchTimer;
    $('#kbSearch').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { kbQuery = v; renderKnowledge(); }, 180);
    });

    /* 自定义标签输入 */
    $('#moodCustomAdd').addEventListener('click', function () { addCustomTag('mood'); });
    $('#moodCustomInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addCustomTag('mood'); }
    });
    $('#bodyCustomAdd').addEventListener('click', function () { addCustomTag('body'); });
    $('#bodyCustomInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addCustomTag('body'); }
    });

    $('#setSave').addEventListener('click', saveSettingsForm);
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function () {
      if (this.files[0]) importData(this.files[0]);
      this.value = '';
    });
    $('#clearBtn').addEventListener('click', clearAll);
  }

  /* ---------------- Service Worker ---------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线能力静默降级 */ });
    });
  }

  /* ---------------- 微信内引导 ---------------- */
  function maybeShowWxGuide() {
    var isWx = /MicroMessenger/i.test(navigator.userAgent || '');
    if (!isWx) return;
    try { if (sessionStorage.getItem('hx_wx_guide_shown')) return; } catch (e) {}
    $('#wxGuide').hidden = false;
    try { sessionStorage.setItem('hx_wx_guide_shown', '1'); } catch (e) {}
  }

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    bind();
    $('#wxDismiss').addEventListener('click', function () { $('#wxGuide').hidden = true; });
    $('#wxGuide .wx-mask').addEventListener('click', function (e) {
      if (e.target === this) $('#wxGuide').hidden = true;
    });
    maybeShowWxGuide();
    renderToday();
    showTab(currentTab());
  });
})();
