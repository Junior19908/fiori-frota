sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/ui/unified/FileUploader",
  "com/skysinc/frota/frota/services/settings/SettingsService"
], function (Controller, JSONModel, MessageToast, BusyIndicator, /* preload */ FileUploader, SettingsService) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.Settings", {
    onInit: function () {
      var that = this;
      SettingsService.loadSettings().then(function (data) {
        var oModel = new JSONModel(data);
        that.getView().setModel(oModel, "settings");
      }).catch(function () {
        MessageToast.show("Falha ao carregar configuraÃƒÂ§ÃƒÂµes. Usando defaults.");
        var oModel = new JSONModel(SettingsService.DEFAULTS);
        that.getView().setModel(oModel, "settings");
      });
    },

      /**
       * Envia o arquivo selecionado para o Storage do Firebase
       */
    onSettingsFileUpload: function (oEvent) {
        var that = this;
        const files = oEvent.getParameter("files");
        const file = files && files[0];
        if (!file) {
          MessageToast.show("Selecione um arquivo JSON.");
          return;
        }
        if (!/\.json$/i.test(file.name)) {
          MessageToast.show("Apenas arquivos .json sÃƒÂ£o permitidos.");
          return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
          var contents = e.target.result;
          var json;
          try {
            json = JSON.parse(contents);
            try { that._lastImportedJson = json; that._lastImportedYm = "2025-09"; } catch(e){}
          } catch (err) {
            MessageToast.show("Arquivo JSON invÃƒÂ¡lido.");
            return;
          }
          // Pergunta ao usuÃƒÂ¡rio o nome do arquivo no storage
          sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Button"], function(Dialog, Input, Button) {
            var inp = new Input({ value: "abastecimentos/2025/09/" + file.name, width: "100%" });
            var dlg = new Dialog({
              title: "Salvar no Firestore (YYYY-MM)",
              content: [inp],
              beginButton: new Button({
                text: "Enviar",
                type: "Emphasized",
                press: function() {
                  var path = inp.getValue();
                  dlg.close();
                  try {
                    var mmatch = String(path||"").match(/abastecimentos\/(\d{4})\/(\d{2})\//);
                    if (mmatch) {
                      var ym = mmatch[1] + "-" + mmatch[2];
                      that._uploadJsonToFirestore(ym, json);
                    } else {
                      that._uploadJsonToFirestore("2025-09", json);
                    }
                  } catch(e){ that._uploadJsonToFirestore("2025-09", json); }
                }
              }),
              endButton: new Button({ text: "Cancelar", press: function(){ dlg.close(); } }),
              afterClose: function(){ dlg.destroy(); }
            });
            that.getView().addDependent(dlg);
            dlg.open();
          });
        };
        reader.readAsText(file);
      },

    // Novo handler para mÃƒÂºltiplos arquivos (apontado no FileUploader)
    onSettingsFileUploadBatch: function (oEvent) {
      var that = this;
      const files = oEvent.getParameter("files");
      if (!files || !files.length) { MessageToast.show("Selecione um ou mais arquivos JSON."); return; }
      var arr = Array.from(files).filter(function(f){ return /\.json$/i.test(f && f.name); });
      if (!arr.length) { MessageToast.show("Apenas arquivos .json sÃƒÂ£o permitidos."); return; }

      function detectYmFromName(name) {
        try {
          var m = String(name||"").match(/(20\d{2})[-_](0\d|1[0-2])/);
          if (m) return m[1] + "-" + ("0"+m[2]).slice(-2);
          m = String(name||"").match(/(20\d{2})(0\d|1[0-2])/);
          if (m) return m[1] + "-" + ("0"+m[2]).slice(-2);
        } catch(e){}
        return null;
      }

      function countAbast(d){
        if (!d) return 0;
        if (Array.isArray(d)) return d.length;
        if (d.abastecimentosPorVeiculo && typeof d.abastecimentosPorVeiculo === 'object') {
          var n = 0; Object.keys(d.abastecimentosPorVeiculo).forEach(function(k){ var a=d.abastecimentosPorVeiculo[k]; n += Array.isArray(a)?a.length:0; }); return n;
        }
        return 0;
      }

      var reads = arr.map(function(file){
        return new Promise(function(resolve){
          var fr = new FileReader();
          fr.onload = function (e) {
            try {
              var json = JSON.parse(e.target.result);
              resolve({ name: file.name, ym: detectYmFromName(file.name), json: json, count: countAbast(json) });
            } catch (err) { resolve(null); }
          };
          fr.onerror = function(){ resolve(null); };
          fr.readAsText(file);
        });
      });

      Promise.all(reads).then(function(items){
        that._importBatch = (items || []).filter(Boolean);
        that._lastImportedJson = null; // usar batch quando presente
        if (!that._importBatch.length) {
          MessageToast.show("Falha ao ler os arquivos.");
          return;
        }
        try {
          sap.ui.require([
            "sap/m/Dialog","sap/m/VBox","sap/m/HBox","sap/m/Text","sap/m/Input","sap/m/Label","sap/m/Button"
          ], function(Dialog, VBox, HBox, Text, Input, Label, Button){
            var vbox = new VBox({ width: "100%" });
            var rows = [];
            (that._importBatch || []).forEach(function(it){
              var y = "", m = "";
              try { var mm = (it.ym||"").match(/^(\d{4})-(\d{2})$/); if (mm) { y = mm[1]; m = mm[2]; } } catch(e){}
              var row = new HBox({ alignItems: "Center", width: "100%", items: [
                new Text({ text: it.name, width: "28rem" }),
                new Text({ text: " (" + String(it.count||0) + " regs)", width: "10rem" }),
                new Label({ text: "Ano", width: "3rem", design: "Bold" }),
                new Input({ value: y, width: "6rem" }),
                new Label({ text: "MÃƒÂªs", width: "3rem", design: "Bold" }),
                new Input({ value: m, width: "4rem" })
              ]});
              rows.push(row);
              vbox.addItem(row);
            });
            var dlg = new Dialog({
              title: "Definir Ano/MÃƒÂªs por arquivo",
              contentWidth: "48rem",
              resizable: true,
              draggable: true,
              content: [vbox],
              beginButton: new Button({
                text: "OK",
                type: "Emphasized",
                press: function(){
                  var hasInvalid = false;
                  rows.forEach(function(row, i){
                    try {
                      var items = row.getItems();
                      var yy = String(items[2].getValue()||"").trim();
                      var mm = String(items[4].getValue()||"").trim();
                      if (mm.length === 1) mm = "0" + mm;
                      var okY = /^\d{4}$/.test(yy);
                      var okM = /^(0[1-9]|1[0-2])$/.test(mm);
                      items[2].setValueState(okY ? "None" : "Error");
                      items[4].setValueState(okM ? "None" : "Error");
                      if (okY && okM) {
                        that._importBatch[i].ym = yy + "-" + mm;
                      } else {
                        hasInvalid = true;
                      }
                    } catch(e){ hasInvalid = true; }
                  });
                  if (hasInvalid) {
                    try { MessageToast.show("Preencha Ano (YYYY) e MÃƒÂªs (MM) vÃƒÂ¡lidos para todos os arquivos."); } catch(e){}
                    return;
                  }
                  dlg.close();
                  try { MessageToast.show("Arquivos prontos. Clique em 'Salvar no Firestore'."); } catch(e){}
                }
              }),
              endButton: new Button({ text: "Cancelar", press: function(){ dlg.close(); } }),
              afterClose: function(){ dlg.destroy(); }
            });
            that.getView().addDependent(dlg);
            dlg.open();
          });
        } catch(e) {
          MessageToast.show(that._importBatch.length + " arquivo(s) carregado(s). Clique em 'Salvar no Firestore'.");
        }
      });
    },

      /** Salva JSON no Firestore em abastecimentos/YYYY-MM */
      _uploadJsonToFirestore: function (ym, json) {
        var m = (ym || "").match(/^(\d{4})-(\d{2})$/);
        if (!m) { MessageToast.show("Informe YYYY-MM vÃƒÂ¡lido."); return; }
        var y = Number(m[1]), mm = Number(m[2]);
        BusyIndicator.show(0);
        sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
          svc.saveMonthlyToFirestore(y, mm, json).then(function (res) {
            MessageToast.show(res && res.ok ? "JSON salvo no Firestore." : ("Falha: " + (res && res.reason)));
          }).catch(function (e) {
            MessageToast.show("Erro ao salvar no Firestore.");
            // eslint-disable-next-line no-console
            console.error(e);
          }).finally(function(){ BusyIndicator.hide(); });
        });
      },

      /**
       * Faz upload de um objeto JSON para o Firebase Storage
       */
      _uploadJsonToFirebase: function (path, json) {
        var that = this;
        if (!path) {
          MessageToast.show("Caminho de destino nÃƒÂ£o informado.");
          return;
        }
        BusyIndicator.show(0);
        sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
          svc.getFirebase().then(function (f) {
            var sref = f.ref(f.storage, path);
            var blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
            return f.uploadBytes(sref, blob, { contentType: "application/json" });
          }).then(function () {
            MessageToast.show("Arquivo enviado para o Storage com sucesso.");
          }).catch(function (e) {
            MessageToast.show("Falha ao enviar arquivo: " + (e && (e.message || e.code || e)));
          }).finally(function () {
            BusyIndicator.hide();
          });
        });
      },

    onLiveChange: function () {},
    onAutoLoadToggle: function () {},
    onSaveLocalToggle: function () {},

    onThemeChange: function (oEvent) {
      const sKey = oEvent.getParameter("selectedItem").getKey();
      try { sap.ui.getCore().applyTheme(sKey); } catch (e) {}
    },

    onAvatarUpload: function (oEvent) {
      const files = oEvent.getParameter("files");
      const f = files && files[0];
      if (!f) { MessageToast.show("Selecione um arquivo de imagem."); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const m = this.getView().getModel("settings");
        m.setProperty("/avatarSrc", reader.result);
        m.setProperty("/avatarInitials", "");
        MessageToast.show("Avatar atualizado.");
      };
      reader.readAsDataURL(f);
    },

    onAvatarClear: function () {
      const m = this.getView().getModel("settings");
      m.setProperty("/avatarSrc", "");
      if (!m.getProperty("/avatarInitials")) m.setProperty("/avatarInitials", "CJ");
    },

    onRestoreDefaults: function () {
      const m = this.getView().getModel("settings");
      m.setData(Object.assign({}, SettingsService.DEFAULTS));
      try { sap.ui.getCore().applyTheme(SettingsService.DEFAULTS.theme); } catch (e) {}
      MessageToast.show("ConfiguraÃƒÂ§ÃƒÂµes restauradas.");
    },

    onSave: async function () {
      const m = this.getView().getModel("settings");
      const data = m.getData();
      BusyIndicator.show(0);
      try {
        await SettingsService.saveSettings(data);
        MessageToast.show(data.saveLocal ? "ConfiguraÃƒÂ§ÃƒÂµes salvas localmente." : "ConfiguraÃƒÂ§ÃƒÂµes salvas remotamente.");
      } catch (e) {
        MessageToast.show("Falha ao salvar configuraÃƒÂ§ÃƒÂµes.");
        // eslint-disable-next-line no-console
        console.error(e);
      } finally {
      BusyIndicator.hide();
      }
    },

    _showExportReport: function (items) {
      var that = this;
      var arr = Array.isArray(items) ? items : [];
      return new Promise(function (resolve) {
        sap.ui.require([
          "sap/m/Dialog",
          "sap/m/List",
          "sap/m/StandardListItem",
          "sap/m/Button"
        ], function (Dialog, List, StandardListItem, Button) {
          var list = new List({ inset: false });
          arr.forEach(function (it) {
            var ym = String(it.y || "") + "-" + String((it.m || 0)).padStart(2, "0");
            var ok = !!(it.result && it.result.ok);
            var desc = ok ? (it.result.path || "Enviado") : (it.result && it.result.reason ? it.result.reason : "Falha");
            list.addItem(new StandardListItem({
              title: ym,
              description: desc,
              info: ok ? "OK" : "ERRO",
              infoState: ok ? "Success" : "Error"
            }));
          });

          var dlg = new Dialog({
            title: "RelatÃƒÂ³rio de ExportaÃƒÂ§ÃƒÂ£o",
            contentWidth: "32rem",
            contentHeight: "20rem",
            resizable: true,
            draggable: true,
            content: [list],
            buttons: [
              new Button({ text: "Fechar", press: function(){ dlg.close(); } })
            ],
            afterClose: function(){ dlg.destroy(); resolve(); }
          });
          that.getView().addDependent(dlg);
          dlg.open();
        });
      });
    },

    onExportCurrentMonth: function () {
      var that = this;
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        const svcPath = "com/skysinc/frota/frota/services/FirebaseFirestoreService";
        return new Promise(function(resolve){ sap.ui.require([svcPath], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        return svc.exportMonth(y, m).then(function (res) {
          var report = [{ y: y, m: m, result: res || { ok: false, reason: "Sem retorno" } }];
          return that._showExportReport(report).then(function(){ return res; });
        });
      }).then(function (res) {
        MessageToast.show(res && res.ok ? "MÃƒÂªs exportado para Firebase." : "Falha ao exportar mÃƒÂªs.");
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show("Erro ao exportar para Firebase.");
      }).finally(function(){ BusyIndicator.hide(); });
    },

    _showTextDialog: function (title, text) {
      var that = this;
      return new Promise(function (resolve) {
        sap.ui.require(["sap/m/Dialog", "sap/m/TextArea", "sap/m/Button"], function (Dialog, TextArea, Button) {
          var ta = new TextArea({ value: text || "", editable: false, width: "100%", rows: 20, growing: true, growingMaxLines: 30 });
          var dlg = new Dialog({
            title: title || "PrÃƒÂ©-visualizaÃƒÂ§ÃƒÂ£o",
            contentWidth: "40rem",
            resizable: true,
            draggable: true,
            content: [ta],
            buttons: [ new Button({ text: "Fechar", press: function(){ dlg.close(); } }) ],
            afterClose: function(){ dlg.destroy(); resolve(); }
          });
          that.getView().addDependent(dlg);
          dlg.open();
        });
      });
    },

    onFetchGsJson: function () {
      var that = this;
      var s = this.byId("inpGsUrl") && this.byId("inpGsUrl").getValue();
      if (!s) { MessageToast.show("Informe um gs:// ou URL."); return; }
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        return new Promise(function(resolve){ sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        var fetch;
        var title = "Resultado";
        if (/^gs:\/\//i.test(s)) {
          var gp = svc.parseGsUrl(s);
          if (!gp) throw new Error("gs:// invÃƒÂ¡lido");
          title = gp.bucket + "/" + gp.path;
          fetch = svc.restDownloadJson(gp.bucket, gp.path);
        } else if (/^https?:\/\//i.test(s)) {
          // Se for URL direta do Firebase Storage e estivermos em localhost, use o proxy /storage
          try {
            var isLocal2 = /localhost|127\.0\.0\.1/.test(String(window.location && window.location.host || ""));
            if (isLocal2 && /^https:\/\/firebasestorage\.googleapis\.com\//i.test(s)) {
              s = s.replace(/^https:\/\/firebasestorage\.googleapis\.com/i, "/storage");
            }
          } catch(e){}
          fetch = new Promise(function (resolve) {
            jQuery.ajax({ url: s, dataType: "text", cache: false, success: function (txt){ resolve(txt); }, error: function(){ resolve(null); } });
          });
        } else {
          throw new Error("Entrada deve comeÃƒÂ§ar com gs:// ou http(s)://");
        }
        return fetch.then(function (data) {
          var txt;
          if (typeof data === 'string') {
            txt = data;
            try { var obj = JSON.parse(data); txt = JSON.stringify(obj, null, 2); } catch (_) {}
          } else if (data && typeof data === 'object') {
            txt = JSON.stringify(data, null, 2);
          } else {
            txt = "<vazio/nÃƒÂ£o encontrado>";
          }
          return that._showTextDialog(title, txt);
        });
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show("Falha ao baixar.");
      }).finally(function(){ BusyIndicator.hide(); });
    },

    onSaveFetchedJson: function () {
      var data = this._lastFetchedJson;
      if (!data || typeof data !== 'object') { MessageToast.show("Baixe/visualize um JSON primeiro."); return; }
      var that = this;
      sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/Button"], function(Dialog, Input, Label, Button) {
        var inp = new Input({ value: "2025-09", width: "100%", placeholder: "YYYY-MM" });
        var dlg = new Dialog({
          title: "Salvar no Firestore (abastecimentos/AAAA-MM)",
          content: [ new Label({ text: "MÃƒÂªs (YYYY-MM)" }), inp ],
          beginButton: new Button({
            text: "Salvar",
            type: "Emphasized",
            press: function() {
              var ym = (inp.getValue() || "").trim();
              dlg.close();
              that._uploadJsonToFirestore(ym, data);
            }
          }),
          endButton: new Button({ text: "Cancelar", press: function(){ dlg.close(); } }),
          afterClose: function(){ dlg.destroy(); }
        });
        that.getView().addDependent(dlg);
        dlg.open();
      });
    },
    onFetchDirectJson: function () {
      var that = this;
      var s = this.byId("inpDirectUrl") && this.byId("inpDirectUrl").getValue();
      if (!s) { MessageToast.show("Informe a URL."); return; }
      // Em dev, se for URL do firebasestorage, use o proxy /storage para evitar CORS
      try {
        var isLocal = /localhost|127\.0\.0\.1/.test(String(window.location && window.location.host || ""));
        if (isLocal && /^https:\/\/firebasestorage\.googleapis\.com\//i.test(s)) {
          s = s.replace(/^https:\/\/firebasestorage\.googleapis\.com/i, "/storage");
        }
      } catch(e){}
      BusyIndicator.show(0);
      jQuery.ajax({
        url: s,
        dataType: "text",
        cache: false,
        success: function (txt) {
          var out = txt;
          try { out = JSON.stringify(JSON.parse(txt), null, 2); } catch(_){}
          that._showTextDialog("PrÃƒÂ©-visualizaÃƒÂ§ÃƒÂ£o", out);
        },
        error: function (xhr) {
          MessageToast.show("Falha ao baixar (verifique CORS/token).");
          // eslint-disable-next-line no-console
          try { console.warn("[Settings] Falha no GET:", s, xhr && xhr.status, xhr && xhr.statusText); } catch(_){}
        },
        complete: function(){ BusyIndicator.hide(); }
      });
    },

    onSaveImportedJson: function () {
      var batch = Array.isArray(this._importBatch) && this._importBatch.length ? this._importBatch : null;
      var that = this;
      if (batch) {
        sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/Text", "sap/m/Button"], function(Dialog, Input, Label, Text, Button){
          var missing = batch.filter(function(it){ return !it.ym; }).length;
          var inpYmFallback = new Input({ value: (that._lastImportedYm || "2025-09"), placeholder: "YYYY-MM (fallback)" });
          var totalRegs = batch.reduce(function(a,b){ return a + Number(b && b.count || 0); }, 0);
          var info  = new Text({ text: batch.length + " arquivo(s). Registros totais: " + String(totalRegs) + (missing? (" | Sem mÃªs: "+missing):"") });
          var dlg = new Dialog({
            title: "Confirmar envio (lote)",
            content: [ new Label({ text: "YYYY-MM padrÃ£o para itens sem mÃªs" }), inpYmFallback, info ],
            beginButton: new Button({
              text: "Enviar todos",
              type: "Emphasized",
              press: function(){
                var fallback = String(inpYmFallback.getValue()||"").trim();
                dlg.close();
                var results = [];
                var chain = Promise.resolve();
                batch.forEach(function(it){
                  var ym = it.ym || fallback;
                  chain = chain.then(function(){ return that._uploadJsonToFirestore(ym, it.json).then(function(res){
                    try { var m = ym.match(/^(\d{4})-(\d{2})$/); var y = m?Number(m[1]):0; var mm = m?Number(m[2]):0; results.push({ y:y, m:mm, result: res || { ok:false, reason:'Sem retorno'} }); } catch(e){ results.push({ y:0, m:0, result: res || { ok:false, reason:'Sem retorno'} }); }
                  }); });
                });
                chain.then(function(){ return that._showExportReport(results); });
              }
            }),
            endButton: new Button({ text: "Cancelar", press: function(){ dlg.close(); } }),
            afterClose: function(){ dlg.destroy(); }
          });
          that.getView().addDependent(dlg);
          dlg.open();
        });
        return;
      }
      var data = this._lastImportedJson;
      if (!data || typeof data !== 'object') { MessageToast.show("Selecione um arquivo JSON primeiro."); return; }
      var that = this;
      function countAbast(d){
        if (!d) return 0;
        if (Array.isArray(d)) return d.length;
        if (d.abastecimentosPorVeiculo && typeof d.abastecimentosPorVeiculo === 'object') {
          var n = 0; Object.keys(d.abastecimentosPorVeiculo).forEach(function(k){ var arr=d.abastecimentosPorVeiculo[k]; n += Array.isArray(arr)?arr.length:0; }); return n;
        }
        return 0;
      }
      sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/Text", "sap/m/Button"], function(Dialog, Input, Label, Text, Button){
        var inpYm = new Input({ value: (that._lastImportedYm || "2025-09"), placeholder: "YYYY-MM", width: "100%" });
        var info  = new Text({ text: "Registros a enviar: " + String(countAbast(data)) });
        var dlg = new Dialog({
          title: "Confirmar envio ao Firestore",
          content: [ new Label({ text: "MÃƒÂªs (YYYY-MM)" }), inpYm, info ],
          beginButton: new Button({
            text: "Enviar",
            type: "Emphasized",
            press: function(){
              var ym = String(inpYm.getValue() || "").trim();
              dlg.close();
              Promise.resolve().then(function(){ return that._uploadJsonToFirestore(ym, data); }).then(function(){
                try { var m = ym.match(/^(\d{4})-(\d{2})$/); var y = m?Number(m[1]):0; var mm = m?Number(m[2]):0; return that._showExportReport([{ y:y, m:mm, result:{ ok:true, path:"abastecimentos/"+y+"/"+String(mm).padStart(2,'0') } }]); } catch(e){}
              });
            }
          }),
          endButton: new Button({ text: "Cancelar", press: function(){ dlg.close(); } }),
          afterClose: function(){ dlg.destroy(); }
        });
        that.getView().addDependent(dlg);
        dlg.open();
      });
    },
    onCreateTestCollection: function () {
      BusyIndicator.show(0);
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
        svc.createTestDoc({ source: "settings", note: "ping" }).then(function (res) {
          MessageToast.show(res && res.ok ? ("TESTE criado: " + res.id) : ("Falha: " + (res && res.reason)));
        }).catch(function (e) {
          MessageToast.show("Erro ao criar TESTE.");
        }).finally(function(){ BusyIndicator.hide(); });
      });
    },

    onExportLastNMonths: function () {
      var N = Number(this.byId("stepExportN")?.getValue?.() || 6);
      if (!Number.isFinite(N) || N <= 0) N = 6;
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        const svcPath = "com/skysinc/frota/frota/services/FirebaseFirestoreService";
        return new Promise(function(resolve){ sap.ui.require([svcPath], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - (N - 1), 1);
        const end   = new Date(now.getFullYear(), now.getMonth(), 28);
        return svc.exportRange(start, end).then(function (list) {
          return Promise.resolve().then(() => this._showExportReport(list)).then(() => list);
        }.bind(this));
      }).then(function (list) {
        const ok = Array.isArray(list) && list.some(function (it) { return it && it.result && it.result.ok; });
        MessageToast.show(ok ? "ExportaÃƒÂ§ÃƒÂ£o concluÃƒÂ­da (alguns meses podem ter falhado)." : "NÃƒÂ£o foi possÃƒÂ­vel exportar.");
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show("Erro ao exportar para Firebase.");
      }).finally(function(){ BusyIndicator.hide(); });
    },

    onTestFirebase: function () {
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        return new Promise(function(resolve){ sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        return svc.probe();
      }).then(function (ok) {
        MessageToast.show(ok ? "Firebase OK (acesso ao Storage)." : "Firebase indisponÃƒÂ­vel ou sem permissÃƒÂ£o.");
      }).catch(function () {
        MessageToast.show("Firebase nÃƒÂ£o configurado.");
      }).finally(function(){ BusyIndicator.hide(); });
    }
  });
});









