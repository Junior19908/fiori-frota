sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
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
          status: "Em serviÃ§o",
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
    },

    _onRouteMatched: function (oEvent) {
      var sOrdem = oEvent.getParameter("arguments").ordem;
      // TODO: quando ligar no OData, usar sOrdem para buscar dados reais (RESB/AFVC/CDS).
      // this._loadFromOData(sOrdem);
    }

  });
});
