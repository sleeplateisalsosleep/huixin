# 蕙心网 · 女性生理期健康护理网站

面向女性经期健康的护理 + 科普站点，包含两个核心功能：

- **核心功能一 · 情绪健康智能护理流程**：情绪识别 → 情绪趋势预测（健康特征匹配）→ 健康风险评估报告 → 分级干预（正念冥想 / 情绪安抚 / 心理咨询推荐 + 生活需求优惠券 / 祝福生活愉快）。
- **核心功能二 · 生理知识科普**：9 个分类、37 条知识，支持关键词搜索、分类筛选与详情弹窗，并支持注册用户投稿、管理员后台审核。

> **需求流程图对用户隐藏**：流程图只是开发依据。页面不渲染任何流程图、节点或"逻辑说明"，
> 用户侧只看到「本次护理计划」的分步文字说明与最终的评估路径。流程定义放在 `docs/flow-spec.js`，
> 不参与 `index.html` 与单文件产物的打包（`tools/layout-check.js` 会校验这一点）。

## 线上地址

| 端 | 地址 | 说明 |
| --- | --- | --- |
| 前端 | https://sleeplateisalsosleep.github.io/huixin/ | GitHub Pages 静态托管，push 到 `main` 即自动发布 |
| 后端 | https://1500436464-bo5m9jc0s9.ap-guangzhou.tencentscf.com | 腾讯云 SCF Web 函数（函数名 `huixin-api`，广州，Python 3.10，监听 9000） |
| 备用后端 | https://huixin-bsm2.vercel.app | Vercel Serverless，同一套 Flask 代码；国内 vercel.app 被 DNS 污染 / SNI 封锁，**前端不指向它**，仅备用 |

## 技术架构

```
浏览器（index.html / 单文件版，app.js 统一服务层）
   │
   ├─ GitHub Pages（静态前端）
   │     fetch /api/*  ──HTTPS + CORS──▶  腾讯云 SCF Web 函数（Flask：backend/app.py）
   │                                        ├─ Turso（libsql 云数据库）
   │                                        └─ 163 SMTP（邮箱验证码）
   │
   └─ 本地 / file:// 打开：自动回退本地模式（localStorage 或本地 sqlite，不联网）
```

**API 地址自动切换**（[app.js](app.js) `API_BASE`）：

- `localhost` / `127.0.0.1`：走相对路径，由本地 Flask 同源提供 API；
- `file://`（双击单文件版）：纯本地模式，数据只存浏览器 `localStorage`；
- 其他域名：走 `REMOTE_API_BASE`（当前为 SCF 公网地址），可用 `window.HX_API_BASE` 运行时覆盖。

**数据库双模式**（`backend/db.py`）：设置了 `TURSO_DATABASE_URL` 环境变量时走 libsql 远程库（Turso），否则使用本地 `data/huixin.db`（sqlite）。本地开发、Vercel、SCF 跑的是同一套 Flask 代码。

## 快速开始（本地）

| 方式 | 命令 / 文件 | 说明 |
| --- | --- | --- |
| 离线体验 | 双击 `huixin-web-standalone.html` | 单文件、样式脚本全内联，纯本地 `localStorage`，不联网 |
| 完整本地开发（推荐） | `python server.py` 后访问 http://127.0.0.1:8200 | 静态页 + API 同源，账号、投稿、测评同步等全部链路可用，数据落 `data/huixin.db` |
| 仅静态页 | `python -m http.server` 后访问 `index.html` | 无后端，API 探测失败后自动回退本地模式 |

## 账号体系

- **注册**：邮箱 + 验证码 + 设置密码（密码 ≥ 6 位）。
- **登录**：支持「邮箱 + 密码」和「邮箱验证码」两种方式。
- **忘记密码**：通过邮箱验证码重置密码。
- **用户中心**：登录后点击右上角「你好，xxx」进入，可查看账号信息并**注销账号**（级联删除本人全部数据）。管理员账号禁止自助注销（前后端双重拦截），防止唯一管理员被删后后台失管。
- **管理员**：由环境变量 `HX_ADMIN_EMAIL` 指定，登录后可进入后台审核知识投稿、查看用户、反馈与统计。
- 未登录或本地模式下，自评结果与周期记录只写入浏览器 `localStorage`。

## 目录结构

