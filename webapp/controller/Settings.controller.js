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
        MessageToast.show("Falha ao carregar configurações. Usando defaults.");
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
          MessageToast.show("Apenas arquivos .json são permitidos.");
          return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
          var contents = e.target.result;
          var json;
          try {
            json = JSON.parse(contents);
          } catch (err) {
            MessageToast.show("Arquivo JSON inválido.");
            return;
          }
          // Pergunta ao usuário o nome do arquivo no storage
          sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Button"], function(Dialog, Input, Button) {
            var inp = new Input({ value: "abastecimentos/2025/09/" + file.name, width: "100%" });
            var dlg = new Dialog({
              title: "Destino no Storage",
              content: [inp],
              beginButton: new Button({
                text: "Enviar",
                type: "Emphasized",
                press: function() {
                  var path = inp.getValue();
                  dlg.close();
                  that._uploadJsonToFirebase(path, json);
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

      /**
       * Faz upload de um objeto JSON para o Firebase Storage
       */
      _uploadJsonToFirebase: function (path, json) {
        var that = this;
        if (!path) {
          MessageToast.show("Caminho de destino não informado.");
          return;
        }
        BusyIndicator.show(0);
        sap.ui.require(["com/skysinc/frota/frota/services/FirebaseExportService"], function (svc) {
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
      MessageToast.show("Configurações restauradas.");
    },

    onSave: async function () {
      const m = this.getView().getModel("settings");
      const data = m.getData();
      BusyIndicator.show(0);
      try {
        await SettingsService.saveSettings(data);
        MessageToast.show(data.saveLocal ? "Configurações salvas localmente." : "Configurações salvas remotamente.");
      } catch (e) {
        MessageToast.show("Falha ao salvar configurações.");
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
            title: "Relatório de Exportação",
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
        const svcPath = "com/skysinc/frota/frota/services/FirebaseExportService";
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
        MessageToast.show(res && res.ok ? "Mês exportado para Firebase." : "Falha ao exportar mês.");
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
            title: title || "Pré-visualização",
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
        return new Promise(function(resolve){ sap.ui.require(["com/skysinc/frota/frota/services/FirebaseExportService"], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        var fetch;
        var title = "Resultado";
        if (/^gs:\/\//i.test(s)) {
          var gp = svc.parseGsUrl(s);
          if (!gp) throw new Error("gs:// inválido");
          title = gp.bucket + "/" + gp.path;
          fetch = svc.restDownloadJson(gp.bucket, gp.path);
        } else if (/^https?:\/\//i.test(s)) {
          fetch = new Promise(function (resolve) {
            jQuery.ajax({ url: s, dataType: "text", cache: false, success: function (txt){ resolve(txt); }, error: function(){ resolve(null); } });
          });
        } else {
          throw new Error("Entrada deve começar com gs:// ou http(s)://");
        }
        return fetch.then(function (data) {
          var txt;
          if (typeof data === 'string') {
            txt = data;
            try { var obj = JSON.parse(data); txt = JSON.stringify(obj, null, 2); } catch (_) {}
          } else if (data && typeof data === 'object') {
            txt = JSON.stringify(data, null, 2);
          } else {
            txt = "<vazio/não encontrado>";
          }
          return that._showTextDialog(title, txt);
        });
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show("Falha ao baixar.");
      }).finally(function(){ BusyIndicator.hide(); });
    },

    onExportLastNMonths: function () {
      var N = Number(this.byId("stepExportN")?.getValue?.() || 6);
      if (!Number.isFinite(N) || N <= 0) N = 6;
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        const svcPath = "com/skysinc/frota/frota/services/FirebaseExportService";
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
        MessageToast.show(ok ? "Exportação concluída (alguns meses podem ter falhado)." : "Não foi possível exportar.");
      }).catch(function (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        MessageToast.show("Erro ao exportar para Firebase.");
      }).finally(function(){ BusyIndicator.hide(); });
    },

    onTestFirebase: function () {
      BusyIndicator.show(0);
      Promise.resolve().then(function(){
        return new Promise(function(resolve){ sap.ui.require(["com/skysinc/frota/frota/services/FirebaseExportService"], function (svc) { resolve(svc); }); });
      }).then(function (svc) {
        return svc.probe();
      }).then(function (ok) {
        MessageToast.show(ok ? "Firebase OK (acesso ao Storage)." : "Firebase indisponível ou sem permissão.");
      }).catch(function () {
        MessageToast.show("Firebase não configurado.");
      }).finally(function(){ BusyIndicator.hide(); });
    }
  });
});
