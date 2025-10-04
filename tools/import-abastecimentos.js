// CLI para importar abastecimentos a partir de Excel para Firestore
// Estrutura alvo (conforme screenshot):
//   abastecimentos/{YYYY-MM} (documento)
//     abastecimentosPorVeiculo: {
//       <veiculo>: [ { data, hora, km, hr, litros, precoLitro, comboio, sequencia, idEvento }, ... ]
//     }

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");

// ---------------------- Util ----------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      out[key] = val;
    } else if (!out.file) {
      out.file = a;
    }
  }
  return out;
}

function normalizeCols(headers) {
  const cmap = new Map();
  headers.forEach((h) => {
    if (h == null) return;
    const s = String(h).trim();
    if (!s) return;
    cmap.set(s.toLowerCase(), s);
  });
  return (name) => cmap.get(String(name || "").toLowerCase());
}

function toDate(val) {
  if (val == null || val === "") return null;
  try {
    if (val instanceof Date) return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
    const d = new Date(val);
    if (!isNaN(d)) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  } catch (e) {}
  return null;
}

function toTimeStr(val) {
  if (val == null || val === "") return null;
  try {
    if (val instanceof Date) {
      const hh = String(val.getHours()).padStart(2, "0");
      const mm = String(val.getMinutes()).padStart(2, "0");
      const ss = String(val.getSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    const s = String(val).trim();
    return s || null;
  } catch (e) {
    return null;
  }
}

function parseNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) return v;
  let s = String(v).trim();
  if (!s) return null;
  if ((s.match(/,/g) || []).length === 1 && (s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, ".");
  }
  const f = parseFloat(s);
  return isNaN(f) ? null : f;
}

function canonicalizeVehicleId(x) {
  if (x == null) return "";
  let s = String(x).trim();
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s;
}

function monthKey(dateObj) {
  if (!dateObj) return null;
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // para doc do Firestore
}

