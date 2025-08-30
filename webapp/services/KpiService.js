sap.ui.define([
  "com/skysinc/frota/frota/util/formatter"
], function (formatter) {
  "use strict";

  function computeKpis(vehicles) {
    const totalLitros = vehicles.reduce((s, i) => s + (Number(i.combustivelLitrosAgg) || 0), 0);
    const totalValorComb = vehicles.reduce((s, i) => s + (Number(i.combustivelValorAgg) || 0), 0);
    const totalMatServ = vehicles.reduce((s, i) => s + (Number(i.custoMaterialAgg) || 0), 0);
    const precoMedio = totalLitros ? (totalValorComb / totalLitros) : 0;

    return {
      totalLitrosFmt: formatter.fmtNum(totalLitros),
      gastoCombustivelFmt: formatter.fmtBrl(totalValorComb),
      custoMateriaisFmt: formatter.fmtBrl(totalMatServ),
      precoMedioFmt: formatter.fmtNum(precoMedio),
      resumoCombFmt: `Comb: ${formatter.fmtBrl(totalValorComb)}`,
      resumoLitrosFmt: `Litros: ${formatter.fmtNum(totalLitros)} L`,
      resumoMatFmt: `Mat/Serv: ${formatter.fmtBrl(totalMatServ)}`,
      resumoPrecoFmt: `Preço Médio: ${formatter.fmtNum(precoMedio)} R$/L`
    };
  }

  return { computeKpis };
});
