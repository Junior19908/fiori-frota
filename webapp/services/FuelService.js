sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/FilterUtil"
], function (JSONModel, FilterUtil) {
  "use strict";

  // Mantido por compatibilidade com possíveis strings; para o seu JSON já numérico,
  // isso vira no-op (retorna o próprio número).
  function _parseNum(v) {
    if (v == null) return NaN;
    if (typeof v === "number") return v;
    const s = String(v)
      .replace(/\s+/g, "")
      .replace(/(Km|km|L|l|Hr|hr)$/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function _orderTs(ev) {
    // data: "YYYY-MM-DD", hora: "HH:mm:ss" (ou vazio)
    return new Date(ev.data + "T" + (ev.hora || "00:00:00")).getTime();
  }

  function openFuelDialog(oController, vehicleObj, range) {
    // === origem dos dados
    const key =
      vehicleObj.id ||
      vehicleObj.veiculo ||
      vehicleObj.equnr || ""; // usa equnr quando existir

    const abModel =
      oController.getView().getModel("abastec") ||
      oController.getView().getModel("abast");

    const arr =
      (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) ||
      vehicleObj.abastecimentos ||
      [];

    // === filtro por período (range: [startDate, endDate] em Date)
    let list = arr;
    if (Array.isArray(range) && range.length >= 1) {
      const start = range[0] ? new Date(range[0].getTime()) : null;
      const end   = range[1] ? new Date(range[1].getTime()) : range[0] ? new Date(range[0].getTime()) : null;
      if (start) { start.setHours(0,0,0,0); }
      if (end)   { end.setHours(23,59,59,999); }

      list = arr.filter((a) => {
        const t = _orderTs(a);
        return (!start || t >= start.getTime()) && (!end || t <= end.getTime());
      });
    }

    // === ordena cronologicamente
    list = list.slice().sort((a, b) => _orderTs(a) - _orderTs(b));

    // === leitura de campos
    const readKm = (ev) => _parseNum(ev.km ?? ev.quilometragem ?? ev.hodometro ?? ev.quilometragemKm);
    const readHr = (ev) => _parseNum(ev.hr ?? ev.horimetro ?? ev.horas);
    const readLt = (ev) => _parseNum(ev.litros ?? ev.qtdLitros ?? ev.volume);

    // === limiares (evitam outliers por erro de digitação)
    const MAX_KM_DELTA = 5000;
    const MAX_HR_DELTA = 500;

    // === acumuladores
    let totalLitros = 0;

    // Para média Km/L
    let somaKmValidos = 0;
    let somaLitrosKmL = 0;

    // Para média L/Hr
    let somaHrValidos = 0;
    let somaLitrosLHr = 0;

    // zera calculados e acumula litros totais
    for (let j = 0; j < list.length; j++) {
      const ev = list[j];
      const litros = readLt(ev);
      if (isFinite(litros)) totalLitros += litros;

      ev._kmPerc = null;
      ev._kmPorL = null;
      ev._lPorKm = null;
      ev._lPorHr = null;

      if (j === 0) continue;

      const prev  = list[j - 1];

      const kmCur = readKm(ev);
      const kmAnt = readKm(prev);
      const hrCur = readHr(ev);
      const hrAnt = readHr(prev);

      const dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : NaN;
      const dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : NaN;

      const kmValido = isFinite(dKm) && dKm > 0 && dKm <= MAX_KM_DELTA;
      const hrValido = isFinite(dHr) && dHr > 0 && dHr <= MAX_HR_DELTA;
      const litrosOk = isFinite(litros) && litros > 0;

      // === por linha: Km/L e L/Km (quando há ΔKm e litros)
      if (kmValido && litrosOk) {
        ev._kmPerc = dKm;
        ev._kmPorL = dKm / litros;
        ev._lPorKm = litros / dKm;

        somaKmValidos += dKm;
        somaLitrosKmL += litros;
      }

      // === por linha: L/Hr (quando há ΔHr e litros)
      if (hrValido && litrosOk) {
        ev._lPorHr = litros / dHr;

        somaHrValidos += dHr;
        somaLitrosLHr += litros;
      }
    }

    // === médias do rodapé
    const mediaKmPorL = (somaLitrosKmL > 0 && somaKmValidos > 0)
      ? (somaKmValidos / somaLitrosKmL)
      : 0;

    const mediaLPorHr = (somaHrValidos > 0)
      ? (somaLitrosLHr / somaHrValidos)
      : 0;

    // === model "fuel" esperado pelo fragment
    if (!oController._fuelModel) oController._fuelModel = new JSONModel();
    oController._fuelModel.setData({
      titulo: `Abastecimentos — ${vehicleObj.equnr || vehicleObj.veiculo || ""} — ${vehicleObj.eqktx || vehicleObj.descricao || ""}`,
      eventos: list,
      totalLitros,
      mediaKmPorL,
      mediaLPorHr
    });

    // === abre o fragment (ajuste o namespace se o seu for "fragments")
    return oController._openFragment(
      "com/skysinc/frota/frota/fragments/FuelDialog",
      "dlgFuel",
      { fuel: oController._fuelModel }
    );
  }

  return { openFuelDialog };
});
