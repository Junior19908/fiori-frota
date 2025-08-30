sap.ui.define([], function () {
  "use strict";

  function _formatNumberBR(n) {
    return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    const headers = Object.keys(rows[0]);

    const esc = (v) => {
      if (v == null) return "";
      if (typeof v === "number") return _formatNumberBR(v);
      let s = String(v);
      if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };

    const lines = [headers.join(";")];
    rows.forEach((r) => {
      lines.push(headers.map((h) => esc(r[h])).join(";"));
    });
    return "\uFEFF" + lines.join("\n"); // BOM p/ Excel
  }

  function downloadCsv(csvString, filename) {
    const name = filename || "dados.csv";
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  return { buildCsv, downloadCsv };
});
