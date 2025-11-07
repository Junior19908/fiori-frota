const fs = require("fs");
const path = require("path");
const ReliabilityCore = require("../../services/ReliabilityCore.js");

const DEFAULT_RELIABILITY_SETTINGS = {
  breakEstimator: { mode: "percentile", p: 0.8, emaAlpha: 0.3 },
  minDeltaKm: 1,
  minDeltaHr: 0.01
};

function createOs(start, end, hasStop = true) {
  return {
    start,
    startDate: start,
    end,
    endDate: end,
    hasStop
  };
}

function loadTelemetryFixture(vehicleId) {
  const filePath = path.join(__dirname, "../../model/localdata/abastecimento/2025/10/abastecimentos.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const list = raw?.abastecimentosPorVeiculo?.[vehicleId] || [];
  return list
    .map((entry) => {
      const date = entry.data ? String(entry.data) : null;
      const time = entry.hora ? String(entry.hora) : "00:00:00";
      const dateTime = date ? new Date(`${date}T${time || "00:00:00"}`) : null;
      return {
        dateTime,
        km: Number(entry.km || 0),
        hr: Number(entry.hr || 0)
      };
    })
    .filter((item) => item.dateTime instanceof Date && !Number.isNaN(item.dateTime.getTime()))
    .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
}

function findNearestTelemetryEntry(entries, date) {
  if (!Array.isArray(entries) || !entries.length || !(date instanceof Date) || Number.isNaN(date)) {
    return null;
  }
  const target = date.getTime();
  let bestBefore = null;
  let bestAfter = null;
  entries.forEach((entry) => {
    const dt = entry.dateTime;
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) {
      return;
    }
    const ts = dt.getTime();
    if (ts <= target) {
      if (!bestBefore || ts > bestBefore.dateTime.getTime()) {
        bestBefore = entry;
      }
    } else if (!bestAfter || ts < bestAfter.dateTime.getTime()) {
      bestAfter = entry;
    }
  });
  return bestBefore || bestAfter || null;
}

function computeAvgPerDay(entries, field, refDate, windowDays = 30) {
  if (!Array.isArray(entries) || entries.length < 2) {
    return null;
  }
  const ref = (refDate instanceof Date && !Number.isNaN(refDate)) ? refDate : new Date();
  const refTime = ref.getTime();
  const windowStart = refTime - (Math.max(1, windowDays) * 24 * 60 * 60 * 1000);
  const filtered = entries.filter((entry) => {
    const dt = entry.dateTime;
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) {
      return false;
    }
    const ts = dt.getTime();
    if (ts > refTime || ts < windowStart) {
      return false;
    }
    return Number.isFinite(entry[field]);
  });
  if (filtered.length < 2) {
    return null;
  }
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  const delta = Number(last[field]) - Number(first[field]);
  if (!(delta > 0)) {
    return null;
  }
  const elapsedMs = last.dateTime.getTime() - first.dateTime.getTime();
  if (!(elapsedMs > 0)) {
    return null;
  }
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  if (!(elapsedDays > 0)) {
    return null;
  }
  return delta / elapsedDays;
}

function buildVehicleStatsForTest(entries, dateTo) {
  const validEntries = (entries || []).filter((entry) => entry.dateTime instanceof Date && !Number.isNaN(entry.dateTime.getTime()));
  const latest = validEntries.filter((entry) => !dateTo || (entry.dateTime.getTime() <= dateTo.getTime())).pop();
  return {
    currentKm: latest && Number.isFinite(latest.km) ? latest.km : null,
    currentHr: latest && Number.isFinite(latest.hr) ? latest.hr : null,
    avgKmPerDay: computeAvgPerDay(entries, "km", dateTo),
    avgHrPerDay: computeAvgPerDay(entries, "hr", dateTo)
  };
}

