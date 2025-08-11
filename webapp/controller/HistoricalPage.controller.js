sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/base/Log"
], function (Controller, Filter, FilterOperator, Log) {
    "use strict";

    return Controller.extend("com.skysinc.frota.frota.controller.HistoricalPage", {
        onInit: function () {
            // Registra evento de rota matched
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("RouteHistorico").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sVeiculoId = oEvent.getParameter("arguments").id;  // Pega o :id: da rota
            Log.info("Veículo ID: " + sVeiculoId);

            // 1) Filtra o veículo específico no modelo default
            var oVeiculosModel = this.getOwnerComponent().getModel();  // Modelo ""
            var aVeiculos = oVeiculosModel.getProperty("/veiculos") || [];
            var oVeiculo = aVeiculos.find(function (oItem) {
                return oItem.id === sVeiculoId;  // Assuma "id" como chave
            });

            if (oVeiculo) {
                // Seta context para detalhes (bindings relativos como {placa})
                this.getView().setBindingContext(new sap.ui.model.Context(oVeiculosModel, "/veiculos/" + aVeiculos.indexOf(oVeiculo)));
            } else {
                sap.m.MessageToast.show("Veículo não encontrado");
            }

            // 2) Filtra materiais pelo veiculoId
            var oMateriaisModel = this.getOwnerComponent().getModel("materiais");
            var aMateriais = oMateriaisModel.getProperty("/materiaisPorVeiculo") || [];
            var aFilteredMateriais = aMateriais.filter(function (oItem) {
                return oItem.veiculoId === sVeiculoId;  // Assuma "veiculoId" no JSON
            });
            oMateriaisModel.setProperty("/filteredMateriais", aFilteredMateriais);  // Cria nova property filtrada

            // Atualiza binding da table de materiais para {materiais>/filteredMateriais}
            // (Altere a view XML para items="{materiais>/filteredMateriais}" ou bind aqui via JS)

            // 3) Similar para abastecimentos
            var oAbastModel = this.getOwnerComponent().getModel("abast");
            var aAbast = oAbastModel.getProperty("/abastecimentosPorVeiculo") || [];
            var aFilteredAbast = aAbast.filter(function (oItem) {
                return oItem.veiculoId === sVeiculoId;
            });
            oAbastModel.setProperty("/filteredAbastecimentos", aFilteredAbast);

            // Se precisar sorter/filters adicionais, use sap.ui.model.Sorter ou manual
        }
    });
});