function monthKeyCompact(dateObj) {
  if (!dateObj) return null;
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`; // para idEvento
}

function makeMonthlyId(prefix, counters, dateObj) {
  const mk = monthKeyCompact(dateObj);
  if (!mk) return null;
  counters[mk] = (counters[mk] || 0) + 1;
  return `${prefix}-${mk}-${String(counters[mk]).padStart(6, "0")}`;
}

const ALLOWED_COMBOIO_LABELS = new Set([
  "Comboio 1",
  "Comboio 2",
  "Comboio 3",
  "Comboio 4",
  "Comboio 5",
  "Posto de Combustível",
]);

function normalizeComboio(raw) {
  const defLabel = "Posto de Combustível";
  if (raw == null || raw === "") return defLabel;
  const s = String(raw).trim().toUpperCase().replace(/;+/g, "");
  if (!s) return defLabel;
  if (s.startsWith("CB")) {
    const code = s.slice(0, 3); // CB1..CB5
    const map = { CB1: "Comboio 1", CB2: "Comboio 2", CB3: "Comboio 3", CB4: "Comboio 4", CB5: "Comboio 5" };
    return map[code] || defLabel;
  }
  return defLabel;
}

// ---------------------- Excel parsing ----------------------
async function loadRowsFromSheet(filePath, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  function sheetToRows(worksheet) {
    const maxCol = worksheet.columnCount || 0;
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const arr = [];
      for (let c = 1; c <= Math.max(maxCol, row.cellCount || 0); c++) {
        const cell = row.getCell(c);
        let v = null;
        if (cell) {
          if (cell.value instanceof Date) v = cell.value;
          else if (cell.text !== undefined && cell.text !== "") v = cell.text;
          else v = cell.value;
        }
        if (v === "") v = null;
        arr.push(v);
      }
      rows.push(arr);
    });
    return rows;
  }

  let ws = null;
  if (sheetName) ws = wb.getWorksheet(sheetName) || null;
  if (!ws) {
    for (const cand of wb.worksheets) {
      const rows = sheetToRows(cand);
      const idx = findHeaderRow(rows);
      if (idx >= 0) { ws = cand; break; }
    }
  }
  if (!ws) throw new Error("Planilha não encontrada/compatível");

  const rows = sheetToRows(ws);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) throw new Error("Cabeçalho não identificado (procuro 'Equipamento' etc.)");
  const headers = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);
  const objs = dataRows.map((r) => objectFromRow(headers, r));
  return objs;
}

function findHeaderRow(rows) {
  const wanted = ["Equipamento", "Qtde Abastecimento"]; // chaves mínimas
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    const asStr = row.map((c) => (c == null ? "" : String(c)));
    const ok = wanted.every((w) => asStr.some((x) => x.toLowerCase() === w.toLowerCase()));
    if (ok) return i;
  }
  return -1;
}

function objectFromRow(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) {
    const k = headers[i];
    if (k == null || k === "") continue;
    obj[String(k).trim()] = row[i];
  }
  return obj;
}

// ---------------------- Core build ----------------------
function detectFuelColumns(sampleObj) {
  const headers = Object.keys(sampleObj || {});
  const get = normalizeCols(headers);
  return {
    equip: get("Equipamento"),
    data: get("DATA_COMBUSTIVEL") || get("Data Inicio Movimento") || get("Data"),
    hora: get("HORA_COMBUSTIVEL") || get("Hora Inicio Movimento") || get("Hora"),
    km: get("kmRodados") || get("Hodometro") || get("Hodômetro") || get("Km"),
    hr: get("hrRodados") || get("Horimetro") || get("Horímetro") || get("Hr"),
    litros: get("Qtde Abastecimento") || get("Litros"),
    valor: get("COMBUSTIVEL") || get("Valor") || get("Total Abastecimento") || get("Valor Total"),
    preco: get("Preco Litro") || get("Preço do Litro") || get("PRECO_LITRO") || get("Valor Unitário") || get("Preço Unitário"),
    comboio: get("Comboio"),
  };
}

function buildAbastecimentos(rows, { precoLitroFallback } = {}) {
  const out = new Map(); // veiculo -> array de eventos
  let globalSeq = 0;
  const monthCounters = {};

  const cols = detectFuelColumns(rows.find((r) => Object.keys(r).length > 0) || {});

  for (const r of rows) {
    const veic = cols.equip ? canonicalizeVehicleId(r[cols.equip]) : null;
    if (!veic) continue;

    const dataObj = cols.data ? toDate(r[cols.data]) : null;
    const horaStr = cols.hora ? toTimeStr(r[cols.hora]) : null;
    const km = cols.km ? parseNumber(r[cols.km]) : null;
    const hr = cols.hr ? parseNumber(r[cols.hr]) : null;
    const litros = cols.litros ? parseNumber(r[cols.litros]) : null;
    const valorTotal = cols.valor ? parseNumber(r[cols.valor]) : null;
    const precoUnit = cols.preco ? parseNumber(r[cols.preco]) : null;

    let litrosFinal = litros;
    if (litrosFinal == null && valorTotal != null && precoLitroFallback) {
      const p = Number(precoLitroFallback);
      if (p > 0) litrosFinal = valorTotal / p;
    }

    let precoLitro;
    if (precoUnit != null && precoUnit > 0) {
      precoLitro = precoUnit;
    } else if (valorTotal != null && litrosFinal != null && litrosFinal !== 0) {
      precoLitro = valorTotal / litrosFinal;
    } else if (precoLitroFallback) {
      const p = Number(precoLitroFallback);
      precoLitro = p > 0 ? p : null;
    } else {
      precoLitro = null;
    }

    const comboioLabel = normalizeComboio(cols.comboio ? r[cols.comboio] : null);

    globalSeq += 1;
    const idEvt = makeMonthlyId("A", monthCounters, dataObj);

    const evt = {
      data: dataObj ? new Date(dataObj).toISOString().slice(0, 10) : null,
      hora: horaStr,
      km: km != null ? Number(km) : 0,
      hr: hr != null ? Number(hr) : 0,
      litros: litrosFinal != null ? Math.round(litrosFinal * 100) / 100 : null,
      precoLitro: precoLitro != null ? Math.round(precoLitro * 10000) / 10000 : null,
      comboio: ALLOWED_COMBOIO_LABELS.has(comboioLabel) ? comboioLabel : "Posto de Combustível",
      sequencia: globalSeq,
      idEvento: idEvt,
    };

    if (!out.has(veic)) out.set(veic, []);
    out.get(veic).push(evt);
  }

  return out; // Map veiculo -> eventos
}

// ---------------------- Firestore ----------------------
function initFirestore(credsPath) {
  if (!admin.apps.length) {
    if (credsPath) {
      const abs = path.isAbsolute(credsPath) ? credsPath : path.join(process.cwd(), credsPath);
      const svc = JSON.parse(fs.readFileSync(abs, "utf8"));
      admin.initializeApp({ credential: admin.credential.cert(svc) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    } else {
      throw new Error("Credenciais não definidas. Use --creds ou GOOGLE_APPLICATION_CREDENTIALS");
    }
  }
  return admin.firestore();
}

async function mergeWrite(db, monthDocId, byVehicle) {
  const ref = db.collection("abastecimentos").doc(monthDocId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : {};
  const existingMap = existing.abastecimentosPorVeiculo || {};

  const resultMap = {};
  for (const [veh, events] of byVehicle.entries()) {
    if (!veh) continue;
    const prev = Array.isArray(existingMap[veh]) ? existingMap[veh] : [];
    const map = new Map();
    for (const e of prev) {
      if (e && e.idEvento) map.set(e.idEvento, e);
    }
    for (const e of events) {
      if (!e.idEvento) continue; // sem data → pula
      map.set(e.idEvento, e);
    }
    const merged = Array.from(map.values()).sort((a, b) => (a.sequencia || 0) - (b.sequencia || 0));
    resultMap[veh] = merged;
  }

  await ref.set({ abastecimentosPorVeiculo: resultMap }, { merge: true });
}

// ---------------------- Main ----------------------
async function main() {
  const args = parseArgs();
  if (!args.file) {
    console.error("Uso: node tools/import-abastecimentos.js --file <excel> [--sheet <nome>] [--precoLitro <num>] [--creds <serviceAccount.json>] [--date YYYY-MM-DD | --month YYYY-MM]");
    process.exit(1);
  }

  const filePath = path.isAbsolute(args.file) ? args.file : path.join(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  const rows = await loadRowsFromSheet(filePath, args.sheet);

  // filtro opcional por data / mês
  let filtered = rows;
  if (args.date) {
    const target = new Date(args.date);
    filtered = rows.filter((r) => {
      const cols = detectFuelColumns(r);
      const d = cols.data ? toDate(r[cols.data]) : null;
      return d && d.toISOString().slice(0, 10) === new Date(target).toISOString().slice(0, 10);
    });
  } else if (args.month) {
    const [y, m] = String(args.month).split("-");
    filtered = rows.filter((r) => {
      const cols = detectFuelColumns(r);
      const d = cols.data ? toDate(r[cols.data]) : null;
      if (!d) return false;
      const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      return mk === `${y}-${m}`;
    });
  }

  const byVehicle = buildAbastecimentos(filtered, { precoLitroFallback: args.precoLitro });

  // Agrupa por mês do doc
  const byMonth = new Map(); // monthDocId -> Map(veh->events)
  for (const [veh, evts] of byVehicle.entries()) {
    for (const e of evts) {
      if (!e.data) continue; // sem data → pula
      const mk = e.data.slice(0, 7); // YYYY-MM
      if (!byMonth.has(mk)) byMonth.set(mk, new Map());
      const m = byMonth.get(mk);
      if (!m.has(veh)) m.set(veh, []);
      m.get(veh).push(e);
    }
  }

  const db = initFirestore(args.creds);
  let written = 0;
  for (const [month, vehMap] of byMonth.entries()) {
    await mergeWrite(db, month, vehMap);
    written += Array.from(vehMap.values()).reduce((acc, arr) => acc + arr.length, 0);
  }

  console.log(JSON.stringify({ months: Array.from(byMonth.keys()), eventsWritten: written }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
