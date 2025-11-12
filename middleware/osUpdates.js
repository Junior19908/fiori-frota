const fs = require("fs/promises");
const path = require("path");

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function parseJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let data = "";
    req.on("data", function (chunk) {
      data += chunk;
    });
    req.on("end", function () {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function ensureCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin,X-Requested-With,Content-Type,Accept");
}

function normalizeValue(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function extractValue(raw, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const key = aliases[i];
    if (!key) continue;
    const value = raw[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeRow(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    NumeroOS: extractValue(raw, ["NumeroOS", "numeroos", "Numero", "NumeroOS", "Ordem", "ordem", "OS"]),
    Equipamento: extractValue(raw, ["Equipamento", "equipamento", "equip", "veiculo"]),
    Descricao: extractValue(raw, ["Descricao", "descricao", "Titulo", "titulo", "Texto"]),
    DataAbertura: extractValue(raw, ["DataAbertura", "dataAbertura", "data abertura", "Inicio", "inicio"]),
    DataFechamento: extractValue(raw, ["DataFechamento", "dataFechamento", "data fechamento", "Fim", "fim"]),
    HoraInicio: extractValue(raw, ["HoraInicio", "horaInicio", "Hora Inicio", "hora inicio"]),
    HoraFim: extractValue(raw, ["HoraFim", "horaFim", "Hora Fim", "hora fim"]),
    Status: extractValue(raw, ["Status", "status", "Situacao", "situacao"]),
    Observacoes: extractValue(raw, ["Observacoes", "observacoes", "Obs", "obs"]),
    CentroDeCusto: extractValue(raw, ["CentroDeCusto", "centroDeCusto", "CC"]),
    Prioridade: extractValue(raw, ["Prioridade", "prioridade"]),
    TipoManual: extractValue(raw, ["TipoManual", "tipoManual"])
  };
}

function extractYearMonth(dateStr) {
  if (!dateStr) {
    return null;
  }
  const normalized = String(dateStr).replace(/\//g, "-");
  const match = /^(\d{4})[-\/](\d{1,2})/.exec(normalized);
  if (!match) {
    return null;
  }
  return {
    year: match[1],
    month: match[2].padStart(2, "0")
  };
}

function getTargetFile(row, baseDir) {
  const byDate = extractYearMonth(row.DataAbertura) || extractYearMonth(row.DataFechamento);
  if (!byDate) {
    return path.join(baseDir, "sem-data", "os.json");
  }
  return path.join(baseDir, byDate.year, byDate.month, "os.json");
}

function makeMatchKey(entry) {
  const numero = (entry.NumeroOS || entry.Numero || entry.ordem || entry.OS || "").toLowerCase().trim();
  const equip = (entry.Equipamento || entry.equipamento || entry.veiculo || "").toLowerCase().trim();
  const data = (entry.DataAbertura || entry.dataAbertura || entry.dataFechamento || "").trim();
  if (!numero && !equip) {
    return null;
  }
  return [numero, equip, data].join("|");
}

function buildEntry(row) {
  const status = row.Status || (row.DataFechamento ? "FECHADA" : "ABERTA");
  return {
    NumeroOS: row.NumeroOS,
    Equipamento: row.Equipamento,
    Descricao: row.Descricao || "",
    DataAbertura: row.DataAbertura || "",
    HoraInicio: row.HoraInicio || "",
    DataFechamento: row.DataFechamento || "",
    HoraFim: row.HoraFim || "",
    Status: status,
    Observacoes: row.Observacoes || "",
    CentroDeCusto: row.CentroDeCusto || "",
    Prioridade: row.Prioridade || "",
    TipoManual: row.TipoManual || "",
    importedAt: new Date().toISOString()
  };
}

function updateEntry(entry, row, replace) {
  if (replace) {
    Object.assign(entry, buildEntry(row));
    return;
  }
  if (row.DataAbertura) {
    entry.DataAbertura = row.DataAbertura;
  }
  if (row.HoraInicio) {
    entry.HoraInicio = row.HoraInicio;
  }
  if (row.Descricao) {
    entry.Descricao = row.Descricao;
  }
  if (row.Observacoes) {
    entry.Observacoes = row.Observacoes;
  }
  if (row.CentroDeCusto) {
    entry.CentroDeCusto = row.CentroDeCusto;
  }
  if (row.Status) {
    entry.Status = row.Status;
  }
  if (row.Prioridade) {
    entry.Prioridade = row.Prioridade;
  }
  if (row.TipoManual) {
    entry.TipoManual = row.TipoManual;
  }
  if (row.DataFechamento) {
    entry.DataFechamento = row.DataFechamento;
  } else if (row.DataFechamento === "") {
    entry.DataFechamento = "";
  }
  if (row.HoraFim) {
    entry.HoraFim = row.HoraFim;
  } else if (!row.DataFechamento) {
    entry.HoraFim = "";
  }
  entry.importedAt = new Date().toISOString();
}

async function applyRows(rows, baseDir, opts) {
  const stats = { created: 0, updated: 0, ignored: 0, files: [] };
  const groups = new Map();
  for (let i = 0; i < rows.length; i++) {
    const norm = normalizeRow(rows[i]);
    if (!norm) {
      continue;
    }
    if (!norm.NumeroOS && !norm.Equipamento) {
      stats.ignored++;
      continue;
    }
    const filePath = getTargetFile(norm, baseDir);
    if (!groups.has(filePath)) {
      groups.set(filePath, []);
    }
    groups.get(filePath).push(norm);
  }
  for (const [filePath, entries] of groups.entries()) {
    let existing = [];
    try {
      const raw = await fs.readFile(filePath, "utf8");
      existing = JSON.parse(raw);
      if (!Array.isArray(existing)) {
        existing = [];
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
      existing = [];
    }
    const indexMap = new Map();
    existing.forEach(function (entry) {
      const key = makeMatchKey(entry);
      if (key) {
        indexMap.set(key, entry);
      }
    });
    entries.forEach(function (row) {
      const key = makeMatchKey(row);
      if (key && indexMap.has(key)) {
        updateEntry(indexMap.get(key), row, opts.replace);
        stats.updated++;
      } else {
        const created = buildEntry(row);
        existing.push(created);
        stats.created++;
      }
    });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2), "utf8");
    stats.files.push(filePath);
  }
  return stats;
}

module.exports = function ({ options }) {
  const cfg = (options && options.configuration) ? options.configuration : {};
  const endpoint = cfg.endpoint || "/local/os/updates";
  const defaultDir = path.join(process.cwd(), "webapp", "model", "localdata", "os");
  const baseDir = cfg.baseDir && path.isAbsolute(cfg.baseDir)
    ? cfg.baseDir
    : path.join(process.cwd(), cfg.baseDir || defaultDir);
  return async function handle(req, res, next) {
    if (req.path !== endpoint) {
      return next();
    }
    ensureCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, reason: "method not allowed" });
      return;
    }
    try {
      const payload = await parseJsonBody(req);
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) {
        sendJson(res, 400, { ok: false, reason: "rows payload required" });
        return;
      }
      const stats = await applyRows(rows, baseDir, { replace: payload.replace === true || payload.mode === "replace" });
      sendJson(res, 200, { ok: true, stats: stats });
    } catch (err) {
      sendJson(res, 500, { ok: false, reason: err && err.message ? err.message : String(err) });
    }
  };
};
