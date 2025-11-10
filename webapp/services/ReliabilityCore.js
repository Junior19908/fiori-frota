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
  const DEFAULT_BREAK_SETTINGS = {
    breakEstimator: { mode: "percentile", p: 0.8, emaAlpha: 0.3 },
    minDeltaKm: 1,
    minDeltaHr: 0.01
  };
  const DEFAULT_TIMEZONE = "America/Maceio";

  function toTimeZoneDate(value, timeZone = DEFAULT_TIMEZONE) {
    const date = coerceDate(value);
    if (!date) {
      return null;
    }
    if (typeof Intl !== "object" || typeof Intl.DateTimeFormat !== "function") {
      return new Date(date.getTime());
    }
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      const parts = formatter.formatToParts(date);
      const tokens = {};
      parts.forEach((part) => {
        if (part.type === "literal") {
          return;
        }
        tokens[part.type] = part.value;
      });
      const iso = `${tokens.year || "1970"}-${tokens.month || "01"}-${tokens.day || "01"}T${tokens.hour || "00"}:${tokens.minute || "00"}:${tokens.second || "00"}`;
      const zoned = new Date(iso);
      return Number.isNaN(zoned.getTime()) ? new Date(date.getTime()) : zoned;
    } catch (err) {
      return new Date(date.getTime());
    }
  }

  function nowLocal(timeZone = DEFAULT_TIMEZONE) {
    return toTimeZoneDate(new Date(), timeZone);
  }

  function hoursDiff(start, end, options = {}) {
    const tz = options.timeZone || DEFAULT_TIMEZONE;
    const startDate = toTimeZoneDate(start, tz);
    const endDate = toTimeZoneDate(end, tz);
    if (!(startDate && endDate)) {
      return 0;
    }
    const delta = endDate.getTime() - startDate.getTime();
    if (!Number.isFinite(delta) || delta <= 0) {
      return 0;
    }
    return delta / 36e5;
  }

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

  function getTypeCode(os) {
    if (!os || typeof os !== "object") {
      return "";
    }
    const candidates = [
      os.type,
      os.Type,
      os.tipo,
      os.Tipo,
      os.tipoOs,
      os.tipoOS,
      os.TipoOS,
      os.tipoOS,
      os.tipo_orden,
      os.class,
      os.category,
      os.categoria,
      os.Categoria
    ];
    for (let i = 0; i < candidates.length; i++) {
      const value = candidates[i];
      if (value == null) {
        continue;
      }
      const raw = String(value).toUpperCase().trim();
      if (!raw) {
        continue;
      }
      const match = raw.match(/ZF0[123]/);
      if (match) {
        return match[0];
      }
    }
    return "";
  }

  function getOsType(os) {
    return getTypeCode(os);
  }

  function isOrderOpen(os) {
    const endDate = coerceDate(os && (os.endDate || os.end || os.finishedAt));
    if (endDate && !Number.isNaN(endDate.getTime())) {
      return false;
    }
    const status = String(os && os.status || "").trim().toUpperCase();
    if (!status) {
      return true;
    }
    return !["ENCERRADA", "ENCERRADO", "FECHADA", "FECHADO", "CONCLUIDA", "CONCLUÍDA", "FINALIZADA", "FINALIZADO"].includes(status);
  }

  function isZF02(os) {
    return getOsType(os) === "ZF02";
  }

  function isZF03(os) {
    return getOsType(os) === "ZF03";
  }

  function shouldSkipDueToStopFlag(os) {
    if (!os) {
      return true;
    }
    if (os.hasStop === false && !isZF02(os)) {
      return true;
    }
    return false;
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

  function percentile(arr, p) {
    const values = positiveFinite(arr).sort((a, b) => a - b);
    if (!values.length) {
      return 0;
    }
    const fraction = Math.max(0, Math.min(1, Number(p)));
    if (!Number.isFinite(fraction)) {
      return values[values.length - 1];
    }
    if (values.length === 1) {
      return values[0];
    }
    const idx = fraction * (values.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) {
      return values[lower];
    }
    const weight = idx - lower;
    return values[lower] + (values[upper] - values[lower]) * weight;
  }

  function ema(arr, alpha = 0.3) {
    const values = positiveFinite(arr);
    if (!values.length) {
      return 0;
    }
    const factor = Number.isFinite(alpha) ? Math.max(0.01, Math.min(0.99, alpha)) : 0.3;
    let acc = values[0];
    for (let i = 1; i < values.length; i++) {
      acc = factor * values[i] + (1 - factor) * acc;
    }
    return acc;
  }

  function positiveFinite(arr) {
    return (Array.isArray(arr) ? arr : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  function resolveStartDate(os) {
    return coerceDate(
      (os && (
        os.startAt || os.start_date || os.startDate || os.start || os.dataAbertura || os.DataAbertura || os.inicio
      )) || null
    );
  }

  function resolveEndDate(os) {
    return coerceDate(
      (os && (
        os.endAt || os.end_date || os.endDate || os.end || os.dataFechamento || os.DataFechamento || os.fim || os.dataFim
      )) || null
    );
  }

  function durationHours(os, now = nowLocal()) {
    const start = resolveStartDate(os);
    if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
      return 0;
    }
    let end = resolveEndDate(os);
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
      const fallback = coerceDate(now) || nowLocal();
      end = fallback instanceof Date ? fallback : new Date();
    }
    const ms = Math.max(0, end.getTime() - start.getTime());
    return ms / 36e5;
  }

  function sumHoursByTypes(osList, types = [], options = {}) {
    const typeSet = new Set(
      (Array.isArray(types) ? types : [])
        .map((code) => String(code || "").toUpperCase().trim())
        .filter((code) => /ZF0[123]/.test(code))
    );
    if (!typeSet.size) {
      return 0;
    }
    const nowRef = coerceDate(options.now) || nowLocal(options.timeZone || DEFAULT_TIMEZONE);
    const seen = new Set();
    let total = 0;
    (Array.isArray(osList) ? osList : []).forEach((os) => {
      if (!os) {
        return;
      }
      let unique = os.id || os.ID || os.ordem || os.Ordem || os.numero || os.Numero || os.NumeroOS || os.order || null;
      if (!unique) {
        try {
          unique = JSON.stringify(os);
        } catch (_) {
          unique = null;
        }
      }
      const id = unique ? String(unique).trim() : "";
      if (id && seen.has(id)) {
        return;
      }
      if (id) {
        seen.add(id);
      }
      const type = getTypeCode(os);
      if (!typeSet.has(type)) {
        return;
      }
      const baseDuration = Number(os.duracaoHoras);
      const hours = Number.isFinite(baseDuration) && baseDuration >= 0
        ? baseDuration
        : durationHours(os, nowRef);
      if (Number.isFinite(hours) && hours > 0) {
        total += hours;
      }
    });
    return total;
  }

  function sumHorasByType(osList, typeCode, options = {}) {
    const targetType = String(typeCode || "").trim().toUpperCase();
    if (!targetType) {
      return 0;
    }
    return sumHoursByTypes(osList, [targetType], options);
  }

  function interFailureDeltas(events, accessor) {
    const deltas = [];
    let prev = null;
    (Array.isArray(events) ? events : []).forEach((event) => {
      if (!event) {
        return;
      }
      const value = typeof accessor === "function" ? accessor(event) : null;
      if (!Number.isFinite(value)) {
        return;
      }
      if (Number.isFinite(prev) && value > prev) {
        deltas.push(value - prev);
      }
      prev = value;
    });
    return deltas;
  }

  function robustInterval(deltas, options = {}) {
    const values = positiveFinite(deltas);
    if (!values.length) {
      return 0;
    }
    const mode = String(options.mode || DEFAULT_BREAK_SETTINGS.breakEstimator.mode).toLowerCase();
    if (mode === "ema") {
      return ema(values, options.emaAlpha);
    }
    const percentileValue = Number.isFinite(options.p) ? options.p : DEFAULT_BREAK_SETTINGS.breakEstimator.p;
    return percentile(values, percentileValue);
  }

  function normalizeReliabilitySettings(settings) {
    const cfg = settings && typeof settings === "object" ? settings : {};
    const estimator = Object.assign({}, DEFAULT_BREAK_SETTINGS.breakEstimator, cfg.breakEstimator || {});
    const normalized = {
      breakEstimator: {
        mode: String(estimator.mode || DEFAULT_BREAK_SETTINGS.breakEstimator.mode).toLowerCase() === "ema" ? "ema" : "percentile",
        p: Number.isFinite(estimator.p) ? Math.max(0, Math.min(1, estimator.p)) : DEFAULT_BREAK_SETTINGS.breakEstimator.p,
        emaAlpha: Number.isFinite(estimator.emaAlpha) ? Math.max(0.01, Math.min(0.99, estimator.emaAlpha)) : DEFAULT_BREAK_SETTINGS.breakEstimator.emaAlpha
      },
      minDeltaKm: Number.isFinite(cfg.minDeltaKm) ? Math.max(0, cfg.minDeltaKm) : DEFAULT_BREAK_SETTINGS.minDeltaKm,
      minDeltaHr: Number.isFinite(cfg.minDeltaHr) ? Math.max(0, cfg.minDeltaHr) : DEFAULT_BREAK_SETTINGS.minDeltaHr
    };
    return normalized;
  }

  function addDays(date, days) {
    const base = coerceDate(date);
    if (!(base && Number.isFinite(days))) {
      return null;
    }
    const clone = new Date(base.getTime());
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  function formatKmValue(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "-";
    }
    return Math.round(value).toLocaleString("pt-BR") + " Km";
  }

  function formatHrValue(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "-";
    }
    return value.toFixed(2) + " h";
  }

  function formatDateValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "-";
    }
    try {
      return date.toLocaleDateString("pt-BR");
    } catch (err) {
      return date.toISOString();
    }
  }

  function computeAlertState(ratio) {
    if (!Number.isFinite(ratio)) {
      return "None";
    }
    if (ratio <= 0.05) {
      return "Error";
    }
    if (ratio <= 0.1) {
      return "Warning";
    }
    return "Success";
  }

  function sliceIntervalToRange(start, end, dateFrom, dateTo, now = nowLocal()) {
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

  function computeReliabilityMetrics({ osList, dateFrom, dateTo, now = nowLocal() } = {}) {
    const from = coerceDate(dateFrom);
    const to = coerceDate(dateTo);
    const nowRef = coerceDate(now) || nowLocal();
    if (!(from && to) || to.getTime() <= from.getTime()) {
      const zeroHours = hoursBetween(from, to);
      return {
        falhas: 0,
        downtimeTotal: 0,
        totalRangeHours: zeroHours,
        operationalHours: zeroHours,
        availability: 1,
        mttr: 0,
        mtbf: 0,
        horasZF02: 0,
        horasZF03: 0,
        qtdAbertasZF02: 0,
        qtdAbertasZF03: 0
      };
    }

    let falhasZF02 = 0;
    let horasZF01 = 0;
    let horasZF02 = 0;
    let horasZF03 = 0;
    let qtdAbertasZF02 = 0;
    let qtdAbertasZF03 = 0;
    const tz = DEFAULT_TIMEZONE;

      (Array.isArray(osList) ? osList : []).forEach((os) => {
        if (shouldSkipDueToStopFlag(os)) {
          return;
        }
      const start = os.start || os.startDate || os.startedAt;
      const end = os.end || os.endDate || os.finishedAt;
      const clamped = sliceIntervalToRange(start, end, from, to, nowRef);
      if (!clamped) {
        return;
      }
      const durationHours = hoursDiff(clamped[0], clamped[1], { timeZone: tz });
      if (!(durationHours > 0)) {
        return;
      }
      const type = getOsType(os);
      if (type === "ZF02") {
        falhasZF02 += 1;
        horasZF02 += durationHours;
        if (isOrderOpen(os)) {
          qtdAbertasZF02 += 1;
        }
      } else if (type === "ZF01") {
        horasZF01 += durationHours;
      } else if (type === "ZF03") {
        horasZF03 += durationHours;
        if (isOrderOpen(os)) {
          qtdAbertasZF03 += 1;
        }
      }
    });

    const totalRangeHours = hoursBetween(from, to);
    const downtimeTotal = Math.max(0, horasZF02);
    const horasZF01_ZF03 = Math.max(0, horasZF01) + Math.max(0, horasZF03);
    const operationalHours = Math.max(0, Math.min(totalRangeHours, totalRangeHours - downtimeTotal));
    const availability = totalRangeHours > 0 ? Math.max(0, Math.min(1, operationalHours / totalRangeHours)) : 1;
    const mttr = calcMTTR(downtimeTotal, falhasZF02);
    const mtbf = calcMTBF(operationalHours, falhasZF02);

    return {
      falhas: falhasZF02,
      downtimeTotal,
      totalRangeHours,
      operationalHours,
      availability,
      mttr,
      mtbf,
      horasZF01: Math.max(0, horasZF01),
      horasZF02: downtimeTotal,
      horasZF03: Math.max(0, horasZF03),
      horasZF01_ZF03,
      qtdAbertasZF02,
      qtdAbertasZF03
    };
  }

  function createEmptyBreakSummary() {
    return {
      kmBreak: null,
      hrBreak: null,
      nextBreakKm: null,
      nextBreakHr: null,
      kmToBreak: null,
      hrToBreak: null,
      kmBreakFmt: "-",
      hrBreakFmt: "-",
      nextBreakKmFmt: "-",
      nextBreakHrFmt: "-",
      kmToBreakFmt: "-",
      hrToBreakFmt: "-",
      kmBreakTooltip: "",
      hrBreakTooltip: "",
      kmBreakState: "None",
      hrBreakState: "None",
      breakAlertLevel: "none",
      breakPreventiveRecommended: false,
      breakPreventiveReason: "",
      kmToBreakRatio: null,
      hrToBreakRatio: null,
      daysToBreakKm: null,
      daysToBreakHr: null,
      etaBreakDateKm: null,
      etaBreakDateHr: null,
      etaBreakDateKmFmt: "-",
      etaBreakDateHrFmt: "-"
    };
  }

  function computeBreakPrediction(events, context = {}) {
    const summary = createEmptyBreakSummary();
    const settings = normalizeReliabilitySettings(context.settings);
    const ordered = [];
      (Array.isArray(events) ? events : []).forEach((event) => {
        if (shouldSkipDueToStopFlag(event)) {
          return;
        }
      const start = coerceDate(event.startDate || event.start || event.dataAbertura);
      if (start) {
        ordered.push({ event, start });
      }
    });
    ordered.sort((a, b) => a.start.getTime() - b.start.getTime());
    if (!ordered.length) {
      return summary;
    }
    const sortedEvents = ordered.map((item) => item.event);
    const kmDeltas = interFailureDeltas(sortedEvents, (event) => Number(event.kmAtEvent));
    const hrDeltas = interFailureDeltas(sortedEvents, (event) => Number(event.hrAtEvent));
    const kmDeltaFiltered = kmDeltas.filter((value) => Number.isFinite(value) && value >= settings.minDeltaKm);
    const hrDeltaFiltered = hrDeltas.filter((value) => Number.isFinite(value) && value >= settings.minDeltaHr);

    const kmBreak = kmDeltaFiltered.length ? robustInterval(kmDeltaFiltered, settings.breakEstimator) : null;
    const hrBreak = hrDeltaFiltered.length ? robustInterval(hrDeltaFiltered, settings.breakEstimator) : null;
    const currentKm = Number.isFinite(context.currentKm) ? context.currentKm : null;
    const currentHr = Number.isFinite(context.currentHr) ? context.currentHr : null;
    const nextBreakKm = Number.isFinite(currentKm) && Number.isFinite(kmBreak) ? currentKm + kmBreak : null;
    const nextBreakHr = Number.isFinite(currentHr) && Number.isFinite(hrBreak) ? currentHr + hrBreak : null;
    const kmToBreak = Number.isFinite(nextBreakKm) && Number.isFinite(currentKm) ? Math.max(0, nextBreakKm - currentKm) : null;
    const hrToBreak = Number.isFinite(nextBreakHr) && Number.isFinite(currentHr) ? Math.max(0, nextBreakHr - currentHr) : null;
    const kmToBreakRatio = Number.isFinite(kmBreak) && kmBreak > 0 && Number.isFinite(kmToBreak) ? kmToBreak / kmBreak : null;
    const hrToBreakRatio = Number.isFinite(hrBreak) && hrBreak > 0 && Number.isFinite(hrToBreak) ? hrToBreak / hrBreak : null;
    const kmState = computeAlertState(kmToBreakRatio);
    const hrState = computeAlertState(hrToBreakRatio);
    const alertStates = [kmState, hrState];
    const breakAlertLevel = alertStates.includes("Error")
      ? "error"
      : (alertStates.includes("Warning") ? "warning" : (alertStates.includes("Success") ? "success" : "none"));
    const preventiveRecommended = kmState === "Error" || hrState === "Error";
    let preventiveReason = "";
    if (preventiveRecommended) {
      if (kmState === "Error" && hrState === "Error") {
        preventiveReason = "km_hr";
      } else if (kmState === "Error") {
        preventiveReason = "km";
      } else {
        preventiveReason = "hr";
      }
    }

    const avgKmPerDay = Number.isFinite(context.avgKmPerDay) && context.avgKmPerDay > 0 ? context.avgKmPerDay : null;
    const avgHrPerDay = Number.isFinite(context.avgHrPerDay) && context.avgHrPerDay > 0 ? context.avgHrPerDay : null;
    const daysToBreakKm = (Number.isFinite(kmToBreak) && kmToBreak > 0 && avgKmPerDay) ? kmToBreak / avgKmPerDay : null;
    const daysToBreakHr = (Number.isFinite(hrToBreak) && hrToBreak > 0 && avgHrPerDay) ? hrToBreak / avgHrPerDay : null;
    const referenceDate = coerceDate(context.dateRef) || new Date();
    const etaBreakDateKm = Number.isFinite(daysToBreakKm) ? addDays(referenceDate, Math.ceil(daysToBreakKm)) : null;
    const etaBreakDateHr = Number.isFinite(daysToBreakHr) ? addDays(referenceDate, Math.ceil(daysToBreakHr)) : null;

    const kmBreakFmt = formatKmValue(kmBreak);
    const hrBreakFmt = formatHrValue(hrBreak);
    const nextBreakKmFmt = formatKmValue(nextBreakKm);
    const nextBreakHrFmt = formatHrValue(nextBreakHr);
    const kmToBreakFmt = formatKmValue(kmToBreak);
    const hrToBreakFmt = formatHrValue(hrToBreak);
    const kmTooltip = (nextBreakKmFmt !== "-" && kmToBreakFmt !== "-")
      ? `Proxima quebra estimada em ${nextBreakKmFmt} (faltam ${kmToBreakFmt})`
      : "";
    const hrTooltip = (nextBreakHrFmt !== "-" && hrToBreakFmt !== "-")
      ? `Proxima quebra estimada em ${nextBreakHrFmt} (faltam ${hrToBreakFmt})`
      : "";

    return Object.assign(summary, {
      kmBreak,
      hrBreak,
      nextBreakKm,
      nextBreakHr,
      kmToBreak,
      hrToBreak,
      kmBreakFmt,
      hrBreakFmt,
      nextBreakKmFmt,
      nextBreakHrFmt,
      kmToBreakFmt,
      hrToBreakFmt,
      kmBreakTooltip: kmTooltip,
      hrBreakTooltip: hrTooltip,
      kmBreakState: kmState,
      hrBreakState: hrState,
      breakAlertLevel,
      breakPreventiveRecommended: preventiveRecommended,
      breakPreventiveReason: preventiveReason,
      kmToBreakRatio,
      hrToBreakRatio,
      daysToBreakKm,
      daysToBreakHr,
      etaBreakDateKm,
      etaBreakDateHr,
      etaBreakDateKmFmt: formatDateValue(etaBreakDateKm),
      etaBreakDateHrFmt: formatDateValue(etaBreakDateHr)
    });
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
    let statsEntry = null;
    const vehicleId = options.vehicleId;
    if (vehicleId) {
      const statsSource = options.vehicleStats;
      if (statsSource instanceof Map) {
        statsEntry = statsSource.get(vehicleId) || null;
      } else if (statsSource && typeof statsSource === "object") {
        statsEntry = statsSource[vehicleId] || null;
      }
    }
    const breakPrediction = computeBreakPrediction(osList, {
      currentKm: statsEntry && Number.isFinite(statsEntry.currentKm) ? statsEntry.currentKm : null,
      currentHr: statsEntry && Number.isFinite(statsEntry.currentHr) ? statsEntry.currentHr : null,
      avgKmPerDay: statsEntry && Number.isFinite(statsEntry.avgKmPerDay) ? statsEntry.avgKmPerDay : null,
      avgHrPerDay: statsEntry && Number.isFinite(statsEntry.avgHrPerDay) ? statsEntry.avgHrPerDay : null,
      dateRef: options.dateTo || options.now,
      settings: options.settings
    });
    const availability = Number.isFinite(metrics.availability)
      ? Math.max(0, Math.min(1, metrics.availability))
      : 1;
    const pctDisp = availability * 100;
    const pctIndisp = (1 - availability) * 100;

    return Object.assign({}, metrics, breakPrediction, {
      availability,
      pctDisp,
      pctIndisp,
      disponibilidadeFmt: formatAvailability(availability),
      horasParadasFmt: formatHours(metrics.downtimeTotal),
      mttrFmt: formatHours(metrics.mttr),
      mtbfFmt: formatHours(metrics.mtbf),
      downtimeFmt: formatHours(metrics.downtimeTotal),
      horasZF01: Number.isFinite(metrics.horasZF01) ? metrics.horasZF01 : 0,
      horasZF03: Number.isFinite(metrics.horasZF03) ? metrics.horasZF03 : 0,
      horasZF01_ZF03: Number.isFinite(metrics.horasZF01_ZF03) ? metrics.horasZF01_ZF03 : (Number(metrics.horasZF01) || 0) + (Number(metrics.horasZF03) || 0),
      horasZF01_ZF03Fmt: formatHours(Number.isFinite(metrics.horasZF01_ZF03) ? metrics.horasZF01_ZF03 : ((Number(metrics.horasZF01) || 0) + (Number(metrics.horasZF03) || 0))),
      horasZF01Fmt: formatHours(metrics.horasZF01),
      horasZF02: Number.isFinite(metrics.horasZF02) ? metrics.horasZF02 : metrics.downtimeTotal,
      horasZF02Fmt: formatHours(Number.isFinite(metrics.horasZF02) ? metrics.horasZF02 : metrics.downtimeTotal),
      horasZF03Fmt: formatHours(metrics.horasZF03),
      qtdAbertasZF02: metrics.qtdAbertasZF02 || 0,
      qtdAbertasZF03: metrics.qtdAbertasZF03 || 0
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
    const statsSource = options.vehicleStats || source.__vehicleStats || null;
    const reliabilitySettings = options.settings || null;

    const ensureVehicle = (vehicleId) => {
      const osList = source.get(vehicleId) || [];
      const summary = buildEntry(osList, {
        dateFrom: from,
        dateTo: to,
        now,
        vehicleId,
        vehicleStats: statsSource,
        settings: reliabilitySettings
      });
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
    getTypeCode,
    nowLocal,
    hoursDiff,
    getOsType,
    durationHours,
    isOrderOpen,
    isZF02,
    isZF03,
    normalizeVehicleIds,
    percentile,
    ema,
    positiveFinite,
    sumHorasByType,
    sumHoursByTypes,
    interFailureDeltas,
    robustInterval,
    normalizeReliabilitySettings,
    sliceIntervalToRange,
    mergeOverlaps,
    sumIntervalsHours,
    calcMTTR,
    calcMTBF,
    hoursBetween,
    computeReliabilityMetrics,
      computeBreakPrediction,
    buildUnifiedReliabilityByVehicleFromMap,
    buildUnifiedReliabilityByVehicle
  };
});
