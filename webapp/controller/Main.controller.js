sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], (Controller, JSONModel) => {
    "use strict";

    return Controller.extend("com.skysinc.frota.frota.controller.Main", {
        onInit() {
            //Carregar os arquivos mock
            const oModel = new JSONModel("model/mockData.json");

            //Aqui será definido o modelo da View(aprender isso)
            this.getView().setModel(oModel);

            //Verificar dados no console
            console.log("Dados da frota: ", oModel.getProperty("/Frota"));
        }
    });
});