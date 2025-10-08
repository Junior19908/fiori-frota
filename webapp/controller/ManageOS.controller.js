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

  return Controller.extend("com.skysinc.frota.frota.controller.ManageOS", {
    fmtYmd: _fmtYmd,

    onInit: function () {
      this.getView().setModel(new JSONModel({ items: [], total: 0, page: { index: 1, size: 100, hasPrev: false, hasNext: false, pageText: "Pgina 1" } }), "os");
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
      if (!hasStart && !hasEnd) { MessageToast.show("Informe perodo."); return; }
      var sEff = hasStart ? f.start : new Date(1970,0,1);
      var eEff = hasEnd ? f.end : new Date(2100,0,1);
      this._pg.meta = { start: hasStart ? f.start : null, end: hasEnd ? f.end : null };
      this._pg.pageIndex = 0; this._pg.cursors = [ null ]; this._pg.last = null;
      this._loadPage(sEff, eEff, null, true);
      var that = this;
      sap.ui.require(["com/skysinc/frota/frota/services/OSService"], function (OS) {
        OS.countByFilter({ start: that._pg.meta.start || undefined, end: that._pg.meta.end || undefined }).then(function (n) {
          var pages = Math.max(1, Math.ceil(Number(n || 0) / that._pg.limit));
          var model = that.getView().getModel("os");
          var d = model.getData();
          d.page = Object.assign({}, d.page, { totalPages: pages });
          model.setData(d); model.refresh(true);
        }).catch(function(){ /* ignore count failure */ });
      });
    },

    _getSelection: function(){
      var tbl = this.byId("tblOS");
      var ctxs = tbl.getSelectedContexts(true);
      return ctxs.map(function (c) { return c.getObject && c.getObject(); }).filter(Boolean);
    },

    onDeleteSelected: function(){
      var sel = this._getSelection();
      if (!sel.length) { MessageToast.show("Selecione ao menos uma OS."); return; }
      var ids = sel.map(function (o) { return String(o._id || ""); }).filter(Boolean);
      var that = this;
      MessageBox.warning("Excluir " + ids.length + " OS selecionada(s)?", {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        onClose: function (act) {
          if (act !== MessageBox.Action.OK) return;
          BusyIndicator.show(0);
          sap.ui.require(["com/skysinc/frota/frota/services/OSService"], function (OS) {
            Promise.all(ids.map(function (id) { return OS.removeById(id).catch(function(){ return { ok:false, id:id }; }); }))
              .then(function(){
                var model = that.getView().getModel("os");
                var data = model.getData();
                data.items = (data.items || []).filter(function (o) { return ids.indexOf(String(o._id||"")) < 0; });
                model.setData(data); model.refresh(true);
                MessageToast.show("OS excludas.");
              })
              .catch(function(e){ console.error(e); MessageToast.show("Falha ao excluir."); })
              .finally(function(){ BusyIndicator.hide(); });
          });
        }
      });
    },

    onDeleteFilteredConfirm: function(){
      var model = this.getView().getModel("os");
      var items = (model.getData().items || []);
      var ids = items.map(function (o) { return String(o._id || ""); }).filter(Boolean);
      var f = this._getFilters();
      var hasLoaded = ids.length > 0;
      if (!hasLoaded && !(f.start instanceof Date) && !(f.end instanceof Date)) { MessageToast.show("Informe perodo para excluso por filtro."); return; }
      var that = this;
      BusyIndicator.show(0);
      sap.ui.require(["com/skysinc/frota/frota/services/OSService"], function (OS) {
        var countPromise = hasLoaded ? Promise.resolve(ids.length) : OS.countByFilter({ start: f.start, end: f.end });
        countPromise.then(function (n) {
          BusyIndicator.hide();
          var total = Number(n || 0);
          if (total <= 0) { MessageToast.show("Nada a excluir para o filtro informado."); return; }
          var pages = Math.max(1, Math.ceil(total / that._pg.limit));
          var desc = hasLoaded
            ? ("itens carregados: " + ids.length)
            : ((f.start instanceof Date ? ("perodo=" + _fmtYmd(f.start) + (f.end instanceof Date ? (" a " + _fmtYmd(f.end)) : "")) : (f.end instanceof Date ? ("at " + _fmtYmd(f.end)) : "")));
          var msg = "Isto excluira " + total + " OS (em " + pages + " pdgina(s)).\nFiltro: " + desc + "\nDeseja continuar?";
          MessageBox.error(msg, {
            actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
            onClose: function (act) {
              if (act !== MessageBox.Action.OK) return;
              BusyIndicator.show(0);
              sap.ui.require(["com/skysinc/frota/frota/services/OSService"], function (OS) {
                var batchSize = 20; var p = Promise.resolve();
                if (hasLoaded) {
                  for (var i = 0; i < ids.length; i += batchSize) {
                    (function (chunk) { p = p.then(function () { return Promise.all(chunk.map(function (id) { return OS.removeById(id).catch(function(){ return { ok:false, id:id }; }); })); }); })(ids.slice(i, i + batchSize));
                  }
                } else {
                  var s2 = f.start instanceof Date ? f.start : new Date(1970,0,1);
                  var e2 = f.end instanceof Date ? f.end : new Date(2100,0,1);
                  var after2 = null;
                  function stepDate() {
                    return OS.listByDateRangePage({ start: s2, end: e2, limit: 100, after: after2 }).then(function (res) {
                      var arr = (res && res.items) || [];
                      if (!arr.length) return false;
                      var chunkIds = arr.map(function (o) { return String(o._id || ""); }).filter(Boolean);
                      var chunks = [];
                      for (var i = 0; i < chunkIds.length; i += batchSize) chunks.push(chunkIds.slice(i, i + batchSize));
                      chunks.forEach(function (c) { p = p.then(function(){ return Promise.all(c.map(function(id){ return OS.removeById(id).catch(function(){ return { ok:false, id:id }; }); })); }); });
                      after2 = (res && res.last) || null;
                      return true;
                    });
                  }
                  p = p.then(function run(){ return stepDate().then(function (cont){ return cont ? run() : null; }); });
                }
                p.then(function(){ model.setData({ items: [], total: 0, page: { index: 1, size: that._pg.limit, hasPrev: false, hasNext: false, pageText: 'Pdgina 1' } }); model.refresh(true); MessageToast.show("OS excludas."); })
                  .catch(function(e){ console.error(e); MessageToast.show("Falha ao excluir por filtro."); })
                  .finally(function(){ BusyIndicator.hide(); });
              });
            }
          });
        }).catch(function(){ BusyIndicator.hide(); MessageToast.show("Falha ao estimar a quantidade a excluir."); });
      });
    },

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
      if (!rows.length) { MessageToast.show("Sem dados na pdgina atual."); return; }
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
        MessageToast.show("CSV da pdgina gerado.");
      } catch (e) { MessageToast.show("Falha ao exportar CSV."); }
    },

    onNextPage: function(){
      var m = this._pg && this._pg.meta || {}; var s = m.start; var e = m.end;
      if (!this._pg.last) return;
      this._pg.pageIndex += 1;
      this._pg.cursors[this._pg.pageIndex] = this._pg.last;
      var sEff = s instanceof Date ? s : new Date(1970,0,1);
      var eEff = e instanceof Date ? e : new Date(2100,0,1);
      this._loadPage(sEff, eEff, this._pg.cursors[this._pg.pageIndex], false);
    },

    onPrevPage: function(){
      var m = this._pg && this._pg.meta || {}; var s = m.start; var e = m.end;
      if (this._pg.pageIndex === 0) return;
      this._pg.pageIndex -= 1;
      var cursor = this._pg.cursors[this._pg.pageIndex] || null;
      var sEff = s instanceof Date ? s : new Date(1970,0,1);
      var eEff = e instanceof Date ? e : new Date(2100,0,1);
      this._loadPage(sEff, eEff, cursor, false);
    },

    _loadPage: function (start, end, after, showBusy) {
      var that = this;
      if (showBusy) BusyIndicator.show(0);
      sap.ui.require(["com/skysinc/frota/frota/services/OSService"], function (OS) {
        Promise.resolve().then(function(){
          return OS.listByDateRangePage({ start: start, end: end, limit: that._pg.limit, after: after });
        }).then(function (res) {
          var items = Array.isArray(res && res.items) ? res.items : [];
          items.forEach(function (o) { if (!o._id) { o._id = String(o.NumeroOS || "") + "|" + String(o.Equipamento || "") + "|" + String(_fmtYmd(o.DataAbertura)||""); } });
          that._pg.last = res && res.last ? res.last : null;
          var hasNext = !!(that._pg.last && items.length >= that._pg.limit);
          var hasPrev = that._pg.pageIndex > 0;
          var pageText = "Pdgina " + String(that._pg.pageIndex + 1);
          var model = that.getView().getModel("os");
          var d = model.getData();
          var totalPages = d && d.page && d.page.totalPages || undefined;
          model.setData({ items: items, total: items.length, page: { index: that._pg.pageIndex + 1, size: that._pg.limit, hasPrev: hasPrev, hasNext: hasNext, pageText: pageText, totalPages: totalPages } });
          model.refresh(true);
          MessageToast.show(items.length + " OS na pdgina.");
        }).catch(function (e) {
          console.error(e); MessageToast.show("Falha ao carregar pdgina.");
        }).finally(function(){ if (showBusy) BusyIndicator.hide(); });
      });
    }
  });
});

