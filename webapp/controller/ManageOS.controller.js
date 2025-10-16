sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, BusyIndicator, MessageBox) {
  "use strict";

  function _fmtYmd(val) {
    try {
      if (!val) return "";
      if (val instanceof Date) {
        const d = new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
        return d.toISOString().substring(0,10);
      }
      const s = String(val);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
      const d2 = new Date(s);
      if (!isNaN(d2.getTime())) return new Date(Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate())).toISOString().substring(0,10);
      return s;
    } catch (_) { return String(val || ""); }
  }

  function pad2(n){ return String(n).padStart(2,'0'); }
  function monthsBetween(s, e){ var out=[]; var y=s.getFullYear(), m=s.getMonth(); var y2=e.getFullYear(), m2=e.getMonth(); while(y<y2 || (y===y2 && m<=m2)){ out.push({y:y,m:m+1}); m++; if(m>11){m=0;y++;} } return out; }

  return Controller.extend("com.skysinc.frota.frota.controller.ManageOS", {
    fmtYmd: _fmtYmd,

    onInit: function () {
      this.getView().setModel(new JSONModel({ items: [], total: 0, page: { index: 1, size: 100, hasPrev: false, hasNext: false, pageText: "Página 1" } }), "os");
      this._pg = { limit: 100, pageIndex: 0, cursors: [ null ], last: null, meta: { start: null, end: null } };
    },

    onNavBack: function(){ try { this.getOwnerComponent().getRouter().navTo("settings"); } catch(_){} },

    _getFilters: function(){
      var drs = this.byId("drs");
      var start = drs && drs.getDateValue ? drs.getDateValue() : null;
      var end   = drs && drs.getSecondDateValue ? drs.getSecondDateValue() : null;
      return { start: start, end: end };
    },

    onLoad: function(){
      var f = this._getFilters();
      var hasStart = f.start instanceof Date;
      var hasEnd = f.end instanceof Date;
      if (!hasStart && !hasEnd) { MessageToast.show("Informe período."); return; }
      var sEff = hasStart ? f.start : new Date(1970,0,1);
      var eEff = hasEnd ? f.end : new Date(2100,0,1);
      this._pg.meta = { start: hasStart ? f.start : null, end: hasEnd ? f.end : null };
      this._pg.pageIndex = 0; this._pg.cursors = [ null ]; this._pg.last = null;
      this._loadPage(sEff, eEff, null, true);
      var model = this.getView().getModel("os");
      var d = model.getData();
      d.page = Object.assign({}, d.page, { totalPages: 1 });
      model.setData(d); model.refresh(true);
    },

    _getSelection: function(){
      var tbl = this.byId("tblOS");
      var ctxs = tbl.getSelectedContexts(true);
      return ctxs.map(function (c) { return c.getObject && c.getObject(); }).filter(Boolean);
    },

    onDeleteSelected: function(){ MessageToast.show("Indisponível no modo local."); },

    onDeleteFilteredConfirm: function(){ MessageToast.show("Indisponível no modo local."); },

    onExportPage: function(){
      var data = this.getView().getModel("os").getData() || {};
      var rows = (data.items || []).map(function (o) {
        return {
          Veiculo: o.Equipamento || "",
          Ordem: o.NumeroOS || "",
          Titulo: o.Descricao || "",
          Inicio: _fmtYmd(o.DataAbertura) || "",
          HoraInicio: o.HoraInicio || "",
          Fim: _fmtYmd(o.DataFechamento) || "",
          HoraFim: o.HoraFim || "",
          TipoManual: o.TipoManual || ""
        };
      });
      if (!rows.length) { MessageToast.show("Sem dados na página atual."); return; }
      var headers = Object.keys(rows[0]);
      function esc(v){ var s = (v==null?"":String(v)); if (/[",;\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"'; return s; }
      var lines = [];
      lines.push(headers.join(";"));
      rows.forEach(function (r) { lines.push(headers.map(function (h) { return esc(r[h]); }).join(";")); });
      var csv = "\uFEFF" + lines.join("\n");
      try {
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a"); a.href = url; a.download = "os_pagina.csv";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
        MessageToast.show("CSV da página gerado.");
      } catch (e) { MessageToast.show("Falha ao exportar CSV."); }
    },

    onNextPage: function(){ /* sem paginação em modo local */ },
    onPrevPage: function(){ /* sem paginação em modo local */ },

    _loadPage: function (start, end, after, showBusy) {
      var that = this;
      if (showBusy) BusyIndicator.show(0);
      var months = monthsBetween(start,end);
      var list = [];
      var chain = Promise.resolve();
      months.forEach(function(it){
        chain = chain.then(function(){
          var url1 = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/os/"+it.y+"/"+pad2(it.m)+"/os.json");
          var url2 = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/os/"+it.y+"/"+pad2(it.m)+"/ordens.json");
          return new Promise(function(resolve){
            jQuery.ajax({ url:url1, dataType:'json', cache:false, success:function(d){ resolve(d); }, error:function(){ jQuery.ajax({ url:url2, dataType:'json', cache:false, success:function(d2){ resolve(d2); }, error:function(){ resolve(null); } }); } });
          }).then(function(data){ if(!data) return; var arr = Array.isArray(data)?data:(Array.isArray(data.ordens)?data.ordens:[]); arr.forEach(function(o){ list.push(o); }); });
        });
      });
      chain.then(function(){
        var sTs = start.getTime(), eTs = end.getTime();
        var items = list.filter(function(o){ var s = (o.DataAbertura||o.dataAbertura||"").substring(0,10); var ts = new Date((s||'1970-01-01')+'T00:00:00').getTime(); return ts>=sTs && ts<=eTs; });
        items.forEach(function (o) { if (!o._id) { o._id = String(o.NumeroOS || "") + "|" + String(o.Equipamento || "") + "|" + String((o.DataAbertura||'').substring(0,10)||""); } });
        that._pg.last = null;
        var model = that.getView().getModel("os");
        model.setData({ items: items, total: items.length, page: { index: 1, size: items.length, hasPrev: false, hasNext: false, pageText: "Página 1", totalPages: 1 } });
        model.refresh(true);
        MessageToast.show(items.length + " OS no período.");
      }).catch(function(e){ console.error(e); MessageToast.show("Falha ao carregar período."); })
        .finally(function(){ if (showBusy) BusyIndicator.hide(); });
    }
  });
});
