sap.ui.define([], function () {
  "use strict";
  function toNum(v){ return Number(v || 0); }
  return {
    fmtBrl: function(v){
      try { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)); }
      catch(e){ return v; }
    },
    isDevolucao: function(qtde) {
      return Number(qtde) < 0;
    },
    fmtNum: function (v) {
      return Number(v || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
    },
    fmtDate: function(v) {
      if (!v) return "";
      const s = String(v).trim();

      // já vem no formato dd/MM/yyyy?
      const mBR = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (mBR) return s;

      // yyyy-MM-dd -> dd/MM/yyyy (sem criar Date!)
      const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (mISO) return `${mISO[3]}/${mISO[2]}/${mISO[1]}`;

      try {
        const d = new Date(s);
        return isNaN(d) ? s : d.toLocaleDateString("pt-BR");
      } catch {
        return s;
      }
    },
    fmtFuncaoKmComb: function(a,b){
      var x = toNum(a), y = toNum(b)||0;
      var r = y ? (x/y) : 0;
      return r.toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
    },
    fmtFuncaoHoraComb: function(a,b){
      var x = toNum(a), y = toNum(b)||0;
      var r = y ? (x/y) : 0;
      return r.toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
    },
    fmtSomaBrl: function(a,b){
      var fmtBrl = toNum(a)+toNum(b);
      return fmtBrl.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    },
    fmtTotalItemBrl: function(q,cu){
      var total = (Number(q||0) * Number(cu||0));
      return total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    },
    fmtBrlunitario: function(q){
      var n = Number(q||0);
      return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    },
    fmtLitros: function(v) {
      try {
        return `${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`;
      } catch (e) {
        return v;
      }
    },
    fmtKm: function(v) {
      try {
        return `${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Km`;
      } catch (e) {
        return v;
      }
    },
    fmtHora: function (v) {
      // aceita "08:15" ou "08:15:00" e deixa como HH:mm
      if (!v) return "";
      var s = String(v);
      var m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (m) return `${m[1].padStart(2,"0")}:${m[2]}`;
      return s;
    }
  };
});
