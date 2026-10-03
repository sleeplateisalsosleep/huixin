/* ============================================================
   蕙心网 · 情绪健康护理流程 —— 实现依据（仅开发/自检使用，不进入页面）
   ------------------------------------------------------------------
   这份文件是需求流程图的文字化落地：节点、连线、分支标签、每段的判定规则。
   · app.js 依据 FLOW_META 里的 rule / impl 决定分支走向，但不渲染任何流程图；
   · tools/layout-check.js 用它校验拓扑自洽（严格照图实现，不做图形输出）；
   · 该文件不参与 index.html 与单文件产物的打包，用户看不到任何流程图形。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HX_FLOW_SPEC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 节点：kind = terminal(起止) | process(处理) | decision(判断分支) */
  const NODES = {
    start: { kind: 'terminal', t: '开始' },
    input: { kind: 'process', t: '用户输入：文字日记 / 情绪标签 / 身体感受' },
    identify: { kind: 'process', t: '情绪识别' },
    emotype: { kind: 'process', t: '识别焦虑、低落、烦躁、平静等情绪类型' },
    emoCheck: { kind: 'decision', t: '负面情绪是否过多？' },
    bless: { kind: 'process', t: '健康祝福激励短语' },

    trend: { kind: 'process', t: '预测情绪趋势' },
    heathfeat: { kind: 'process', t: '健康特征匹配' },
    trendCheck: { kind: 'decision', t: '是否持续负面情绪？' },
    suggest: { kind: 'process', t: '正念冥想建议' },

    severe: { kind: 'process', t: '情绪重度异常' },
    risk: { kind: 'process', t: '健康风险评估报告' },
    medCheck: { kind: 'decision', t: '是否进入正念冥想' },
    medOut: { kind: 'process', t: '小程序输出冥想内容' },

    soothe: { kind: 'process', t: '对应情绪抚平安慰' },
    counselCheck: { kind: 'decision', t: '是否需要心理咨询' },
    counselOut: { kind: 'process', t: '心理咨询推荐、生活需求商品优惠券等' },
    lifeHappy: { kind: 'process', t: '祝福生活愉快' }
  };

  /* 连线：lab 为流程图上的分支标签 */
  const EDGES = [
    { f: 'start', t: 'input' },
    { f: 'input', t: 'identify' },
    { f: 'identify', t: 'emotype' },
    { f: 'emotype', t: 'emoCheck' },
    { f: 'emoCheck', t: 'bless', lab: '否' },
    { f: 'emoCheck', t: 'trend', lab: '是' },
    { f: 'trend', t: 'heathfeat' },
    { f: 'heathfeat', t: 'trendCheck' },
    { f: 'trendCheck', t: 'suggest', lab: '否' },
    { f: 'trendCheck', t: 'severe', lab: '是' },
    { f: 'severe', t: 'risk' },
    { f: 'risk', t: 'medCheck' },
    { f: 'medCheck', t: 'medOut', lab: '是' },
    { f: 'medCheck', t: 'soothe', lab: '否' },
    { f: 'medOut', t: 'counselCheck' },
    { f: 'soothe', t: 'counselCheck' },
    { f: 'counselCheck', t: 'counselOut', lab: '是' },
    { f: 'counselCheck', t: 'lifeHappy', lab: '否' }
  ];

  /* 每条分支的判定规则与页面实现说明（app.js 的 analyze() 按此实现） */
  const RULES = {
    start: { rule: '用户进入「情绪自评」入口，开始一次护理流程。', impl: '点击「开始情绪自评」进入 #assessment，state.step = 1。' },
    input: { rule: '接收三类输入：文字日记、情绪标签、身体感受。', impl: '第 1 步：日记文本域 + 9 项身体感受多选。' },
    identify: { rule: '从输入中识别焦虑、低落、烦躁、平静等情绪类型。', impl: '第 2 步情绪标签多选，叠加日记负面关键词匹配。' },
    emotype: { rule: '输出识别到的情绪类型清单。', impl: 'NEG / 非 NEG 分类统计为 negs 与 poss。' },
    emoCheck: { rule: '负面标签 ≥ 2 项，或日记命中负面词，或影响程度 ≥ 5，即判定为「过多」。', impl: 'emoOver = redFlag || negScore >= 2 || intensity >= 5。' },
    bless: { rule: '否：情绪平稳，返回健康祝福与激励短语。', impl: 'branch = "bless"，输出祝福与激励卡片。' },
    trend: { rule: '是：继续结合健康特征预测情绪走向。', impl: '进入第 3 步采集周期、睡眠、疼痛、压力。' },
    heathfeat: { rule: '把周期阶段、睡眠、疼痛、压力与情绪做匹配。', impl: 'dayOfCycle 推算周期第几天与阶段，与睡眠/疼痛/压力加权匹配。' },
    trendCheck: { rule: '持续 ≥ 3 天或反复两周以上，或影响 ≥ 7 且压力大；高危项、影响 ≥ 9、重度评分 ≥ 6 也直接进入。', impl: 'persistent || forceSevere 判定为持续负面情绪。' },
    suggest: { rule: '否：给出正念冥想与呼吸练习建议。', impl: 'branch = "suggest"，风险等级记为低。' },
    severe: { rule: '是：判定为情绪重度异常，启动健康风险评估。', impl: 'branch = "severe"，计算 severeScore 与风险等级。' },
    risk: { rule: '生成健康风险评估报告，明确风险等级与建议层级。', impl: '第 5 步输出五段式报告（含风险评分条）。' },
    medCheck: { rule: '风险等级为低 / 中且无自伤念头时，进入正念冥想干预。', impl: 'meditation = riskLevel !== "high" && !psychFlag。' },
    medOut: { rule: '是：输出冥想引导内容。', impl: '渲染「小程序输出冥想内容」卡片。' },
    soothe: { rule: '否：先用情绪安抚与陪伴内容降低当下张力。', impl: '渲染「情绪抚平安慰」+ 即时舒缓三步。' },
    counselCheck: { rule: '高风险、自伤念头、影响 ≥ 8 或持续两周以上时建议心理咨询。', impl: 'counseling 判定。' },
    counselOut: { rule: '是：推荐心理咨询资源，并提供生活需求类商品优惠券。', impl: '输出咨询渠道、就医科别、示例优惠券。' },
    lifeHappy: { rule: '否：以祝福语收束流程。', impl: '输出祝福语并保存本次自评到 localStorage。' }
  };

  /* 分支可达性断言：供自检脚本核对"每条分支都有真实触发条件" */
  const REACHABLE = {
    bless: 'emoCheck = 否',
    suggest: 'emoCheck = 是 → trendCheck = 否',
    medOut: 'emoCheck = 是 → trendCheck = 是 → medCheck = 是',
    soothe: 'emoCheck = 是 → trendCheck = 是 → medCheck = 否',
    counselOut: '… → counselCheck = 是',
    lifeHappy: '… → counselCheck = 否'
  };

  return { NODES: NODES, EDGES: EDGES, RULES: RULES, REACHABLE: REACHABLE };
});
