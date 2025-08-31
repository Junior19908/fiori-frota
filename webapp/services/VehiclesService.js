sap.ui.define([
  "sap/base/Log",
  "sap/ui/model/json/JSONModel",
  "./ODataVehicles"
], function (Log, JSONModel, ODataVehicles) {
  "use strict";

  function ensureVM(oView) {
    let oVM = oView.getModel("vm");
    if (!oVM) {
      oVM = new JSONModel({ veiculos: [], movimentos: [], aggregateOn: true });
      oView.setModel(oVM, "vm");
    }
    return oVM;
  }

  /**
   * (Mantido) Carrega linhas detalhadas e grava em vm>/movimentos.
   */
  function loadVehiclesForRange(oView, range) {
    const base = new Date();
    const from = (range && (range.from || range[0] || range.to)) || base;
    const to   = (range && (range.to   || range[1] || range.from)) || from;

    return ODataVehicles.loadVehicles(oView, from, to).then(function (aRows) {
      const oVM = ensureVM(oView);
      oVM.setProperty("/movimentos", Array.isArray(aRows) ? aRows : []);
      console.log("[VehiclesService] vm>/movimentos length =", (aRows || []).length);
      if ((aRows || []).length) console.table((aRows || []).slice(0, 10));
    });
  }

  /**
   * NOVO: Carrega DISTINCT (1 veículo por linha) e grava em targetPath (padrão vm>/veiculos).
   * Faz agregação em memória (sum dmbtr → totalValor; sum menge → totalQtde).
   */
  function loadVehiclesDistinctForRange(oView, range, opts) {
    const base = new Date();
    const from = (range && (range.from || range[0] || range.to)) || base;
    const to   = (range && (range.to   || range[1] || range.from)) || from;

    const aggregate = !!(opts && opts.aggregate);
    const targetPath = (opts && opts.targetPath) || "vm>/veiculos";

    return ODataVehicles.loadVehiclesDistinct(oView, from, to, { aggregate }).then(function (aRows) {
      const oVM = ensureVM(oView);

      // Já vem agregado: {equnr, eqktx, totalValor, totalQtde}
      const norm = Array.isArray(aRows) ? aRows.map(function (r) {
        return {
          equnr: r.equnr || "",
          eqktx: r.eqktx || "",
          CATEGORIA: r.CATEGORIA || "",
          totalValor: Number(r.totalValor || 0),
          totalQtde:  Number(r.totalQtde  || 0)
        };
      }) : [];

      if (targetPath.startsWith("vm>/")) {
        oVM.setProperty(targetPath.substring(3), norm);
      } else {
        oVM.setProperty(targetPath, norm);
      }

      const len = (targetPath.startsWith("vm>/")
        ? oVM.getProperty(targetPath.substring(3))
        : oVM.getProperty(targetPath)
      )?.length || 0;

      console.log("[VehiclesService] " + targetPath + " atualizado. length =", len);
      if (len) console.table(norm.slice(0, 10));
      window.__vm = oVM; // facilitar inspeção no console
    });
  }

  return {
    loadVehiclesForRange,
    loadVehiclesDistinctForRange
  };
});
