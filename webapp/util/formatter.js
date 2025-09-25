sap.ui.define([], function () {
  "use strict";

  function toNum(v) { return Number(v || 0); }

  // --- Helpers internos
  function fmtNumber(v, min = 2, max = 2) {
    return Number(v || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: min, maximumFractionDigits: max
    });
  }

  // Monta "DD/MM/YYYY" a partir de pedaços numéricos, sem criar Date()
  function _ddmmyyyy(d, m, y) {
    const dd = String(d).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const yy = String(y);
    return `${dd}/${mm}/${yy}`;
  }

  // Versão usada quando já temos (y,m,d) — mantém semântica
  function _ddmmyyyy_from(y, m, d) { return _ddmmyyyy(d, m, y); }

  // Normaliza hora "HH:mm[:ss]" sem criar Date()
  function _hhmmss(hhmmss) {
    if (!hhmmss) return "";
    const m = String(hhmmss).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return String(hhmmss);
    const H = String(m[1]).padStart(2, "0");
    const M = String(m[2]).padStart(2, "0");
    const S = m[3] != null ? String(m[3]).padStart(2, "0") : null;
    return S ? `${H}:${M}:${S}` : `${H}:${M}`;
  }

  return {
    /* ==========================
     * Formatação monetária / numérica
     * ========================== */
    fmtBrl: function (v) {
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
      catch (e) { return v; }
    },

    // alias usado na view
    currencyBRL: function (v) {
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
      catch (e) { return v; }
    },

    fmtNum: function (v) { // 2 casas
      return fmtNumber(v, 2, 2);
    },

    // alias com 3 casas
    number3: function (v) {
      return fmtNumber(v, 3, 3);
    },

    /* ==========================
     * Regras de negócio / classes
     * ========================== */
    isDevolucao: function (qtde) {
      return Number(qtde) < 0;
    },
	isDisponibilidade: function (data){
	  return Number(data) <= 50;
	},
	isIndisponibilidade: function (data){
	  return Number(data) <= 49;
	},

    getTipoText: function (tipo) {
      if (!tipo) return "";
      return String(tipo).toUpperCase();
    },

    getTipoClass: function (tipo) {
      var t = (tipo || "").toString().toLowerCase();
      if (t === "serviço" || t === "servico") return "blinkingTextServico";
      if (t === "peça" || t === "peca")       return "blinkingTextPeca";
      return "";
    },

    /* ==========================
     * Datas / horas (fuso-safe)
     * ========================== */

    // Data sem deslocar: aceita Date, "YYYY-MM-DD" (com/sem timezone), "DD/MM/YYYY"
    fmtDate: function (v) {
      if (!v) return "";

      // ⚠️ Se já é Date, formatar pelos campos UTC para não "voltar 1 dia"
      if (v instanceof Date && !isNaN(v)) {
        const y = v.getUTCFullYear();
        const m = v.getUTCMonth() + 1; // 1..12
        const d = v.getUTCDate();
        return _ddmmyyyy_from(y, m, d);
      }

      const s = String(v).trim();

      // DD/MM/YYYY -> retorna como está
      let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if (m) return s;

      // ISO: YYYY-MM-DD[...] (com ou sem timezone) -> usa só a parte da data
      m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) {
        const y = +m[1], mon = +m[2], d = +m[3];
        return _ddmmyyyy_from(y, mon, d);
      }

      // Fallback: tenta parse e usa UTC para exibir
      try {
        const d2 = new Date(s);
        if (isNaN(d2)) return s;
        return _ddmmyyyy_from(d2.getUTCFullYear(), d2.getUTCMonth() + 1, d2.getUTCDate());
      } catch {
        return s;
      }
    },
    fmtDateUtcAware: function(a, b) {
      var v = a || b;
      if (!v) return "";
      var s = String(v);

      function add1Day(d) {
        var x = new Date(d.getTime());
        x.setDate(x.getDate() + 1);
        return x;
      }

      if (s.endsWith("Z") || /[+\-]\d{2}:\d{2}$/.test(s)) {
        var d = new Date(s);
        if (isNaN(d)) return "";
        d = add1Day(d);
        var dd = String(d.getUTCDate()).padStart(2, "0");
        var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        var yy = d.getUTCFullYear();
        return dd + "/" + mm + "/" + yy;
      }

      var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        var d2 = new Date(+m[1], +m[2] - 1, +m[3]);
        d2 = add1Day(d2);
        var dd2 = String(d2.getDate()).padStart(2, "0");
        var mm2 = String(d2.getMonth() + 1).padStart(2, "0");
        var yy2 = d2.getFullYear();
        return dd2 + "/" + mm2 + "/" + yy2;
      }

      try {
        var d3 = new Date(s);
        if (isNaN(d3)) return "";
        d3 = add1Day(d3);
        var dd3 = String(d3.getDate()).padStart(2, "0");
        var mm3 = String(d3.getMonth() + 1).padStart(2, "0");
        var yy3 = d3.getFullYear();
        return dd3 + "/" + mm3 + "/" + yy3;
      } catch(e) {
        return "";
      }
    },


    /** Média de eficiência: km/L (usa kmRodados / combustivelLitros) */
    fmtKmPorLitro: function (kmRodados, litros) {
      const km = Number(kmRodados || 0);
      const lt = Number(litros || 0);
      if (!isFinite(km) || !isFinite(lt) || lt <= 0) return "—";
      return (km / lt).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    /** Consumo horário: L/h (usa combustivelLitros / hrRodados) */
    fmtLitrosPorHora: function (litros, horas) {
      const lt = Number(litros || 0);
      const hr = Number(horas || 0);
      if (!isFinite(lt) || !isFinite(hr) || hr <= 0) return "—";
      return (lt / hr).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },


    // Data + Hora sem deslocar (montagem textual)
    // Ex.: ( Date(2025-09-01T00:00:00Z), "13:21:00" ) => "01/09/2025 13:21:00"
    fmtDateTime: function (dateVal, horaVal) {
      let dataTxt = "";
      if (dateVal instanceof Date && !isNaN(dateVal)) {
        dataTxt = _ddmmyyyy_from(
          dateVal.getUTCFullYear(),
          dateVal.getUTCMonth() + 1,
          dateVal.getUTCDate()
        );
      } else {
        dataTxt = this.fmtDate(dateVal);
      }
      const horaTxt = _hhmmss(horaVal);
      if (dataTxt && horaTxt) return `${dataTxt} ${horaTxt}`;
      return dataTxt || horaTxt || "";
    },

    fmtHora: function (v) {
      return _hhmmss(v);
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
