sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/formatter"
], function (JSONModel, formatter) {
  "use strict";

  function ensureKpiModel(oView) {
    let mdl = oView.getModel("kpi");
    if (!mdl) {
      mdl = new JSONModel({});
      oView.setModel(mdl, "kpi");
    }
    return mdl;
  }

  function filterVehicles(arr, vehicleKey, categoryKey) {
    const vKey = (vehicleKey && vehicleKey !== "__ALL__") ? String(vehicleKey) : null;
    const cKey = (categoryKey && categoryKey !== "__ALL__") ? String(categoryKey) : null;

    return arr.filter((row) => {
      const byVeh = vKey ? String(row.equnr) === vKey : true;
      const byCat = cKey ? String(row.CATEGORIA || "") === cKey : true;
      return byVeh && byCat;
    });
  }

  function computeTotals(list) {
    let totLitros = 0, totComb = 0, totMat = 0;
    list.forEach((v) => {
      totLitros += Number(v.combustivelLitrosAgg || 0);
      totComb   += Number(v.combustivelValorAgg  || 0);
      totMat    += Number(v.totalValor ?? v.custoMateriaisAgg ?? v.custoMaterialAgg); 
    });
    const precoMedio = (totLitros > 0) ? (totComb / totLitros) : 0;
    return { totLitros, totComb, totMat, precoMedio };
  }

  

  /**
   * Recalcula e atualiza o model "kpi" a psartir do vm>/veiculos já agregados.
   * @param {sap.ui.core.mvc.View} oView
   * @param {{vehicleKey?:string, categoryKey?:string}} [opts]
   */
  function recalc(oView, opts) {
    const vm = oView.getModel("vm");
    const veiculos = (vm && vm.getProperty("/veiculos")) || [];
    const subset = filterVehicles(veiculos, opts?.vehicleKey, opts?.categoryKey);
    const { totLitros, totComb, totMat, precoMedio } = computeTotals(subset);

    const kpi = ensureKpiModel(oView);
    kpi.setData({
      totalLitrosFmt: formatter.fmtLitros(totLitros),
      gastoCombustivelFmt: formatter.fmtBrl(totComb),
      custoMateriaisFmt: formatter.fmtBrl(totMat),
      precoMedioFmt: formatter.fmtNum(precoMedio),
      resumoCombFmt: "Comb: " + formatter.fmtBrl(totComb),
      resumoLitrosFmt: "Litros: " + formatter.fmtLitros(totLitros),
      resumoMatFmt: "Mat/Serv: " + formatter.fmtBrl(totMat),
      resumoPrecoFmt: "Preço Médio: " + formatter.fmtNum(precoMedio) + " R$/L"
    }, true);

    return { totLitros, totComb, totMat, precoMedio, subsetCount: subset.length };
  }

  return { recalc };
});
