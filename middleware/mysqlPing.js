// Simple UI5 custom middleware to test MySQL/MariaDB connectivity.
// It creates a database (optional) and a table `ping_test`, then inserts a row.

const os = require("os");

let mysql;
try {
  mysql = require("mysql2/promise");
} catch (e) {
  mysql = null;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = function ({ options }) {
  // Load .env if available (dev-time convenience)
  try { require("dotenv").config(); } catch (_) {}

  const cfg = options.configuration || {};
  const endpoint = cfg.endpoint || "/local/mysql-ping";

  // Connection info from env vars. Provide sensible defaults for local dev.
  const DB_HOST = process.env.MYSQL_HOST || process.env.DB_HOST || "127.0.0.1";
  const DB_PORT = Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306);
  const DB_USER = process.env.MYSQL_USER || process.env.DB_USER || "root";
  const DB_PASS = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "";
  const DB_NAME = process.env.MYSQL_DATABASE || process.env.DB_NAME || "frota_local";

  async function handle(req, res, next) {
    if (req.path !== endpoint || !["GET", "POST"].includes(req.method)) return next();

    if (!mysql) {
      return sendJson(res, 500, { ok: false, reason: "mysql2 module not installed" });
    }

    const started = Date.now();
    let conn; let createdDb = false; let createdTable = false; let insertId = null; let count = 0;
    try {
      // First connect without database to ensure DB exists
      conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, multipleStatements: true });
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdDb = true; // either pre-existing or created now
      await conn.changeUser({ database: DB_NAME });

      // Create table if not exists
      const createSql = `CREATE TABLE IF NOT EXISTS ping_test (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        host VARCHAR(128) NULL,
        note VARCHAR(255) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
      await conn.query(createSql);
      createdTable = true;

      // Insert a row
      const [r] = await conn.query("INSERT INTO ping_test (host, note) VALUES (?, ?)", [os.hostname(), "pong"]);
      insertId = r && (r.insertId || null);

      // Count rows
      const [rows] = await conn.query("SELECT COUNT(*) AS c FROM ping_test");
      count = Array.isArray(rows) && rows[0] && Number(rows[0].c) || 0;

      const elapsedMs = Date.now() - started;
      return sendJson(res, 200, {
        ok: true,
        db: DB_NAME,
        table: "ping_test",
        createdDb,
        createdTable,
        insertedId: insertId,
        count,
        elapsedMs
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, reason: err && err.message || String(err) });
    } finally {
      try { if (conn) await conn.end(); } catch (_) {}
    }
  }

  return handle;
};

