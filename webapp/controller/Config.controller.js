sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/ui/core/routing/History"
], function (Controller, MessageToast, History) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.Config", {
    onInit: function () {
      this.getRouter().getRoute("config").attachPatternMatched(this._onMatched, this);
      this.getRouter().getRoute("configNoVeh").attachPatternMatched(this._onMatched, this);
      // modelo auxiliar para route params
      this.getView().setModel(new sap.ui.model.json.JSONModel({ equnr: null }), "route");
    },

    _onMatched: function (oEvent) {
      const sEqunr = (oEvent.getParameter("arguments") || {}).equnr || null;
      this.getView().getModel("route").setProperty("/equnr", sEqunr);
      this._loadProfile(sEqunr);
    },

    _loadProfile: function (sEqunr) {
      const oVehConf = this.getModel("vehConf");
      const oData = oVehConf.getData();

      let oCurrent = {};
      if (sEqunr && oData.vehicles && oData.vehicles[sEqunr]) {
        oCurrent = Object.assign({ VehicleId: sEqunr }, oData.globals, this._catDefaultFor(sEqunr), oData.vehicles[sEqunr]);
      } else {
        // sem parâmetro ou veículo sem config → defaults globais + por categoria se disponível depois que usuário escolher
        oCurrent = Object.assign({ VehicleId: sEqunr || "" }, oData.globals);
      }

      // validação rápida de coerência
      oCurrent._validationMessage = this._quickValidate(oCurrent);
      oVehConf.setProperty("/current", oCurrent);
    },

    _catDefaultFor: function (sEqunr) {
      // Se você tiver o vm>/veiculos no escopo global, pode mapear equnr → categoria aqui.
      // Por ora, retornamos vazio e mantemos globais/veículo.
      return {};
    },

    _quickValidate: function (c) {
      const msgs = [];
      if (c.MaxLitersPerFill > c.TankCapacity) msgs.push("Litros máx. por abastecimento > capacidade do tanque.");
      if (c.MaxNegativeKm < 0) msgs.push("Queda permitida não pode ser negativa.");
      if (c.MaxKmPerHour <= 0) msgs.push("Velocidade máx. deve ser maior que zero.");
      if (c.MaxLph <= 0) msgs.push("Consumo L/h máx. deve ser maior que zero.");
      return msgs.join(" ");
    },

    onLiveValidate: function () {
      const c = this.getModel("vehConf").getProperty("/current");
      this.getModel("vehConf").setProperty("/current/_validationMessage", this._quickValidate(c));
    },

    onLoadFromSelection: function () {
      const sEqunr = this.byId("cbVeicConfig").getSelectedKey();
      if (!sEqunr || sEqunr === "__NONE__") {
        MessageToast.show("Selecione um veículo.");
        return;
      }
      this._loadProfile(sEqunr);
      this.getModel("vehConf").setProperty("/current/VehicleId", sEqunr);
    },

    onSave: function () {
      const oVehConf = this.getModel("vehConf");
      const c = oVehConf.getProperty("/current");
      if (!c || !c.VehicleId) {
        MessageToast.show("Informe o veículo antes de salvar.");
        return;
      }
      if (c._validationMessage) {
        MessageToast.show("Corrija os avisos antes de salvar.");
        return;
      }

      // Persistência mock → JSONModel (trocar por OData depois)
      const all = oVehConf.getData();
      all.vehicles = all.vehicles || {};
      all.vehicles[c.VehicleId] = {
        MaxJumpKm: c.MaxJumpKm,
        MaxNegativeKm: c.MaxNegativeKm,
        RolloverMaxKm: c.RolloverMaxKm,
        MaxKmPerHour: c.MaxKmPerHour,
        MaxLitersPerFill: c.MaxLitersPerFill,
        MaxLph: c.MaxLph,
        TankCapacity: c.TankCapacity,
        FuelType: c.FuelType,
        EnableValidation: !!c.EnableValidation,
        StrictMode: !!c.StrictMode
      };
      oVehConf.updateBindings(true);
      MessageToast.show("Configuração salva.");

      // TODO: trocar por chamada OData create/update para ZC_VEH_CONF
    },

    onNavBack: function () {
      const oHistory = History.getInstance();
      const sPrevHash = oHistory.getPreviousHash();
      if (sPrevHash !== undefined) {
        window.history.go(-1);
      } else {
        this.getRouter().navTo("main", {}, true);
      }
    },

    getRouter: function () {
      return sap.ui.core.UIComponent.getRouterFor(this);
    },

    getModel: function (sName) {
      return this.getView().getModel(sName) || this.getOwnerComponent().getModel(sName);
    }
  });
});
