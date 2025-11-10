const timeOverlap = require("../../util/timeOverlap");

describe("timeOverlap overlapMinutes", () => {
  it("computes only the portion inside the filter window (OS 4858590 example)", () => {
    const start = "23/09/2025 17:33";
    const end = "13/10/2025 08:00";
    const filterStart = timeOverlap.parseTz("01/10/2025 00:00");
    const filterEnd = timeOverlap.parseTz("31/10/2025 23:59");
    const minutes = timeOverlap.overlapMinutes(start, end, filterStart, filterEnd);
    expect(minutes).toBe(296 * 60);
    expect(timeOverlap.formatHm(minutes)).toBe("296h00");
  });
});
