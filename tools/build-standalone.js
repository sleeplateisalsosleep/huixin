/* 蕙心网 · 单文件打包
   把 styles.css / app.js / assets/cover.svg 内联进一个 HTML，
   生成可离线双击打开的 huixin-web-standalone.html
   （docs/flow-spec.js 是开发依据，不参与打包，用户看不到内部流程图）
   运行：node tools/build-standalone.js                                     */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const cover = read('assets/cover.svg');
const coverData = 'data:image/svg+xml;base64,' + Buffer.from(cover, 'utf8').toString('base64');

/* 注意：必须用替换「函数」而不是替换字符串，
   否则源码里的 $$ 会被 String.replace 当作转义序列吃成单个 $（曾导致 const $$ 退化为 const $） */
html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  () => '<style>\n' + css + '\n</style>'
);
html = html.replace('src="assets/cover.svg"', () => 'src="' + coverData + '"');
html = html.replace(
  '<script src="app.js"></script>',
  () => '<script>\n' + app + '\n</script>'
);

const out = path.join(root, 'huixin-web-standalone.html');
fs.writeFileSync(out, html, 'utf8');

const leftovers = ['styles.css', 'app.js', 'flow-map.js', 'assets/cover.svg']
  .filter((f) => html.indexOf('"' + f + '"') >= 0);
console.log('已生成：' + out);
console.log('大小：' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
console.log(leftovers.length ? '⚠ 仍有外链未内联：' + leftovers.join('、') : '✓ 全部资源已内联，可离线打开');
