sap.ui.define([
  "sap/ui/thirdparty/jquery"
], function (jQuery) {
  "use strict";

  const MODULE_PREFIX = "com/skysinc/frota/frota";

  const TELEMETRY_INDEX = {
    2024: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
    2025: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]
  };

  const OS_INDEX = {
    2024: ["08"],
    2025: ["09", "10"]
  };

  const NUM_FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const PCT_FMT = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let _telemetryPromise = null;
  let _osPromise = null;

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

  function loadOS() {
    if (_osPromise) {
      return _osPromise;
    }
    const files = _buildPaths(OS_INDEX, "model/localdata/os");
    _osPromise = Promise.all(files.map(_fetchJson)).then((payloads) => {
      const list = [];
      payloads.forEach((payload) => {
        if (!Array.isArray(payload)) {
          return;
        }
        payload.forEach((entry) => {
          const start = _combineDateTime(entry.DataAbertura, entry.HoraInicio);
          const finish = _combineDateTime(entry.DataFechamento, entry.HoraFim);
          list.push({
            numero: String(entry.NumeroOS || ""),
            equipamento: String(entry.Equipamento || ""),
            descricao: String(entry.Descricao || "").trim(),
            categoria: String(entry.Categoria || "").trim(),
            dataAbertura: entry.DataAbertura || "",
            horaInicio: entry.HoraInicio || "",
            dataFechamento: entry.DataFechamento || "",
            horaFim: entry.HoraFim || "",
            startDate: start instanceof Date && !Number.isNaN(start.getTime()) ? start : null,
            endDate: finish instanceof Date && !Number.isNaN(finish.getTime()) ? finish : null,
            raw: entry
          });
        });
      });
      return list;
    });
    return _osPromise;
  }

  function calcDowntimeHoras(os, range) {
    if (!os || !(os.startDate instanceof Date)) {
      return 0;
    }
    const now = new Date();
    const start = os.startDate;
    const endCandidate = os.endDate instanceof Date ? os.endDate : now;
    const from = range && range.from instanceof Date ? range.from : null;
    const to = range && range.to instanceof Date ? range.to : null;
    if (to && start.getTime() > to.getTime()) {
      return 0;
    }
    let effectiveStart = start;
    if (from && start.getTime() < from.getTime()) {
      effectiveStart = from;
    }
    let effectiveEnd = endCandidate;
    if (to && endCandidate.getTime() > to.getTime()) {
      effectiveEnd = to;
    }
    const diff = effectiveEnd.getTime() - effectiveStart.getTime();
    return diff > 0 ? diff / 36e5 : 0;
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

  function mergeDataPorVeiculo(options) {
    const opts = options || {};
    const vehicleId = String(opts.vehicleId || opts.equnr || opts.veiculo || "").trim();
    const range = opts.range && opts.range.from instanceof Date && opts.range.to instanceof Date ? opts.range : {
      from: opts.range?.from instanceof Date ? opts.range.from : (Array.isArray(opts.range) ? opts.range[0] : null),
      to: opts.range?.to instanceof Date ? opts.range.to : (Array.isArray(opts.range) ? opts.range[1] : null)
    };
    const osFilter = _normalizeOsFilter(opts);

    return Promise.all([loadTelemetry(), loadOS()]).then((resolved) => {
      const telemetryMap = resolved[0];
      const osList = resolved[1] || [];
      const vehicleTelemetry = telemetryMap.get(vehicleId) || [];

      const telemetryInRange = range && (range.from instanceof Date || range.to instanceof Date)
        ? vehicleTelemetry.filter((entry) => entry.dateTime && _withinRange(entry.dateTime, range))
        : vehicleTelemetry.slice();

      const osForVehicle = osList.filter((item) => item.equipamento === vehicleId);
      const osWithinRange = range && (range.from instanceof Date || range.to instanceof Date)
        ? osForVehicle.filter((item) => {
            const start = item.startDate;
            const end = item.endDate || new Date();
            if (!start) {
              return false;
          }
          const from = range.from instanceof Date ? range.from : null;
          const to = range.to instanceof Date ? range.to : null;
          if (to && start.getTime() > to.getTime()) {
            return false;
          }
          if (from && end.getTime() < from.getTime()) {
            return false;
          }
          return true;
        })
        : osForVehicle.slice();

      const osFiltered = (!osFilter.showAllOS && osFilter.allowedSet.size)
        ? osWithinRange.filter((item) => {
            const categoria = String(item.categoria || item.raw?.Categoria || "").trim().toUpperCase();
            if (!categoria) {
              return false;
            }
            return osFilter.allowedSet.has(categoria);
          })
        : osWithinRange;

      osFiltered.sort((a, b) => {
        const at = a.startDate instanceof Date ? a.startDate.getTime() : 0;
        const bt = b.startDate instanceof Date ? b.startDate.getTime() : 0;
        return at - bt;
      });

      const tableRows = osFiltered.map((os) => {
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

      const falhas = tableRows.filter((row) => row.downtimeHoras > 0).length;
      const downtimeTotal = tableRows.reduce((acc, row) => acc + (Number(row.downtimeHoras) || 0), 0);

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
      const operationalHours = Math.max(0, totalRangeHours - downtimeTotal);

      const mttr = calcMTTR(downtimeTotal, falhas);
      const mtbf = calcMTBF(operationalHours, falhas);
      const disponibilidade = calcDisponibilidade(mtbf, mttr);

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
          downtimeFmt: _formatHours(downtimeTotal),
          mtbf,
          mtbfFmt: mtbf ? NUM_FMT.format(mtbf) + " h" : "-",
          mttr,
          mttrFmt: mttr ? NUM_FMT.format(mttr) + " h" : "-",
          disponibilidade,
          disponibilidadeFmt: disponibilidade ? PCT_FMT.format(disponibilidade) : "-",
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
    loadOS,
    mergeDataPorVeiculo,
    calcDowntimeHoras,
    calcIntervalsKm,
    calcIntervalsHora,
    calcMTBF,
    calcMTTR,
    calcDisponibilidade,
    calcProximaQuebraKm,
    calcProximaQuebraHr
  };
});