function attachTelemetryToEvents(osList, telemetryEntries) {
  return (osList || []).map((os) => {
    if (Number.isFinite(os.kmAtEvent) && Number.isFinite(os.hrAtEvent)) {
      return os;
    }
    const snapshot = (os && os.startDate instanceof Date) ? findNearestTelemetryEntry(telemetryEntries, os.startDate) : null;
    if (snapshot) {
      if (!Number.isFinite(os.kmAtEvent)) {
        os.kmAtEvent = Number.isFinite(snapshot.km) ? snapshot.km : null;
      }
      if (!Number.isFinite(os.hrAtEvent)) {
        os.hrAtEvent = Number.isFinite(snapshot.hr) ? snapshot.hr : null;
      }
    }
    return os;
  });
}

describe("sliceIntervalToRange", () => {
  const { sliceIntervalToRange } = ReliabilityCore;

  it("returns null when there is no overlap", () => {
    const from = new Date("2025-10-01T00:00:00");
    const to = new Date("2025-10-31T23:59:59");
    const start = new Date("2025-09-01T00:00:00");
    const end = new Date("2025-09-02T00:00:00");
    expect(sliceIntervalToRange(start, end, from, to)).toBeNull();
  });

  it("clamps intervals to the provided range", () => {
    const from = new Date("2025-10-01T00:00:00");
    const to = new Date("2025-10-31T23:59:59");
    const start = new Date("2025-09-30T12:00:00");
    const end = new Date("2025-10-02T12:00:00");
    const interval = sliceIntervalToRange(start, end, from, to);
    expect(interval).not.toBeNull();
    const [clampedStart, clampedEnd] = interval;
    expect(new Date(clampedStart).toISOString()).toBe(new Date("2025-10-01T00:00:00").toISOString());
    expect(new Date(clampedEnd).toISOString()).toBe(new Date("2025-10-02T12:00:00").toISOString());
  });
});

describe("mergeOverlaps", () => {
  const { mergeOverlaps } = ReliabilityCore;

  it("merges touching and overlapping intervals", () => {
    const intervals = [
      [0, 10],
      [5, 15],
      [20, 30],
      [25, 35]
    ];
    expect(mergeOverlaps(intervals)).toEqual([
      [0, 15],
      [20, 35]
    ]);
  });
});

describe("sumIntervalsHours", () => {
  const { sumIntervalsHours } = ReliabilityCore;

  it("converts milliseconds to hours", () => {
    const intervals = [
      [0, 3_600_000],
      [3_600_000, 5_400_000]
    ];
    expect(sumIntervalsHours(intervals)).toBeCloseTo(1.5);
  });
});

describe("computeReliabilityMetrics", () => {
  const { computeReliabilityMetrics } = ReliabilityCore;
  const range = {
    dateFrom: new Date("2025-10-01T00:00:00Z"),
    dateTo: new Date("2025-10-31T23:59:59Z")
  };

  it("returns full availability when there are no OS", () => {
    const result = computeReliabilityMetrics({
      osList: [],
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    });
    expect(result.availability).toBe(1);
    expect(result.falhas).toBe(0);
    expect(result.downtimeTotal).toBe(0);
  });

  it("counts downtime for OS entirely inside the window", () => {
    const start = new Date("2025-10-10T00:00:00Z");
    const end = new Date("2025-10-10T06:00:00Z");
    const result = computeReliabilityMetrics({
      osList: [createOs(start, end)],
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    });
    expect(result.downtimeTotal).toBeCloseTo(6);
    expect(result.falhas).toBe(1);
  });

  it("clamps OS crossing the boundaries", () => {
    const start = new Date("2025-09-30T18:00:00Z");
    const end = new Date("2025-10-01T06:00:00Z");
    const result = computeReliabilityMetrics({
      osList: [createOs(start, end)],
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    });
    expect(result.downtimeTotal).toBeCloseTo(6);
  });

  it("does not double count overlapping OS", () => {
    const start1 = new Date("2025-10-05T00:00:00Z");
    const end1 = new Date("2025-10-05T06:00:00Z");
    const start2 = new Date("2025-10-05T03:00:00Z");
    const end2 = new Date("2025-10-05T08:00:00Z");
    const result = computeReliabilityMetrics({
      osList: [createOs(start1, end1), createOs(start2, end2)],
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    });
    expect(result.downtimeTotal).toBeCloseTo(8); // 0-8h merged
    expect(result.falhas).toBe(2);
  });

  it("computes MTTR and MTBF for multiple OS", () => {
    const osList = [
      createOs(new Date("2025-10-10T00:00:00Z"), new Date("2025-10-10T04:00:00Z")),
      createOs(new Date("2025-10-15T00:00:00Z"), new Date("2025-10-15T02:00:00Z")),
      createOs(new Date("2025-10-20T00:00:00Z"), new Date("2025-10-20T01:00:00Z"))
    ];
    const result = computeReliabilityMetrics({
      osList,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo
    });
    expect(result.falhas).toBe(3);
    expect(result.mttr).toBeCloseTo((4 + 2 + 1) / 3);
    const totalHours = (range.dateTo.getTime() - range.dateFrom.getTime()) / 36e5;
    expect(result.mtbf).toBeCloseTo((totalHours - (4 + 2 + 1)) / 3);
  });
});

