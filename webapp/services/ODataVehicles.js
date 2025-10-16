sap.ui.define([
  "sap/ui/core/Component"
], function (Component) {
  "use strict";

  function ymd(d) {
    if (!d) return "";
    if (typeof d === "string") return d.substring(0, 10);
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function buildDateFilter(field, fromYMD, toYMD) {
    return field + " ge datetime'" + fromYMD + "T00:00:00' and " +
           field + " le datetime'" + toYMD   + "T23:59:59' and werks eq 'USGA' and (dadomestretipolocalinst eq 'A' or dadomestretipolocalinst eq 'G')";
  }

  function resolveSvcModel(ctx) {
    try {
      const oView = (ctx && typeof ctx.isA === "function" && ctx.isA("sap.ui.core.mvc.View"))
        ? ctx
        : (ctx && typeof ctx.getView === "function" ? ctx.getView() : null);

      let m = null;
      if (oView) {
        m = oView.getModel("svc"); if (m) return m;
        const owner = Component.getOwnerComponentFor(oView);
        if (owner) { m = owner.getModel("svc"); if (m) return m; }
      }
      m = sap.ui.getCore().getModel("svc");
      return m || null;
    } catch (_e) {
      return null;
    }
  }

  function toNum(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    const t = String(v).trim().replace(/\./g, ".").replace(",", ".");
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  function loadVehicles(ctx, dFrom, dTo) {
    return new Promise(function (resolve, reject) {
      const oModel = resolveSvcModel(ctx);
      if (!oModel) {
        return reject(new Error("Modelo OData 'svc' nÃ£o encontrado. Verifique manifest/bootstrapping."));
      }

      let fromYMD = ymd(dFrom);
      const toYMD = ymd(dTo || dFrom || new Date());
      if (!fromYMD) fromYMD = toYMD;

      const sFilter = buildDateFilter("budat_mkpf", fromYMD, toYMD);

      oModel.read("/ZC_EQ_MOVTO", {
        async: true,
        urlParameters: {
          "$filter": sFilter,
          "$select": [
            "equnr","eqktx",
            "matnr","maktx","menge","meins",
            "dmbtr","waers","lgort",
            "budat_mkpf","cpudt_mkpf","cputm_mkpf",
            "aufnr","rsnum","rspos","wempf","usnam_mkpf",
            "servpc","CATEGORIA","matkl","wgbez"
          ].join(","),
          "$format": "json"
        },
        success: function (oData) {
          const results = (oData && oData.results) || [];
          resolve(results);
        },
        error: function (e) {
          reject(e);
        }
      });
    });
  }
  function loadVehiclesDistinct(ctx, dFrom, dTo, opts) {
    const options = opts || {};
    return loadVehicles(ctx, dFrom, dTo).then(function (rows) {
      // Agrupa por equnr+eqktx
      const map = new Map();
      rows.forEach(function (r) {
        const equnr = r.equnr || "";
        const eqktx = r.eqktx || "";
        const CATEGORIA = r.CATEGORIA || "";
        const key = equnr + "||" + eqktx;

        if (!map.has(key)) {
          map.set(key, { equnr, eqktx, totalValor: 0, totalQtde: 0, CATEGORIA });
        }
        const agg = map.get(key);

        if (options.aggregate) {
          // Soma dmbtr e menge quando a flag aggregate estiver ligada
          agg.totalValor += toNum(r.dmbtr);
          agg.totalQtde  += toNum(r.menge);
        }
      });

      return Array.from(map.values());
    });
  }

  return {
    ymd,
    buildDateFilter,
    resolveSvcModel,
    toNum,
    loadVehicles,
    loadVehiclesDistinct
  };
});
