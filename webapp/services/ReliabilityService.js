sap.ui.define([
  "sap/ui/thirdparty/jquery",
  "com/skysinc/frota/frota/services/ReliabilityCore"
], function (jQuery, ReliabilityCore) {
  "use strict";

  const MODULE_PREFIX = "com/skysinc/frota/frota";

  const TELEMETRY_INDEX = {
    2024: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
    2025: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]
  };

  const NUM_FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const PCT_FMT = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let _telemetryPromise = null;
  const _osMonthCache = new Map();

  const {
    sliceIntervalToRange,
    mergeOverlaps,
    sumIntervalsHours,
    computeReliabilityMetrics,
    buildUnifiedReliabilityByVehicle: buildUnifiedReliabilityByVehicleCore,
    buildUnifiedReliabilityByVehicleFromMap,
    normalizeVehicleIds,
    coerceDate
  } = ReliabilityCore;

  function _buildPaths(index, basePath) {
    const files = [];
    Object.keys(index).forEach((year) => {
      const months = index[year] || [];
      months.forEach((month) => {
        files.push(`${basePath}/${year}/${month}/` + (basePath.indexOf("abastecimento") !== -1 ? "abastecimentos.json" : "os.json"));
      });
    });
    return files;
  }

  function _pad2(value) {
    return String(value).padStart(2, "0");
  }

  function _extractOsArray(payload) {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload.os)) {
      return payload.os;
    }
    if (Array.isArray(payload.ordens)) {
      return payload.ordens;
    }
    return [];
  }

  function _normalizeTipoFilter(tiposOS) {
    if (!Array.isArray(tiposOS) || !tiposOS.length) {
      return null;
    }
    const set = new Set();
    tiposOS.forEach((tipo) => {
      const code = String(tipo || "").trim().toUpperCase();
      if (code) {
        set.add(code);
      }
    });
    return set.size ? set : null;
  }

  function _resolveHasStop(entry) {
    const candidates = [
      entry?.hasStop,
      entry?.HasStop,
      entry?.parada,
      entry?.Parada,
      entry?.temParada,
      entry?.TemParada
    ];
    for (let i = 0; i < candidates.length; i++) {
      const flag = candidates[i];
      if (typeof flag === "boolean") {
        return flag;
      }
      if (typeof flag === "string") {
        const normalized = flag.trim().toLowerCase();
        if (!normalized) {
          continue;
        }
        if (["sim", "s", "true", "1", "y"].includes(normalized)) {
          return true;
        }
        if (["nao", "não", "n", "false", "0"].includes(normalized)) {
          return false;
        }
      }
    }
    return true;
  }

  function _normalizeOsRecord(entry) {
    if (!entry) {
      return null;
    }
    const vehicleId = String(entry.Equipamento || entry.equipamento || entry.veiculo || entry.Veiculo || "").trim();
    if (!vehicleId) {
      return null;
    }
    const start = _combineDateTime(
      entry.DataAbertura || entry.dataAbertura || entry.Abertura || entry.AberturaData,
      entry.HoraInicio || entry.horaInicio || entry.HoraAbertura || entry.horaAbertura
    );
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      return null;
    }
    const end = _combineDateTime(
      entry.DataFechamento || entry.dataFechamento || entry.Fechamento || entry.FechamentoData,
      entry.HoraFim || entry.horaFim || entry.HoraFechamento || entry.horaFechamento
    );
    const numero = String(entry.NumeroOS || entry.numero || entry.Ordem || entry.ordem || entry.os || entry.OS || "").trim();
    const categoria = String(entry.Categoria || entry.categoria || entry.TipoOS || entry.tipoOS || entry.Tipo || entry.tipo || "").trim().toUpperCase();
    const descricao = String(entry.Descricao || entry.descricao || entry.Titulo || entry.titulo || "").trim();
    const hasStop = _resolveHasStop(entry);
    return {
      id: numero || `${vehicleId}-${start.getTime()}`,
      numero,
      vehicleId,
      descricao,
      categoria,
      tipo: categoria,
      dataAbertura: entry.DataAbertura || entry.dataAbertura || "",
      dataFechamento: entry.DataFechamento || entry.dataFechamento || "",
      horaInicio: entry.HoraInicio || entry.horaInicio || "",
      horaFim: entry.HoraFim || entry.horaFim || "",
      start,
      end,
      startDate: start,
      endDate: end,
      hasStop,
      status: entry.Status || entry.status || "",
      prioridade: entry.Prioridade || entry.prioridade || "",
      tipoManual: entry.TipoManual || entry.tipoManual || "",
      raw: entry
    };
  }

  function _enumerateMonths(from, to) {
    if (!(from instanceof Date) || !(to instanceof Date) || to.getTime() < from.getTime()) {
      return [];
    }
    const months = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1, 0, 0, 0, 0));
    const limit = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1, 0, 0, 0, 0));
    while (cursor.getTime() <= limit.getTime()) {
      months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      cursor.setUTCDate(1);
    }
    return months;
  }

  function _loadOsMonth(year, month) {
    const key = `${year}-${_pad2(month)}`;
    if (_osMonthCache.has(key)) {
      return _osMonthCache.get(key);
    }
    const promise = (async () => {
      const mm = _pad2(month);
      const basePath = `model/localdata/os/${year}/${mm}`;
      const candidates = [`${basePath}/os.json`, `${basePath}/ordens.json`];
      for (let i = 0; i < candidates.length; i++) {
        const payload = await _fetchJson(candidates[i]);
        const entries = _extractOsArray(payload);
        if (entries.length) {
          return entries.map(_normalizeOsRecord).filter(Boolean);
        }
      }
      return [];
    })();
    _osMonthCache.set(key, promise);
    return promise;
  }

  function _normalizeOsFilter(options) {
    const opts = options || {};
    let showAllOS = true;
    let allowedTypes = [];
    if (typeof opts.showAllOS === "boolean") {
      showAllOS = opts.showAllOS;
    }
    if (Array.isArray(opts.allowedOsTypes)) {
      allowedTypes = opts.allowedOsTypes.slice();
    }
    const normalizedSet = new Set(
      allowedTypes
        .map((code) => String(code || "").trim().toUpperCase())
        .filter(Boolean)
    );
    return {
      showAllOS,
      allowedSet: normalizedSet
    };
  }

  function _fetchJson(relativePath) {
    return new Promise((resolve) => {
      const url = sap.ui.require.toUrl(`${MODULE_PREFIX}/${relativePath}`);
      jQuery.ajax({
        url,
        dataType: "json",
        cache: false,
        success: (data) => resolve(data),
        error: () => resolve(null)
      });
    });
  }

  function _combineDateTime(dateStr, timeStr) {
    if (!dateStr) {
      return null;
    }
    const cleanDate = String(dateStr).trim();
    if (!cleanDate) {
      return null;
    }
    const cleanTime = String(timeStr || "").trim();
    const hhmm = /^\d{1,2}:\d{2}$/.test(cleanTime) ? cleanTime : "00:00";
    const candidate = `${cleanDate}T${hhmm}`;
    const dt = new Date(candidate);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
    const fallback = new Date(cleanDate);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  function _formatHours(hours) {
    const minutes = Math.max(0, Math.round((Number(hours) || 0) * 60));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h${String(m).padStart(2, "0")}`;
  }

  function _withinRange(date, range) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return false;
    }
    const from = range && range.from instanceof Date ? range.from : null;
    const to = range && range.to instanceof Date ? range.to : null;
    if (from && date.getTime() < from.getTime()) {
      return false;
    }
    if (to && date.getTime() > to.getTime()) {
      return false;
    }
    return true;
  }

  function loadTelemetry() {
    if (_telemetryPromise) {
      return _telemetryPromise;
    }
    const files = _buildPaths(TELEMETRY_INDEX, "model/localdata/abastecimento");
    _telemetryPromise = Promise.all(files.map(_fetchJson)).then((payloads) => {
      const perVehicle = new Map();
      payloads.forEach((payload) => {
        const group = payload && payload.abastecimentosPorVeiculo;
        if (!group) {
          return;
        }
        Object.keys(group).forEach((vehicleId) => {
          const current = perVehicle.get(vehicleId) || [];
          (group[vehicleId] || []).forEach((entry) => {
            const dateTime = _combineDateTime(entry.data, entry.hora);
            current.push({
              vehicleId,
              data: entry.data || null,
              hora: entry.hora || null,
              dateTime,
              km: Number(entry.km || 0),
              hr: Number(entry.hr || 0),
              litros: Number(entry.litros || 0),
              precoLitro: Number(entry.precoLitro || 0),
              sequencia: entry.sequencia,
              idEvento: entry.idEvento || null,
              fonte: "abastecimento"
            });
          });
          current.sort((a, b) => {
            const at = a.dateTime ? a.dateTime.getTime() : 0;
            const bt = b.dateTime ? b.dateTime.getTime() : 0;
            return at - bt;
          });
          perVehicle.set(vehicleId, current);
        });
      });
      return perVehicle;
    });
    return _telemetryPromise;
  }

  function calcDowntimeHoras(os, range) {
    if (!os) {
      return 0;
    }
    const rangeFrom = (range && range.from instanceof Date) ? range.from : (Array.isArray(range) ? range[0] : null);
    const rangeTo = (range && range.to instanceof Date) ? range.to : (Array.isArray(range) ? range[1] : null);
    if (!(rangeFrom instanceof Date && rangeTo instanceof Date)) {
      return 0;
    }
    const clamped = sliceIntervalToRange(os.startDate || os.start, os.endDate || os.end, rangeFrom, rangeTo);
    if (!clamped) {
      return 0;
    }
    return (clamped[1] - clamped[0]) / 36e5;
  }

  function calcIntervalsKm(osEvents) {
    const sorted = (osEvents || [])
      .filter((item) => Number.isFinite(item.kmEvento) && item.startDate instanceof Date)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const delta = current.kmEvento - prev.kmEvento;
      if (Number.isFinite(delta) && delta > 0) {
        intervals.push(delta);
      }
    }
    return intervals;
  }

  function calcIntervalsHora(osEvents) {
    const sorted = (osEvents || [])
      .filter((item) => Number.isFinite(item.hrEvento) && item.startDate instanceof Date)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const current = sorted[i];
      const delta = current.hrEvento - prev.hrEvento;
      if (Number.isFinite(delta) && delta > 0) {
        intervals.push(delta);
      }
    }
    return intervals;
  }

  function calcMTBF(operationalHours, falhas) {
    if (!falhas || falhas <= 0) {
      return 0;
    }
    return (Number(operationalHours) || 0) / falhas;
  }

  function calcMTTR(downtimeTotal, falhas) {
    if (!falhas || falhas <= 0) {
      return 0;
    }
    return (Number(downtimeTotal) || 0) / falhas;
  }

  function calcDisponibilidade(mtbf, mttr) {
    const a = Number(mtbf) || 0;
    const b = Number(mttr) || 0;
    if (a <= 0 && b <= 0) {
      return 0;
    }
    return a / (a + b);
  }

  function calcProximaQuebraKm(kmAtual, intervalosKm) {
    if (!Array.isArray(intervalosKm) || !intervalosKm.length) {
      return 0;
    }
    const soma = intervalosKm.reduce((acc, cur) => acc + Number(cur || 0), 0);
    const media = soma / intervalosKm.length;
    return Number(kmAtual || 0) + media;
  }

  function calcProximaQuebraHr(hrAtual, intervalosHr) {
    if (!Array.isArray(intervalosHr) || !intervalosHr.length) {
      return 0;
    }
    const soma = intervalosHr.reduce((acc, cur) => acc + Number(cur || 0), 0);
    const media = soma / intervalosHr.length;
    return Number(hrAtual || 0) + media;
  }

  function _findSnapshot(telemetryList, targetDate) {
    if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
      return null;
    }
    let candidate = null;
    telemetryList.forEach((entry) => {
      const dt = entry.dateTime;
      if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) {
        return;
      }
      if (dt.getTime() <= targetDate.getTime()) {
        if (!candidate || candidate.dateTime.getTime() < dt.getTime()) {
          candidate = entry;
        }
      }
    });
    return candidate;
  }

  async function fetchOsUnifiedByVehiclesAndRange(options = {}) {
    const vehicles = normalizeVehicleIds(options.vehicles || []);
    const vehicleSet = vehicles.length ? new Set(vehicles) : null;
    const dateFrom = coerceDate(options.dateFrom);
    const dateTo = coerceDate(options.dateTo);
    const tipoFilter = _normalizeTipoFilter(options.tiposOS);
    const result = new Map();
    if (!(dateFrom && dateTo) || dateTo.getTime() <= dateFrom.getTime()) {
      vehicles.forEach((id) => result.set(id, []));
      return result;
    }
    const months = _enumerateMonths(dateFrom, dateTo);
    const now = new Date();

    const monthEntries = await Promise.all(months.map(({ year, month }) => _loadOsMonth(year, month)));
    monthEntries.forEach((entries) => {
      entries.forEach((entry) => {
        if (!entry || !entry.vehicleId) {
          return;
        }
        if (vehicleSet && !vehicleSet.has(entry.vehicleId)) {
          return;
        }
        if (tipoFilter && tipoFilter.size) {
          const categoria = String(entry.categoria || "").toUpperCase();
          if (!categoria || !tipoFilter.has(categoria)) {
            return;
          }
        }
        const clamped = sliceIntervalToRange(entry.startDate, entry.endDate, dateFrom, dateTo, now);
        if (!clamped) {
          return;
        }
        if (!result.has(entry.vehicleId)) {
          result.set(entry.vehicleId, []);
        }
        result.get(entry.vehicleId).push(Object.assign({}, entry));
      });
    });

    if (vehicleSet) {
      vehicleSet.forEach((id) => {
        if (!result.has(id)) {
          result.set(id, []);
        }
      });
    }

    result.forEach((list) => {
      list.sort((a, b) => {
        const at = a.startDate instanceof Date ? a.startDate.getTime() : 0;
        const bt = b.startDate instanceof Date ? b.startDate.getTime() : 0;
        return at - bt;
      });
    });

    return result;
  }

  function buildUnifiedReliabilityByVehicle(options) {
    return buildUnifiedReliabilityByVehicleCore(options, {
      osProvider: fetchOsUnifiedByVehiclesAndRange
    });
  }

  function buildUnifiedReliabilityByVehicleFromMapPublic(osMap, options) {
    return buildUnifiedReliabilityByVehicleFromMap(osMap, options);
  }

  function mergeDataPorVeiculo(options) {
    const opts = options || {};
    const vehicleId = String(opts.vehicleId || opts.equnr || opts.veiculo || "").trim();
    const range = (opts.range && opts.range.from instanceof Date && opts.range.to instanceof Date)
      ? opts.range
      : {
          from: opts.range?.from instanceof Date ? opts.range.from : (Array.isArray(opts.range) ? opts.range[0] : null),
          to: opts.range?.to instanceof Date ? opts.range.to : (Array.isArray(opts.range) ? opts.range[1] : null)
        };
    const osFilter = _normalizeOsFilter(opts);
    const tipoFilter = (!osFilter.showAllOS && osFilter.allowedSet.size) ? Array.from(osFilter.allowedSet.values()) : null;
    const providedOsList = Array.isArray(opts.osList) ? opts.osList : null;
    const shouldFetchOs = !providedOsList && vehicleId && range.from instanceof Date && range.to instanceof Date;
    const osPromise = shouldFetchOs
      ? fetchOsUnifiedByVehiclesAndRange({
          vehicles: vehicleId ? [vehicleId] : [],
          dateFrom: range.from,
          dateTo: range.to,
          tiposOS: tipoFilter
        })
      : Promise.resolve(providedOsList && vehicleId ? new Map([[vehicleId, providedOsList]]) : new Map());

    return Promise.all([
      loadTelemetry(),
      osPromise
    ]).then((resolved) => {
      const telemetryMap = resolved[0];
      const osMap = resolved[1] || new Map();
      const vehicleTelemetry = telemetryMap.get(vehicleId) || [];

      const telemetryInRange = (range.from instanceof Date || range.to instanceof Date)
        ? vehicleTelemetry.filter((entry) => entry.dateTime && _withinRange(entry.dateTime, range))
        : vehicleTelemetry.slice();

      const osList = providedOsList && vehicleId ? providedOsList : (osMap.get(vehicleId) || []);
      osList.sort((a, b) => {
        const at = a.startDate instanceof Date ? a.startDate.getTime() : 0;
        const bt = b.startDate instanceof Date ? b.startDate.getTime() : 0;
        return at - bt;
      });

      const tableRows = osList.map((os) => {
        const downtime = calcDowntimeHoras(os, range);
        const snapshot = _findSnapshot(vehicleTelemetry, os.startDate);
        const kmEvento = snapshot ? snapshot.km : NaN;
        const hrEvento = snapshot ? snapshot.hr : NaN;
        return {
          numero: os.numero,
          descricao: os.descricao,
          categoria: os.categoria,
          dataInicio: os.dataAbertura,
          horaInicio: os.horaInicio,
          dataFim: os.dataFechamento,
          horaFim: os.horaFim,
          startDate: os.startDate,
          endDate: os.endDate,
          downtimeHoras: downtime,
          downtimeFmt: _formatHours(downtime),
          kmEvento,
          hrEvento
        };
      });

      const reliabilityByVehicle = buildUnifiedReliabilityByVehicleFromMap(osMap, {
        vehicles: vehicleId ? [vehicleId] : [],
        dateFrom: range.from,
        dateTo: range.to
      });
      const summary = vehicleId ? (reliabilityByVehicle[vehicleId] || null) : null;

      const falhas = summary ? summary.falhas : tableRows.filter((row) => row.downtimeHoras > 0).length;
      const downtimeTotal = summary ? summary.downtimeTotal : tableRows.reduce((acc, row) => acc + (Number(row.downtimeHoras) || 0), 0);

      let rangeStart = range && range.from instanceof Date ? range.from : null;
      let rangeEnd = range && range.to instanceof Date ? range.to : null;
      if (!rangeStart) {
        const firstTelemetry = telemetryInRange.length ? telemetryInRange[0] : vehicleTelemetry[0];
        rangeStart = firstTelemetry && firstTelemetry.dateTime instanceof Date ? firstTelemetry.dateTime : null;
      }
      if (!rangeEnd) {
        const lastTelemetry = telemetryInRange.length ? telemetryInRange[telemetryInRange.length - 1] : vehicleTelemetry[vehicleTelemetry.length - 1];
        rangeEnd = lastTelemetry && lastTelemetry.dateTime instanceof Date ? lastTelemetry.dateTime : new Date();
      }

      let totalRangeHours = 0;
      if (rangeStart instanceof Date && rangeEnd instanceof Date && rangeEnd.getTime() > rangeStart.getTime()) {
        totalRangeHours = (rangeEnd.getTime() - rangeStart.getTime()) / 36e5;
      }
      const operationalHours = summary ? summary.operationalHours : Math.max(0, totalRangeHours - downtimeTotal);

      const mttr = summary ? summary.mttr : calcMTTR(downtimeTotal, falhas);
      const mtbf = summary ? summary.mtbf : calcMTBF(operationalHours, falhas);
      const disponibilidade = summary ? summary.availability : calcDisponibilidade(mtbf, mttr);

      const kmEventosValidos = tableRows.filter((row) => Number.isFinite(row.kmEvento));
      const hrEventosValidos = tableRows.filter((row) => Number.isFinite(row.hrEvento));
      const kmMin = kmEventosValidos.length ? Math.min.apply(null, kmEventosValidos.map((row) => row.kmEvento)) : 0;
      const kmMax = kmEventosValidos.length ? Math.max.apply(null, kmEventosValidos.map((row) => row.kmEvento)) : 0;
      const hrMin = hrEventosValidos.length ? Math.min.apply(null, hrEventosValidos.map((row) => row.hrEvento)) : 0;
      const hrMax = hrEventosValidos.length ? Math.max.apply(null, hrEventosValidos.map((row) => row.hrEvento)) : 0;

      const kmPorQuebra = falhas ? Math.max(0, kmMax - kmMin) / falhas : 0;
      const hrPorQuebra = falhas ? Math.max(0, hrMax - hrMin) / falhas : 0;

      const intervalsKm = calcIntervalsKm(tableRows);
      const intervalsHora = calcIntervalsHora(tableRows);

      const kmAtual = telemetryInRange.length
        ? telemetryInRange[telemetryInRange.length - 1].km
        : (vehicleTelemetry.length ? vehicleTelemetry[vehicleTelemetry.length - 1].km : 0);
      const hrAtual = telemetryInRange.length
        ? telemetryInRange[telemetryInRange.length - 1].hr
        : (vehicleTelemetry.length ? vehicleTelemetry[vehicleTelemetry.length - 1].hr : 0);

      const proximaQuebraKm = calcProximaQuebraKm(kmAtual, intervalsKm);
      const proximaQuebraHr = calcProximaQuebraHr(hrAtual, intervalsHora);

      return {
        vehicleId,
        range: { from: rangeStart, to: rangeEnd },
        telemetry: telemetryInRange,
        osEventos: tableRows,
        metrics: {
          falhas,
          downtimeTotal,
          downtimeFmt: summary ? summary.downtimeFmt : _formatHours(downtimeTotal),
          mtbf,
          mtbfFmt: summary ? summary.mtbfFmt : (mtbf ? NUM_FMT.format(mtbf) + " h" : "-"),
          mttr,
          mttrFmt: summary ? summary.mttrFmt : (mttr ? NUM_FMT.format(mttr) + " h" : "-"),
          disponibilidade,
          disponibilidadeFmt: summary ? summary.disponibilidadeFmt : (disponibilidade ? PCT_FMT.format(disponibilidade) : "-"),
          kmPorQuebra,
          kmPorQuebraFmt: kmPorQuebra ? NUM_FMT.format(kmPorQuebra) + " km" : "-",
          hrPorQuebra,
          hrPorQuebraFmt: hrPorQuebra ? NUM_FMT.format(hrPorQuebra) + " h" : "-",
          proximaQuebraKm,
          proximaQuebraKmFmt: proximaQuebraKm ? NUM_FMT.format(proximaQuebraKm) + " km" : "-",
          proximaQuebraHr,
          proximaQuebraHrFmt: proximaQuebraHr ? NUM_FMT.format(proximaQuebraHr) + " h" : "-",
          kmAtual,
          hrAtual
        },
        intervals: {
          km: intervalsKm,
          hora: intervalsHora
        }
      };
    });
  }

  return {
    loadTelemetry,
    mergeDataPorVeiculo,
    calcDowntimeHoras,
    calcIntervalsKm,
    calcIntervalsHora,
    calcMTBF,
    calcMTTR,
    calcDisponibilidade,
    calcProximaQuebraKm,
    calcProximaQuebraHr,
    sliceIntervalToRange,
    mergeOverlaps,
    sumIntervalsHours,
    computeReliabilityMetrics,
    fetchOsUnifiedByVehiclesAndRange,
    buildUnifiedReliabilityByVehicle,
    buildUnifiedReliabilityByVehicleFromMap: buildUnifiedReliabilityByVehicleFromMapPublic
  };
});