```
huixin-web/
├─ index.html                  线上前端页面（Pages 发布此外链版本）
├─ styles.css                  设计令牌与全站样式（响应式 / 打印 / 减少动效）
├─ app.js                      业务逻辑：自评状态机、护理计划、知识库、认证、统一服务层
├─ assets/                     cover.svg 首屏主视觉、logo 等
├─ huixin-web-standalone.html  单文件离线产物（构建生成，勿手改）
├─ server.py                   本地开发入口（默认 127.0.0.1:8200，静态页 + API 同源）
├─ requirements.txt            Python 依赖
├─ vercel.json                 Vercel 路由重写（/api/* → api/index.py）
├─ backend/                    Flask 后端（本地 / Vercel / SCF 共用）
│  ├─ app.py                   应用工厂与全部 /api/* 路由（认证、卡片、反馈、测评同步、管理后台）
│  ├─ db.py                    双模式数据库层（Turso libsql / 本地 sqlite）
│  ├─ security.py              令牌生成与校验、密码哈希
│  └─ kb_seed.json             知识库初始数据
├─ api/
│  └─ index.py                 Vercel Serverless 入口（复用 backend.app:create_app）
├─ scf/                        腾讯云 SCF Web 函数部署素材
│  ├─ scf_bootstrap            函数启动脚本（设置 PYTHONPATH/PORT=9000，自动探测 python3）
│  ├─ scf_server.py            waitress 启动 Flask
│  └─ requirements.txt         函数依赖
├─ tools/
│  ├─ build_standalone.py      打包单文件 HTML（发布前必跑，须输出 leftovers: none）
│  ├─ build_scf.py             打包 SCF 函数 → dist_scf/huixin-scf.zip
│  ├─ smoke-serverless.py      后端双模式冒烟（sqlite / libsql 两个参数）
│  ├─ layout-check.js          流程拓扑自检 + 校验页面无流程图形残留
│  ├─ smoke-test.js            离线前端业务自检
│  ├─ browser-test.js          浏览器真实 DOM 自检（需 Edge）
│  ├─ verify-standalone.js     校验单文件产物
│  └─ shot-report.js           生成页面快照供人工检查
├─ dist_scf/                   构建产物（huixin-scf.zip 等），.gitignore 不入库
├─ data/                       本地 sqlite 与 SMTP 配置，.gitignore 不入库（含密钥，严禁提交）
├─ docs/
│  └─ flow-spec.js             需求流程图的文字化落地（仅开发与自检使用）
└─ .trae/skills/huixin-release/  发布流程 Skill 与线上验证脚本（本地 Trae 目录，.gitignore 不入库）
```

## 核心功能一的分支实现（对用户不可见）

| 流程判定 | 页面实现 |
| --- | --- |
| 开始 | 点击「开始情绪自评」进入 `#assessment` |
| 用户输入：文字日记 / 情绪标签 / 身体感受 | 第 1 步：日记文本域 + 9 项身体感受多选 |
| 情绪识别 / 识别情绪类型 | 第 2 步：8 类情绪标签多选 + 日记负面关键词匹配 |
| 负面情绪是否过多？ | `emoOver = 红旗项 \|\| 负面计分 ≥ 2 \|\| 影响程度 ≥ 5` |
| 否 → 健康祝福激励短语 | 输出「健康祝福 · 继续保持」与激励短语 |
| 是 → 预测情绪趋势 / 健康特征匹配 | 第 3 步：周期日期、周期与经期长度、睡眠、疼痛、压力 |
| 是否持续负面情绪？ | `persistent = 红旗项 \|\| 持续 3 天以上 \|\|（影响 ≥ 7 且压力大）`；另设 `forceSevere`（红旗 / 影响 ≥ 9 / 重度评分 ≥ 6）避免高危漏判 |
| 否 → 正念冥想建议 | 输出 4-7-8 呼吸、身体扫描、情绪日记三张卡片 |
| 是 → 情绪重度异常 → 健康风险评估报告 | 第 4 步风险筛查 + 第 5 步生成报告（含风险等级与评分条） |
| 是否进入正念冥想？ | `meditation = 风险等级 ≠ 高 且 无自伤念头` |
| 是 → 小程序输出冥想内容 | 输出 10 分钟冥想引导卡片（对应小程序端能力） |
| 否 → 对应情绪抚平安慰 | 输出共情语句 + 即时舒缓三步 |
| 是否需要心理咨询？ | `counseling = 高风险 \|\| 自伤念头 \|\| 影响 ≥ 8 \|\| 持续两周以上` |
| 是 → 心理咨询推荐、生活需求商品优惠券等 | 输出咨询渠道、就医科别提示、示例优惠券 `HX-CARE20` |
| 否 → 祝福生活愉快 | 输出祝福语并保存本次自评 |

红旗项（自伤念头 / 大出血 / 月经推迟 10 天以上 / 晕厥剧痛发热）会置顶「请优先就医」提示，并给出心理援助热线 **12356**。

**用户侧看到的替代内容**：右侧「本次护理计划」按步骤给出文字说明（第 1～5 步），
完成后切换为本次评估路径的中文说明（如「填写感受 → 情绪识别 → 判断负面情绪是否过多 → … → 心理咨询与生活支持推荐」），
报告包含 ① 情绪识别结果 ② 健康特征匹配与趋势预测 ③ 健康风险评估报告 ④ 分级干预方案 ⑤ 本次评估路径。

## 核心功能二的科普分类

周期基础（5）· 经期护理（3）· 痛经与不适（3）· 经期营养（4）· 经期运动（3）· 情绪与 PMS（4）· 卫生用品（3）· 常见误区（6）· 就医与检查（6）

## 部署与发布流程

