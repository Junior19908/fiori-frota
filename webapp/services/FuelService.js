sap.ui.define([
  "sap/ui/model/json/JSONModel"
], function (JSONModel) {
  "use strict";

  const RANGES_URL = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/config/ranges_config.json");
  const SAVE_LIMITS_URL = "/local/ranges";

  let _rangesByVeh = null;

  function _parseNum(v) {
    if (v == null) return NaN;
    if (typeof v === "number") return v;
    const s = String(v)
      .replace(/\s+/g, "")
      .replace(/(Km|km|L|l|Hr|hr)$/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function _orderTs(ev) {
    const data = ev?.data;
    if (!data) return NaN;
    return new Date(data + "T" + (ev.hora || "00:00:00")).getTime();
  }

  function _readKm(ev) {
    return _parseNum(ev?.km ?? ev?.quilometragem ?? ev?.hodometro ?? ev?.quilometragemKm);
  }

  function _readHr(ev) {
    return _parseNum(ev?.hr ?? ev?.horimetro ?? ev?.horas);
  }

  function _readLt(ev) {
    return _parseNum(ev?.litros ?? ev?.qtdLitros ?? ev?.volume);
  }

  function _fmt(n) {
    return Number.isFinite(n)
      ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
      : "-";
  }

  function _fmtRange(label, min, max) {
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (!hasMin && !hasMax) return "";
    return `${label}: Mín.=${hasMin ? _fmt(min) : "–"} • Máx.=${hasMax ? _fmt(max) : "–"}`;
  }

  function _hintText(min, max) {
    const hasMin = Number.isFinite(min);
    const hasMax = Number.isFinite(max);
    if (!hasMin && !hasMax) return "Sem sugestão histórica";
    if (hasMin && hasMax) return `Sugestão: ${_fmt(min)} a ${_fmt(max)}`;
    if (hasMin) return `Sugestão: mínimo ${_fmt(min)}`;
    return `Sugestão: máximo ${_fmt(max)}`;
  }

  function _pickVehicleKey(v) {
    return String(v?.equnr ?? v?.veiculo ?? v?.id ?? "").trim();
  }

  function _cloneEvents(list) {
    return Array.isArray(list) ? list.map((ev) => ({ ...ev })) : [];
  }

  function _sanitizeLimits(raw) {
    if (!raw) {
      return {
        minKm: null,
        maxKm: null,
        minHr: null,
        maxHr: null,
        minLt: null,
        maxLt: null
      };
    }

    const minKm = _parseNum(raw.minKm);
    const maxKm = _parseNum(raw.maxKm);
    const minHr = _parseNum(raw.minHr);
    const maxHr = _parseNum(raw.maxHr);
    const minLt = _parseNum(raw.minLt);
    const maxLt = _parseNum(raw.maxLt);

    return {
      minKm: Number.isFinite(minKm) ? minKm : null,
      maxKm: Number.isFinite(maxKm) ? maxKm : null,
      minHr: Number.isFinite(minHr) ? minHr : null,
      maxHr: Number.isFinite(maxHr) ? maxHr : null,
      minLt: Number.isFinite(minLt) ? minLt : null,
      maxLt: Number.isFinite(maxLt) ? maxLt : null
    };
  }

  function _resolveLimit(overrideValue, baseValue) {
    const candidate = _parseNum(overrideValue);
    if (Number.isFinite(candidate)) return candidate;
    return Number.isFinite(baseValue) ? baseValue : null;
  }

  function _decorateEvents(list, limits) {
    let totalLitros = 0;
    let somaKmValidos = 0;
    let somaLitrosKmL = 0;
    let somaHrValidos = 0;
    let somaLitrosLHr = 0;
    let hasAnyKm = false;
    let hasAnyHr = false;

    const minKm = limits.minKm;
    const maxKm = limits.maxKm;
    const minHr = limits.minHr;
    const maxHr = limits.maxHr;
    const minLt = limits.minLt;
    const maxLt = limits.maxLt;

    for (let i = 0; i < list.length; i += 1) {
      const ev = list[i];
      const litros = _readLt(ev);
      if (Number.isFinite(litros) && litros > 0) {
        totalLitros += litros;
      }

      const kmCur = _readKm(ev);
      const hrCur = _readHr(ev);
      if (Number.isFinite(kmCur) && kmCur > 0) hasAnyKm = true;
      if (Number.isFinite(hrCur) && hrCur > 0) hasAnyHr = true;

      ev._kmPerc = null;
      ev._kmPorL = null;
      ev._lPorKm = null;
      ev._lPorHr = null;
      ev._statusText = "";
      ev._statusState = "None";
      ev._statusIcon = null;
      ev._statusTooltip = "";

      if (i === 0) continue;

      const prev = list[i - 1];
      const kmAnt = _readKm(prev);
      const hrAnt = _readHr(prev);

      const litrosOk = Number.isFinite(litros) && litros > 0;
      const hasKmPair = Number.isFinite(kmCur) && Number.isFinite(kmAnt) && (kmCur > 0 || kmAnt > 0);
      const hasHrPair = Number.isFinite(hrCur) && Number.isFinite(hrAnt) && (hrCur > 0 || hrAnt > 0);

      const dKm = hasKmPair ? (kmCur - kmAnt) : NaN;
      const dHr = hasHrPair ? (hrCur - hrAnt) : NaN;

      const litrosDentro = Number.isFinite(minLt) ? (litrosOk && litros >= minLt) : litrosOk;
      const tooLowKm = hasKmPair && Number.isFinite(minKm) && dKm > 0 && dKm < minKm && litrosDentro;
      const tooLowHr = hasHrPair && Number.isFinite(minHr) && dHr > 0 && dHr < minHr && litrosDentro;
      const tooHighKm = hasKmPair && Number.isFinite(maxKm) && dKm > maxKm;
      const tooHighHr = hasHrPair && Number.isFinite(maxHr) && dHr > maxHr;
      const retroKm = hasKmPair && dKm <= 0;
      const retroHr = hasHrPair && dHr <= 0;

      if (retroKm || retroHr) {
        ev._statusText = "Retrocesso ou sem avanço, revisar medição";
        ev._statusState = "Error";
        ev._statusIcon = "sap-icon://error";
      } else if (tooHighKm || tooHighHr) {
        ev._statusText = "Salto de numeração, possível erro";
        ev._statusState = "Error";
        ev._statusIcon = "sap-icon://error";
      } else if (tooLowKm || tooLowHr) {
        ev._statusText = "Variação muito baixa, conferir leitura";
        ev._statusState = "Warning";
        ev._statusIcon = "sap-icon://alert";
      }

      const tooltipPieces = [];
      if (hasKmPair || Number.isFinite(minKm) || Number.isFinite(maxKm)) {
        tooltipPieces.push(`Km=${_fmt(dKm)} (Mín.=${_fmt(minKm)}, Máx.=${_fmt(maxKm)})`);
      }
      if (hasHrPair || Number.isFinite(minHr) || Number.isFinite(maxHr)) {
        tooltipPieces.push(`Hr=${hasHrPair ? _fmt(dHr) : "-"} (Mín.=${_fmt(minHr)}, Máx.=${_fmt(maxHr)})`);
      }
      if (litrosOk || Number.isFinite(minLt) || Number.isFinite(maxLt)) {
        tooltipPieces.push(`Litros=${_fmt(litros)} (Mín.=${_fmt(minLt)}, Máx.=${_fmt(maxLt)})`);
      }
      ev._statusTooltip = tooltipPieces.join(" • ");

      if (hasKmPair && dKm > 0 && litrosOk) {
        ev._kmPerc = dKm;
        ev._kmPorL = dKm / litros;
        ev._lPorKm = litros / dKm;
        somaKmValidos += dKm;
        somaLitrosKmL += litros;
      }

      if (hasHrPair && dHr > 0 && litrosOk) {
        ev._lPorHr = litros / dHr;
        somaHrValidos += dHr;
        somaLitrosLHr += litros;
      }
    }

    const mediaKmPorL = (somaLitrosKmL > 0 && somaKmValidos > 0)
      ? (somaKmValidos / somaLitrosKmL)
      : 0;
    const mediaLPorHr = (somaHrValidos > 0 && somaLitrosLHr > 0)
      ? (somaLitrosLHr / somaHrValidos)
      : 0;

    return {
      eventos: list,
      totalLitros,
      mediaKmPorL,
      mediaLPorHr,
      hasAnyKm,
      hasAnyHr
    };
  }

  function _buildFuelModelPayload(events, baseLimits, overrides, hintLimits) {
    const sanitizedBase = _sanitizeLimits(baseLimits);
    const sanitizedHints = _sanitizeLimits(hintLimits || baseLimits);
    const effectiveLimits = {
      minKm: _resolveLimit(overrides?.limiteKmMin, sanitizedBase.minKm),
      maxKm: _resolveLimit(overrides?.limiteKm, sanitizedBase.maxKm),
      minHr: _resolveLimit(overrides?.limiteHrMin, sanitizedBase.minHr),
      maxHr: _resolveLimit(overrides?.limiteHr, sanitizedBase.maxHr),
      minLt: sanitizedBase.minLt,
      maxLt: sanitizedBase.maxLt
    };

    const list = _cloneEvents(events);
    list.sort((a, b) => _orderTs(a) - _orderTs(b));
    const decorated = _decorateEvents(list, effectiveLimits);

    const limiteKmMinActive = Number.isFinite(effectiveLimits.minKm);
    const limiteKmActive = Number.isFinite(effectiveLimits.maxKm);
    const limiteHrMinActive = Number.isFinite(effectiveLimits.minHr);
    const limiteHrActive = Number.isFinite(effectiveLimits.maxHr);

    return {
      eventos: decorated.eventos,
      totalLitros: decorated.totalLitros,
      mediaKmPorL: decorated.mediaKmPorL,
      mediaLPorHr: decorated.mediaLPorHr,
      limitesKmText: decorated.hasAnyKm ? _fmtRange("Km", effectiveLimits.minKm, effectiveLimits.maxKm) : "",
      limitesHrText: decorated.hasAnyHr ? _fmtRange("Hr", effectiveLimits.minHr, effectiveLimits.maxHr) : "",
      limitesLtText: _fmtRange("Litros", sanitizedBase.minLt, sanitizedBase.maxLt),
      limiteToolbarVisible: decorated.hasAnyKm || decorated.hasAnyHr,
      limiteKmVisible: decorated.hasAnyKm,
      limiteHrVisible: decorated.hasAnyHr,
      limiteKmEnabled: decorated.hasAnyKm,
      limiteHrEnabled: decorated.hasAnyHr,
      limiteKmMin: limiteKmMinActive ? effectiveLimits.minKm : 0,
      limiteKm: limiteKmActive ? effectiveLimits.maxKm : 0,
      limiteHrMin: limiteHrMinActive ? effectiveLimits.minHr : 0,
      limiteHr: limiteHrActive ? effectiveLimits.maxHr : 0,
      limiteKmMinActive,
      limiteKmActive,
      limiteHrMinActive,
      limiteHrActive,
      limiteKmHint: _hintText(sanitizedHints.minKm, sanitizedHints.maxKm),
      limiteHrHint: _hintText(sanitizedHints.minHr, sanitizedHints.maxHr)
    };
  }

  function _queuePersist(state, payload) {
    if (!state?.vehicleKey) return;

    const body = {
      vehicle: state.vehicleKey,
      deltaKm: {
        min: payload.limiteKmMinActive ? payload.limiteKmMin : null,
        max: payload.limiteKmActive ? payload.limiteKm : null
      },
      deltaHr: {
        min: payload.limiteHrMinActive ? payload.limiteHrMin : null,
        max: payload.limiteHrActive ? payload.limiteHr : null
      },
      metadata: {
        source: "FuelDialog",
        savedAt: new Date().toISOString()
      }
    };

    const serialized = JSON.stringify(body);
    state._pendingPersistBody = serialized;

    if (state._persistTimer) {
      clearTimeout(state._persistTimer);
    }

    state._persistTimer = setTimeout(() => {
      state._persistTimer = null;
      const payloadBody = state._pendingPersistBody;
      const doFetch = (typeof window !== "undefined" && typeof window.fetch === "function")
        ? window.fetch
        : null;

      const request = doFetch
        ? doFetch(SAVE_LIMITS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payloadBody
          })
        : jQuery.ajax({
            url: SAVE_LIMITS_URL,
            method: "POST",
            contentType: "application/json",
            data: payloadBody
          });

      Promise.resolve(request)
        .then((response) => {
          if (response && response.ok === false) {
            throw new Error("Falha ao salvar limites");
          }
          state._lastPersistBody = payloadBody;
        })
        .catch(() => {
          state._lastPersistBody = null;
        })
        .finally(() => {
          if (state._pendingPersistBody === payloadBody) {
            state._pendingPersistBody = null;
          }
        });
    }, 600);
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
          list.forEach((it) => {
            const code = String(it.veiculo || "").trim();
            if (!code) return;
            map[code] = {
              litros: it.litros || {},
              deltaKm: it.deltaKm || {},
              deltaHr: it.deltaHr || {}
            };
          });
          _rangesByVeh = map;
          resolve(_rangesByVeh);
        },
        error: () => {
          _rangesByVeh = {};
          resolve(_rangesByVeh);
        }
      });
    });
  }

  function _getVehRanges(vehCode) {
    const r = _rangesByVeh?.[vehCode] || {};
    const km = r.deltaKm || {};
    const hr = r.deltaHr || {};
    const lt = r.litros || {};
    return {
      minKm: _parseNum(km.min),
      maxKm: _parseNum(km.max),
      minHr: _parseNum(hr.min),
      maxHr: _parseNum(hr.max),
      minLt: _parseNum(lt.min),
      maxLt: _parseNum(lt.max)
    };
  }

  async function openFuelDialog(oController, vehicleObj, range) {
    await _loadRangesOnce();

    const vehKey = _pickVehicleKey(vehicleObj);
    const abModel = oController.getView().getModel("abastec") || oController.getView().getModel("abast");

    // Se o modelo de abastecimentos ainda não tiver sido carregado (obj vazio),
    // tentar carregar rapidamente o mês atual via Component (fallback).
    let abMap = abModel && abModel.getProperty("/abastecimentosPorVeiculo");
    if (abModel && (!abMap || Object.keys(abMap).length === 0)) {
      try {
        const comp = oController.getOwnerComponent && oController.getOwnerComponent();
        if (comp && typeof comp.loadAllHistoryInRange === "function") {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth(), 28);
          // load only current month as a quick attempt to populate data
          await comp.loadAllHistoryInRange(start, end);
          abMap = abModel.getProperty("/abastecimentosPorVeiculo");
        }
      } catch (e) {
        // swallow - we'll continue with whatever data we have
        /* no-op */
      }
    }

    const baseArr =
      (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + vehKey)) ||
      vehicleObj.abastecimentos ||
      [];

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
        const ts = _orderTs(a);
        return (!start || ts >= start.getTime()) && (!end || ts <= end.getTime());
      });
    }

    const limits = _sanitizeLimits(_getVehRanges(vehKey));
    const baseEvents = _cloneEvents(list);
    const payload = _buildFuelModelPayload(baseEvents, limits, {
      limiteKm: limits.maxKm,
      limiteKmMin: limits.minKm,
      limiteHr: limits.maxHr,
      limiteHrMin: limits.minHr
    }, limits);

    const titulo = `Abastecimentos - ${vehicleObj.equnr || vehicleObj.veiculo || ""} - ${vehicleObj.eqktx || vehicleObj.descricao || ""}`;

    if (!oController._fuelModel) {
      oController._fuelModel = new JSONModel();
    }
    oController._fuelModel.setData({
      titulo,
      ...payload
    });

    if (oController._fuelDialogState?._persistTimer) {
      clearTimeout(oController._fuelDialogState._persistTimer);
    }

    oController._fuelDialogState = {
      titulo,
      vehicleKey: vehKey,
      baseEvents,
      limits,
      originalLimits: { ...limits },
      overrides: {
        limiteKm: payload.limiteKmActive ? payload.limiteKm : null,
        limiteKmMin: payload.limiteKmMinActive ? payload.limiteKmMin : null,
        limiteHr: payload.limiteHrActive ? payload.limiteHr : null,
        limiteHrMin: payload.limiteHrMinActive ? payload.limiteHrMin : null
      },
      _persistTimer: null,
      _pendingPersistBody: null,
      _lastPersistBody: null
    };

    return oController._openFragment(
      "com/skysinc/frota/frota/fragments/FuelDialog",
      "dlgFuel",
      { fuel: oController._fuelModel }
    );
  }

  function updateFuelLimits(oController, overrides) {
    if (!oController || !oController._fuelDialogState) return;

    const state = oController._fuelDialogState;
    state.overrides = {
      ...(state.overrides || {}),
      ...(overrides || {})
    };

    const payload = _buildFuelModelPayload(
      state.baseEvents,
      state.limits,
      state.overrides,
      state.originalLimits
    );

    if (!oController._fuelModel) {
      oController._fuelModel = new JSONModel();
    }
    oController._fuelModel.setData({
      titulo: state.titulo,
      ...payload
    });

    state.overrides.limiteKm = payload.limiteKmActive ? payload.limiteKm : null;
    state.overrides.limiteKmMin = payload.limiteKmMinActive ? payload.limiteKmMin : null;
    state.overrides.limiteHr = payload.limiteHrActive ? payload.limiteHr : null;
    state.overrides.limiteHrMin = payload.limiteHrMinActive ? payload.limiteHrMin : null;

    if (state.vehicleKey && _rangesByVeh) {
      const cache = _rangesByVeh[state.vehicleKey] || (_rangesByVeh[state.vehicleKey] = {});
      cache.deltaKm = cache.deltaKm || {};
      cache.deltaHr = cache.deltaHr || {};
      cache.deltaKm.min = payload.limiteKmMinActive ? payload.limiteKmMin : null;
      cache.deltaKm.max = payload.limiteKmActive ? payload.limiteKm : null;
      cache.deltaHr.min = payload.limiteHrMinActive ? payload.limiteHrMin : null;
      cache.deltaHr.max = payload.limiteHrActive ? payload.limiteHr : null;
    }

    state.limits.minKm = payload.limiteKmMinActive ? payload.limiteKmMin : null;
    state.limits.maxKm = payload.limiteKmActive ? payload.limiteKm : null;
    state.limits.minHr = payload.limiteHrMinActive ? payload.limiteHrMin : null;
    state.limits.maxHr = payload.limiteHrActive ? payload.limiteHr : null;

    // Removido: não persistir automaticamente a cada mudança.
    // A persistência ocorrerá explicitamente via saveFuelLimits() ou ao fechar o diálogo.
  }

  async function saveFuelLimits(oController, metadata) {
    if (!oController || !oController._fuelDialogState) return Promise.resolve(false);

    const state = oController._fuelDialogState;
    const payload = _buildFuelModelPayload(
      state.baseEvents,
      state.limits,
      state.overrides,
      state.originalLimits
    );

    if (!state.vehicleKey) return Promise.resolve(false);

    const body = {
      vehicle: state.vehicleKey,
      deltaKm: {
        min: payload.limiteKmMinActive ? payload.limiteKmMin : null,
        max: payload.limiteKmActive ? payload.limiteKm : null
      },
      deltaHr: {
        min: payload.limiteHrMinActive ? payload.limiteHrMin : null,
        max: payload.limiteHrActive ? payload.limiteHr : null
      },
      metadata: Object.assign({
        source: "FuelDialog",
        savedAt: new Date().toISOString()
      }, metadata || {})
    };

    const payloadBody = JSON.stringify(body);

    const doFetch = (typeof window !== "undefined" && typeof window.fetch === "function")
      ? window.fetch
      : null;

    const request = doFetch
      ? doFetch(SAVE_LIMITS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadBody
        })
      : jQuery.ajax({
          url: SAVE_LIMITS_URL,
          method: "POST",
          contentType: "application/json",
          data: payloadBody
        });

    try {
      const resp = await Promise.resolve(request);
      if (resp && resp.ok === false) throw new Error("Falha ao salvar limites");
      state._lastPersistBody = payloadBody;
      state._pendingPersistBody = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    openFuelDialog,
    updateFuelLimits,
    saveFuelLimits
  };
});
