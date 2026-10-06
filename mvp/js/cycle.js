/* ============================================================
   cycle.js — 月经周期推算纯函数（移植自主站 app.js）
   无依赖，可独立测试
   ============================================================ */
(function (global) {
  'use strict';

  var DAY_MS = 86400000;

  function dateOnly(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** 'YYYY-MM-DD' 本地日期 */
  function isoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysBetween(fromIso, toDate) {
    var a = dateOnly(fromIso + 'T00:00:00');
    var b = dateOnly(toDate);
    return Math.round((b - a) / DAY_MS);
  }

  /** 周期阶段：月经期 / 卵泡期 / 排卵期 / 黄体期（经前期） */
  function stageOf(day, cycleLen) {
    var ovu = Math.round(cycleLen / 2);
    if (day <= 5) return '月经期';
    if (day < ovu - 1) return '卵泡期';
    if (day <= ovu + 1) return '排卵期';
    return '黄体期（经前期）';
  }

  /**
   * 相对于指定日期的周期信息。
   * @returns {{day:number, stage:string, daysToNext:number}|null}
   */
  function cycleInfo(lastPeriod, cycleLen, refDate) {
    if (!lastPeriod) return null;
    var start = dateOnly(lastPeriod + 'T00:00:00');
    if (isNaN(start.getTime())) return null;
    var ref = dateOnly(refDate || new Date());
    var diff = Math.round((ref - start) / DAY_MS);
    if (diff < 0) return { day: 0, stage: '未知', daysToNext: null, future: true };
    var day = (diff % cycleLen) + 1;
    var daysToNext = cycleLen - day + 1; // 距下次月经第 1 天
    return { day: day, stage: stageOf(day, cycleLen), daysToNext: daysToNext, future: false };
  }

  /** 某历史日期的阶段（趋势色带用） */
  function stageAtDate(lastPeriod, cycleLen, dateIso) {
    var info = cycleInfo(lastPeriod, cycleLen, dateOnly(dateIso + 'T00:00:00'));
    return info ? info.stage : '未知';
  }

  /** PMS 易波动窗口：下次经期前 7 天内（黄体期末段）或经期第 1-2 天 */
  function inPmsWindow(info) {
    if (!info || info.future) return false;
    return info.stage === '黄体期（经前期）' && info.daysToNext <= 7;
  }

  global.Cycle = {
    isoDate: isoDate,
    daysBetween: daysBetween,
    stageOf: stageOf,
    cycleInfo: cycleInfo,
    stageAtDate: stageAtDate,
    inPmsWindow: inPmsWindow
  };
})(window);
