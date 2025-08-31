sap.ui.define([
  "sap/ui/model/odata/v2/ODataModel",
  "sap/m/MessageBox"
], function (ODataModel, MessageBox) {
  "use strict";

  function toABAPDateTimeString(jsDate, endOfDay) {
    const y = jsDate.getFullYear();
    const m = String(jsDate.getMonth() + 1).padStart(2, "0");
    const d = String(jsDate.getDate()).padStart(2, "0");
    const t = endOfDay ? "23:59:59" : "00:00:00";
    return `${y}-${m}-${d}T${t}`;
  }

  function loadMaterials(oComponent, { equnr, startDate, endDate }) {
    const oSvc = oComponent.getModel("svc");
    if (!oSvc || !(oSvc instanceof ODataModel)) {
      console.warn("[OData] Modelo nomeado 'svc' não configurado.");
      MessageBox.error("OData 'svc' não configurado no manifest.");
      return Promise.resolve([]);
    }

    const sFrom = toABAPDateTimeString(startDate || new Date(), false);
    const sTo   = toABAPDateTimeString(endDate   || new Date(), true);

    const aFilterParts = [
      `budat_mkpf ge datetime'${sFrom}' and budat_mkpf le datetime'${sTo}'`
    ];
    if (equnr) aFilterParts.push(`equnr eq '${String(equnr).trim()}'`);
    const sFilter = aFilterParts.join(" and ");

    const sSelect = [
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

    const urlParams = {
      "$filter": sFilter,
      "$select": sSelect,
      "$format": "json",
      "$orderby": "budat_mkpf asc, cpudt_mkpf asc, cputm_mkpf asc"
    };

    /* eslint-disable no-console */
    console.group("[ODataMaterials.loadMaterials]");
    console.info("Filtros:", { equnr, sFrom, sTo });
    const sTestUrl = "https://fiori.usga.com.br:8001/sap/opu/odata/sap/ZC_EQ_MOVTO_CDS/ZC_EQ_MOVTO"
      + "?$filter=" + encodeURIComponent(sFilter)
      + "&$select=" + encodeURIComponent(sSelect)
      + "&$orderby=" + encodeURIComponent(urlParams["$orderby"])
      + "&$format=json";
    console.log("[OData][Materiais] URL de teste (copie e cole no navegador autenticado):");
    console.log(sTestUrl);

    sap.ui.core.BusyIndicator.show(0);
    return new Promise((resolve) => {
      oSvc.read("/ZC_EQ_MOVTO", {
        urlParameters: urlParams,
        success: (oData) => {
          sap.ui.core.BusyIndicator.hide();

          const results = (oData && oData.results) || [];
          console.info("Registros brutos recebidos:", results.length);
          if (results.length) {
            console.table(results.slice(0, 5)); // preview rápido
          }

          // Mapeamento para o dialog
          const mapped = results.map((r) => {
            const qtde  = Number(r.menge || 0);
            const valor = Number(r.dmbtr || 0);
            const custoUnit = qtde ? (valor / qtde) : 0;

            let horaEntrada = "";
            if (r.cputm_mkpf && r.cputm_mkpf.ms !== undefined) {
              const totalMs = Number(r.cputm_mkpf.ms) || 0;
              const sec = Math.floor(totalMs / 1000);
              const H = String(Math.floor(sec/3600)).padStart(2,"0");
              const M = String(Math.floor((sec%3600)/60)).padStart(2,"0");
              const S = String(sec%60).padStart(2,"0");
              horaEntrada = `${H}:${M}:${S}`;
            }

            // budat_mkpf pode vir como string ISO ou Date do V2; preservamos string se existir
            const toDateStr = () => {
              if (r.budat_mkpf && r.budat_mkpf.getTime) {
                const d = r.budat_mkpf;
                const y = d.getFullYear();
                const m = String(d.getMonth()+1).padStart(2,"0");
                const x = String(d.getDate()).padStart(2,"0");
                return `${y}-${m}-${x}`;
              }
              return r.budat_mkpf || "";
            };

            return {
              idEvento: r.ID || `${r.equnr || ""}-${r.rsnum || ""}-${r.rspos || ""}-${r.matnr || ""}-${r.budat_mkpf || ""}`,
              veiculo: r.equnr || "",
              descricaoVeiculo: r.eqktx || "",

              codMaterial: r.matnr || "",
              nome: r.maktx || "",
              tipo: r.servpc || "", // "Serv/Pc" do CDS; seu formatter resolve a exibição
              unid: r.meins || "",
              deposito: r.lgort || "",

              qtde: qtde,
              custoUnit: custoUnit,
              valorTotal: valor,
              moeda: r.waers || "",

              data: toDateStr(),
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
          });

          console.info("Mapeados para o dialog:", mapped.length, "item(ns)");
          if (mapped.length) console.table(mapped.slice(0, 5));
          resolve(mapped);
          console.groupEnd();
        },
        error: (e) => {
          sap.ui.core.BusyIndicator.hide();
          console.error("[OData][Materiais][ERR]", e);
          MessageBox.error("Falha ao consultar materiais em ZC_EQ_MOVTO.");
          resolve([]);
          console.groupEnd();
        }
      });
    });
  }

  return { loadMaterials };
});
