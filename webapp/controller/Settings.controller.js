sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "com/skysinc/frota/frota/services/settings/SettingsService"
], function (Controller, JSONModel, MessageToast, BusyIndicator, SettingsService) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.Settings", {
    onInit: function () {
      this._viewModel = new JSONModel({ authorized: false });
      this.getView().setModel(this._viewModel, "settingsView");
      this._settingsLoaded = false;

      var oComponent = this.getOwnerComponent && this.getOwnerComponent();
      this._router = oComponent && oComponent.getRouter ? oComponent.getRouter() : null;

      if (this._router && this._router.getRoute) {
        var oRoute = this._router.getRoute("settings");
        if (oRoute) {
          this._settingsRoute = oRoute;
          oRoute.attachPatternMatched(this._onSettingsRouteMatched, this);
        }
      }

      if (this._isAuthorized()) {
        this._grantAccess();
      } else {
        this._ensureProtectedState();
      }
    },

    _ensureProtectedState: function () {
      if (this._viewModel) {
        this._viewModel.setProperty("/authorized", false);
      }
    },

    _isAuthorized: function () {
      if (this._authorized) {
        return true;
      }
      try {
        return window.sessionStorage && window.sessionStorage.getItem("frota.settingsAuthorized") === "1";
      } catch (e) {
        return false;
      }
    },

    _grantAccess: function () {
      this._authorized = true;
      if (this._viewModel) {
        this._viewModel.setProperty("/authorized", true);
      }
      try {
        if (window.sessionStorage) {
          window.sessionStorage.setItem("frota.settingsAuthorized", "1");
        }
      } catch (e) {
        // eslint-disable-next-line no-empty
      }

      this._ensureSettingsLoaded();
    },

    _ensureSettingsLoaded: function () {
      if (this._settingsLoaded) {
        return;
      }
      this._settingsLoaded = true;
      var that = this;
      SettingsService.loadSettings().then(function (data) {
        var oModel = new JSONModel(data);
        that.getView().setModel(oModel, "settings");
      }).catch(function () {
        that._settingsLoaded = false;
        var rb = that.getView() && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
        MessageToast.show(rb ? rb.getText("settings.loadError") : "Falha ao carregar configurações. Usando defaults.");
        var oModel = new JSONModel(SettingsService.DEFAULTS);
        that.getView().setModel(oModel, "settings");
      });
    },

    _onSettingsRouteMatched: function () {
      if (this._isAuthorized()) {
        this._grantAccess();
        return;
      }
      this._ensureProtectedState();
      this._promptForPassword();
    },

    _promptForPassword: function () {
      var that = this;
      if (this._authDialog) {
        this._authDialog.open();
        return;
      }
      sap.ui.require(["sap/m/Dialog", "sap/m/Input", "sap/m/Button", "sap/m/Text"], function (Dialog, Input, Button, Text) {
        var oInput = new Input({
          type: "Password",
          width: "100%",
          placeholder: "Senha",
          liveChange: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            var oBeginButton = that._authDialog && that._authDialog.getBeginButton();
            if (oBeginButton) {
              oBeginButton.setEnabled(Boolean(sValue));
            }
          }
        });

        oInput.addStyleClass("sapUiSmallMarginTop");

        that._authDialog = new Dialog({
          title: "Proteção das configurações",
          contentWidth: "24rem",
          draggable: true,
          resizable: true,
          content: [
            new Text({ text: "Informe a senha para acessar a página de configuração." }),
            oInput
          ],
          beginButton: new Button({
            text: "Entrar",
            type: "Emphasized",
            enabled: false,
            press: function () {
              var value = oInput.getValue();
              if (value === "transporte#usga") {
                oInput.setValue("");
                that._grantAccess();
                that._authDialog.close();
              } else {
                oInput.setValue("");
                var oBeginButton = that._authDialog && that._authDialog.getBeginButton();
                if (oBeginButton) {
                  oBeginButton.setEnabled(false);
                }
                MessageToast.show("Senha incorreta.");
              }
            }
          }),
          endButton: new Button({
            text: "Cancelar",
            press: function () {
              oInput.setValue("");
              var oBeginButton = that._authDialog && that._authDialog.getBeginButton();
              if (oBeginButton) {
                oBeginButton.setEnabled(false);
              }
              that._authDialog.close();
              if (that._router && that._router.navTo) {
                that._router.navTo("RouteMain");
              }
            }
          }),
          afterOpen: function () {
            oInput.focus();
          },
          afterClose: function () {
            if (that._authDialog) {
              that._authDialog.destroy();
            }
            that._authDialog = null;
          }
        });

        that._authDialog.setEscapeHandler(function (oPromise) {
          oPromise.resolve();
          if (that._authDialog) {
            that._authDialog.close();
            if (that._router && that._router.navTo) {
              that._router.navTo("RouteMain");
            }
          }
        });

        that.getView().addDependent(that._authDialog);
        that._authDialog.open();
      });
    },

    onExit: function () {
      if (this._settingsRoute) {
        this._settingsRoute.detachPatternMatched(this._onSettingsRouteMatched, this);
      }
      if (this._authDialog) {
        this._authDialog.destroy();
        this._authDialog = null;
      }
    },

    // Novo handler para mÃƒÂºltiplos arquivos (apontado no FileUploader)
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


  });
});
