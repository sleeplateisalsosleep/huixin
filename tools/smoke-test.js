/* 蕙心网 · 离线自检：用最小 DOM 桩跑通核心功能一的全部分支与渲染
   运行：node tools/smoke-test.js  （在 huixin-web 目录下）           */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 输入值集合：供测试用例改写 ---------- */
const V = {
  '#diary': '',
  '#duration': 'hours',
  '#intensity': '5',
  '#lastPeriod': '',
  '#cycleLen': '28',
  '#periodLen': '5',
  '#sleep': '7-9',
  '#pain': 'none',
  '#stress': 'low',
  '#extraNote': '',
  '#selfHarm': false, '#heavyBleed': false, '#missedPeriod': false, '#faint': false,
  '#search': ''
};
let symChecked = [];
let emoChecked = [];
const store = {};

const captured = { plan: '', report: '', kb: '', filters: '', pred: '', records: '', checks: '', modal: '' };

/* 点击处理器按选择器登记，测试里可以“点按钮”驱动真实状态机 */
const clicks = {};

function node(sel) {
  const el = {
    _sel: sel,
    get value() { return V[sel] !== undefined ? V[sel] : ''; },
    set value(v) { V[sel] = v; },
    get checked() { return !!V[sel]; },
    set checked(v) { V[sel] = !!v; },
    hidden: false, textContent: '', className: '',
    style: {}, children: [],
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    addEventListener(type, fn) { if (type === 'click') clicks[sel] = fn; },
    removeEventListener() { },
    setAttribute() { }, getAttribute() { return null; }, removeAttribute() { },
    querySelector() { return node('__q'); },
    querySelectorAll() { return []; },
    closest() { return null; }, focus() { }, scrollIntoView() { },
    appendChild() { }, removeChild() { },
    set innerHTML(v) { this._html = v; onHtml(sel, v); },
    get innerHTML() { return this._html || ''; }
  };
  return el;
}

function onHtml(sel, v) {
  if (sel === '#planList') captured.plan = v;
  else if (sel === '#reportMount') captured.report = v;
  else if (sel === '#kbGrid') captured.kb = v;
  else if (sel === '#kbFilters') captured.filters = v;
  else if (sel === '#toolResult') captured.pred = v;
  else if (sel === '#recordList') captured.records = v;
  else if (sel === '#checklist') captured.checks = v;
  else if (sel === '#modalBody') captured.modal = v;
}

const registry = new Map();
function get(sel) {
  if (!registry.has(sel)) registry.set(sel, node(sel));
  return registry.get(sel);
}

const document = {
  querySelector: (s) => get(s),
  querySelectorAll: (s) => {
    if (s === 'input[name="symptom"]:checked') return symChecked.map((v) => ({ value: v }));
    if (s === 'input[name="emotion"]:checked') return emoChecked.map((v) => ({ value: v }));
    if (s === '.step-panel' || s === '#stepNav li' || s === '.fnode' || s === 'a[href="#assessment"]' ||
      s === '#modal [data-close]' || s === '.kb-card' || s === '#recordList .del') return [];
    return [];
  },
  addEventListener() { }, documentElement: { style: { setProperty() { } } },
  body: { style: {} }
};
const localStorage = {
  getItem: (k) => (store[k] === undefined ? null : store[k]),
  setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; }
};
const window = { addEventListener() { } };
const location = { hash: '' };

const ctx = {
  document, window, localStorage, location, console,
  __HX_TRACE: !!process.env.HX_TRACE,
  setTimeout: () => 0, clearTimeout: () => { }, Date, Math, JSON, Number, String, Array, Object, isFinite, parseInt, parseFloat
};
ctx.globalThis = ctx;
vm.createContext(ctx);

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
vm.runInContext(code, ctx, { filename: 'app.js' });

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); }
}

console.log('\n[1] 页面不出现内部流程图，只保留面向用户的护理计划');
const appSrc = code;
ok('app.js 不含流程图形渲染代码',
  ['flowRender', 'buildFlow', 'fnode', 'FLOW_META', 'edgePoints'].every((t) => appSrc.indexOf(t) < 0));
ok('app.js 不含从 flow-map 加载几何数据',
  appSrc.indexOf('HX_FLOW') < 0 && appSrc.indexOf('flow-map.js') < 0);
ok('护理计划正文已渲染（5 步）', (captured.plan.match(/<li/g) || []).length === 5,
  '实际 ' + (captured.plan.match(/<li/g) || []).length);
