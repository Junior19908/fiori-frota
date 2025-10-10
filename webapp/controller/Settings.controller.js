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
        var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(rb ? rb.getText("settings.loadError") : "Falha ao carregar configurações. Usando defaults.");
        var oModel = new JSONModel(SettingsService.DEFAULTS);
        that.getView().setModel(oModel, "settings");
      });
    },

      /**
       * Envia o arquivo selecionado para processamento
       */
    onSettingsFileUpload: function (oEvent) {
        var that = this;
        const files = oEvent.getParameter("files");
        const file = files && files[0];
        if (!file) {
          var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
          MessageToast.show(rb ? rb.getText("settings.selectJson") : "Selecione um arquivo JSON.");
          return;
        }
        if (!/\.json$/i.test(file.name)) {
          var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
          MessageToast.show(rb ? rb.getText("settings.onlyJsonAllowed") : "Apenas arquivos .json são permitidos.");
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
            var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
            MessageToast.show(rb ? rb.getText("settings.invalidJson") : "Arquivo JSON inválido.");
            return;
          }
          // Pergunta ao usuÃƒÂ¡rio o nome do arquivo no storage
          sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Button"], function(Dialog, Input, Button) {
            var inp = new Input({ value: "abastecimentos/2025/09/" + file.name, width: "100%" });
            var dlg = new Dialog({
              title: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.saveFirestoreYm") : "Salvar no Firestore (YYYY-MM)"),
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
  if (!files || !files.length) { MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.selectMultipleJson") : "Selecione um ou mais arquivos JSON.")); return; }
      var arr = Array.from(files).filter(function(f){ return /\.json$/i.test(f && f.name); });
  if (!arr.length) { MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.onlyJsonAllowed") : "Apenas arquivos .json são permitidos.")); return; }

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
          MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.readFilesError") : "Falha ao ler os arquivos."));
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
                new Label({ text: "Mês", width: "3rem", design: "Bold" }),
                new Input({ value: m, width: "4rem" })
              ]});
              rows.push(row);
              vbox.addItem(row);
            });
            var dlg = new Dialog({
              title: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.setYearMonthPerFile") : "Definir Ano/Mês por arquivo"),
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
                    try { MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.fillYearMonthAll") : "Preencha Ano (YYYY) e Mês (MM) válidos para todos os arquivos.")); } catch(e){}
                    return;
                  }
                  dlg.close();
                  try { MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.filesReadyClickSave") : "Arquivos prontos. Clique em 'Salvar no Firestore'.")); } catch(e){}
                }
              }),
              endButton: new Button({ text: "Cancelar", press: function(){ dlg.close(); } }),
              afterClose: function(){ dlg.destroy(); }
            });
            that.getView().addDependent(dlg);
            dlg.open();
          });
        } catch(e) {
          (function(__n){ var __rb = this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__rb ? __rb.getText("settings.filesLoadedClickSaveN", [String(__n)]) : (__n + " arquivo(s) carregado(s). Clique em 'Salvar no Firestore'.")); })(that._importBatch.length);
        }
      });
    },

      /** Salva JSON no Firestore em abastecimentos/YYYY-MM */
      _uploadJsonToFirestore: function (ym, json) {
        var that = this;
        var m = (ym || "").match(/^(\d{4})-(\d{2})$/);
        if (!m) { var __rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__rb ? __rb.getText("settings.informYmValid") : "Informe YYYY-MM válido."); return; }
  if (!m) { MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.informYmValid") : "Informe YYYY-MM válido.")); return; }
        var y = Number(m[1]), mm = Number(m[2]);
        BusyIndicator.show(0);
        sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
          svc.saveMonthlyToFirestore(y, mm, json).then(function (res) {
            (function(__res){ var __rb = that.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__res && __res.ok ? (__rb ? __rb.getText("settings.savedFirestoreOk") : "JSON salvo no Firestore.") : (__rb ? __rb.getText("settings.failWithReason", [String(__res && __res.reason || "")]) : ("Falha: " + String(__res && __res.reason || "")))); })(res);
          }).catch(function (e) {
            MessageToast.show(((that.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? that.getView().getModel("i18n").getResourceBundle().getText("settings.saveFirestoreError") : "Erro ao salvar no Firestore."));
            // eslint-disable-next-line no-console
            console.error(e);
          }).finally(function(){ BusyIndicator.hide(); });
        });
      },


    onLiveChange: function () { try { const m = this.getView().getModel("settings"); if (!m) return; const data = m.getData(); try { if (data && data.theme) { sap.ui.getCore().applyTheme(data.theme); } } catch(e){} try { sap.ui.require(["com/skysinc/frota/frota/services/settings/SettingsService"], function (svc) { svc.saveSettings(data); }); } catch(e){} } catch (_) {} },
    onAutoLoadToggle: function () {},
    onSaveLocalToggle: function () {},

    onThemeChange: function (oEvent) {
      const sKey = oEvent.getParameter("selectedItem").getKey();
      try { sap.ui.getCore().applyTheme(sKey); } catch (e) {}
    },

            onRestoreDefaults: function () {
      const m = this.getView().getModel("settings");
      m.setData(Object.assign({}, SettingsService.DEFAULTS));
      try { sap.ui.getCore().applyTheme(SettingsService.DEFAULTS.theme); } catch (e) {}
      var rb1 = this.getView() && this.getView().getModel("i18n") && this.getView().getModel("i18n").getResourceBundle();
      MessageToast.show(rb1 ? rb1.getText("settings.restored") : "Configurações restauradas.");
    },

    onSave: async function () {
      const m = this.getView().getModel("settings");
      const data = m.getData();
      BusyIndicator.show(0);
      try {
        await SettingsService.saveSettings(data);
        var rb2 = this.getView() && this.getView().getModel("i18n") && this.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(rb2 ? rb2.getText("settings.savedRemote") : "Configurações salvas remotamente.");
      } catch (e) {
        var rb3 = this.getView() && this.getView().getModel("i18n") && this.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(rb3 ? rb3.getText("settings.saveFailed") : "Falha ao salvar configurações.");
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
            title: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.exportReport") : "Relatório de Exportação"),
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
  (function(__res){ var __rb = this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__res && __res.ok ? (__rb ? __rb.getText("settings.exportMonthOk") : "Mês exportado para Firestore.") : (__rb ? __rb.getText("settings.exportMonthFail") : "Falha ao exportar mês.")); })(res);
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.exportError") : "Erro ao exportar para Firestore."));
      }).finally(function(){ BusyIndicator.hide(); });
    },

    _showTextDialog: function (title, text) {
      var that = this;
      return new Promise(function (resolve) {
        sap.ui.require(["sap/m/Dialog", "sap/m/TextArea", "sap/m/Button"], function (Dialog, TextArea, Button) {
          var ta = new TextArea({ value: text || "", editable: false, width: "100%", rows: 20, growing: true, growingMaxLines: 30 });
          var dlg = new Dialog({
            title: title || (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.preview") : "Pré-visualização"),
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


    onSaveFetchedJson: function () {
      var data = this._lastFetchedJson;
      if (!data || typeof data !== 'object') { var __rb = this.getView() && this.getView().getModel("i18n") && this.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__rb ? __rb.getText("settings.previewDownloadFirst") : "Baixe/visualize um JSON primeiro."); return; }
      var that = this;
      sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/Button"], function(Dialog, Input, Label, Button) {
        var inp = new Input({ value: "2025-09", width: "100%", placeholder: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.placeholder.ym") : "YYYY-MM") });
        var dlg = new Dialog({
            title: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.saveFirestoreBatch") : "Salvar no Firestore (abastecimentos/AAAA-MM)"),
          content: [ new Label({ text: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.label.monthYm") : "Mês (YYYY-MM)") }), inp ],
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

    onSaveImportedJson: function () {
      var batch = Array.isArray(this._importBatch) && this._importBatch.length ? this._importBatch : null;
      var that = this;
      if (batch) {
        sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/Text", "sap/m/Button"], (Dialog, Input, Label, Text, Button) => {
          var missing = batch.filter(function(it){ return !it.ym; }).length;
          var inpYmFallback = new Input({ value: (that._lastImportedYm || "2025-09"), placeholder: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? that.getView().getModel("i18n").getResourceBundle().getText("settings.placeholder.ymFallback") : "YYYY-MM (fallback)") });
          var totalRegs = batch.reduce(function(a,b){ return a + Number(b && b.count || 0); }, 0);
          var info  = new Text({ text: batch.length + " arquivo(s). Registros totais: " + String(totalRegs) + (missing? (" | Sem mÃªs: "+missing):"") });
          var dlg = new Dialog({
            title: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? that.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.confirmBatch") : "Confirmar envio (lote)"),
            content: [ new Label({ text: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.label.ymDefaultForItems") : "YYYY-MM padrão para itens sem mês") }), inpYmFallback, info ],
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
      if (!data || typeof data !== 'object') { MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.selectJsonFirst") : "Selecione um arquivo JSON primeiro.")); return; }
      var that = this;
      function countAbast(d){
        if (!d) return 0;
        if (Array.isArray(d)) return d.length;
        if (d.abastecimentosPorVeiculo && typeof d.abastecimentosPorVeiculo === 'object') {
          var n = 0; Object.keys(d.abastecimentosPorVeiculo).forEach(function(k){ var arr=d.abastecimentosPorVeiculo[k]; n += Array.isArray(arr)?arr.length:0; }); return n;
        }
        return 0;
      }
      sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Label", "sap/m/Text", "sap/m/Button"], (Dialog, Input, Label, Text, Button) => {
        var inpYm = new Input({ value: (that._lastImportedYm || "2025-09"), placeholder: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.placeholder.ym") : "YYYY-MM"), width: "100%" });
        var info  = new Text({ text: "Registros a enviar: " + String(countAbast(data)) });
        var dlg = new Dialog({
            title: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.dlg.confirmSendFirestore") : "Confirmar envio ao Firestore"),
          content: [ new Label({ text: (that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle() ? this.getView().getModel("i18n").getResourceBundle().getText("settings.label.monthYm") : "Mês (YYYY-MM)") }), inp ],
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
      var that = this;
      BusyIndicator.show(0);
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
        svc.createTestDoc({ source: "settings", note: "ping" }).then(function (res) {
          (function(__res){ var __rb = that.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__res && __res.ok ? (__rb ? __rb.getText("settings.testCreated", [String(__res.id)]) : ("TESTE criado: " + String(__res.id))) : (__rb ? __rb.getText("settings.failWithReason", [String(__res && __res.reason || "")]) : ("Falha: " + String(__res && __res.reason || "")))); })(res);
        }).catch(function (e) {
          MessageToast.show(((that.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? that.getView().getModel("i18n").getResourceBundle().getText("settings.errorCreatingTest") : "Erro ao criar TESTE."));
        }).finally(function(){ BusyIndicator.hide(); });
      });
    },

    onExportLastNMonths: function () {
      var that = this;
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
        (function(__ok){ var __rb = this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle(); MessageToast.show(__ok ? (__rb ? __rb.getText("settings.exportDone") : "Exportação concluída (alguns meses podem ter falhado).") : (__rb ? __rb.getText("settings.exportNotPossible") : "Não foi possível exportar.")); })(ok);
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show(((this.getView()&&that.getView().getModel("i18n")&&that.getView().getModel("i18n").getResourceBundle()) ? this.getView().getModel("i18n").getResourceBundle().getText("settings.exportError") : "Erro ao exportar para Firestore."));
      }).finally(function(){ BusyIndicator.hide(); });
    },

    onTestFirebase: function () {
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        return new Promise(function(resolve){ sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        return svc.probe();
      }).then(function (ok) {
        var rb = this.getView().getModel("i18n") && this.getView().getModel("i18n").getResourceBundle(); MessageToast.show(ok ? (rb ? rb.getText("settings.firebase.ok") : "Firebase OK (Firestore).") : (rb ? rb.getText("settings.firebase.unavailable") : "Firebase indisponível ou sem permissão."));
      }).catch(function () {
        var rb = this.getView().getModel("i18n") && this.getView().getModel("i18n").getResourceBundle(); MessageToast.show(rb ? rb.getText("settings.firebase.notConfigured") : "Firebase não configurado.");
      }).finally(function(){ BusyIndicator.hide(); });
    },

    onOpenImportOS: function () {
      try { this.getOwnerComponent().getRouter().navTo("ImportOS"); } catch (e) { MessageToast.show("Navegação indisponível."); }
    },

    onOpenImportAbast: function () {
      try { this.getOwnerComponent().getRouter().navTo("ImportAbastecimentos"); } catch (e) { MessageToast.show("Navegação indisponível."); }
    },

    onOpenManageAbast: function () {
      try { this.getOwnerComponent().getRouter().navTo("ManageAbastecimentos"); } catch (e) { MessageToast.show("Navegação indisponível."); }
    },

    onOpenManageOS: function () {
      try { this.getOwnerComponent().getRouter().navTo("ManageOS"); } catch (e) { MessageToast.show("Navegação indisponível."); }
    },

    // Teste de conexão com MySQL/MariaDB via middleware local
    onMysqlPing: function () {
      var that = this;
      BusyIndicator.show(0);
      fetch("/local/mysql-ping", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
          if (j && j.ok) {
            var msg = (rb ? rb.getText("settings.mysql.ok") : "MySQL OK.") + " (" + String(j.db || "") + "." + String(j.table || "") + ")";
            try { if (typeof j.count === "number") { msg += " | registros: " + String(j.count); } } catch(_) {}
            MessageToast.show(msg);
          } else {
            var reason = j && j.reason ? String(j.reason) : "";
            MessageToast.show(rb ? rb.getText("settings.mysql.error", [reason]) : ("Falha no MySQL: " + reason));
          }
        })
        .catch(function (e) {
          var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
          MessageToast.show(rb ? rb.getText("settings.mysql.error", [String(e && e.message || e)]) : ("Falha no MySQL: " + String(e && e.message || e)));
        })
        .finally(function(){ BusyIndicator.hide(); });
    }
  });
});














