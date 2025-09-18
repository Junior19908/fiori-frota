sap.ui.define([
  "sap/ui/model/json/JSONModel"
], function (JSONModel) {
  "use strict";

  // Caminho do arquivo de ranges (ajuste se necessário)
  const RANGES_URL = sap.ui.require.toUrl(
    "com/skysinc/frota/frota/model/localdata/config/ranges_config.json"
  );

  // Cache de ranges em memória: { [veiculo]: { litros:{p50,p95}, deltaKm:{p50,p95}, deltaHr:{p50,p95} } }
  let _rangesByVeh = null;

  /* ============================== Utils ============================== */
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
    // data: "YYYY-MM-DD", hora: "HH:mm:ss" ou vazio
    return new Date(ev.data + "T" + (ev.hora || "00:00:00")).getTime();
  }

  function _readKm(ev) { return _parseNum(ev.km ?? ev.quilometragem ?? ev.hodometro ?? ev.quilometragemKm); }
  function _readHr(ev) { return _parseNum(ev.hr ?? ev.horimetro ?? ev.horas); }
  function _readLt(ev) { return _parseNum(ev.litros ?? ev.qtdLitros ?? ev.volume); }

  function _fmt(n) {
    return (typeof n === "number" && isFinite(n))
      ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
      : "-";
  }

  function _pickVehicleKey(v) {
    return String(v?.equnr ?? v?.veiculo ?? v?.id ?? "").trim();
  }

  function _loadRangesOnce() {
    if (_rangesByVeh) return Promise.resolve(_rangesByVeh);
    return new Promise((resolve) => {
      jQuery.ajax({
        url: RANGES_URL,
        dataType: "json",
        cache: false,
        success: (raw) => {
          const map = {};
          const list = Array.isArray(raw?.veiculos) ? raw.veiculos : [];
          for (const it of list) {
            const code = String(it.veiculo || "").trim();
            if (!code) continue;
            map[code] = {
              litros: it.litros || {},
              deltaKm: it.deltaKm || {},
              deltaHr: it.deltaHr || {}
            };
          }
          _rangesByVeh = map;
          resolve(_rangesByVeh);
        },
        error: () => { _rangesByVeh = {}; resolve(_rangesByVeh); }
      });
    });
  }

  function _getVehRanges(vehCode) {
    // Retorna {minKm,maxKm,minHr,maxHr,minLt}
    const r = _rangesByVeh?.[vehCode] || {};
    const km = r.deltaKm || {};
    const hr = r.deltaHr || {};
    const lt = r.litros || {};
    const minKm = _parseNum(km.p50);
    const maxKm = _parseNum(km.p95);
    const minHr = _parseNum(hr.p50);
    const maxHr = _parseNum(hr.p95);
    const minLt = _parseNum(lt.p50);
    return {
      minKm: isFinite(minKm) ? minKm : null,
      maxKm: isFinite(maxKm) ? maxKm : null,
      minHr: isFinite(minHr) ? minHr : null,
      maxHr: isFinite(maxHr) ? maxHr : null,
      minLt: isFinite(minLt) ? minLt : null
    };
  }

  /* ============================== API ============================== */
  async function openFuelDialog(oController, vehicleObj, range) {
    // 1) Carrega ranges (uma vez)
    await _loadRangesOnce();

    // 2) Origem dos dados (modelo acumulado do Component)
    const vehKey = _pickVehicleKey(vehicleObj);
    const abModel =
      oController.getView().getModel("abastec") || // compat.
      oController.getView().getModel("abast");
    const baseArr =
      (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + vehKey)) ||
      vehicleObj.abastecimentos ||
      [];

    // 3) Filtro por período (range = [startDate, endDate])
    let list = baseArr;
    if (Array.isArray(range) && range.length >= 1) {
      const start = range[0] ? new Date(range[0].getTime()) : null;
      const end = range[1]
        ? new Date(range[1].getTime())
        : range[0]
        ? new Date(range[0].getTime())
        : null;
      if (start) start.setHours(0, 0, 0, 0);
      if (end) end.setHours(23, 59, 59, 999);

      list = baseArr.filter((a) => {
        const t = _orderTs(a);
        return (!start || t >= start.getTime()) && (!end || t <= end.getTime());
      });
    }

    // 4) Ordena cronologicamente
    list = list.slice().sort((a, b) => _orderTs(a) - _orderTs(b));

    // 5) Ranges do veículo
    const { minKm, maxKm, minHr, maxHr, minLt } = _getVehRanges(vehKey);

    // 6) Acumuladores
    let totalLitros = 0,
      somaKmValidos = 0,
      somaLitrosKmL = 0,
      somaHrValidos = 0,
      somaLitrosLHr = 0;

    // 7) Loop das linhas
    for (let j = 0; j < list.length; j++) {
      const ev = list[j];
      const litros = _readLt(ev);
      if (isFinite(litros)) totalLitros += litros;

      // Reset calculados e status
      ev._kmPerc = null;
      ev._kmPorL = null;
      ev._lPorKm = null;
      ev._lPorHr = null;

      ev._statusText = "";
      ev._statusState = "None";
      ev._statusIcon = null;
      ev._statusTooltip = "";

      if (j === 0) continue;

      const prev = list[j - 1];
      const kmCur = _readKm(ev), kmAnt = _readKm(prev);
      const hrCur = _readHr(ev), hrAnt = _readHr(prev);

      const dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : NaN;
      const dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : NaN;

      const litrosOk = isFinite(litros) && litros > 0;

      // Só considerar Hr quando houver medição (>0) em pelo menos um (ant/atual)
      const hasHr = isFinite(hrCur) && isFinite(hrAnt) && (hrCur > 0 || hrAnt > 0);
      const hasKm = isFinite(kmCur) && isFinite(kmAnt) && (kmCur > 0 || kmAnt > 0);

      // Outliers por p95/p50
      const tooHighKm = hasKm && isFinite(maxKm) && dKm > maxKm;
      const tooHighHr = hasHr && isFinite(maxHr) && dHr > maxHr;

      const enoughLt = isFinite(minLt) ? (litrosOk && litros >= minLt) : litrosOk;
      const tooLowKm = hasKm && isFinite(minKm) && dKm > 0 && dKm < minKm && enoughLt;
      const tooLowHr = hasHr && isFinite(minHr) && dHr > 0 && dHr < minHr && enoughLt;

      // Retrocesso/sem avanço apenas quando havia medição
      const retroKm = hasKm && dKm <= 0;
      const retroHr = hasHr && dHr <= 0;

      // ===== STATUS (prioridade) =====
      if (retroKm || retroHr) {
        ev._statusText = "Retrocesso/sem avanço — verificar medição";
        ev._statusState = "Error";
        ev._statusIcon = "sap-icon://error";
      } else if (tooHighKm || tooHighHr) {
        ev._statusText = "Salto de numeração — possível erro de digitação";
        ev._statusState = "Error";
        ev._statusIcon = "sap-icon://error";
      } else if (tooLowKm || tooLowHr) {
        ev._statusText = "Variação muito baixa — possível erro de leitura";
        ev._statusState = "Warning";
        ev._statusIcon = "sap-icon://alert";
      }

      // Tooltip detalhado
      const parts = [];
      if (hasKm || isFinite(minKm) || isFinite(maxKm)) {
        parts.push(`ΔKm=${_fmt(dKm)} (Mín.=${_fmt(minKm)}, Máx.=${_fmt(maxKm)})`);
      }
      if (hasHr || isFinite(minHr) || isFinite(maxHr)) {
        parts.push(`ΔHr=${hasHr ? _fmt(dHr) : "-"} (Mín.=${_fmt(minHr)}, Máx.=${_fmt(maxHr)})`);
      }
      if (litrosOk || isFinite(minLt)) {
        parts.push(`Litros=${_fmt(litros)} (Mín.=${_fmt(minLt)})`);
      }
      ev._statusTooltip = parts.join(" • ");

      // Métricas por linha (respeitando teto p95)
      const kmValido = hasKm && dKm > 0 && (!isFinite(maxKm) || dKm <= maxKm);
      const hrValido = hasHr && dHr > 0 && (!isFinite(maxHr) || dHr <= maxHr);

      if (kmValido && litrosOk) {
        ev._kmPerc = dKm;
        ev._kmPorL = dKm / litros;
        ev._lPorKm = litros / dKm;
        somaKmValidos += dKm;
        somaLitrosKmL += litros;
      }
      if (hrValido && litrosOk) {
        ev._lPorHr = litros / dHr;
        somaHrValidos += dHr;
        somaLitrosLHr += litros;
      }
    }

    // 8) Rodapé: médias do período
    const mediaKmPorL =
      (somaLitrosKmL > 0 && somaKmValidos > 0) ? (somaKmValidos / somaLitrosKmL) : 0;
    const mediaLPorHr =
      (somaHrValidos > 0) ? (somaLitrosLHr / somaHrValidos) : 0;

    // Textos de limites p/ exibir na barra inferior
    // Só exibe limites quando há medições no período
    const hasAnyKm = list.some(ev => isFinite(_readKm(ev)) && _readKm(ev) > 0);
    const hasAnyHr = list.some(ev => isFinite(_readHr(ev)) && _readHr(ev) > 0);
    const limitesKmText = hasAnyKm
      ? (isFinite(minKm) || isFinite(maxKm))
        ? `Km: Mín.=${_fmt(minKm)} • Máx.=${_fmt(maxKm)}`
        : "Km: Mín.=– • Máx.=–"
      : "";
    const limitesHrText = hasAnyHr
      ? (isFinite(minHr) || isFinite(maxHr))
        ? `Hr: Mín.=${_fmt(minHr)} • Máx.=${_fmt(maxHr)}`
        : "Hr: Mín.=– • Máx.=–"
      : "";

    // 9) Envia para o modelo "fuel" usado pelo fragment
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

    // 10) Abre o fragment
    return oController._openFragment(
      "com/skysinc/frota/frota/fragments/FuelDialog",
      "dlgFuel",
      { fuel: oController._fuelModel }
    );
  }

  return { openFuelDialog };
});
