sap.ui.define([
  "sap/base/Log",
  "sap/ui/core/Component"
], function (Log, Component) {
  "use strict";

  // === Utils ===
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
    } catch (e) {
      Log.error("Falha ao resolver modelo 'svc'", e);
      return null;
    }
  }

  // Converte valores numéricos vindo como string do OData V2
  function toNum(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    // garante ponto decimal padrão
    const t = String(v).trim().replace(/\./g, ".").replace(",", ".");
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  // === Leitura DETALHADA (sem agregação) ===
  function loadVehicles(ctx, dFrom, dTo) {
    return new Promise(function (resolve, reject) {
      const oModel = resolveSvcModel(ctx);
      if (!oModel) {
        const msg = "Modelo OData 'svc' não encontrado. Verifique o manifest e o bootstrap.";
        Log.error(msg); return reject(new Error(msg));
      }
      let fromYMD = ymd(dFrom);
      const toYMD = ymd(dTo || dFrom || new Date());
      if (!fromYMD) fromYMD = toYMD;

      const sFilter = buildDateFilter("budat_mkpf", fromYMD, toYMD);

      Log.info("[ODataVehicles] DET /ZC_EQ_MOVTO");
      console.log("[ODataVehicles][DET] $filter:", sFilter);

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
          console.log("[ODataVehicles][DET] success. results.length =", results.length);
          if (results.length) console.table(results.slice(0, 10));
          resolve(results);
        },
        error: function (e) {
          console.error("[ODataVehicles][DET] error:", e);
          reject(e);
        }
      });
    });
  }

  // === Leitura DISTINCT (agregação em memória) ===
  /**
   * Retorna uma linha por veículo: {equnr, eqktx, totalValor?, totalQtde?}
   * Faz a leitura DETALHADA com $filter e agrega em JS.
   *
   * @param {*} ctx View/Controller para resolver o modelo "svc"
   * @param {Date|string} dFrom
   * @param {Date|string} dTo
   * @param {{aggregate?: boolean}} [opts]
   * @returns {Promise<Array>}
   */
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
          // some dmbtr e menge
          agg.totalValor += toNum(r.dmbtr);
          agg.totalQtde  += toNum(r.menge);
        }
      });

      const list = Array.from(map.values());
      console.log("[ODataVehicles][DIST-MEM] agregação concluída. distintos =", list.length);
      if (list.length) console.table(list.slice(0, 10));
      return list;
    });
  }

  return {
    loadVehicles,
    loadVehiclesDistinct
  };
});
