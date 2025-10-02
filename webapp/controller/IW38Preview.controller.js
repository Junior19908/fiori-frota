sap.ui.define([  "sap/ui/core/mvc/Controller",  "sap/ui/model/json/JSONModel",  "sap/ui/model/Filter",  "sap/ui/model/FilterOperator" ], function (Controller, JSONModel, Filter, FilterOperator) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.IW38Preview", {

    onInit: function () {
      // ForÃ§a compact density (igual SAP GUI)
      this.getOwnerComponent().getRootControl().addStyleClass("sapUiSizeCompact");

      // Roteamento
      var oRouter = this.getOwnerComponent().getRouter();
      if (oRouter.getRoute("RouteIW38")) {
        oRouter.getRoute("RouteIW38").attachPatternMatched(this._onRouteMatched, this);
      }

      // MOCK local (somente leitura)
      var oData = {
        header: {
          ordem: "4804378",
          status: "Em serviço",
          titulo: "CONSERTO. MOTOR / INSTALAÃ‡ÃƒO ELÃ‰TRICA",
          centroTrabalho: "SGOFTRAI / USGA",
          grupoPlanej: "222 / USGA",
          tipoAtv: "F05 â€“ ManutenÃ§Ã£o Corretiva",
          prioridade: "2 - Elevado",
          inicioBase: "2024-12-17T05:55",
          fimBase: "2024-12-17T23:59",
          locInstal: "20020410",
          equip: "20020410",
          textoEquip: "Caterpillar 140K",
          parada: true,
          duracaoParada: 6.266
        },
        componentes: [
          {
            componente: "618964",
            descricao: "PLACA 8W1749 F:08PG:363 PAT.CAT.12â€¦",
            tipo: "T",
            qtdNecess: 4,
            um: "PC",
            cc: "PM01",
            estoque: true,
            deposito: "UG01",
            centro: "USGA",
            oper: "0010",
            lote: "",
            ctgSuprimento: "Reserva para a ordem",
            item: "0000",
            recebedor: "JOSÃ‰ CÃCERO",
            ptoDescarga: "410",
            flagE: false,
            flagM: true,
            flagB: false,
            reqCompra: "imediatamente",
            localizDestino: ""
          },
          {
            componente: "610979",
            descricao: "TIRA ENCOSTO CAT 5T8366",
            tipo: "T",
            qtdNecess: 4,
            um: "PC",
            cc: "PM01",
            estoque: true,
            deposito: "UG01",
            centro: "USGA",
            oper: "0010",
            lote: "",
            ctgSuprimento: "Reserva para a ordem",
            item: "0000",
            recebedor: "LEANDERSON",
            ptoDescarga: "410",
            flagE: false,
            flagM: true,
            flagB: false,
            reqCompra: "imediatamente",
            localizDestino: ""
          }
        ]
      };
      this.getView().setModel(new JSONModel(oData), "iw38");

      // Seed fictício de ordens por veículo com downtime
      try {
        var now = new Date();
        var ordens = [];
        function hrs(a,b){ return Math.max(0, (b - a) / 36e5); }
        function add(ordem, veiculo, titulo, ini, fim, parada){
          ordens.push({
            ordem: String(ordem),
            veiculo: String(veiculo),
            titulo: String(titulo),
            inicio: new Date(ini).toLocaleString(),
            fim: new Date(fim).toLocaleString(),
            parada: !!parada,
            downtime: hrs(ini,fim),
            downtimeFmt: hrs(ini,fim).toFixed(2) + ' h'
          });
        }
        add(4804301, '20020410', 'Troca de Correia', new Date(now.getFullYear(), now.getMonth(), now.getDate()-2, 8), new Date(now.getFullYear(), now.getMonth(), now.getDate()-2, 14, 15), true);
        add(4804302, '20020411', 'Reparo Elétrico', new Date(now.getFullYear(), now.getMonth(), now.getDate()-1, 9), new Date(now.getFullYear(), now.getMonth(), now.getDate()-1, 12, 30), true);
        add(4804303, '20020412', 'Inspeção Preventiva', new Date(now.getFullYear(), now.getMonth(), now.getDate()-3, 7), new Date(now.getFullYear(), now.getMonth(), now.getDate()-3, 9), false);
        add(4804304, '20020413', 'Troca de Óleo', new Date(now.getFullYear(), now.getMonth(), now.getDate()-5, 10), new Date(now.getFullYear(), now.getMonth(), now.getDate()-5, 13, 45), true);
        this.getView().getModel("iw38").setProperty("/ordens", ordens);
      } catch(e) {}
    },

    _onRouteMatched: function (oEvent) {
      var equnr = oEvent.getParameter("arguments").equnr;
      try {
        var tbl = this.byId("tblOsList");
        var b = tbl && tbl.getBinding && tbl.getBinding("rows");
        if (b) {
          if (equnr) {
            b.filter([ new sap.ui.model.Filter("veiculo", sap.ui.model.FilterOperator.EQ, String(equnr)) ]);
          } else {
            b.filter([]);
          }
        }
      } catch(e){}
      // TODO: quando ligar no OData, usar equnr para buscar dados reais.
    }

  });
});




