sap.ui.define([
  "sap/ui/model/odata/v2/ODataModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageBox"
], function (ODataModel, Filter, FilterOperator, MessageBox) {
  "use strict";

  function padEqunr(e) {
    const digits = String(e || "").replace(/\D/g, "");
    return digits.padStart(18, "0");
  }

  function dayRange(from, to) {
    const f = new Date(from || new Date()); f.setHours(0,0,0,0);
    const t = new Date(to   || from || new Date()); t.setHours(23,59,59,999);
    return [f, t];
  }

  const SELECT = [
    "ID","equnr","eqktx",
    "matnr","maktx",
    "menge","meins",
    "dmbtr","waers",
    "lgort",
    "budat_mkpf","cpudt_mkpf","cputm_mkpf",
    "aufnr","rsnum","rspos",
    "wempf","usnam_mkpf",
    "servpc",
    "CATEGORIA","matkl","wgbez"
  ].join(",");

  const ORDERBY = "budat_mkpf asc, cpudt_mkpf asc, cputm_mkpf asc";

  function mapResult(r) {
    const qtde  = Number(r.menge || 0);
    const valor = Number(r.dmbtr || 0);
    const custoUnit = qtde ? (valor / qtde) : 0;

    let horaEntrada = "";
    if (r.cputm_mkpf && r.cputm_mkpf.ms !== undefined) {
      const ms = Number(r.cputm_mkpf.ms) || 0;
      const sec = Math.floor(ms / 1000);
      const H = String(Math.floor(sec/3600)).padStart(2,"0");
      const M = String(Math.floor((sec%3600)/60)).padStart(2,"0");
      const S = String(sec%60).padStart(2,"0");
      horaEntrada = `${H}:${M}:${S}`;
    }

    const dataStr = (() => {
      if (r.budat_mkpf && r.budat_mkpf.getTime) {
        const d = r.budat_mkpf;
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,"0");
        const x = String(d.getDate()).padStart(2,"0");
        return `${y}-${m}-${x}`;
      }
      return r.budat_mkpf || "";
    })();

    return {
      idEvento: r.ID || `${r.equnr || ""}-${r.rsnum || ""}-${r.rspos || ""}-${r.matnr || ""}-${r.budat_mkpf || ""}`,
      veiculo: r.equnr || "",
      descricaoVeiculo: r.eqktx || "",
      codMaterial: r.matnr || "",
      nome: r.maktx || "",
      tipo: r.servpc || "",
      unid: r.meins || "",
      deposito: r.lgort || "",
      qtde: qtde,
      custoUnit: custoUnit,
      valorTotal: valor,
      moeda: r.waers || "",
      data: dataStr,
      dataEntrada: r.cpudt_mkpf || "",
      horaEntrada: horaEntrada,
      nOrdem: r.aufnr || "",
      nReserva: r.rsnum || "",
      nItem: r.rspos || "",
      recebedor: r.wempf || "",
      usuario: r.usnam_mkpf || "",
      categoria: r.CATEGORIA || "",
      grpMerc: r.matkl || "",
      grpMercDesc: r.wgbez || ""
    };
  }

  function loadMaterials(oComponent, { equnr, startDate, endDate }) {
    const oSvc = oComponent.getModel("svc");
    if (!oSvc || !(oSvc instanceof ODataModel)) {
      MessageBox.error("OData 'svc' não configurado no manifest.");
      return Promise.resolve([]);
    }

    const equnr18 = padEqunr(equnr);
    const [from, to] = dayRange(startDate, endDate);

    const filters = [
      new Filter("budat_mkpf", FilterOperator.BT, from, to), // obrigatório (SingleRange)
      new Filter("equnr",      FilterOperator.EQ, equnr18)   // veículo selecionado
    ];

    const urlParameters = { $select: SELECT, $orderby: ORDERBY };

    sap.ui.core.BusyIndicator.show(0);
    return new Promise((resolve) => {
      oSvc.read("/ZC_EQ_MOVTO", {
        filters,
        urlParameters,
        success: (oData) => {
          sap.ui.core.BusyIndicator.hide();
          const results = (oData && oData.results) || [];
          resolve(results.map(mapResult));
        },
        error: () => {
          sap.ui.core.BusyIndicator.hide();
          MessageBox.error("Falha ao consultar materiais em ZC_EQ_MOVTO.");
          resolve([]);
        }
      });
    });
  }

  return { loadMaterials };
});
