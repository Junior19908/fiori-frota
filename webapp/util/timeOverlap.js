(function (root, factory) {
  if (typeof sap !== "undefined" && sap.ui && sap.ui.define) {
    sap.ui.define([
      "com/skysinc/frota/frota/thirdparty/dayjs/dayjs.min",
      "com/skysinc/frota/frota/thirdparty/dayjs/plugin/customParseFormat",
      "com/skysinc/frota/frota/thirdparty/dayjs/plugin/utc",
      "com/skysinc/frota/frota/thirdparty/dayjs/plugin/timezone"
    ], function (dayjsLib, customParse, utc, timezone) {
      return factory(dayjsLib, customParse, utc, timezone);
    });
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("dayjs"),
      require("dayjs/plugin/customParseFormat"),
      require("dayjs/plugin/utc"),
      require("dayjs/plugin/timezone")
    );
  } else {
    root.timeOverlap = factory(
      root.dayjs,
      root.dayjs_plugin_customParseFormat,
      root.dayjs_plugin_utc,
      root.dayjs_plugin_timezone
    );
  }
})(typeof self !== "undefined" ? self : this, function (dayjsLib, customParse, utc, timezone) {
  "use strict";

  var dayjs = dayjsLib && dayjsLib.default ? dayjsLib.default : dayjsLib;
  var customParsePlugin = customParse && customParse.default ? customParse.default : customParse;
  var utcPlugin = utc && utc.default ? utc.default : utc;
  var timezonePlugin = timezone && timezone.default ? timezone.default : timezone;

  if (dayjs && typeof dayjs.extend === "function") {
    if (customParsePlugin) {
      dayjs.extend(customParsePlugin);
    }
    if (utcPlugin) {
      dayjs.extend(utcPlugin);
    }
    if (timezonePlugin) {
      dayjs.extend(timezonePlugin);
    }
  }

  var TZ = "America/Maceio";
  var MASK = "DD/MM/YYYY HH:mm";
  var DEBUG_OVERLAP = false;
  if (typeof process !== "undefined" && process && process.env && String(process.env.FROTA_DEBUG_OVERLAP).toLowerCase() === "true") {
    DEBUG_OVERLAP = true;
  }
  if (!DEBUG_OVERLAP) {
    try {
      if (typeof window !== "undefined" && window) {
        DEBUG_OVERLAP = window.__FROTA_DEBUG_OVERLAP__ === true
          || (window.localStorage && window.localStorage.getItem("frota:debugOverlap") === "true");
      }
    } catch (_) {
      DEBUG_OVERLAP = false;
    }
  }
  if (dayjs && dayjs.tz && typeof dayjs.tz.setDefault === "function") {
    dayjs.tz.setDefault(TZ);
  }

  function isDayjsInstance(value) {
    return !!(dayjs && dayjs.isDayjs && dayjs.isDayjs(value));
  }

  function coerceDayjs(value) {
    if (!dayjs || value == null) {
      return null;
    }
    if (isDayjsInstance(value)) {
      return value;
    }
    if (value instanceof Date || (typeof value === "number" && Number.isFinite(value))) {
      var fromDate = dayjs(value);
      return fromDate && fromDate.isValid()
        ? (typeof fromDate.tz === "function" ? fromDate.tz(TZ) : fromDate)
        : null;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (dayjs.tz && typeof dayjs.tz === "function") {
        var strictParsed = null;
        try {
          strictParsed = dayjs.tz(trimmed, MASK, TZ, true);
        } catch (_) {
          strictParsed = null;
        }
        if (strictParsed && strictParsed.isValid()) {
          return strictParsed;
        }
        if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
          var tzParsed = null;
          try {
            tzParsed = dayjs.tz(trimmed, TZ);
          } catch (_) {
            tzParsed = null;
          }
          if (tzParsed && tzParsed.isValid()) {
            return tzParsed;
          }
        }
      }
      var fallback = dayjs(trimmed);
      if (fallback && fallback.isValid()) {
        return typeof fallback.tz === "function" ? fallback.tz(TZ) : fallback;
      }
      return null;
    }
    return null;
  }

  function parseTz(dateStr) {
    var parsed = coerceDayjs(dateStr);
    return parsed && parsed.isValid() ? parsed : null;
  }

  function overlapMinutes(start, end, fStart, fEnd, nowRef) {
    if (!dayjs) {
      return 0;
    }
    var filterStart = coerceDayjs(fStart);
    var filterEnd = coerceDayjs(fEnd);
    if (!(filterStart && filterEnd) || !filterEnd.isAfter(filterStart)) {
      return 0;
    }

    var osStart = coerceDayjs(start);
    if (!osStart) {
      return 0;
    }
    var osEnd = end ? coerceDayjs(end) : null;
    var nowCoerced = nowRef ? coerceDayjs(nowRef) : null;
    var now = nowCoerced || (dayjs.tz ? dayjs.tz(new Date(), TZ) : dayjs());
    var cappedEnd = (osEnd && osEnd.isValid() && osEnd.isAfter(osStart))
      ? osEnd
      : (now.isBefore(filterEnd) ? now : filterEnd);

    var effectiveStart = osStart.isAfter(filterStart) ? osStart : filterStart;
    var effectiveEnd = cappedEnd.isBefore(filterEnd) ? cappedEnd : filterEnd;

    if (!effectiveEnd.isAfter(effectiveStart)) {
      return 0;
    }
    var diff = effectiveEnd.diff(effectiveStart, "minute");
    if (DEBUG_OVERLAP && typeof console !== "undefined" && typeof console.debug === "function") {
      try {
        console.debug("[timeOverlap]", {
          start: osStart && osStart.format ? osStart.format(MASK) : osStart,
          end: effectiveEnd && effectiveEnd.format ? effectiveEnd.format(MASK) : effectiveEnd,
          filterStart: filterStart && filterStart.format ? filterStart.format(MASK) : filterStart,
          filterEnd: filterEnd && filterEnd.format ? filterEnd.format(MASK) : filterEnd,
          minutes: diff
        });
      } catch (_) {
        // ignore logging issues
      }
    }
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  }

  function formatHm(totalMinutes) {
    var minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return hours + "h" + String(rest).padStart(2, "0");
  }

  return {
    parseTz: parseTz,
    overlapMinutes: overlapMinutes,
    formatHm: formatHm,
    dayjs: dayjs,
    TZ: TZ,
    MASK: MASK,
    coerceDayjs: coerceDayjs
  };
});
