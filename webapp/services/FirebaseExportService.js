sap.ui.define([], function () {
  "use strict";

  function pad2(n){ return String(n).padStart(2, "0"); }

  function monthsBetween(start, end) {
    const out = [];
    if (!(start instanceof Date) || !(end instanceof Date)) return out;
    let y = start.getFullYear(), m = start.getMonth();
    const y2 = end.getFullYear(), m2 = end.getMonth();
    while (y < y2 || (y === y2 && m <= m2)) {
      out.push({ y, m: m + 1 });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return out;
  }

  function toUrl(p) { return sap.ui.require.toUrl(p); }

  function fetchMonthlyLocal(y, m) {
    return new Promise(function(resolve){
      const mm = pad2(m);
      const url = toUrl("com/skysinc/frota/frota/model/localdata/" + y + "/" + mm + "/abastecimentos.json");
      jQuery.ajax({ url: url, dataType: "json", cache: false, success: (d)=> resolve(d), error: ()=> resolve(null) });
    });
  }

  function asBlob(obj) {
    const json = JSON.stringify(obj || {}, null, 2);
    try {
      return new Blob([json], { type: "application/json" });
    } catch (e) {
      // IE fallback not needed here
      return null;
    }
  }

  function exportMonth(y, m) {
    return fetchMonthlyLocal(y, m).then(function (data) {
      if (!data) return { ok: false, reason: "not-found" };
      return { ok: true, data: data };
    });
  }

  function exportRange(start, end) {
    const months = monthsBetween(start, end);
    const results = [];
    let chain = Promise.resolve();
    months.forEach(function (it) {
      chain = chain.then(function(){
        return exportMonth(it.y, it.m).then(function (r) {
          results.push({ y: it.y, m: it.m, result: r });
        }).catch(function (e) {
          results.push({ y: it.y, m: it.m, result: { ok: false, reason: String(e && e.message || e) } });
        });
      });
    });
    return chain.then(function(){ return results; });
  }

  return {
    exportMonth: exportMonth,
    exportRange: exportRange
  };
});
