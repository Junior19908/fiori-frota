sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/StandardListItem",
  "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, BusyIndicator, StandardListItem, JSONModel) {
  "use strict";

  function normalizeHeader(s) {
    try {
      var t = String(s || "").toLowerCase();
      t = t.normalize ? t.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : t;
      t = t.replace(/[^a-z0-9]+/g, " ").trim();
      return t;
    } catch (e) { return String(s || "").toLowerCase(); }
  }

  function headerIndex(headers) {
    var idx = {};
    (headers || []).forEach(function (h, i) { idx[normalizeHeader(h)] = i; });
    function find() {
      var norm = Array.prototype.slice.call(arguments).map(normalizeHeader);
      for (var j = 0; j < norm.length; j++) {
        if (norm[j] in idx) return idx[norm[j]];
      }
      // fuzzy contains
      for (var k = 0; k < norm.length; k++) {
        var q = norm[k];
        var keys = Object.keys(idx);
        for (var i = 0; i < keys.length; i++) {
          var h = keys[i];
          if (h.indexOf(q) >= 0 || q.indexOf(h) >= 0) return idx[h];
        }
      }
      return -1;
    }
    return {
      Equipamento: find("equipamento"),
      Data: find("data inicio movimento", "data", "data combustivel"),
      Hora: find("hora inicio movimento", "hora", "hora combustivel"),
      Hodometro: find("hodometro", "quilometragem", "km"),
      Horimetro: find("horimetro", "horimetro"),
      Litros: find("qtde abastecimento", "litros"),
      Comboio: find("comboio")
    };
  }

  function parseNumber(v) {
    if (v == null || v === "") return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    var s = String(v).trim().replace(/\s+/g, "");
    if (!s) return null;
    if ((s.match(/,/g) || []).length === 1 && (s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, ".");
    }
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    var s = String(v).trim();
    var m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1) return new Date(Date.UTC(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1])));
    var m2 = s.match(/^(\d{4})[\-](\d{1,2})[\-](\d{1,2})$/);
    if (m2) return new Date(Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3])));
    var d = new Date(s);
    return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  function toTimeStr(v) {
    if (!v) return null;
    if (v instanceof Date) {
      var hh = String(v.getHours()).padStart(2, '0');
      var mm = String(v.getMinutes()).padStart(2, '0');
      var ss = String(v.getSeconds()).padStart(2, '0');
      return hh + ":" + mm + ":" + ss;
    }
    var s = String(v).trim();
    return s || null;
  }

  function normalizeComboio(raw) {
    var defLabel = "Posto de Combustível";
    if (raw == null || raw === "") return defLabel;
    var s = String(raw).trim().toUpperCase().replace(/;+/g, "");
    if (!s) return defLabel;
    if (s.startsWith("CB")) {
      var map = { CB1: "Comboio 1", CB2: "Comboio 2", CB3: "Comboio 3", CB4: "Comboio 4", CB5: "Comboio 5" };
      return map[s.slice(0, 3)] || defLabel;
    }
    return defLabel;
  }

  function canonVeh(x){ var s = String(x||"").trim(); if (s.endsWith('.0')) s = s.slice(0,-2); return s; }
  function mkId(prefix, counters, dateObj){ if(!dateObj) return null; var y = dateObj.getUTCFullYear(); var m = String(dateObj.getUTCMonth()+1).padStart(2,'0'); var k = String(y)+m; counters[k]=(counters[k]||0)+1; return prefix+"-"+k+"-"+String(counters[k]).padStart(6,'0'); }

  function findHeaderRow(rows){
    var wanted = ["Equipamento", "Qtde Abastecimento"];
    for (var i=0;i<Math.min(12, rows.length);i++){
      var r = rows[i]||[]; var has = wanted.every(function(w){ return r.some(function(c){ return String(c||'').toLowerCase()===w.toLowerCase(); }); });
      if (has) return i;
    }
    return 0;
  }

  return Controller.extend("com.skysinc.frota.frota.controller.ImportAbastecimentos", {
    onInit: function () {
      this._events = [];
      this._progressModel = new JSONModel({ total: 0, current: 0, created: 0, updated: 0, skipped: 0, errors: 0, percent: 0, text: "" });
    },

    onNavBack: function(){ try { this.getOwnerComponent().getRouter().navTo("settings"); } catch(_){} },

    _ensureProgressDialog: function () {
      if (this._dlgProgress) return this._dlgProgress;
      var that = this;
      sap.ui.require(["sap/m/Dialog", "sap/m/ProgressIndicator", "sap/m/Text", "sap/m/Button", "sap/m/VBox"], function (Dialog, ProgressIndicator, Text, Button, VBox) {
        var pi = new ProgressIndicator({
          width: "100%",
          percentValue: "{progress>/percent}",
          displayValue: "{progress>/text}",
          showValue: true
        });
        var stats = new Text({ text: "{= 'Criadas: ' + ${progress>/created} + '  |  Atualizadas: ' + ${progress>/updated} + '  |  Ignoradas: ' + ${progress>/skipped} + '  |  Erros: ' + ${progress>/errors} }" });
        var box = new VBox({ items: [pi, stats] });
        var dlg = new Dialog({
          title: "Enviando Abastecimentos",
          contentWidth: "26rem",
          content: [box],
          endButton: new Button({ text: "Fechar", enabled: false, press: function(){ dlg.close(); } }),
          afterClose: function(){ try { dlg.destroy(); } catch(_){} }
        });
        that.getView().addDependent(dlg);
        dlg.setModel(that._progressModel, "progress");
        that._dlgProgress = dlg;
      });
      return this._dlgProgress;
    },

    _openProgress: function (total) {
      this._progressModel.setData({ total: total, current: 0, created: 0, updated: 0, skipped: 0, errors: 0, percent: 0, text: "0% (0/" + total + ")" });
      var dlg = this._ensureProgressDialog();
      if (dlg && dlg.open) dlg.open();
    },

    _updateProgress: function (patch) {
      var d = this._progressModel.getData();
      Object.assign(d, patch || {});
      if (d.total > 0) {
        d.percent = Math.round((d.current / d.total) * 100);
        d.text = d.percent + "% (" + d.current + "/" + d.total + ")";
      }
      this._progressModel.refresh(true);
    },

    _finishProgress: function () {
      this._updateProgress({});
      if (this._dlgProgress) {
        try { this._dlgProgress.getEndButton().setEnabled(true); } catch (_) {}
        setTimeout(function(){ try { this._dlgProgress.close(); } catch(_){} }.bind(this), 800);
      }
    },

    _showErrorsDialog: function (errors, title) {
      if (!Array.isArray(errors) || !errors.length) return;
      var top = errors.slice(0, 20);
      var that = this;
      sap.ui.require(["sap/m/Dialog", "sap/m/List", "sap/m/StandardListItem", "sap/m/Button", "sap/m/Text"], function (Dialog, List, SLI, Button, Text) {
        var list = new List({ inset: false, growing: true });
        top.forEach(function (e) {
          list.addItem(new SLI({ title: "Linha " + String(e.line || "?"), description: String(e.reason || "Erro"), type: "Inactive" }));
        });
        var more = errors.length - top.length;
        var txt = more > 0 ? new Text({ text: "+ " + more + " linha(s) com erro não exibidas." }) : null;
        var dlg = new Dialog({
          title: title || "Erros na Importação",
          contentWidth: "36rem",
          content: txt ? [list, txt] : [list],
          endButton: new Button({ text: "Fechar", press: function(){ dlg.close(); } }),
          afterClose: function(){ try { dlg.destroy(); } catch(_){} }
        });
        that.getView().addDependent(dlg);
        dlg.open();
      });
    },

    _ensureXLSX: function(){
      return new Promise(function (resolve, reject) {
        function shape(mod){ var c = mod && (mod.default || mod); return (c && c.read && c.utils) ? c : null; }
        try {
          if (sap && sap.ui && sap.ui.require) {
            sap.ui.require(["xlsx"], function (amdMod) { var s=shape(amdMod); if(s) return resolve(s); next(); }, function(){ next(); });
            return;
          }
        } catch(_){}
        next();
        function next(){ import("https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs").then(function(esm){ var s=shape(esm); if(s) return resolve(s); fallbackGlobal(); }).catch(function(){ fallbackGlobal(); }); }
        function fallbackGlobal(){ if (window.XLSX && window.XLSX.read) return resolve(window.XLSX); var url="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; jQuery.sap.includeScript(url, "sheetjs-xlsx", function(){ if (window.XLSX && window.XLSX.read) resolve(window.XLSX); else reject(new Error("Falha XLSX")); }, function(e){ reject(e||new Error("Falha XLSX")); }); }
      });
    },

    onExcelSelected: function (oEvent) {
      var files = oEvent.getParameter("files");
      var file = files && files[0];
      if (!file) { MessageToast.show("Selecione um arquivo .xlsx."); return; }
      if (!/\.xlsx$/i.test(file.name)) { MessageToast.show("Apenas .xlsx."); return; }
      var that = this;
      BusyIndicator.show(0);
      this._ensureXLSX().then(function (XLSX) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var wb = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });
            var sheetName = that.byId("inpSheet").getValue() || "Monitor POSTO";
            var ws = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]];
            var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
            var headerIdx = findHeaderRow(rows);
            var headers = rows[headerIdx] || [];
            var hmap = headerIndex(headers);
            var out = [];
            var readErrors = [];
            for (var r = headerIdx + 1; r < rows.length; r++) {
              try {
                var row = rows[r] || [];
                var veic = canonVeh(row[hmap.Equipamento]);
                if (!veic) continue;
                var dataObj = toDate(row[hmap.Data]);
                var horaStr = toTimeStr(row[hmap.Hora]);
                var km = parseNumber(row[hmap.Hodometro]);
                var hr = parseNumber(row[hmap.Horimetro]);
                var litros = parseNumber(row[hmap.Litros]);
                var comboio = normalizeComboio(row[hmap.Comboio]);
                out.push({ line: (r + 1), veiculo: veic, dataObj: dataObj, hora: horaStr, km: km, hr: hr, litros: litros, comboio: comboio });
              } catch (ex) {
                readErrors.push({ line: (r + 1), reason: (ex && (ex.message || ex)) || "Falha ao ler linha" });
              }
            }
            that._raw = out;
            that._renderPreview();
            MessageToast.show("Arquivo lido: " + out.length + " linha(s)");
            if (readErrors.length) {
              that._showErrorsDialog(readErrors, "Erros ao ler o Excel");
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            MessageToast.show("Falha ao ler Excel: " + (err && err.message || err));
          } finally { BusyIndicator.hide(); }
        };
        reader.readAsArrayBuffer(file);
      }).catch(function (e) { BusyIndicator.hide(); console.error(e); MessageToast.show("Falha ao carregar biblioteca XLSX."); });
    },

    _renderPreview: function(){
      var list = this.byId("lstPreview"); if (!list) return;
      list.destroyItems(); var rows = this._raw || [];
      rows.slice(0, 50).forEach(function (o) {
        var title = (o.veiculo || "") + " - " + (o.dataObj ? o.dataObj.toISOString().slice(0,10) : "(sem data)");
        var desc = (o.hora || "") + (o.litros!=null ? (" | L: "+o.litros) : "");
        list.addItem(new StandardListItem({ title: title, description: desc }));
      });
      var txt = this.byId("txSummary"); if (txt) txt.setText("Linhas lidas: " + rows.length + ". Exibindo primeiras " + Math.min(rows.length, 50) + ".");
    },

    onProcess: function(){
      var ym = String(this.byId("inpMonth").getValue() || "").trim();
      var m = ym.match(/^(\d{4})-(\d{2})$/); if (!m) { MessageToast.show("Informe Mês YYYY-MM."); return; }
      var y = Number(m[1]), mm = Number(m[2]);
      var precoFallback = parseNumber(this.byId("inpPreco").getValue());
      var raw = this._raw || []; if (!raw.length) { MessageToast.show("Carregue um Excel primeiro."); return; }

      // filtra pelo mês informado
      var filtered = raw.filter(function (r) { if (!r.dataObj) return false; return (r.dataObj.getUTCFullYear() === y && (r.dataObj.getUTCMonth()+1) === mm); });
      if (!filtered.length) { MessageToast.show("Planilha sem linhas para o mês informado."); return; }

      var that = this;
      var errors = [];
      var warns = 0;
      // validações por linha
      filtered = filtered.filter(function(r){
        if (!r.dataObj) { errors.push({ line: r.line, reason: "Sem Data" }); return false; }
        if (!r.hora) { warns += 1; }
        return true;
      });

      // abre progresso e busca doc existente para mesclar/deduplicar
      this._openProgress(filtered.length);
      BusyIndicator.show(0);
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
        svc.fetchMonthlyFromFirestore(y, mm).then(function (existing) {
          var existingMap = (existing && existing.abastecimentosPorVeiculo) || {};

          var seq = 0; var counters = {};
          // copia estrutura para merge calculando created/updated
          var resultMap = {};
          var created = 0, updated = 0, skipped = 0; // skipped para linhas com erro
          // Monta mapa de existentes por veiculo/idEvento
          var prevIndex = {};
          Object.keys(existingMap).forEach(function (veh) {
            var arr = Array.isArray(existingMap[veh]) ? existingMap[veh] : [];
            var im = new Map();
            arr.forEach(function (e) { if (e && e.idEvento) im.set(e.idEvento, e); });
            prevIndex[veh] = im;
            resultMap[veh] = arr.slice();
          });

          // Processa cada linha
          for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            try {
              seq += 1; var idEvt = mkId('A', counters, r.dataObj);
              var evt = {
                data: r.dataObj ? r.dataObj.toISOString().slice(0,10) : null,
                hora: r.hora || null,
                km: Number.isFinite(r.km) ? r.km : 0,
                hr: Number.isFinite(r.hr) ? r.hr : 0,
                litros: Number.isFinite(r.litros) ? Math.round(r.litros*100)/100 : null,
                precoLitro: Number.isFinite(precoFallback) ? precoFallback : null,
                comboio: r.comboio,
                sequencia: seq,
                idEvento: idEvt
              };
              var veh = r.veiculo;
              if (!resultMap[veh]) { resultMap[veh] = []; prevIndex[veh] = new Map(); }
              if (prevIndex[veh].has(idEvt)) {
                // update (substitui)
                var arr = resultMap[veh];
                var pos = arr.findIndex(function (e) { return e && e.idEvento === idEvt; });
                if (pos >= 0) arr[pos] = evt; else arr.push(evt);
                prevIndex[veh].set(idEvt, evt);
                updated++;
              } else {
                resultMap[veh].push(evt);
                prevIndex[veh].set(idEvt, evt);
                created++;
              }
            } catch (e) {
              errors.push({ line: r.line, reason: (e && (e.message || e)) || "Erro ao montar evento" });
              skipped++;
            }
            that._updateProgress({ current: i + 1, created: created, updated: updated, skipped: skipped, errors: errors.length });
          }

          // escreve no firestore
          var json = { abastecimentosPorVeiculo: resultMap };
          return svc.saveMonthlyToFirestore(y, mm, json).then(function (res) {
            that._finishProgress();
            var msg = "Importação: Criadas " + created + ", Atualizadas " + updated + ", Ignoradas " + skipped + (warns ? ", Avisos (sem hora) " + warns : "");
            MessageToast.show(msg);
            if (errors.length) { that._showErrorsDialog(errors, "Erros na Importação"); }
            return res;
          }).catch(function (e) {
            that._finishProgress();
            // eslint-disable-next-line no-console
            console.error(e);
            MessageToast.show("Erro ao salvar no Firestore.");
          });
        }).catch(function (e) {
          that._finishProgress();
          console.error(e);
          MessageToast.show("Falha ao ler mês no Firestore.");
        }).finally(function(){ BusyIndicator.hide(); });
      });
    }
  });
});
