sap.ui.define([
  "sap/ui/model/odata/v2/ODataModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (ODataModel, MessageToast, MessageBox) {
  "use strict";

  function _toABAPDateTimeString(jsDate, endOfDay) {
    const y = jsDate.getFullYear();
    const m = String(jsDate.getMonth() + 1).padStart(2, "0");
    const d = String(jsDate.getDate()).padStart(2, "0");
    const t = endOfDay ? "23:59:59" : "00:00:00";
    return `${y}-${m}-${d}T${t}`;
  }

  function loadMovtos(oComponent, startDate, endDate) {
    const oSvc = oComponent.getModel("svc");
    if (!oSvc || !(oSvc instanceof ODataModel)) {
      console.warn("[OData] Modelo 'svc' ausente ou inválido. Verifique manifest.");
      MessageToast.show("OData não configurado (svc).");
      return Promise.resolve({ results: [] });
    }

    const sFrom = _toABAPDateTimeString(startDate || new Date(), false);
    const sTo   = _toABAPDateTimeString(endDate   || new Date(), true);
    const sFilter = `budat_mkpf ge datetime'${sFrom}' and budat_mkpf le datetime'${sTo}'`;
    const sTestUrl = `/sap/opu/odata/sap/ZC_EQ_MOVTO_CDS/ZC_EQ_MOVTO?$filter=${encodeURIComponent(sFilter)}&$format=json`;
    /* eslint-disable no-console */
    console.log("[OData][GET] Filtro:", sFilter);
    console.log("[OData][GET] URL de teste:", sTestUrl);

    sap.ui.core.BusyIndicator.show(0);
    return new Promise((resolve) => {
      oSvc.read("/ZC_EQ_MOVTO", {
        urlParameters: { "$filter": sFilter, "$format": "json" },
        success: (oData) => {
          sap.ui.core.BusyIndicator.hide();
          const results = (oData && oData.results) || [];
          console.table(results);
          MessageToast.show("Movimentos carregados do OData.");
          resolve({ results });
        },
        error: (e) => {
          sap.ui.core.BusyIndicator.hide();
          console.error("[OData][ERR]", e);
          MessageBox.error("Falha ao consultar ZC_EQ_MOVTO. Veja o console.");
          resolve({ results: [] });
        }
      });
    });
  }

  return { loadMovtos };
});
