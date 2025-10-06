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
      t = t.normalize ? t.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : t; // remove acentos
      t = t.replace(/[^a-z0-9]+/g, " ").trim();
      return t;
    } catch (e) { return String(s || "").toLowerCase(); }
  }

  function headerMapIndex(headers) {
    var map = {};
    var idx = {};
    var normHeaders = (headers || []).map(function (h) { return normalizeHeader(h); });
    (normHeaders).forEach(function (n, i) { idx[n] = i; });
    function find() {
      var args = Array.prototype.slice.call(arguments);
      // 1) match exato
      for (var j = 0; j < args.length; j++) {
        var n = normalizeHeader(args[j]);
        if (n in idx) return idx[n];
      }
      // 2) fuzzy: contém/é contido
      for (var k = 0; k < args.length; k++) {
        var q = normalizeHeader(args[k]);
        for (var i = 0; i < normHeaders.length; i++) {
          var h = normHeaders[i];
          if (!h) continue;
          if (h.indexOf(q) >= 0 || q.indexOf(h) >= 0) return i;
        }
      }
      return -1;
    }
    map.NumeroOS = find("numero os", "n os", "numero da os", "ordem", "os", "num os");
    map.Equipamento = find("equipamento", "equnr", "equip", "equipam", "maquina", "veiculo");
    map.Descricao = find("descricao", "descrição", "texto", "texto breve", "resumo");
    map.DataAbertura = find("data abertura", "abertura", "inicio", "data inicio", "data de abertura");
    map.DataFechamento = find("data fechamento", "fechamento", "fim", "data fim", "data de fechamento");
    map.Status = find("status", "situacao", "situação");
    map.Prioridade = find("prioridade", "prio");
    map.CentroDeCusto = find("centro de custo", "cc", "centro custo", "kostl");
    map.Responsavel = find("responsavel", "responsável", "executor", "tecnico");
    map.Categoria = find("categoria", "tipo", "classe", "tipo de ordem");
    map.CustoTotal = find("custo total", "custo", "valor", "total");
    map.Observacoes = find("observacoes", "observações", "obs", "comentarios", "comentários", "descricao os");
    return map;
  }

  async function sha1Hex(str) {
    const enc = new TextEncoder();
    const data = enc.encode(String(str || ""));
    const hash = await crypto.subtle.digest("SHA-1", data);
    const arr = Array.from(new Uint8Array(hash));
    return arr.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function parseDateCell(v) {
    if (!v) return "";
    if (v instanceof Date) return v.toISOString();
    var s = String(v).trim();
    // Try Excel serial (number)
    var num = Number(s);
    if (Number.isFinite(num) && num > 20000) {
      // Excel epoch 1899-12-30
      var d = new Date(Date.UTC(1899, 11, 30));
      d.setUTCDate(d.getUTCDate() + Math.floor(num));
      return d.toISOString();
    }
    // Try ISO-like dd/mm/yyyy or yyyy-mm-dd
    var m1 = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m1) {
      var d1 = new Date(Date.UTC(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])));
      return d1.toISOString();
    }
    var m2 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m2) {
      var d2 = new Date(Date.UTC(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1])));
      return d2.toISOString();
    }
    // Fallback: Date.parse
    var dt = new Date(s);
    return isNaN(dt.getTime()) ? "" : dt.toISOString();
  }

  function asNumber(v) {
    var n = (typeof v === 'number') ? v : Number(String(v).replace(/[^0-9,.-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  return Controller.extend("com.skysinc.frota.frota.controller.ImportOS", {
    onInit: function () {
      this._rows = [];
      this._progressModel = new JSONModel({ total: 0, current: 0, created: 0, updated: 0, skipped: 0, percent: 0, text: "" });
    },

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
        var stats = new Text({ text: "{= 'Criadas: ' + ${progress>/created} + '  |  Atualizadas: ' + ${progress>/updated} + '  |  Ignoradas: ' + ${progress>/skipped} }" });
        var box = new VBox({ items: [pi, stats] });
        var dlg = new Dialog({
          title: "Enviando OS para Firestore",
          contentWidth: "24rem",
          content: [box],
          endButton: new Button({ text: "Fechar", enabled: false, press: function(){ dlg.close(); } }),
          afterClose: function(){ dlg.destroy(); that._dlgProgress = null; }
        });
        dlg.setModel(that._progressModel, "progress");
        that.getView().addDependent(dlg);
        that._dlgProgress = dlg;
        dlg.open();
      });
      return null;
    },

    _openProgress: function (total) {
      this._progressModel.setData({ total: total, current: 0, created: 0, updated: 0, skipped: 0, percent: 0, text: "0% (0/" + total + ")" });
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

    onNavBack: function () {
      try { this.getOwnerComponent().getRouter().navTo("settings"); } catch (e) {}
    },

    _ensureXLSX: function () {
      // Tenta em ordem: AMD ('xlsx'), ESM dinâmico, global window.XLSX via includeScript
      return new Promise(function (resolve, reject) {
        function shape(mod) {
          if (!mod) return null;
          // Suporte a namespace ESM e global
          var candidate = mod.default && (mod.default.read || mod.default.utils) ? mod.default : mod;
          if (candidate && (typeof candidate.read === 'function') && candidate.utils) return candidate;
          return null;
        }

        try {
          // 1) AMD: alguns builds do xlsx registram-se como módulo 'xlsx'
          if (sap && sap.ui && sap.ui.require) {
            sap.ui.require(["xlsx"], function (amdMod) {
              var s = shape(amdMod);
              if (s) return resolve(s);
              // continua fallback se formato inesperado
              next();
            }, function(){ next(); });
            return;
          }
        } catch (_) {}

        next();

        function next() {
          // 2) ESM dinâmico oficial (SheetJS)
          import("https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs").then(function (esm) {
            var s = shape(esm);
            if (s) return resolve(s);
            fallbackGlobal();
          }).catch(function(){ fallbackGlobal(); });
        }

        function fallbackGlobal() {
          // 3) Global via includeScript (versão alinhada)
          if (window.XLSX && typeof window.XLSX.read === 'function') return resolve(window.XLSX);
          var url = "https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.full.min.js";
          jQuery.sap.includeScript(url, "sheetjs-xlsx", function () {
            if (window.XLSX && typeof window.XLSX.read === 'function') resolve(window.XLSX);
            else reject(new Error("Falha ao carregar XLSX"));
          }, function (e) { reject(e || new Error("Falha ao carregar XLSX")); });
        }
      });
    },

    onExcelSelected: function (oEvent) {
      var files = oEvent.getParameter("files");
      var file = files && files[0];
      if (!file) { MessageToast.show("Selecione um arquivo .xlsx."); return; }
      if (!/\.xlsx$/i.test(file.name)) { MessageToast.show("Apenas arquivos .xlsx são permitidos."); return; }
      var that = this;
      BusyIndicator.show(0);
      this._ensureXLSX().then(function (XLSX) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var wb = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });
            var sheetName = wb.SheetNames && wb.SheetNames.find(function (n) { return String(n).toLowerCase() === 'planilha1'; }) || wb.SheetNames[0];
            if (!sheetName) { throw new Error("Planilha não encontrada"); }
            if (String(sheetName).toLowerCase() !== 'planilha1') {
              // Apenas Planilha1 é considerada
            }
            var ws = wb.Sheets[sheetName];
            var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
            if (!rows || !rows.length) throw new Error("Planilha vazia");
            var headers = rows[0] || [];
            var hmap = headerMapIndex(headers);
            var out = [];
            for (var r = 1; r < rows.length; r++) {
              var row = rows[r] || [];
              // Monta objeto com campos solicitados
              var obj = {
                NumeroOS: String(row[hmap.NumeroOS] || "").trim(),
                Equipamento: String(row[hmap.Equipamento] || "").trim(),
                Descricao: String(row[hmap.Descricao] || "").trim(),
                DataAbertura: parseDateCell(row[hmap.DataAbertura] || ""),
                DataFechamento: parseDateCell(row[hmap.DataFechamento] || ""),
                Status: String(row[hmap.Status] || "").trim(),
                Prioridade: String(row[hmap.Prioridade] || "").trim(),
                CentroDeCusto: String(row[hmap.CentroDeCusto] || "").trim(),
                Responsavel: String(row[hmap.Responsavel] || "").trim(),
                Categoria: String(row[hmap.Categoria] || "").trim(),
                CustoTotal: asNumber(row[hmap.CustoTotal] || 0),
                Observacoes: String(row[hmap.Observacoes] || "").trim(),
                importedAt: new Date().toISOString()
              };
              if (!obj.NumeroOS && !obj.Equipamento) continue; // ignora linhas vazias
              out.push(obj);
            }
            that._rows = out;
            that._renderPreview();
            MessageToast.show("Arquivo lido: " + out.length + " linha(s)");
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            MessageToast.show("Falha ao ler Excel: " + (err && err.message || err));
          } finally {
            BusyIndicator.hide();
          }
        };
        reader.readAsArrayBuffer(file);
      }).catch(function (e) {
        BusyIndicator.hide();
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show("Falha ao carregar biblioteca XLSX.");
      });
    },

    _renderPreview: function () {
      var list = this.byId("lstPreview");
      if (!list) return;
      list.destroyItems();
      var rows = this._rows || [];
      rows.slice(0, 50).forEach(function (o) {
        var title = (o.NumeroOS || "(sem OS)") + " - " + (o.Equipamento || "");
        var desc = (o.Descricao || "") + (o.DataAbertura ? (" | Abertura: " + o.DataAbertura.substring(0, 10)) : "");
        list.addItem(new StandardListItem({ title: title, description: desc }));
      });
      var txt = this.byId("txSummary");
      if (txt) txt.setText("Linhas prontas: " + rows.length + ". Exibindo primeiras " + Math.min(rows.length, 50) + ".");
    },

    onProcess: function () {
      var that = this;
      var rows = this._rows || [];
      if (!rows.length) { MessageToast.show("Carregue um Excel primeiro."); return; }
      BusyIndicator.hide();
      this._openProgress(rows.length);
      // Usa serviço Firebase já existente no app
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
        svc.getFirebase().then(async function (f) {
          var total = rows.length, gravados = 0, atualizados = 0, ignorados = 0;
          for (var i = 0; i < rows.length; i++) {
            var o = rows[i];
            var keyBase = (o.NumeroOS || "") + "|" + (o.Equipamento || "") + "|" + (o.DataAbertura || "");
            var docId = await sha1Hex(keyBase);
            try {
              var dref = f.doc(f.db, "ordensServico", docId);
              var exists = false;
              var existingData = null;
              try {
                var snap = await f.getDoc(dref);
                exists = !!(snap && (snap.exists ? snap.exists() : (snap.exists === true)));
                existingData = snap && (snap.data ? snap.data() : (snap.get ? snap.get() : null));
              } catch (_) { exists = false; existingData = null; }
              var incomingHasClose = !!(o && o.DataFechamento);
              var existingHasClose = !!(existingData && existingData.DataFechamento);
              if (exists && existingHasClose && !incomingHasClose) {
                ignorados++;
              } else {
                await f.setDoc(dref, o, { merge: true });
                if (exists) atualizados++; else gravados++;
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("Falha ao gravar doc", docId, e && (e.code || e.message || e));
            }
            that._updateProgress({ current: i + 1, created: gravados, updated: atualizados, skipped: ignorados });
          }
          that._finishProgress();
          MessageToast.show("Importação concluída. Lidas: " + total + ", Gravadas: " + gravados + ", Atualizadas: " + atualizados + ".");
        }).catch(function (e) {
          that._finishProgress();
          // eslint-disable-next-line no-console
          console.error(e);
          MessageToast.show("Firebase indisponível ou não configurado.");
        });
      });
    }
  });
});
