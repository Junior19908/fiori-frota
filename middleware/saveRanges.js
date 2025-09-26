const fs = require("fs/promises");
const path = require("path");

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

module.exports = function ({ options }) {
  const cfg = options.configuration || {};
  const endpoint = cfg.endpoint || "/local/ranges";
  const targetFile = cfg.filePath || "webapp/model/localdata/config/ranges_config.json";
  const projectRoot = process.cwd();
  const filePath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(projectRoot, targetFile);

  return async function saveRanges(req, res, next) {
    if (req.path !== endpoint || !["POST", "PUT", "PATCH"].includes(req.method)) {
      return next();
    }

    try {
      const payload = await parseBody(req);
      const vehicle = String(payload.vehicle || "").trim();
      if (!vehicle) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing vehicle" }));
        return;
      }

      let raw = "{}";
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }

      let json;
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch (err) {
        json = { corrupted: raw };
      }

      if (!Array.isArray(json.veiculos)) {
        json.veiculos = [];
      }

      let entry = json.veiculos.find((v) => String(v.veiculo || v.vehicle || "").trim() === vehicle);
      if (!entry) {
        entry = { veiculo: vehicle };
        json.veiculos.push(entry);
      }

      entry.deltaKm = entry.deltaKm || {};
      entry.deltaHr = entry.deltaHr || {};

      if (payload.deltaKm && typeof payload.deltaKm === "object") {
        if ("min" in payload.deltaKm) {
          entry.deltaKm.min = payload.deltaKm.min;
        }
        if ("max" in payload.deltaKm) {
          entry.deltaKm.max = payload.deltaKm.max;
        }
      }

      if (payload.deltaHr && typeof payload.deltaHr === "object") {
        if ("min" in payload.deltaHr) {
          entry.deltaHr.min = payload.deltaHr.min;
        }
        if ("max" in payload.deltaHr) {
          entry.deltaHr.max = payload.deltaHr.max;
        }
      }

      if (payload.metadata && typeof payload.metadata === "object") {
        entry._meta = Object.assign({}, entry._meta, payload.metadata);
      }

      await fs.writeFile(filePath, JSON.stringify(json, null, 2), "utf8");

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err.message || String(err) }));
    }
  };
};
