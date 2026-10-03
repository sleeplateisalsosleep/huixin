/* 校验打包产物：抽出内联脚本逐段做语法检查，并统计关键内容 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'huixin-web-standalone.html');
const html = fs.readFileSync(file, 'utf8');
console.log('产物大小：' + (html.length / 1024).toFixed(1) + ' KB');

const blocks = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) blocks.push(m[1]);
console.log('内联脚本块：' + blocks.length + ' 个（' + blocks.map((b) => (b.length / 1024).toFixed(1) + 'KB').join(', ') + '）');

let fail = 0;
blocks.forEach((code, i) => {
  try {
    new vm.Script(code, { filename: 'inline-' + i + '.js' });
    console.log('  ✓ 脚本块 ' + i + ' 语法正确');
  } catch (e) {
    fail++;
    console.log('  ✗ 脚本块 ' + i + ' 语法错误：' + e.message);
  }
});

const must = [
  ['样式已内联', /--teal-600:#27887a/],
  ['护理计划面板已内联', /id="planList"/],
  ['知识库已内联', /月经周期是怎样运转的/],
  ['封面已内联为 data URI', /src="data:image\/svg\+xml;base64,/],
  ['无外链 css', /<link rel="stylesheet"/],
  /* 内部流程图仅作开发依据，不得进入交付产物 */
  ['产物不含流程图形', /flowRender|fnode|buildFlow|HX_FLOW/]
];
must.forEach(([name, re2]) => {
  const hit = re2.test(html);
  const expectHit = name !== '无外链 css' && name !== '产物不含流程图形';
  if (hit === expectHit) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name); }
});

console.log(fail ? '\n打包校验失败 ' + fail + ' 项' : '\n打包校验通过');
process.exit(fail ? 1 : 0);
