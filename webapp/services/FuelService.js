sap.ui.define([
  "sap/ui/model/json/JSONModel"
], function (JSONModel) {
  "use strict";

  const RANGES_URL = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/config/ranges_config.json");

  let _rangesByVeh = null;

  function _parseNum(v){
    if (v == null) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/\s+/g,"").replace(/(Km|km|L|l|Hr|hr)$/g,"").replace(/\./g,"").replace(",",".");
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }
  function _orderTs(ev){ return new Date(ev.data + "T" + (ev.hora || "00:00:00")).getTime(); }
  function _readKm(ev){ return _parseNum(ev.km ?? ev.quilometragem ?? ev.hodometro ?? ev.quilometragemKm); }
  function _readHr(ev){ return _parseNum(ev.hr ?? ev.horimetro ?? ev.horas); }
  function _readLt(ev){ return _parseNum(ev.litros ?? ev.qtdLitros ?? ev.volume); }

  function _loadRangesOnce(){
    if (_rangesByVeh) return Promise.resolve(_rangesByVeh);
    return new Promise((resolve) => {
      jQuery.ajax({
        url: RANGES_URL, dataType: "json", cache: false,
        success: (raw) => {
          const map = {};
          const list = Array.isArray(raw?.veiculos) ? raw.veiculos : [];
          for (const it of list){
            const code = String(it.veiculo || "").trim();
            if (!code) continue;
            map[code] = {
              litros  : it.litros   || {},
              deltaKm : it.deltaKm  || {},
              deltaHr : it.deltaHr  || {}
            };
          }
          _rangesByVeh = map; resolve(_rangesByVeh);
        },
        error: () => { _rangesByVeh = {}; resolve(_rangesByVeh); }
      });
    });
  }

  function _pickVehicleKey(v){ return String(v?.equnr ?? v?.veiculo ?? v?.id ?? "").trim(); }

  function _getVehRanges(vehCode){
    const r  = _rangesByVeh?.[vehCode] || {};
    const km = r.deltaKm || {};
    const hr = r.deltaHr || {};
    const lt = r.litros  || {};
    const minKm = _parseNum(km.p50), maxKm = _parseNum(km.p95);
    const minHr = _parseNum(hr.p50), maxHr = _parseNum(hr.p95);
    const minLt = _parseNum(lt.p50);
    return {
      minKm: isFinite(minKm) ? minKm : null,
      maxKm: isFinite(maxKm) ? maxKm : null,
      minHr: isFinite(minHr) ? minHr : null,
      maxHr: isFinite(maxHr) ? maxHr : null,
      minLt: isFinite(minLt) ? minLt : null
    };
  }

  function _fmt(n){ return isFinite(n) ? String(n).replace(".", ",") : "-"; }

  async function openFuelDialog(oController, vehicleObj, range){
    await _loadRangesOnce();

    const vehKey  = _pickVehicleKey(vehicleObj);
    const abModel = oController.getView().getModel("abastec") || oController.getView().getModel("abast");
    const baseArr = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + vehKey)) || vehicleObj.abastecimentos || [];

    let list = baseArr;
    if (Array.isArray(range) && range.length >= 1){
      const start = range[0] ? new Date(range[0].getTime()) : null;
      const end   = range[1] ? new Date(range[1].getTime()) : (range[0] ? new Date(range[0].getTime()) : null);
      if (start) start.setHours(0,0,0,0);
      if (end)   end.setHours(23,59,59,999);
      list = baseArr.filter((a) => {
        const t = _orderTs(a);
        return (!start || t >= start.getTime()) && (!end || t <= end.getTime());
      });
    }

    list = list.slice().sort((a,b) => _orderTs(a) - _orderTs(b));

    const { minKm, maxKm, minHr, maxHr, minLt } = _getVehRanges(vehKey);

    let totalLitros=0, somaKmValidos=0, somaLitrosKmL=0, somaHrValidos=0, somaLitrosLHr=0;

    for (let j=0; j<list.length; j++){
      const ev = list[j];
      const litros = _readLt(ev);
      if (isFinite(litros)) totalLitros += litros;

      ev._kmPerc=null; ev._kmPorL=null; ev._lPorKm=null; ev._lPorHr=null;
      ev._statusText=""; ev._statusState="None"; ev._statusIcon=null; ev._statusTooltip="";

      if (j === 0) continue;

      const prev  = list[j-1];
      const kmCur = _readKm(ev), kmAnt = _readKm(prev);
      const hrCur = _readHr(ev), hrAnt = _readHr(prev);

      const dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : NaN;
      const dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : NaN;

      const litrosOk = isFinite(litros) && litros > 0;

      // --- STATUS com p50/p95 + tooltip
      const tooHighKm = isFinite(dKm) && isFinite(maxKm) && dKm > maxKm;
      const tooHighHr = isFinite(dHr) && isFinite(maxHr) && dHr > maxHr;
      const enoughLt  = isFinite(minLt) ? (litrosOk && litros >= minLt) : litrosOk;
      const tooLowKm  = isFinite(dKm) && isFinite(minKm) && dKm > 0 && dKm < minKm && enoughLt;
      const tooLowHr  = isFinite(dHr) && isFinite(minHr) && dHr > 0 && dHr < minHr && enoughLt;

      // Retrocesso/sem avanço primeiro
      if ((isFinite(dKm) && dKm <= 0) || (isFinite(dHr) && dHr <= 0)){
        ev._statusText  = "Retrocesso/sem avanço — verificar medição";
        ev._statusState = "Error";
        ev._statusIcon  = "sap-icon://error";
      } else if (tooHighKm || tooHighHr){
        ev._statusText  = "Salto de numeração — possível erro de digitação";
        ev._statusState = "Error";
        ev._statusIcon  = "sap-icon://error";
      } else if (tooLowKm || tooLowHr){
        ev._statusText  = "Variação muito baixa — possível erro de leitura";
        ev._statusState = "Warning";
        ev._statusIcon  = "sap-icon://alert";
      }

      // Tooltip detalhado (Δ + p50/p95 disponíveis)
      const parts = [];
      if (isFinite(dKm) || isFinite(minKm) || isFinite(maxKm)){
        parts.push(`ΔKm=${isFinite(dKm)?_fmt(dKm):"-"} (p50=${_fmt(minKm)}, p95=${_fmt(maxKm)})`);
      }
      if (isFinite(dHr) || isFinite(minHr) || isFinite(maxHr)){
        parts.push(`ΔHr=${isFinite(dHr)?_fmt(dHr):"-"} (p50=${_fmt(minHr)}, p95=${_fmt(maxHr)})`);
      }
      if (litrosOk || isFinite(minLt)){
        parts.push(`Litros=${_fmt(litros)} (p50=${_fmt(minLt)})`);
      }
      ev._statusTooltip = parts.join(" • ");

      // métricas por linha (dentro do teto p95)
      const kmValido = isFinite(dKm) && dKm > 0 && (!isFinite(maxKm) || dKm <= maxKm);
      const hrValido = isFinite(dHr) && dHr > 0 && (!isFinite(maxHr) || dHr <= maxHr);

      if (kmValido && litrosOk){
        ev._kmPerc = dKm;
        ev._kmPorL = dKm / litros;
        ev._lPorKm = litros / dKm;
        somaKmValidos += dKm; somaLitrosKmL += litros;
      }
      if (hrValido && litrosOk){
        ev._lPorHr = litros / dHr;
        somaHrValidos += dHr; somaLitrosLHr += litros;
      }
    }

    const mediaKmPorL = (somaLitrosKmL > 0 && somaKmValidos > 0) ? (somaKmValidos / somaLitrosKmL) : 0;
    const mediaLPorHr = (somaHrValidos > 0) ? (somaLitrosLHr / somaHrValidos) : 0;

    // textos de limites p/ rodapé
    const limitesKmText = (isFinite(minKm) || isFinite(maxKm))
      ? `Km: p50=${_fmt(minKm)} • p95=${_fmt(maxKm)}`
      : "Km: p50=– • p95=–";
    const limitesHrText = (isFinite(minHr) || isFinite(maxHr))
      ? `Hr: p50=${_fmt(minHr)} • p95=${_fmt(maxHr)}`
      : "Hr: sem percentis";

    if (!oController._fuelModel) oController._fuelModel = new JSONModel();
    oController._fuelModel.setData({
      titulo: `Abastecimentos — ${vehicleObj.equnr || vehicleObj.veiculo || ""} — ${vehicleObj.eqktx || vehicleObj.descricao || ""}`,
      eventos: list,
      totalLitros,
      mediaKmPorL,
      mediaLPorHr,
      limitesKmText,
      limitesHrText
    });

    return oController._openFragment(
      "com/skysinc/frota/frota/fragments/FuelDialog",
      "dlgFuel",
      { fuel: oController._fuelModel }
    );
  }

  return { openFuelDialog };
});
