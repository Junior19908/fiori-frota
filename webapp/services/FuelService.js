sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/FilterUtil"
], function (JSONModel, FilterUtil) {
  "use strict";

  function _parseNum(v) {
    if (v == null) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/\s|Km/gi, "").replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function openFuelDialog(oController, vehicleObj, range) {
    const key = vehicleObj.id || vehicleObj.veiculo;
    const abModel = oController.getView().getModel("abast");
    const arr = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || vehicleObj.abastecimentos || [];

    let list = arr;
    if (range) {
      const [start, end] = range;
      list = arr.filter((a) => {
        const d = FilterUtil.parseAnyDate(a.data);
        return d && d >= start && d <= end;
      });
    }

    const toTime = (ev) => {
      const d = FilterUtil.parseAnyDate(ev.data) || new Date(0,0,1);
      if (ev.hora && /^\d{2}:\d{2}:\d{2}$/.test(String(ev.hora))) {
        const [H,M,S] = ev.hora.split(":").map(Number);
        d.setHours(H||0, M||0, S||0, 0);
      }
      return d.getTime();
    };
    list = list.slice().sort((a,b) => toTime(a) - toTime(b));

    const readKm = (ev) => _parseNum(ev.quilometragem ?? ev.km ?? ev.hodometro ?? ev.quilometragemKm);
    const readHr = (ev) => _parseNum(ev.hr);

    const MAX_KM_DELTA = 2000, MAX_HR_DELTA = 200;
    let totalLitros = 0, somaKmDelta = 0, somaHrDelta = 0, hasKmDelta = false, hasHrDelta = false;

    for (let j = 0; j < list.length; j++) {
      const ev = list[j];
      const litros = Number(ev.litros || 0);
      totalLitros += litros;

      ev._kmPerc = ev._kmPorL = ev._lPorKm = ev._lPorHr = null;
      if (j === 0) continue;

      const prev = list[j-1];
      const kmCur = readKm(ev),   kmAnt = readKm(prev);
      const hrCur = readHr(ev),   hrAnt = readHr(prev);

      const dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : NaN;
      const dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : NaN;

      const kmValido = isFinite(dKm) && dKm > 0 && dKm <= MAX_KM_DELTA;
      const hrValido = isFinite(dHr) && dHr > 0 && dHr <= MAX_HR_DELTA;

      if (kmValido && litros > 0) {
        ev._kmPerc = dKm; ev._kmPorL = dKm / litros; ev._lPorKm = litros / dKm;
        somaKmDelta += dKm; hasKmDelta = true;
      }
      if (hrValido && litros > 0) {
        ev._lPorHr = litros / dHr;
        somaHrDelta += dHr; hasHrDelta = true;
      }
    }

    const mediaKmPorL = (totalLitros > 0 && somaKmDelta > 0) ? (somaKmDelta / totalLitros) : 0;
    const mediaLPorHr = (somaHrDelta > 0) ? (totalLitros / somaHrDelta) : 0;

    let showKm = false, showHr = false;
    if (hasKmDelta) { showKm = true;  showHr = false; }
    else if (hasHrDelta) { showKm = false; showHr = true; }
    else { showKm = true;  showHr = true; }

    if (!oController._fuelModel) oController._fuelModel = new JSONModel();
    oController._fuelModel.setData({
      titulo: `Abastecimentos — ${vehicleObj.veiculo || ""} — ${vehicleObj.descricao || ""}`,
      eventos: list,
      totalLitros, mediaKmPorL, mediaLPorHr, showKm, showHr
    });

    return oController._openFragment(
      "com.skysinc.frota.frota.fragments.FuelDialog",
      "dlgFuel",
      { fuel: oController._fuelModel }
    );
  }

  return { openFuelDialog };
});
