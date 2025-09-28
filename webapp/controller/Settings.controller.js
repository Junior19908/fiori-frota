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
    }
  });
});

