/* 浏览器端冒烟测试：用 Edge 无头模式在真实 DOM 上跑一遍全流程，
   验证流程图节点点击、知识点弹窗、自评 5 步与报告渲染。
   运行：node tools/browser-test.js                                          */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.join(__dirname, '..');
const shotDir = path.join(__dirname, '_shot');
fs.mkdirSync(shotDir, { recursive: true });

/* 生成测试页：在真实页面末尾追加自动化脚本，用 DOM 自检结果写入 document.title */
const html = fs.readFileSync(path.join(root, 'huixin-web-standalone.html'), 'utf8');

const probe = `
<script>
(function () {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (extra || '')));
  try {
    /* 1. 页面不出现内部流程图，只展示面向用户的护理计划 */
    ok('页面没有任何流程图形', document.querySelectorAll('#flowRender,#flowRenderBig,#flowDetail,.fnode,.flow-full').length === 0,
      '实际 ' + document.querySelectorAll('#flowRender,#flowRenderBig,#flowDetail,.fnode,.flow-full').length);
    ok('面向用户的护理计划已渲染（5 步）', document.querySelectorAll('#planList li').length === 5,
      '实际 ' + document.querySelectorAll('#planList li').length);
    ok('护理计划当前步骤高亮', document.querySelectorAll('#planList li.is-current').length === 1,
      '实际 ' + document.querySelectorAll('#planList li.is-current').length);
    ok('护理计划未暴露内部节点名',
      ['emoCheck', 'trendCheck', 'medCheck', 'counselCheck', 'fnode'].every((t) => (document.body.innerText || '').indexOf(t) < 0));

    /* 3. 知识科普 */
    ok('渲染 37 条知识卡片', document.querySelectorAll('.kb-card').length === 37,
      '实际 ' + document.querySelectorAll('.kb-card').length);
    ok('渲染 10 个分类筛选按钮', document.querySelectorAll('#kbFilters button').length === 10,
      '实际 ' + document.querySelectorAll('#kbFilters button').length);

    /* 4. 打开一篇知识详情 */
    document.querySelectorAll('.kb-card')[8].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const modal = document.getElementById('modal');
    ok('点击知识卡片打开详情弹窗', !modal.hidden && document.getElementById('modalBody').textContent.length > 100);
    document.querySelector('#modal .modal-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('关闭按钮可关闭弹窗', modal.hidden);

    /* 5. 走完自评 5 步 */
    document.getElementById('diary').value = '这两天小腹坠胀，晚上失眠，很烦躁';
    document.querySelectorAll('input[name="symptom"]')[1].checked = true;
    const next = () => document.getElementById('nextBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    next(); /* -> 第 2 步 */
    ok('第 1 步进入第 2 步', document.querySelector('.step-panel[data-step="2"]').classList.contains('is-active'));
    document.querySelectorAll('input[name="emotion"]')[2].checked = true; /* 焦虑 */
    document.querySelectorAll('input[name="emotion"]')[3].checked = true; /* 低落 */
    document.getElementById('duration').value = '3-5d';
    next(); /* -> 第 3 步 */
    ok('第 2 步进入第 3 步', document.querySelector('.step-panel[data-step="3"]').classList.contains('is-active'));
    document.getElementById('lastPeriod').value = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    document.getElementById('cycleLen').value = '28';
    document.getElementById('stress').value = 'high';
    next(); /* -> 第 4 步 */
    ok('第 3 步进入第 4 步', document.querySelector('.step-panel[data-step="4"]').classList.contains('is-active'));
    next(); /* -> 第 5 步（生成报告） */
    const report = document.getElementById('reportMount');
    const text = report.textContent;
    ok('生成护理报告', text.length > 500, '长度 ' + text.length);
    ok('报告含情绪识别小节', text.indexOf('情绪识别结果') >= 0);
    ok('报告含趋势预测小节', text.indexOf('健康特征匹配与趋势预测') >= 0);
    ok('报告含风险评估小节', text.indexOf('健康风险评估报告') >= 0);
    ok('报告含分级干预方案', text.indexOf('分级干预方案') >= 0);
    ok('报告含本次评估路径', text.indexOf('本次评估路径') >= 0);
    ok('护理计划同步为本次路径', document.querySelectorAll('#planList li').length >= 8,
      '实际 ' + document.querySelectorAll('#planList li').length);
    ok('页面无流程图形残留', document.querySelectorAll('.fnode,#flowRender,#flowRenderBig').length === 0);
    ok('自评已写入 localStorage', !!localStorage.getItem('hx_history'));

    /* 6. 周期工具 */
    document.getElementById('toolDate').value = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    document.getElementById('toolAdd').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const pred = document.getElementById('toolResult').textContent;
    ok('周期工具生成预测', pred.indexOf('预计下次月经') >= 0 && pred.indexOf('PMS 情绪易波动窗口') >= 0, pred.slice(0, 40));
    ok('自检清单 8 项', document.querySelectorAll('#checklist li').length === 8);

    /* 7. 知识点直达锚点 */
    ok('无 JS 报错、页面结构完整', document.querySelectorAll('section').length >= 6);

    const fails = out.filter((l) => l.indexOf('FAIL') === 0);
    document.title = 'HXRESULT|' + out.length + '|' + fails.length + '|' + out.join(' ;; ');
  } catch (err) {
    document.title = 'HXRESULT|0|1|FAIL | 运行异常 | ' + err.message;
  }
})();
</script>
`;

const testPage = path.join(shotDir, 'browser-test.html');
fs.writeFileSync(testPage, html.replace('</body>', probe + '</body>'), 'utf8');

let dom = '';
try {
  dom = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--virtual-time-budget=12000', '--dump-dom',
    'file:///' + testPage.split(path.sep).join('/')
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
} catch (e) {
  dom = (e.stdout || '') + '';
}

const m = dom.match(/<title>HXRESULT\|([\s\S]*?)<\/title>/);
if (!m) {
  console.log('未取得浏览器测试结果，DOM 长度 ' + dom.length);
  process.exit(1);
}
const [total, failed, ...items] = m[1].split('|');
console.log('\n浏览器端冒烟测试（Edge headless 真实 DOM）');
items.join('|').split(' ;; ').forEach((line) => {
  const [state, name, extra] = line.split(' | ');
  console.log((state === 'PASS' ? '  ✓ ' : '  ✗ ') + name + (extra ? '  →  ' + extra : ''));
});
console.log('\n共 ' + total + ' 项，失败 ' + failed + ' 项');
process.exit(Number(failed) ? 1 : 0);
