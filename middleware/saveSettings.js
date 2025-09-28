const fs = require("fs/promises");
const path = require("path");

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

module.exports = function ({ options }) {
  const cfg = options.configuration || {};
  const endpoint = cfg.endpoint || "/local/settings";
  const targetFile = cfg.filePath || "webapp/model/settings.json";
  const projectRoot = process.cwd();
  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(projectRoot, targetFile);

  return async function saveSettings(req, res, next) {
    if (req.path !== endpoint || !["POST", "PUT"].includes(req.method)) return next();
    try {
      const payload = await parseBody(req);
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err.message || String(err) }));
    }
  };
};