双端发布：**前端** push 到 GitHub `main` 即由 Pages 自动发布；**后端**只有改了代码才需要在 SCF 控制台重新上传 zip。完整分步流程见 Trae 项目 Skill `.trae/skills/huixin-release/SKILL.md`，摘要如下。

### 1. 判断改动面

| 改动文件 | 前端 Pages | 后端 SCF |
| --- | --- | --- |
| `index.html` `styles.css` `app.js` `assets/` | 必须 push | 否 |
| `huixin-web-standalone.html` | 随 push 发布 | 否 |
| `backend/` `scf/` `api/` `requirements.txt` `vercel.json` | 否 | 必须重新上传 zip |
| 同时改了 `app.js` 和 `backend/` | 必须 | 必须 |
| 仅 `README.md` 等文档 | 随 push 更新文档 | 否 |

不确定时按"两端都发"处理。

### 2. 本地校验

```powershell
# Python 语法检查
python -c "import ast,glob; [ast.parse(open(f,encoding='utf-8').read()) for f in glob.glob('backend/*.py')]"
# 后端双模式冒烟（本地 sqlite + 远程 Turso 各一遍）
python tools/smoke-serverless.py sqlite
python tools/smoke-serverless.py libsql
# 涉及认证等核心链路时，起本地服务做接口级冒烟后再停掉
python server.py   # http://127.0.0.1:8200
```

### 3. 构建

```powershell
python tools/build_standalone.py   # 每次发布必做，确认输出 leftovers: none
python tools/build_scf.py          # 仅后端改动时需要，产物 dist_scf/huixin-scf.zip（约 5.8MB）
```

### 4. 提交并推送（前端发布）

把改动同步到 git 克隆目录后提交（`data/`、`dist_scf/` 已在 `.gitignore`，**绝不提交密钥或数据库**）：

```powershell
git add -A
git commit -m "feat: 简明描述"   # 前缀用 feat/fix/chore/refactor/docs
git push origin main
```

push 后等待约 60 秒，Pages 即完成构建。

### 5. 后端改动：重新部署云函数（控制台手动）

仅当步骤 1 判断后端受影响时执行：

1. 登录腾讯云控制台 → SCF → 函数 `huixin-api`（广州）→ 函数代码；
2. 「上传/更新代码」选择本机构建的 `dist_scf/huixin-scf.zip` → 部署，等待状态变绿；
3. 环境变量在控制台维护，换包不会清除；**运行环境必须为 Python 3.10**（3.6 会因 libssl 版本缺失无法连接 Turso）。

纯前端 / 文档改动**不需要动云函数**。

### 6. SCF 环境变量清单（控制台配置，不在代码包内）

| 变量 | 示例 / 说明 |
| --- | --- |
| `TURSO_DATABASE_URL` | `libsql://xxx.turso.io`，配置后走云数据库；不配置则回退本地 sqlite（云函数环境应始终配置） |
| `TURSO_AUTH_TOKEN` | Turso 访问令牌 |
| `HX_SMTP_HOST` / `HX_SMTP_PORT` / `HX_SMTP_TLS` | `smtp.163.com` / `465` / `1` |
| `HX_SMTP_USER` / `HX_SMTP_FROM` | 发件邮箱（当前为 163 邮箱） |
| `HX_SMTP_PASS` | 邮箱 SMTP 授权码（非登录密码） |
| `HX_ADMIN_EMAIL` | 管理员邮箱，登录后自动获得 admin 角色 |
| `HX_SKIP_AUTO_INIT` | `1`，跳过自动初始化（知识库等由 seed 流程处理） |

### 7. 发布后线上验证

SCF 冷启动首次请求可能需要 10–30 秒，HTTP 客户端超时建议设到 90 秒。运行线上冒烟脚本：

```powershell
python .trae/skills/huixin-release/scripts/verify-production.py
```

脚本检查：后端 health、CORS 与 `X-Auth-Token` 头、认证新接口（`login-email` 未注册返回 401、`delete-account` 无 token 返回 401）、`send-code` 的 `exists` 字段、Pages 上 `app.js` 的版本标记。全部 PASS 才算发布完成；任何 FAIL 先修复再宣告成功。

> `.trae/` 是本机 Trae 技能目录（已被 `.gitignore`），脚本随 `huixin-release` 技能保存在工作副本中。

## 前端自检命令

```bash
node tools/layout-check.js       # 流程拓扑 + 页面无流程图形残留
node tools/smoke-test.js         # 离线业务自检
python tools/build_standalone.py # 打包单文件（须输出 leftovers: none）
node tools/verify-standalone.js  # 校验打包产物（含"不含流程图形"断言）
node tools/browser-test.js       # 浏览器真实 DOM 自检（需 Edge）
node tools/shot-report.js top    # 生成页面快照（top / report）
```

## 免责声明

本站为健康教育与自我观察工具，**不构成医疗诊断或处方**，不能替代执业医师的面诊、检查与治疗。周期预测基于历史记录推算，不可用于避孕或备孕决策。出现剧烈腹痛、大量出血、晕厥、发热或自伤念头时，请立即就医或联系当地急救 / 心理援助热线。
