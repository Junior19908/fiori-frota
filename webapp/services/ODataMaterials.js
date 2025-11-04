sap.ui.define([
  "sap/ui/model/odata/v2/ODataModel",
  "sap/m/MessageBox",
  "sap/ui/core/BusyIndicator"
], function (ODataModel, MessageBox, BusyIndicator) {
  "use strict";

  function pad(num, size) {
    const digits = String(num || "").replace(/\D/g, "");
    return digits.padStart(size, "0");
  }

  function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function nextDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  }

  const SELECT = [
    "ID", "equnr", "eqktx",
    "matnr", "maktx",
    "menge", "meins",
    "dmbtr", "waers",
    "lgort",
    "budat_mkpf", "cpudt_mkpf", "cputm_mkpf",
    "aufnr", "rsnum", "rspos",
    "wempf", "usnam_mkpf",
    "servpc",
    "CATEGORIA", "matkl", "wgbez"
  ].join(",");

  const ORDERBY = "budat_mkpf asc, cpudt_mkpf asc, cputm_mkpf asc";

  function mapResult(row) {
    const quantity = Number(row.menge || 0);
    const amount = Number(row.dmbtr || 0);
    const unitCost = quantity ? (amount / quantity) : 0;

    let timeStr = "";
    if (row.cputm_mkpf && row.cputm_mkpf.ms !== undefined) {
      const ms = Number(row.cputm_mkpf.ms) || 0;
      const seconds = Math.floor(ms / 1000);
      const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
      const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      const s = String(seconds % 60).padStart(2, "0");
      timeStr = h + ":" + m + ":" + s;
    }

    const dateStr = (function () {
      if (row.budat_mkpf && row.budat_mkpf.getTime) {
        const d = row.budat_mkpf;
        return ymd(d);
      }
      return row.budat_mkpf || "";
    })();

    return {
      idEvento: row.ID || [
        row.equnr || "",
        row.rsnum || "",
        row.rspos || "",
        row.matnr || "",
        row.budat_mkpf || ""
      ].join("-"),
      veiculo: row.equnr || "",
      descricaoVeiculo: row.eqktx || "",
      codMaterial: row.matnr || "",
      nome: row.maktx || "",
      tipo: row.servpc || "",
      unid: row.meins || "",
      deposito: row.lgort || "",
      qtde: quantity,
      custoUnit: unitCost,
      valorTotal: amount,
      moeda: row.waers || "",
      data: dateStr,
      dataEntrada: row.cpudt_mkpf || "",
      horaEntrada: timeStr,
      nOrdem: row.aufnr || "",
      nReserva: row.rsnum || "",
      nItem: row.rspos || "",
      recebedor: row.wempf || "",
      usuario: row.usnam_mkpf || "",
      categoria: row.CATEGORIA || "",
      grpMerc: row.matkl || "",
      grpMercDesc: row.wgbez || ""
    };
  }

  function buildOrderFilter(orders) {
    if (!Array.isArray(orders) || orders.length === 0) {
      return "";
    }
    const parts = orders
      .map(function (order) {
        return pad(order, 12);
      })
      .filter(Boolean)
      .map(function (value) {
        return "aufnr eq '" + value + "'";
      });
    if (!parts.length) {
      return "";
    }
    return "(" + parts.join(" or ") + ")";
  }

  /**
   * Carrega materiais respeitando datas locais (sem UTC manual).
   * Usa meia-aberta: GE <start 00:00> e LT <end+1 00:00>.
   */
  function loadMaterials(oComponent, options) {
    const settings = options || {};
    const oSvc = oComponent.getModel("svc");
    if (!oSvc || !(oSvc instanceof ODataModel)) {
      MessageBox.error("OData 'svc' não configurado no manifest.");
      return Promise.resolve([]);
    }

    const equnr18 = pad(settings.equnr, 18);

    const startDate = settings.startDate || new Date();
    const endDate = settings.endDate || startDate;

    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endNext = nextDay(new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()));

    const fEqunr = "equnr eq '" + equnr18 + "'";
    const fGe = "budat_mkpf ge datetime'" + ymd(start) + "T00:00:00'";
    const fLt = "budat_mkpf lt datetime'" + ymd(endNext) + "T00:00:00'";
    const orderFilter = buildOrderFilter(settings.orders);

    let filterStr = "(" + fGe + " and " + fLt + ") and " + fEqunr;
    if (orderFilter) {
      filterStr += " and " + orderFilter;
    }

    const urlParameters = {
      "$select": SELECT,
      "$orderby": ORDERBY,
      "$filter": filterStr
    };

    const showBusy = settings.showBusy !== false;
    if (showBusy) {
      BusyIndicator.show(0);
    }
    return new Promise(function (resolve) {
      oSvc.read("/ZC_EQ_MOVTO", {
        urlParameters: urlParameters,
        success: function (data) {
          if (showBusy) {
            BusyIndicator.hide();
          }
          const results = data && data.results ? data.results : [];
          resolve(results.map(mapResult));
        },
        error: function () {
          if (showBusy) {
            BusyIndicator.hide();
          }
          MessageBox.error("Falha ao consultar materiais em ZC_EQ_MOVTO.");
          resolve([]);
        }
      });
    });
  }

  return {
    loadMaterials: loadMaterials
  };
});
