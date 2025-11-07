sap.ui.define([], function () {
  "use strict";

  function toNum(v) { return Number(v || 0); }

  function fmtNumber(v, min = 2, max = 2) {
    return Number(v || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: min, maximumFractionDigits: max
    });
  }

  function _ddmmyyyy(d, m, y) {
    const dd = String(d).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const yy = String(y);
    return `${dd}/${mm}/${yy}`;
  }

  function _ddmmyyyy_from(y, m, d) { return _ddmmyyyy(d, m, y); }

  function _hhmmss(hhmmss) {
    if (!hhmmss) return "";
    const m = String(hhmmss).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return String(hhmmss);
    const H = String(m[1]).padStart(2, "0");
    const M = String(m[2]).padStart(2, "0");
    const S = m[3] != null ? String(m[3]).padStart(2, "0") : null;
    return S ? `${H}:${M}:${S}` : `${H}:${M}`;
  }

  function clampPercent(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  // Internal date formatter used by multiple exports (no reliance on `this`).
  function fmtDateInner(v) {
    if (!v) return "";

    if (v instanceof Date && !isNaN(v)) {
      const y = v.getUTCFullYear();
      const m = v.getUTCMonth() + 1;
      const d = v.getUTCDate();
      return _ddmmyyyy_from(y, m, d);
    }

    const s = String(v).trim();

    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return s;

    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) {
      const y = +m[1], mon = +m[2], d = +m[3];
      return _ddmmyyyy_from(y, mon, d);
    }

    try {
      const d2 = new Date(s);
      if (isNaN(d2)) return s;
      return _ddmmyyyy_from(d2.getUTCFullYear(), d2.getUTCMonth() + 1, d2.getUTCDate());
    } catch {
      return s;
    }
  }

  return {
    fmtBrl: function (v) {
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
      catch (e) { return v; }
    },

    currencyBRL: function (v) {
      try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
      catch (e) { return v; }
    },

    fmtNum: function (v) {
      return fmtNumber(v, 2, 2);
    },

    number3: function (v) {
      return fmtNumber(v, 3, 3);
    },

    isDevolucao: function (qtde) {
      return Number(qtde) < 0;
    },

    disponibilidadeState: function (valor) {
      const v = clampPercent(valor);
      if (v <= 50) return "Error";
      if (v <= 70) return "Warning";
      return "Success";
    },

    indisponibilidadeState: function (valor) {
      const v = clampPercent(valor);
      if (v >= 71) return "Error";
      if (v >= 51) return "Warning";
      return "Success";
    },

    fmtPercent: function (valor) {
      const v = clampPercent(valor);
      return v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " %";
    },

    getTipoText: function (tipo) {
      if (!tipo) return "";
      return String(tipo).toUpperCase();
    },

    getTipoClass: function (tipo) {
      var t = (tipo || "").toString().toLowerCase();
      if (t === "serviÃ§o" || t === "servico") return "blinkingTextServico";
      if (t === "peÃ§a" || t === "peca")       return "blinkingTextPeca";
      return "";
    },

    fmtDate: fmtDateInner,
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

    fmtKmPorLitro: function (kmRodados, litros) {
      const km = Number(kmRodados || 0);
      const lt = Number(litros || 0);
      if (!isFinite(km) || !isFinite(lt) || lt <= 0) return "-";
      return (km / lt).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    fmtLitrosPorHora: function (litros, horas) {
      const lt = Number(litros || 0);
      const hr = Number(horas || 0);
      if (!isFinite(lt) || !isFinite(hr) || hr <= 0) return "-";
      return (lt / hr).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    fmtDateTime: function (dateVal, horaVal) {
      let dataTxt = "";
      if (dateVal instanceof Date && !isNaN(dateVal)) {
        dataTxt = _ddmmyyyy_from(
          dateVal.getUTCFullYear(),
          dateVal.getUTCMonth() + 1,
          dateVal.getUTCDate()
        );
      } else {
        dataTxt = fmtDateInner(dateVal);
      }
      const horaTxt = _hhmmss(horaVal);
      if (dataTxt && horaTxt) return `${dataTxt} ${horaTxt}`;
      return dataTxt || horaTxt || "";
    },

    fmtHora: function (v) {
      return _hhmmss(v);
    },

    // ---- OS helpers ----
    osTypeState: function (tipo) {
      try {
        var c = String(tipo || '').toUpperCase();
        if (c === 'ZF01') return 'Success';   // Verde
        if (c === 'ZF02') return 'Error';     // Vermelho
        if (c === 'ZF03') return 'Warning';   // Amarelo
        return 'None';
      } catch (_) { return 'None'; }
    },
    hoursPct24: function (hours) {
      try { var h = Number(hours) || 0; var pct = Math.max(0, Math.min(100, (h / 24) * 100)); return Math.round(pct); } catch (_) { return 0; }
    },
    hoursPctOfMax: function (hours, max) {
      try {
        var h = Number(hours) || 0;
        var mx = Number(max) || 0;
        if (mx <= 0) return 0;
        var pct = (h / mx) * 100;
        if (!isFinite(pct)) return 0;
        return Math.max(0, Math.min(100, Math.round(pct)));
      } catch (_) { return 0; }
    },

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
	fmtKmQuebra: function (kmQ, flQ){
		var kmQuebraValor = (Number(kmQ || 0) / Number(flQ || 0));
		return `${fmtNumber(kmQuebraValor, 2, 2)}`;
	},
	fmtHrQuebra: function (hrQ, flQ){
		var hrQuebraValor = (Number(hrQ || 0) / Number(flQ || 0));
		
		return `${fmtNumber(hrQuebraValor, 2, 2)}`;
	},
	fmtHorasParadas: function (dtIni, hrIni, dtFim, hrFim){
		
		return `${fmtNumber(Math.max(hrIni, 0), 0, 2) - fmtNumber(Math.max(hrFim, 0), 0, 2)} Hr`;
	},

    fmtKm: function (v) {
      try { return `${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Km`; }
      catch (e) { return v; }
    },

    fmtDisponibilidade: function(pctDisp, pctIndisp){
      if (!isFinite(pctDisp) || !isFinite(pctIndisp)) return "";
      return `${Number(pctDisp).toFixed(1)}% disponível | ${Number(pctIndisp).toFixed(1)}% indisponível`;
    },
    fmtDisponibilidadeTooltip: function(pctDisp, pctIndisp, totalHoras, horasIndisp, horasDisp){
      const total = Number(totalHoras);
      const indisp = Number(horasIndisp);
      const disp = horasDisp != null ? Number(horasDisp) : (isFinite(total) && isFinite(indisp) ? total - indisp : NaN);
      const pctDispN = Number(pctDisp);
      const pctIndispN = Number(pctIndisp);

      if (!isFinite(total) || total <= 0) {
        if (isFinite(pctDispN) && isFinite(pctIndispN)) {
          return `${pctDispN.toFixed(1)}% disponível | ${pctIndispN.toFixed(1)}% indisponível`;
        }
        return "";
      }

      const totalTxt = fmtNumber(total, 2, 2);
      const indispTxt = fmtNumber(Math.max(indisp, 0), 2, 2);
      const dispTxt = fmtNumber(Math.max(isFinite(disp) ? disp : total - Math.max(indisp, 0), 0), 2, 2);
      const pctDispTxt = isFinite(pctDispN) ? pctDispN.toFixed(1) : "0.0";
      const pctIndispTxt = isFinite(pctIndispN) ? pctIndispN.toFixed(1) : "0.0";

      return `Indisponibilidade: (${indispTxt} h / ${totalTxt} h) x 100 = ${pctIndispTxt}%. Disponibilidade: 100 - ${pctIndispTxt}% = ${pctDispTxt}%. Horas disponíveis: ${dispTxt} h.`;
    },
	formatacaoHorasNovo: function(indispValor){
		return `${fmtNumber(Math.max(indispValor, 0), 0, 2)}`;
	},
    stateDisponibilidade: function(pctDisp){
      const d = Number(pctDisp) || 0;
      if (d >= 90) return "Success";
      if (d >= 70) return "Warning";
      return "Error";
    }
  };
});

