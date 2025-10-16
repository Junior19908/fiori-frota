// File: com/skysinc/frota/frota/services/ODataMaterials.js
sap.ui.define([
  "sap/ui/model/odata/v2/ODataModel",
  "sap/m/MessageBox"
], function (ODataModel, MessageBox) {
  "use strict";

  function pad2(n){ return String(n).padStart(2,"0"); }
  function ymd(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function nextDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()+1); }

  function padEqunr(e) {
    const digits = String(e || "").replace(/\D/g, "");
    return digits.padStart(18, "0");
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

  /**
   * Carrega materiais respeitando datas locais (sem UTC manual).
   * Usa meia-aberta: GE <start 00:00> e LT <end+1 00:00>.
   */
  function loadMaterials(oComponent, { equnr, startDate, endDate }) {
    const oSvc = oComponent.getModel("svc");
    if (!oSvc || !(oSvc instanceof ODataModel)) {
      MessageBox.error("OData 'svc' nÃ£o configurado no manifest.");
      return Promise.resolve([]);
    }

    const equnr18 = padEqunr(equnr);

    // Normaliza para 00:00 local e 00:00 do dia seguinte
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endNext = nextDay(new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()));

    // Monta $filter como STRING para evitar conversÃ£o Date->UTC pelo ODataModel
    const fEqunr = "equnr eq '" + equnr18 + "'";
    const fGe = "budat_mkpf ge datetime'" + ymd(start) + "T00:00:00'";
    const fLt = "budat_mkpf lt datetime'" + ymd(endNext) + "T00:00:00'";
    const filterStr = "(" + fGe + " and " + fLt + ") and " + fEqunr;

    const urlParameters = {
      "$select": SELECT,
      "$orderby": ORDERBY,
      "$filter": filterStr
    };

    sap.ui.core.BusyIndicator.show(0);
    return new Promise((resolve) => {
      oSvc.read("/ZC_EQ_MOVTO", {
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
