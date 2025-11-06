const fs = require("fs");
const path = require("path");
const ReliabilityCore = require("../../services/ReliabilityCore.js");

function createOs(start, end, hasStop = true) {
  return {
    start,
    startDate: start,
    end,
    endDate: end,
    hasStop
  };
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
  ["availability", "mtbf", "mttr", "operationalHours", "downtimeTotal", "totalRangeHours"].forEach((key) => {
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
    const osMap = new Map([[vehicleId, osList]]);
    const summaryMap = ReliabilityCore.buildUnifiedReliabilityByVehicleFromMap(osMap, {
      vehicles: [vehicleId],
      dateFrom,
      dateTo
    });
    const summary = summaryMap[vehicleId];
    expect(summary).toBeDefined();
    expect(roundSummary(summary)).toMatchSnapshot();
  });
});
