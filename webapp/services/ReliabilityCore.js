(function (root, factory) {
  if (typeof sap !== "undefined" && sap.ui && sap.ui.define) {
    sap.ui.define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ReliabilityCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HOURS_FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const PCT_FMT = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function coerceDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getTime());
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === "string" && value) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function normalizeVehicleIds(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    const set = new Set();
    list.forEach((entry) => {
      const id = String(entry || "").trim();
      if (id) {
        set.add(id);
      }
    });
    return Array.from(set.values());
  }

  function sliceIntervalToRange(start, end, dateFrom, dateTo, now = new Date()) {
    const rangeStart = coerceDate(dateFrom);
    const rangeEnd = coerceDate(dateTo);
    if (!(rangeStart && rangeEnd) || rangeEnd.getTime() <= rangeStart.getTime()) {
      return null;
    }
    const startDate = coerceDate(start);
    if (!startDate) {
      return null;
    }
    let endDate = coerceDate(end);
    if (!endDate || endDate.getTime() <= startDate.getTime()) {
      const fallbackLimit = rangeEnd.getTime();
      const nowTime = (now instanceof Date && !Number.isNaN(now.getTime())) ? now.getTime() : Date.now();
      endDate = new Date(Math.min(fallbackLimit, nowTime));
    }
    const effectiveStart = Math.max(startDate.getTime(), rangeStart.getTime());
    const effectiveEnd = Math.min(endDate.getTime(), rangeEnd.getTime());
    if (effectiveEnd <= effectiveStart) {
      return null;
    }
    return [effectiveStart, effectiveEnd];
  }

  function mergeOverlaps(intervals) {
    if (!Array.isArray(intervals) || !intervals.length) {
      return [];
    }
    const sorted = intervals
      .map((pair) => [Number(pair[0] || 0), Number(pair[1] || 0)])
      .filter((pair) => pair[1] > pair[0])
      .sort((a, b) => a[0] - b[0]);
    if (!sorted.length) {
      return [];
    }
    const merged = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];
      if (current[0] <= last[1]) {
        last[1] = Math.max(last[1], current[1]);
      } else {
        merged.push(current.slice());
      }
    }
    return merged;
  }

  function sumIntervalsHours(intervals) {
    if (!Array.isArray(intervals) || !intervals.length) {
      return 0;
    }
    const totalMs = intervals.reduce((acc, pair) => {
      const span = Number(pair[1] || 0) - Number(pair[0] || 0);
      return acc + (span > 0 ? span : 0);
    }, 0);
    return totalMs / 36e5;
  }

  function calcMTTR(downtimeTotal, falhas) {
    if (!falhas || falhas <= 0) {
      return 0;
    }
    return (Number(downtimeTotal) || 0) / falhas;
  }

  function calcMTBF(operationalHours, falhas) {
    if (!falhas || falhas <= 0) {
      return 0;
    }
    return (Number(operationalHours) || 0) / falhas;
  }

  function hoursBetween(dateFrom, dateTo) {
    const from = coerceDate(dateFrom);
    const to = coerceDate(dateTo);
    if (!(from && to) || to.getTime() <= from.getTime()) {
      return 0;
    }
    return (to.getTime() - from.getTime()) / 36e5;
  }

  function computeReliabilityMetrics({ osList, dateFrom, dateTo, now = new Date() } = {}) {
    const from = coerceDate(dateFrom);
    const to = coerceDate(dateTo);
    if (!(from && to) || to.getTime() <= from.getTime()) {
      const zeroHours = hoursBetween(from, to);
      return {
        falhas: 0,
        downtimeTotal: 0,
        totalRangeHours: zeroHours,
        operationalHours: zeroHours,
        availability: 1,
        mttr: 0,
        mtbf: 0
      };
    }

    const intervals = [];
    let falhas = 0;
    (Array.isArray(osList) ? osList : []).forEach((os) => {
      if (!os || os.hasStop === false) {
        return;
      }
      const start = os.start || os.startDate || os.startedAt;
      const end = os.end || os.endDate || os.finishedAt;
      const clamped = sliceIntervalToRange(start, end, from, to, now);
      if (clamped) {
        intervals.push(clamped);
        falhas += 1;
      }
    });

    const merged = mergeOverlaps(intervals);
    const downtimeTotal = sumIntervalsHours(merged);
    const totalRangeHours = hoursBetween(from, to);
    const operationalHours = Math.max(0, Math.min(totalRangeHours, totalRangeHours - downtimeTotal));
    const availability = totalRangeHours > 0 ? (operationalHours / totalRangeHours) : 1;
    const mttr = calcMTTR(downtimeTotal, falhas);
    const mtbf = calcMTBF(operationalHours, falhas);

    return {
      falhas,
      downtimeTotal,
      totalRangeHours,
      operationalHours,
      availability,
      mttr,
      mtbf
    };
  }

  function formatHours(value) {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    return HOURS_FMT.format(safe) + " h";
  }

  function formatAvailability(value) {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    const disp = PCT_FMT.format(safe);
    const indisp = PCT_FMT.format(Math.max(0, Math.min(1, 1 - safe)));
    return `${disp} disponível | ${indisp} indisponível`;
  }

  function buildEntry(osList, options = {}) {
    const metrics = computeReliabilityMetrics({
      osList,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      now: options.now
    });
    const availability = Number.isFinite(metrics.availability)
      ? Math.max(0, Math.min(1, metrics.availability))
      : 1;
    const pctDisp = availability * 100;
    const pctIndisp = (1 - availability) * 100;

    return Object.assign({}, metrics, {
      availability,
      pctDisp,
      pctIndisp,
      disponibilidadeFmt: formatAvailability(availability),
      horasParadasFmt: formatHours(metrics.downtimeTotal),
      mttrFmt: formatHours(metrics.mttr),
      mtbfFmt: formatHours(metrics.mtbf),
      downtimeFmt: formatHours(metrics.downtimeTotal)
    });
  }

  function buildUnifiedReliabilityByVehicleFromMap(osMap, options = {}) {
    const source = osMap instanceof Map ? osMap : new Map();
    const vehicleIds = normalizeVehicleIds(options.vehicles);
    const includeOsList = options.includeOsList === true;
    const from = coerceDate(options.dateFrom);
    const to = coerceDate(options.dateTo);
    const now = (options.now instanceof Date && !Number.isNaN(options.now.getTime())) ? options.now : new Date();
    const output = {};

    const ensureVehicle = (vehicleId) => {
      const osList = source.get(vehicleId) || [];
      const summary = buildEntry(osList, { dateFrom: from, dateTo: to, now });
      if (includeOsList) {
        summary.osList = osList;
      }
      output[vehicleId] = summary;
    };

    if (vehicleIds.length) {
      vehicleIds.forEach((vehicleId) => {
        ensureVehicle(vehicleId);
      });
    } else {
      source.forEach((_, vehicleId) => ensureVehicle(vehicleId));
    }

    return output;
  }

  async function buildUnifiedReliabilityByVehicle(options = {}, deps = {}) {
    const provider = deps.osProvider || options.osProvider;
    if (typeof provider !== "function") {
      throw new Error("Missing osProvider for buildUnifiedReliabilityByVehicle");
    }
    const osMap = await provider(options);
    return buildUnifiedReliabilityByVehicleFromMap(osMap, options);
  }

  return {
    coerceDate,
    normalizeVehicleIds,
    sliceIntervalToRange,
    mergeOverlaps,
    sumIntervalsHours,
    calcMTTR,
    calcMTBF,
    hoursBetween,
    computeReliabilityMetrics,
    buildUnifiedReliabilityByVehicleFromMap,
    buildUnifiedReliabilityByVehicle
  };
});
