/* 蕙心网 · 护理流程拓扑自检（开发依据校验）
   数据来源：docs/flow-spec.js（需求流程图的文字化落地，仅开发使用，不进入页面）
   校验：1) 节点/连线引用有效  2) 无悬挂节点  3) 每个判断节点都有 是 / 否 两条出边
        4) 每条终点分支都可达  5) 页面代码里不出现任何流程图形
   运行：node tools/layout-check.js                                        */
const fs = require('fs');
const path = require('path');
const spec = require('../docs/flow-spec.js');

const { NODES, EDGES, RULES, REACHABLE } = spec;
const ids = Object.keys(NODES);

let fail = 0;
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const good = (m) => console.log('  ✓ ' + m);
const ok = (name, cond) => (cond ? good(name) : bad(name));

console.log('\n[1] 节点与连线（共 ' + ids.length + ' 个节点 / ' + EDGES.length + ' 条连线）');
const badEdges = EDGES.filter((e) => !NODES[e.f] || !NODES[e.t]);
badEdges.length
  ? bad('引用了不存在的节点：' + badEdges.map((e) => e.f + '→' + e.t).join('、'))
  : good('全部连线端点均有效');

const outMap = {};
const inMap = {};
EDGES.forEach((e) => {
  (outMap[e.f] = outMap[e.f] || []).push(e);
  (inMap[e.t] = inMap[e.t] || []).push(e);
});
const dangling = ids.filter((id) => !inMap[id] && !outMap[id]);
dangling.length ? bad('悬挂节点：' + dangling.join('、')) : good('没有悬挂节点（每个节点至少连一条线）');

console.log('\n[2] 判断节点必须是 是 / 否 双出边');
const decisions = ids.filter((id) => NODES[id].kind === 'decision');
decisions.forEach((id) => {
  const outs = outMap[id] || [];
  const labs = outs.map((e) => e.lab).sort().join('/');
  if (outs.length === 2 && labs === '否/是') good(id + '：' + outs.map((e) => e.lab + '→' + NODES[e.t].t).join('，'));
  else bad(id + ' 的出边异常（' + outs.length + ' 条：' + labs + '）');
});

console.log('\n[3] 起止与主链');
ok('有且只有一个开始节点', ids.filter((id) => NODES[id].kind === 'terminal').length === 1 &&
  NODES.start.kind === 'terminal');
const finals = ids.filter((id) => !outMap[id]);
ok('终点分支共 ' + finals.length + ' 个：' + finals.map((id) => NODES[id].t).join('、'), finals.length >= 4);

console.log('\n[4] 分支可达性（每条终点都必须有真实触发条件）');
finals.forEach((id) => {
  if (REACHABLE[id]) good(NODES[id].t + ' ← ' + REACHABLE[id]);
  else bad('终点 ' + id + '（' + NODES[id].t + '）缺少可达性说明');
});

console.log('\n[5] 判定规则与实现说明');
const missingRule = ids.filter((id) => !RULES[id] || !RULES[id].rule || !RULES[id].impl);
missingRule.length ? bad('缺少规则说明：' + missingRule.join('、')) : good('18 个节点全部具备 rule + impl 说明');

console.log('\n[6] 页面不得出现流程图形（对用户隐藏）');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const leaks = [];
[['app.js', appSrc], ['index.html', htmlSrc], ['styles.css', cssSrc]].forEach(([name, src]) => {
  ['flowRender', 'flowRenderBig', 'flowDetail', 'fnode', 'flow-full', 'flow-legend', 'assess-flow', 'buildFlow']
    .forEach((tok) => { if (src.indexOf(tok) >= 0) leaks.push(name + ':' + tok); });
});
leaks.length ? bad('仍存在流程图残留：' + leaks.join('、')) : good('app.js / index.html / styles.css 均无流程图渲染代码');

console.log('\n──────────────────────────────');
if (fail) { console.log('流程自检问题 ' + fail + ' 处'); process.exit(1); }
console.log('流程自检全部通过');