describe("estimator helpers", () => {
  it("computes percentile P80 correctly", () => {
    const result = ReliabilityCore.percentile([10, 100, 200, 400], 0.8);
    expect(result).toBeCloseTo(280);
  });

  it("computes EMA with custom alpha", () => {
    const result = ReliabilityCore.ema([10, 20, 50], 0.5);
    expect(result).toBeCloseTo(32.5);
  });

  it("derives inter-failure deltas from ordered events", () => {
    const events = [
      { kmAtEvent: 1000 },
      { kmAtEvent: 1600 },
      { kmAtEvent: 2200 },
      { kmAtEvent: 2100 }
    ];
    const deltas = ReliabilityCore.interFailureDeltas(events, (ev) => ev.kmAtEvent);
    expect(deltas).toEqual([600, 600]);
  });

  it("selects EMA when configured in robustInterval", () => {
    const deltas = [100, 120, 180, 260];
    const value = ReliabilityCore.robustInterval(deltas, { mode: "ema", emaAlpha: 0.4 });
    expect(value).toBeCloseTo(186.08);
  });
});

describe("computeBreakPrediction", () => {
  const baseEvents = [
    { startDate: new Date("2025-01-05T00:00:00Z"), kmAtEvent: 1000, hrAtEvent: 10, hasStop: true },
    { startDate: new Date("2025-02-04T00:00:00Z"), kmAtEvent: 2000, hrAtEvent: 40, hasStop: true },
    { startDate: new Date("2025-03-10T00:00:00Z"), kmAtEvent: 3300, hrAtEvent: 90, hasStop: true },
    { startDate: new Date("2025-04-15T00:00:00Z"), kmAtEvent: 4800, hrAtEvent: 150, hasStop: true }
  ];

  it("returns percentile-based break intervals and states", () => {
    const result = ReliabilityCore.computeBreakPrediction(baseEvents, {
      currentKm: 6000,
      currentHr: 220,
      avgKmPerDay: 250,
      avgHrPerDay: 6,
      settings: {
        breakEstimator: { mode: "percentile", p: 0.8 },
        minDeltaKm: 50,
        minDeltaHr: 5
      }
    });
    expect(result.kmBreak).toBeCloseTo(1420, 0);
    expect(result.hrBreak).toBeCloseTo(56, 0);
    expect(result.kmBreakState).toBe("Success");
    expect(result.hrBreakState).toBe("Success");
    expect(result.nextBreakKm).toBeCloseTo(7420, 0);
    expect(result.kmBreakTooltip).toContain("Proxima quebra estimada");
    expect(result.breakPreventiveRecommended).toBe(false);
  });

  it("supports EMA estimator mode", () => {
    const result = ReliabilityCore.computeBreakPrediction(baseEvents, {
      currentKm: 4800,
      currentHr: 150,
      settings: {
        breakEstimator: { mode: "ema", emaAlpha: 0.5 },
        minDeltaKm: 10,
        minDeltaHr: 1
      }
    });
    expect(result.kmBreak).toBeCloseTo(1325);
    expect(result.hrBreak).toBeCloseTo(50);
  });
});

