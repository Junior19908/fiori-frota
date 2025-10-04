sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/core/BusyIndicator",
  "sap/m/MessageToast"
], function (Controller, JSONModel, Filter, FilterOperator, BusyIndicator, MessageToast) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.IW38Preview", {

    onInit: function () {
      try { this.getOwnerComponent().getRootControl().addStyleClass("sapUiSizeCompact"); } catch (e) {}

      var oRouter = this.getOwnerComponent().getRouter();
      if (oRouter && oRouter.getRoute && oRouter.getRoute("RouteIW38")) {
        oRouter.getRoute("RouteIW38").attachPatternMatched(this._onRouteMatched, this);
      }

      var oData = {
        header: {
          ordem: "",
          status: "",
          titulo: "",
          centroTrabalho: "",
          grupoPlanej: "",
          tipoAtv: "",
          prioridade: "",
          inicioBase: "",
          fimBase: "",
          locInstal: "",
          equip: "",
          textoEquip: "",
          parada: false,
          duracaoParada: 0
        },
        componentes: [],
        ordens: []
      };
      this.getView().setModel(new JSONModel(oData), "iw38");
      // Evita leitura massiva padrão; IW38 ficará passiva a menos que seja ajustada para filtros específicos
      return;

      // Carrega ordens do Firestore com indicador de atividade
      var that = this;
      try {
        BusyIndicator.show(0);
        sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (Svc) {
          if (!Svc || !Svc.listAllOrders) { BusyIndicator.hide(); return; }
          Svc.listAllOrders().then(function (list) {
            var out = (list || []).map(function (o) {
              function toLoc(val){ try { return val ? new Date(val).toLocaleString() : ""; } catch(_) { return String(val||""); } }
              function hrs(a,b){ try { var A = o[a] ? new Date(o[a]).getTime() : 0; var B = o[b] ? new Date(o[b]).getTime() : 0; return (A && B && B>A) ? (B-A)/36e5 : 0; } catch(_) { return 0; } }
              var downtime = hrs('DataAbertura','DataFechamento');
              return {
                ordem: String(o.NumeroOS || ""),
                veiculo: String(o.Equipamento || ""),
                titulo: String(o.Descricao || ""),
                inicio: toLoc(o.DataAbertura),
                fim: toLoc(o.DataFechamento),
                parada: downtime > 0,
                downtime: downtime,
                downtimeFmt: downtime.toFixed(2) + ' h'
              };
            }).sort(function(a,b){
              if (a.veiculo === b.veiculo) {
                return String(a.ordem).localeCompare(String(b.ordem));
              }
              return String(a.veiculo).localeCompare(String(b.veiculo));
            });
            that.getView().getModel("iw38").setProperty("/ordens", out);
            try { MessageToast.show("OS carregadas: " + out.length); } catch(_){}
          }).catch(function (e) {
            // eslint-disable-next-line no-console
            try { console.warn("Falha ao carregar OS do Firestore", e && (e.code || e.message || e)); } catch(_){}
            try {
              var rb = that.getView() && that.getView().getModel && that.getView().getModel("i18n") && that.getView().getModel("i18n").getResourceBundle();
              MessageToast.show(rb ? rb.getText("iw38LoadError") : "Erro ao carregar OS do Firestore.");
            } catch(_){}
          }).finally(function(){ BusyIndicator.hide(); });
        });
      } catch (_) { BusyIndicator.hide(); }
    },

    _onRouteMatched: function (oEvent) {
      var equnr = oEvent && oEvent.getParameter && oEvent.getParameter("arguments") && oEvent.getParameter("arguments").equnr;
      var showAll = false;
      try { showAll = !!(this.getView().getModel("settings") && this.getView().getModel("settings").getProperty("/showAllOS")); } catch(_){}
      try {
        var tbl = this.byId("tblOsList");
        var b = tbl && tbl.getBinding && tbl.getBinding("rows");
        if (b) {
          if (equnr && !showAll) {
            b.filter([ new Filter("veiculo", FilterOperator.EQ, String(equnr)) ]);
            try {
              var arr = (this.getView().getModel("iw38").getProperty("/ordens") || []).filter(function(it){ return String(it.veiculo) === String(equnr); });
              if (!arr.length) MessageToast.show("Sem OS para este veículo");
            } catch(_){}
          } else {
            b.filter([]);
          }
        }
      } catch (e) {}
    }

  });
});
