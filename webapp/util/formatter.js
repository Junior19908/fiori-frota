sap.ui.define([], function () {
  "use strict";

  function toNum(v) { return Number(v || 0); }

  // --- Helpers internos
  function fmtNumber(v, min = 2, max = 2) {
    return Number(v || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: min, maximumFractionDigits: max
    });
  }

  return {
    /* ==========================
     * Formatação monetária / numérica
     * ========================== */
    fmtBrl: function (v) { // já existente
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
      catch (e) { return v; }
    },

    // ALIAS usado pela view: formatter=".formatter.currencyBRL"
    currencyBRL: function (v) {
      return this && typeof this.fmtBrl === "function" ? this.fmtBrl(v) : (() => {
        try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
        catch (e) { return v; }
      })();
    },

    fmtNum: function (v) { // já existente (2 casas)
      return fmtNumber(v, 2, 2);
    },

    // ALIAS usado pela view: formatter=".formatter.number3"
    // Ex.: 1234.567 -> "1.234,567"
    number3: function (v) {
      return fmtNumber(v, 3, 3);
    },

    /* ==========================
     * Regras de negócio / classes
     * ========================== */
    // DEVOLUÇÃO: qtde < 0
    isDevolucao: function (qtde) {
      return Number(qtde) < 0;
    },

    // Texto exibido no status ("PEÇA" | "SERVIÇO")
    getTipoText: function (tipo) {
      if (!tipo) return "";
      return String(tipo).toUpperCase();
    },

    // Classe CSS para piscar conforme o tipo
    getTipoClass: function (tipo) {
      var t = (tipo || "").toString().toLowerCase();
      if (t === "serviço" || t === "servico") return "blinkingTextServico";
      if (t === "peça" || t === "peca")       return "blinkingTextPeca";
      return "";
    },

    /* ==========================
     * Datas / horas
     * ========================== */
    fmtDate: function (v) {
      if (!v) return "";
      const s = String(v).trim();

      // Já no formato BR?
      const mBR = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (mBR) return s;

      // ISO (YYYY-MM-DD...)
      const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (mISO) return `${mISO[3]}/${mISO[2]}/${mISO[1]}`;

      // Tentativa de parse genérica
      try {
        const d = new Date(s);
        return isNaN(d) ? s : d.toLocaleDateString("pt-BR");
      } catch {
        return s;
      }
    },

    fmtHora: function (v) {
      if (!v) return "";
      var s = String(v);
      var m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
      return s;
    },

    /* ==========================
     * Métricas específicas
     * ========================== */
    fmtFuncaoKmComb: function (a, b) {
      var x = toNum(a), y = toNum(b) || 0;
      var r = y ? (x / y) : 0;
      return fmtNumber(r, 2, 2);
    },

    fmtFuncaoHoraComb: function (a, b) {
      var x = toNum(a), y = toNum(b) || 0;
      var r = y ? (x / y) : 0;
      return fmtNumber(r, 2, 2);
    },

    fmtSomaBrl: function (a, b) {
      var total = toNum(a) + toNum(b);
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total); }
      catch (e) { return String(total); }
    },

    fmtTotalItemBrl: function (q, cu) {
      var total = (Number(q || 0) * Number(cu || 0));
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total); }
      catch (e) { return String(total); }
    },

    fmtBrlunitario: function (q) {
      var n = Number(q || 0);
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n); }
      catch (e) { return String(n); }
    },

    fmtLitros: function (v) {
      return `${fmtNumber(v, 2, 2)} L`;
    },

    fmtKm: function (v) {
      try { return `${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Km`; }
      catch (e) { return v; }
    }
  };
});
