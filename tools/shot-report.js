/* 生成页面快照用于人工检查视觉
   运行：node tools/shot-report.js [report|top]                                  */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = path.join(__dirname, '..');
const shotDir = path.join(__dirname, '_shot');
fs.mkdirSync(shotDir, { recursive: true });

const mode = process.argv[2] || 'report';
const html = fs.readFileSync(path.join(root, 'huixin-web-standalone.html'), 'utf8');

const reportScript = `
<script>
(function () {
  const next = () => document.getElementById('nextBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.getElementById('diary').value = '这几天小腹坠胀，晚上失眠，什么都不想做，很烦躁';
  document.querySelectorAll('input[name="symptom"]')[1].checked = true;
  document.querySelectorAll('input[name="symptom"]')[5].checked = true;
  next();
  const emo = document.querySelectorAll('input[name="emotion"]');
  emo[2].checked = true; emo[3].checked = true; emo[4].checked = true;
  document.getElementById('duration').value = 'week';
  document.getElementById('intensity').value = '8';
  document.getElementById('intensity').dispatchEvent(new Event('input', { bubbles: true }));
  next();
  document.getElementById('lastPeriod').value = new Date(Date.now() - 25 * 86400000).toISOString().slice(0, 10);
  document.getElementById('sleep').value = 'lt6';
  document.getElementById('pain').value = 'mid';
  document.getElementById('stress').value = 'high';
  next(); next();
  document.getElementById('hero').style.display = 'none';
  document.getElementById('feature2').style.display = 'none';
  document.getElementById('tools').style.display = 'none';
  document.getElementById('about').style.display = 'none';
  window.scrollTo(0, 0);
})();
</script>
`;

const topScript = `
<script>
(function () {
  document.getElementById('feature2').style.display = 'none';
  document.getElementById('tools').style.display = 'none';
  document.getElementById('about').style.display = 'none';
  window.scrollTo(0, 0);
})();
</script>
`;

const script = mode === 'top' ? topScript : reportScript;
const page = path.join(shotDir, mode + '.html');
fs.writeFileSync(page, html.replace('</body>', script + '</body>'), 'utf8');

execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--virtual-time-budget=9000', '--window-size=' + (mode === 'top' ? '1440,2600' : '1440,2100'),
  '--screenshot=' + path.join(shotDir, mode + '.png'),
  'file:///' + page.split(path.sep).join('/')], { encoding: 'utf8' });

console.log('已生成快照：' + path.join(shotDir, mode + '.png'));
