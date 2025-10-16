sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/ColumnListItem",
  "sap/m/Text",
  "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, BusyIndicator, ColumnListItem, MText, JSONModel) {
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
      // 2) fuzzy: contÃ©m/Ã© contido
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
    map.Descricao = find("descricao", "descriÃ§Ã£o", "texto", "texto breve", "resumo");
    map.DataAbertura = find("data abertura", "abertura", "inicio", "data inicio", "data de abertura");
    map.DataFechamento = find("data fechamento", "fechamento", "fim", "data fim", "data de fechamento");
    map.HoraInicio = find("hora inicio", "hora de inicio", "hora inicial", "hora inicio sap", "hora inicio (sap)");
    map.HoraFim = find("hora fim", "hora final", "hora de fim", "hora termino", "hora fim sap", "hora fim (sap)");
    map.Status = find("status", "situacao", "situaÃ§Ã£o");
    map.Prioridade = find("prioridade", "prio");
    map.CentroDeCusto = find("centro de custo", "cc", "centro custo", "kostl");
    map.Responsavel = find("responsavel", "responsÃ¡vel", "executor", "tecnico");
    map.Categoria = find("categoria", "tipo", "classe", "tipo de ordem");
    map.CustoTotal = find("custo total", "custo", "valor", "total");
    map.Observacoes = find("observacoes", "observaÃ§Ãµes", "obs", "comentarios", "comentÃ¡rios", "descricao os");
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
    // Converte vÃ¡rias entradas para string somente data: YYYY-MM-DD
    function ymd(d) {
      var y = d.getUTCFullYear();
      var m = String(d.getUTCMonth() + 1).padStart(2, "0");
      var day = String(d.getUTCDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }
    if (!v) return "";
    if (v instanceof Date) return ymd(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    var s = String(v).trim();
    // Excel serial (nÃºmero)
    var num = Number(s);
    if (Number.isFinite(num) && num > 20000) {
      // Excel epoch 1899-12-30
      var d = new Date(Date.UTC(1899, 11, 30));
      d.setUTCDate(d.getUTCDate() + Math.floor(num));
      return ymd(d);
    }
    // yyyy-mm-dd (ou yyyy/mm/dd)
    var m1 = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m1) {
      var d1 = new Date(Date.UTC(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])));
      return ymd(d1);
    }
    // dd/mm/yyyy
    var m2 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (m2) {
      var d2 = new Date(Date.UTC(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1])));
      return ymd(d2);
    }
    // Fallback: Date.parse
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return "";
    return ymd(new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate())));
  }

  function parseTimeCell(v) {
    function hhmm(h, m) {
      var hh = String(Math.max(0, Math.min(23, h || 0))).padStart(2, "0");
      var mm = String(Math.max(0, Math.min(59, m || 0))).padStart(2, "0");
      return hh + ":" + mm;
    }
    if (!v && v !== 0) return "";
    if (v instanceof Date) {
      // Usa hora/minuto locais para evitar deslocamentos históricos de fuso (ex.: 1899-12-30)
      return hhmm(v.getHours(), v.getMinutes());
    }
    var num = Number(v);
    if (Number.isFinite(num)) {
      var frac = num % 1; if (frac < 0) frac = 0;
      var totalSec = Math.round(frac * 24 * 60 * 60);
      var h = Math.floor(totalSec / 3600) % 24;
      var m = Math.floor((totalSec % 3600) / 60);
      return hhmm(h, m);
    }
    var s = String(v).trim();
    var m1 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m1) return hhmm(Number(m1[1]), Number(m1[2]));
    var dt = new Date(s);
    if (!isNaN(dt.getTime())) return hhmm(dt.getUTCHours(), dt.getUTCMinutes());
    return "";
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
          title: "Gerando JSON de OS",
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
      // Tenta em ordem: AMD ('xlsx'), ESM dinÃ¢mico, global window.XLSX via includeScript
      return new Promise(function (resolve, reject) {
        function shape(mod) {
          if (!mod) return null;
          // Suporte a namespace ESM e global
          var candidate = mod.default && (mod.default.read || mod.default.utils) ? mod.default : mod;
          if (candidate && (typeof candidate.read === 'function') && candidate.utils) return candidate;
          return null;
        }

        try {
          // 1) AMD: alguns builds do xlsx registram-se como mÃ³dulo 'xlsx'
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
          // 2) ESM dinÃ¢mico oficial (SheetJS)
          import("https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs").then(function (esm) {
            var s = shape(esm);
            if (s) return resolve(s);
            fallbackGlobal();
          }).catch(function(){ fallbackGlobal(); });
        }

        function fallbackGlobal() {
          // 3) Global via includeScript (versÃ£o alinhada)
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
      if (!/\.xlsx$/i.test(file.name)) { MessageToast.show("Apenas arquivos .xlsx sÃ£o permitidos."); return; }
      var that = this;
      BusyIndicator.show(0);
      this._ensureXLSX().then(function (XLSX) {
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = new Uint8Array(e.target.result);
            var wb = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });
            var sheetName = wb.SheetNames && wb.SheetNames.find(function (n) { return String(n).toLowerCase() === 'planilha1'; }) || wb.SheetNames[0];
            if (!sheetName) { throw new Error("Planilha nÃ£o encontrada"); }
            if (String(sheetName).toLowerCase() !== 'planilha1') {
              // Apenas Planilha1 Ã© considerada
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
                HoraInicio: parseTimeCell(row[hmap.HoraInicio] || ""),
                HoraFim: parseTimeCell(row[hmap.HoraFim] || ""),
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
      var table = this.byId("tblPreview");
      if (!table) return;
      table.destroyItems();
      var rows = this._rows || [];
      rows.slice(0, 50).forEach(function (o) {
        table.addItem(new ColumnListItem({
          cells: [
            new MText({ text: o.NumeroOS || "(sem OS)" }),
            new MText({ text: o.Equipamento || "" }),
            new MText({ text: (o.DataAbertura || "").substring(0, 10) }),
            new MText({ text: o.HoraInicio || "" }),
            new MText({ text: (o.DataFechamento || "").substring(0, 10) }),
            new MText({ text: o.HoraFim || "" }),
            new MText({ text: o.Descricao || "" })
          ]
        }));
      });
      var txt = this.byId("txSummary");
      if (txt) txt.setText("Linhas prontas: " + rows.length + ". Exibindo primeiras " + Math.min(rows.length, 50) + ".");
    },

    /* onDownloadJson removed per request */
    /*onDownloadJson: function () {
      var rows = this._rows || [];
      if (!rows.length) { MessageToast.show("Carregue um Excel primeiro."); return; }
      this._openProgress(rows.length);
      try {
        var json = JSON.stringify(rows, null, 2);
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "os-import.json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 500);
        MessageToast.show("JSON de OS gerado.");
      } catch (e) {
        MessageToast.show("Falha ao gerar JSON de OS.");
      } finally {
        this._finishProgress();
      }
    },*/

    /* onUploadToFirestore removed per request */
    /*onUploadToFirestore: function () {
      var that = this;
      var rows = this._rows || [];
      if (!rows.length) { MessageToast.show("Carregue um Excel primeiro."); return; }
      BusyIndicator.hide();
      this._openProgress(rows.length);
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (FB) {
        Promise.resolve(FB.ensure()).then(async function (f) {
          var total = rows.length;
          var gravados = 0, atualizados = 0, ignorados = 0;
          for (var i = 0; i < total; i++) {
            var o = rows[i];
            var keyBase = [o.NumeroOS || "", o.Equipamento || "", o.DataAbertura || "", o.HoraInicio || "", o.DataFechamento || "", o.HoraFim || "", o.Descricao || ""].join("|");
            var docId = await sha1Hex(keyBase);
            try {
              var dref = f.doc(f.db, "ordensServico", docId);
              var exists = false;
              var existingData = null;
              try {
                var snap = await f.getDoc(dref);
                exists = !!(snap && ((typeof snap.exists === 'function') ? snap.exists() : (snap.exists === true)));
                existingData = snap && (typeof snap.data === 'function' ? snap.data() : (snap.data || null));
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
    ,*/
    /* onReplaceUploadToFirestore removed per request */
    /*onReplaceUploadToFirestore: function () {
      var that = this;
      var rows = this._rows || [];
      if (!rows.length) { MessageToast.show("Carregue um Excel primeiro."); return; }
      BusyIndicator.hide();
      this._openProgress(rows.length);
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (FB) {
        Promise.resolve(FB.ensure()).then(async function (f) {
          var total = rows.length;
          var gravados = 0, substituidos = 0;
          for (var i = 0; i < total; i++) {
            var o = rows[i];
            var keyBase = [o.NumeroOS || "", o.Equipamento || "", o.DataAbertura || "", o.HoraInicio || "", o.DataFechamento || "", o.HoraFim || "", o.Descricao || ""].join("|");
            var docId = await sha1Hex(keyBase);
            try {
              var dref = f.doc(f.db, "ordensServico", docId);
              var existed = false;
              try {
                var snap = await f.getDoc(dref);
                existed = !!(snap && ((typeof snap.exists === 'function') ? snap.exists() : (snap.exists === true)));
              } catch (_) { existed = false; }
              try { if (f.deleteDoc) { await f.deleteDoc(dref); } } catch (_) {}
              await f.setDoc(dref, o);
              if (existed) substituidos++; else gravados++;
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("Falha ao substituir doc", docId, e && (e.code || e.message || e));
            }
            that._updateProgress({ current: i + 1, created: gravados, updated: substituidos, skipped: 0 });
          }
          that._finishProgress();
          MessageToast.show("Importação concluída (substituição). Lidas: " + total + ", Novas: " + gravados + ", Substituídas: " + substituidos + ".");
        }).catch(function (e) {
          that._finishProgress();
          // eslint-disable-next-line no-console
          console.error(e);
          MessageToast.show("Firebase indisponível ou não configurado.");
        });
      });
    }*/
    onProcess: function () {
      var that = this;
      var rows = this._rows || [];
      if (!rows.length) { MessageToast.show("Carregue um Excel primeiro."); return; }
      BusyIndicator.hide();
      this._openProgress(rows.length);
      // Usa serviÃ§o Firebase jÃ¡ existente no app
      (function(){ try{ var json = JSON.stringify(rows, null, 2); var blob = new Blob([json], {type:"application/json"}); var url = URL.createObjectURL(blob); var a=document.createElement("a"); a.href=url; a.download="os-import.json"; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(url); }, 500); MessageToast.show("JSON de OS gerado."); } catch(e){ MessageToast.show("Falha ao gerar JSON de OS."); } finally { that._finishProgress(); } })();
/*          var docId = await sha1Hex(keyBase);
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
          MessageToast.show("ImportaÃ§Ã£o concluÃ­da. Lidas: " + total + ", Gravadas: " + gravados + ", Atualizadas: " + atualizados + ".");
        }).catch(function (e) {
          that._finishProgress();
          // eslint-disable-next-line no-console
          console.error(e);
          MessageToast.show("Firebase indisponÃ­vel ou nÃ£o configurado.");
        });
      });
*/
    }
    ,
    onReplaceProcess: function () {
      var that = this;
      var rows = this._rows || [];
      if (!rows.length) { MessageToast.show("Carregue um Excel primeiro."); return; }
      BusyIndicator.hide();
      this._openProgress(rows.length);
      (function(){ try{ var json = JSON.stringify(rows, null, 2); var blob = new Blob([json], {type:"application/json"}); var url = URL.createObjectURL(blob); var a=document.createElement("a"); a.href=url; a.download="os-import.json"; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(url); }, 500); MessageToast.show("JSON de OS gerado."); } catch(e){ MessageToast.show("Falha ao gerar JSON de OS."); } finally { that._finishProgress(); } })();
/*          var docId = await sha1Hex(keyBase);
            try {
              var dref = f.doc(f.db, "ordensServico", docId);
              var existed = false;
              try {
                var snap = await f.getDoc(dref);
                existed = !!(snap && (snap.exists ? snap.exists() : (snap.exists === true)));
              } catch (_) { existed = false; }
              try { if (f.deleteDoc) { await f.deleteDoc(dref); } } catch (_) {}
              await f.setDoc(dref, o); // sobrescreve por completo
              if (existed) substituidos++; else gravados++;
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("Falha ao substituir doc", docId, e && (e.code || e.message || e));
            }
            that._updateProgress({ current: i + 1, created: gravados, updated: substituidos, skipped: 0 });
          }
          that._finishProgress();
          MessageToast.show("ImportaÃ§Ã£o concluÃ­da (substituiÃ§Ã£o). Lidas: " + total + ", Novas: " + gravados + ", SubstituÃ­das: " + substituidos + ".");
        }).catch(function (e) {
          that._finishProgress();
          // eslint-disable-next-line no-console
          console.error(e);
          MessageToast.show("Firebase indisponÃ­vel ou nÃ£o configurado.");
        });
      });
*/
    }
  });
});