function normalizeFixtureEntry(entry) {
  const dataInicio = entry.DataAbertura || "";
  const dataFim = entry.DataFechamento || "";
  const horaInicio = entry.HoraInicio || "00:00";
  const horaFim = entry.HoraFim || "";
  const start = new Date(`${dataInicio}T${horaInicio.padStart(5, "0")}:00`);
  const end = horaFim ? new Date(`${dataFim || dataInicio}T${horaFim.padStart(5, "0")}:00`) : null;
  return {
    vehicleId: String(entry.Equipamento || ""),
    start,
    startDate: start,
    end,
    endDate: end,
    hasStop: true
  };
}

function loadFixtureVehicle(vehicleId, dateFrom, dateTo) {
  const filePath = path.join(__dirname, "../../model/localdata/os/2025/10/os.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const list = Array.isArray(raw) ? raw : raw?.os || [];
  const filtered = list
    .filter((entry) => String(entry.Equipamento || "") === vehicleId)
    .map(normalizeFixtureEntry)
    .filter((os) => !!ReliabilityCore.sliceIntervalToRange(os.start, os.end, dateFrom, dateTo));
  return filtered;
}

function roundSummary(summary) {
  const clone = JSON.parse(JSON.stringify(summary));
  [
    "availability",
    "mtbf",
    "mttr",
    "operationalHours",
    "downtimeTotal",
    "totalRangeHours",
    "kmBreak",
    "hrBreak",
    "nextBreakKm",
    "nextBreakHr",
    "kmToBreak",
    "hrToBreak",
    "kmToBreakRatio",
    "hrToBreakRatio",
    "daysToBreakKm",
    "daysToBreakHr"
  ].forEach((key) => {
    if (typeof clone[key] === "number") {
      clone[key] = Number(clone[key].toFixed(6));
    }
  });
  if (typeof clone.pctDisp === "number") {
    clone.pctDisp = Number(clone.pctDisp.toFixed(3));
  }
  if (typeof clone.pctIndisp === "number") {
    clone.pctIndisp = Number(clone.pctIndisp.toFixed(3));
  }
  return clone;
}

describe("buildUnifiedReliabilityByVehicle snapshot", () => {
  it("matches expected metrics for vehicle 20010035 in Oct/2025", () => {
    const vehicleId = "20010035";
    const dateFrom = new Date("2025-10-01T00:00:00Z");
    const dateTo = new Date("2025-10-31T23:59:59Z");
    const osList = loadFixtureVehicle(vehicleId, dateFrom, dateTo);
    const telemetryEntries = loadTelemetryFixture(vehicleId);
    const enrichedList = attachTelemetryToEvents(osList, telemetryEntries);
    const vehicleStats = {};
    vehicleStats[vehicleId] = buildVehicleStatsForTest(telemetryEntries, dateTo);
    const osMap = new Map([[vehicleId, enrichedList]]);
    const summaryMap = ReliabilityCore.buildUnifiedReliabilityByVehicleFromMap(osMap, {
      vehicles: [vehicleId],
      dateFrom,
      dateTo,
      vehicleStats,
      settings: DEFAULT_RELIABILITY_SETTINGS
    });
    const summary = summaryMap[vehicleId];
    expect(summary).toBeDefined();
    expect(summary.kmBreak).toBeGreaterThan(0);
    if (Number.isFinite(summary.hrBreak)) {
      expect(summary.hrBreak).toBeGreaterThanOrEqual(0);
    }
    expect(typeof summary.kmToBreakFmt).toBe("string");
    expect(roundSummary(summary)).toMatchSnapshot();
  });
});