ok('护理计划首项为当前步骤', captured.plan.indexOf('is-current') > 0);
ok('护理计划文案不暴露内部节点名',
  ['emoCheck', 'trendCheck', 'medCheck', 'counselCheck'].every((t) => captured.plan.indexOf(t) < 0));

console.log('\n[2] 知识科普');
ok('分类筛选按钮已渲染', captured.filters.indexOf('data-cat="周期基础"') > 0);
ok('分类数 = 10', (captured.filters.match(/data-cat=/g) || []).length === 10,
  '实际 ' + (captured.filters.match(/data-cat=/g) || []).length);
ok('知识卡片已渲染 37 条', (captured.kb.match(/class="kb-card"/g) || []).length === 37,
  '实际 ' + (captured.kb.match(/class="kb-card"/g) || []).length);

console.log('\n[3] 工具与清单');
ok('自检清单 8 项', (captured.checks.match(/<li>/g) || []).length === 8);
ok('未记录时提示已渲染', captured.pred.indexOf('还没有记录') > 0);

/* ---------- 分支用例 ---------- */
function runCase(name, cfg, expectPath, expectLevel) {
  V['#diary'] = cfg.diary || '';
  V['#duration'] = cfg.duration || 'hours';
  V['#intensity'] = String(cfg.intensity === undefined ? 5 : cfg.intensity);
  V['#lastPeriod'] = cfg.lastPeriod || '2026-09-20';
  V['#cycleLen'] = String(cfg.cycleLen || 28);
  V['#sleep'] = cfg.sleep || '7-9';
  V['#pain'] = cfg.pain || 'none';
  V['#stress'] = cfg.stress || 'low';
  V['#extraNote'] = cfg.extra || '';
  V['#selfHarm'] = !!cfg.selfHarm;
  V['#heavyBleed'] = false; V['#missedPeriod'] = false; V['#faint'] = false;
  symChecked = cfg.symptoms || [];
  emoChecked = cfg.emotions || [];

  captured.report = '';
  // 通过点击「下一步」推进到结果页：这里直接调用内部状态机不方便，改为模拟表单推进
  return { name, expectPath, expectLevel };
}

/* 直接用真实状态机跑用例：改写表单值 → 依次点击「下一步」→ 读取第 5 步生成的报告 */
function runFlow(cfg) {
  V['#diary'] = cfg.diary || '';
  V['#duration'] = cfg.duration || 'hours';
  V['#intensity'] = String(cfg.intensity === undefined ? 5 : cfg.intensity);
  V['#lastPeriod'] = cfg.lastPeriod || '2026-09-20';
  V['#cycleLen'] = String(cfg.cycleLen || 28);
  V['#periodLen'] = String(cfg.periodLen || 5);
  V['#sleep'] = cfg.sleep || '7-9';
  V['#pain'] = cfg.pain || 'none';
  V['#stress'] = cfg.stress || 'low';
  V['#extraNote'] = cfg.extra || '';
  V['#selfHarm'] = !!cfg.selfHarm;
  V['#heavyBleed'] = !!cfg.heavyBleed;
  V['#missedPeriod'] = !!cfg.missedPeriod;
  V['#faint'] = !!cfg.faint;
  symChecked = cfg.symptoms || [];
  emoChecked = cfg.emotions || [];
  captured.report = '';
  /* 每轮用例前先回到第 1 步（等同点击「重新自评」），保证状态机可重复驱动 */
  if (clicks['#resetBtn']) clicks['#resetBtn']({ preventDefault() { } });
  captured.plan = '';
  for (let i = 0; i < 4; i++) {
    const fn = clicks['#nextBtn'];
    if (!fn) throw new Error('未注册 #nextBtn 的 click 处理器');
    fn({ preventDefault() { } });
  }
  return captured.report;
}

