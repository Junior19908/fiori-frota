sap.ui.define([], function () {
  "use strict";

  function pad2(n) { return String(n).padStart(2, "0"); }

  function monthsBetween(start, end) {
    const out = [];
    if (!(start instanceof Date) || !(end instanceof Date)) return out;
    let y = start.getFullYear(), m = start.getMonth();
    const y2 = end.getFullYear(), m2 = end.getMonth();
    while (y < y2 || (y === y2 && m <= m2)) {
      out.push({ y, m: m + 1 });
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
    return out;
  }

  function toUrl(p) { return sap.ui.require.toUrl(p); }

  function parseDateYmd(s) {
    try {
      if (!s) return null;
      const str = String(s);
      if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const d = new Date(str);
        return isNaN(d) ? null : d;
      }
      const d2 = new Date(str);
      return isNaN(d2) ? null : d2;
    } catch (_) { return null; }
  }

  function overlapInRange(os, from, to, now) {
    const ab = parseDateYmd(os.DataAbertura || os.dataAbertura || os.Abertura || os.AberturaData);
    let fe = parseDateYmd(os.DataFechamento || os.dataFechamento || os.Fechamento || os.FechamentoData);
    if (!ab) return null;
    if (ab.getTime() < from.getTime()) return null; // regra do cliente
    if (!fe) fe = new Date(Math.min(now.getTime(), to.getTime()));
    const ini = new Date(Math.max(ab.getTime(), from.getTime()));
    const fim = new Date(Math.min(fe.getTime(), to.getTime()));
    if (fim.getTime() <= ini.getTime()) return null;
    return { ini, fim };
  }

  function fetchMonth(y, m) {
    const mm = pad2(m);
    const url1 = toUrl("com/skysinc/frota/frota/model/localdata/os/" + y + "/" + mm + "/os.json");
    const url2 = toUrl("com/skysinc/frota/frota/model/localdata/os/" + y + "/" + mm + "/ordens.json");
    return new Promise(function (resolve) {
      jQuery.ajax({ url: url1, dataType: "json", cache: false,
        success: function (d) { resolve(d); },
        error: function () {
          jQuery.ajax({ url: url2, dataType: "json", cache: false,
            success: function (d2) { resolve(d2); },
            error: function () { resolve(null); }
          });
        }
      });
    }).then(function (data) {
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.ordens)) return data.ordens;
      if (Array.isArray(data.os)) return data.os;
      return [];
    });
  }

  async function fetchOsByVehiclesAndRange(ids, range) {
    try {
      try {
        const vehiclesLabel = Array.isArray(ids) && ids.length ? ids.join(",") : "ALL";
        console.warn(`[RELIABILITY] Mixed sources detected for vehicle(s) ${vehiclesLabel}. Please migrate to unified pipeline.`);
      } catch (warnErr) {
        // ignore logging failures
      }
      const from = range && range.from instanceof Date ? range.from : null;
      const to   = range && range.to   instanceof Date ? range.to   : null;
      if (!from || !to) return new Map();
      const now = new Date();
      const months = monthsBetween(from, to);
      const setIds = new Set((ids || []).map(String));
      const map = new Map();

      for (let i = 0; i < months.length; i++) {
        const it = months[i];
        let arr = [];
        try { arr = await fetchMonth(it.y, it.m); } catch (_) { arr = []; }
        if (!Array.isArray(arr) || !arr.length) continue;

        arr.forEach(function (o) {
          const veh = String(o.Equipamento || o.equnr || o.veiculo || "");
          if (!veh || (setIds.size && !setIds.has(veh))) return;

          // opcional: calcular overlap no range para ajudar a agregação
          const ov = overlapInRange(o, from, to, now);
          if (!map.has(veh)) map.set(veh, []);
          const clone = Object.assign({}, o);
          if (ov) { clone.__overlapStart = ov.ini; clone.__overlapEnd = ov.fim; }
          map.get(veh).push(clone);
        });
      }
      return map;
    } catch (e) {
      return new Map();
    }
  }

  async function initFirebaseIfNeeded() { return null; }

  return {
    initFirebaseIfNeeded: initFirebaseIfNeeded,
    fetchOsByVehiclesAndRange: fetchOsByVehiclesAndRange
  };
});
