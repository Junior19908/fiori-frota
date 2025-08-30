sap.ui.define([], function () {
  "use strict";

  function parseAnyDate(v) {
    if (!v) return null;
    if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0,0,0,0);
    const s = String(v).trim();
    const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mIso) return new Date(+mIso[1], +mIso[2]-1, +mIso[3], 0,0,0,0);
    const mBr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (mBr) return new Date(+mBr[3], +mBr[2]-1, +mBr[1], 0,0,0,0);
    return null;
  }

  function currentRange(oDateRangeSelection) {
    if (!oDateRangeSelection) return null;
    const d1 = oDateRangeSelection.getDateValue();
    const d2 = oDateRangeSelection.getSecondDateValue();
    if (!d1 || !d2) return null;
    const start = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 0,0,0,0);
    const end   = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23,59,59,999);
    return [start, end];
  }

  function ymd(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function numBR(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number" && isFinite(v)) return v;
    const s = String(v).trim().replace(/[R$\s]/g,"").replace(/\./g,"").replace(",",".");
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  return { parseAnyDate, currentRange, ymd, numBR };
});