console.log('\n[4] 分支判定（用真实状态机点击「下一步」跑通 5 步）');
const cases = [
  { name: '平静愉悦 → 健康祝福激励短语', cfg: { emotions: ['平静', '愉悦'], intensity: 1, duration: 'hours' }, want: ['健康祝福 · 继续保持', '负面情绪<b>不多</b>'] },
  { name: '焦虑+低落 仅数小时 → 正念冥想建议', cfg: { emotions: ['焦虑', '低落'], intensity: 5, duration: 'hours' }, want: ['正念冥想建议 · 4-7-8 呼吸', '正念冥想建议'] },
  { name: '持续一周+高压力+高影响 → 咨询推荐+优惠券', cfg: { emotions: ['低落', '焦虑', '疲惫'], intensity: 8, duration: 'week', stress: 'high' }, want: ['心理咨询推荐', '生活需求商品优惠券', '③ 健康风险评估报告'] },
  { name: '持续 3-5 天 中风险 → 正念冥想输出+祝福生活愉快', cfg: { emotions: ['烦躁', '低落'], intensity: 6, duration: '3-5d' }, want: ['小程序输出冥想内容', '祝福生活愉快', '③ 健康风险评估报告'] },
  { name: '影响 7/10 但仅 1～2 天 → 未判定持续，走正念冥想建议', cfg: { emotions: ['低落'], intensity: 7, duration: '1-2d' }, want: ['正念冥想建议', '身体扫描冥想'] },
  { name: '影响 9/10 → 高风险・情绪安抚+心理咨询推荐', cfg: { emotions: ['低落'], intensity: 9, duration: '1-2d' }, want: ['心理咨询推荐', '需要重点关注', '高风险', '情绪抚平安慰'] },
  { name: '勾选自伤念头 → 必须给危机支持与咨询推荐', cfg: { emotions: ['低落'], intensity: 6, duration: '1-2d', selfHarm: true }, want: ['请立即寻求专业帮助', '12356', '心理咨询推荐'] },
  { name: '日记命中负面词 → 进入趋势预测分支', cfg: { emotions: ['平静'], diary: '最近很烦躁，晚上失眠', intensity: 6, duration: 'hours' }, want: ['正念冥想建议', '日记中命中情绪线索词'] },
  { name: '大出血红旗 → 置顶就医提醒', cfg: { emotions: ['平静'], intensity: 3, duration: 'hours', heavyBleed: true }, want: ['请优先就医或寻求专业支持', '健康风险评估报告'] }
];

let allReports = [];
cases.forEach((c) => {
  const html = runFlow(c.cfg);
  if (process.env.HX_DEBUG) {
    console.log('  · ' + c.name + ' 报告长度=' + html.length + ' 轨迹=' + (store['hx_history'] && JSON.parse(store['hx_history'])[0].branch) + '/' + (store['hx_history'] && JSON.parse(store['hx_history'])[0].risk));
    if (process.env.HX_DEBUG === '2') console.log(html.replace(/></g, '>\n<'));
  }
  const missing = c.want.filter((w) => html.indexOf(w) < 0);
  ok(c.name, missing.length === 0 && html.length > 200, missing.length ? '缺少：' + missing.join(' / ') : '报告为空(' + html.length + '字节)');
  allReports.push(html);
});

console.log('\n[5] 报告结构完整性');
/* 评估路径小节应使用面向用户的措辞，不出现内部节点标识 */
cases.forEach((c, i) => {
  const html = allReports[i];
  if (html.indexOf('⑤ 本次评估路径') >= 0) {
    ok('「' + c.name + '」评估路径为中文说明',
      ['emoCheck', 'trendCheck', 'counselCheck'].every((t) => html.indexOf(t) < 0));
  }
});
const aReport = allReports[2];
ok('红旗用例均置顶就医提醒', cases.every((c, i) => {
  const flagged = c.cfg.selfHarm || c.cfg.heavyBleed || c.cfg.faint || c.cfg.missedPeriod;
  return !flagged || allReports[i].indexOf('请优先就医或寻求专业支持') >= 0;
}), '红旗用例报告缺少置顶提醒');
['① 情绪识别结果', '② 健康特征匹配与趋势预测', '③ 健康风险评估报告', '④ 分级干预方案', '⑤ 本次评估路径']
  .forEach((h) => ok('包含小节：' + h, aReport.indexOf(h) >= 0));
ok('轨迹节点不少于 10 个', (aReport.match(/<span>/g) || []).length >= 10,
  '实际 ' + (aReport.match(/<span>/g) || []).length);
ok('自评已写入本地历史记录', !!store['hx_history'] && JSON.parse(store['hx_history']).length >= 1);

console.log('\n[6] 知识分区完整性');
const catList = ['周期基础', '经期护理', '痛经与不适', '经期营养', '经期运动', '情绪与 PMS', '卫生用品', '常见误区', '就医与检查'];
catList.forEach((c) => ok('分类存在：' + c, captured.filters.indexOf('data-cat="' + c + '"') > 0));

console.log('\n──────────────────────────────');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
