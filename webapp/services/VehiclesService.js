sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "./ODataVehicles"
], function (JSONModel, ODataVehicles) {
  "use strict";

  function ensureVM(oView) {
    let oVM = oView.getModel("vm");
    if (!oVM) {
      oVM = new JSONModel({ veiculos: [], movimentos: [], aggregateOn: true });
      oView.setModel(oVM, "vm");
    }
    return oVM;
  }

  function loadVehiclesForRange(oView, range) {
    const base = new Date();
    const from = (range && (range.from || range[0] || range.to)) || base;
    const to   = (range && (range.to   || range[1] || range.from)) || from;

    return ODataVehicles.loadVehicles(oView, from, to).then(function (aRows) {
      const oVM = ensureVM(oView);
      oVM.setProperty("/movimentos", Array.isArray(aRows) ? aRows : []);
    });
  }
  function loadVehiclesDistinctForRange(oView, range, opts) {
    const base = new Date();
    const from = (range && (range.from || range[0] || range.to)) || base;
    const to   = (range && (range.to   || range[1] || range.from)) || from;

    const aggregate  = !!(opts && opts.aggregate);
    const targetPath = (opts && opts.targetPath) || "vm>/veiculos";

    return ODataVehicles.loadVehiclesDistinct(oView, from, to, { aggregate }).then(function (aRows) {
      const oVM = ensureVM(oView);

      const norm = Array.isArray(aRows) ? aRows.map(function (r) {
        return {
          equnr:      r.equnr || "",
          eqktx:      r.eqktx || "",
          CATEGORIA:  r.CATEGORIA || "",       
          totalValor: Number(r.totalValor || 0),
          totalQtde:  Number(r.totalQtde  || 0)
        };
      }) : [];

      if (targetPath.startsWith("vm>/")) {
        oVM.setProperty(targetPath.substring(3), norm);
      } else {
        oVM.setProperty(targetPath, norm);
      }
    });
  }

  return {
    ensureVM,                
    loadVehiclesForRange,     
    loadVehiclesDistinctForRange 
  };
});
