sap.ui.define([
  "sap/base/Log"
], function (Log) {
  "use strict";

  /**
   * Serviço de baixo nível que fala direto com o OData (modelo "svc").
   * Ele faz um $apply com filter + groupby para retornar veículos únicos
   * (equnr, eqktx, CATEGORIA) no intervalo de budat_mkpf.
   */
  const _fmt = {
    // YYYY-MM-DD
    d: (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  };

  function _buildApply(dFrom, dTo) {
    // OData V2 literal: datetime'YYYY-MM-DDTHH:mm:ss'
    const from = `${_fmt.d(dFrom)}T00:00:00`;
    const to   = `${_fmt.d(dTo)}T23:59:59`;
    // groupby para trazer apenas veículos distintos dentro do range
    return `filter(budat_mkpf ge datetime'${from}' and budat_mkpf le datetime'${to}')/groupby((equnr,eqktx,CATEGORIA))`;
  }

  return {
    /**
     * Lê veículos únicos do CDS ZC_EQ_MOVTO usando $apply.
     * @param {sap.ui.core.mvc.View|sap.ui.core.Component} ctx View ou Component para alcançar o modelo "svc"
     * @param {Date} dFrom data inicial (obrigatória pelo serviço)
     * @param {Date} dTo data final (obrigatória pelo serviço)
     * @returns {Promise<Array<{equnr:string, eqktx:string, CATEGORIA:string}>>}
     */
    loadVehicles(ctx, dFrom, dTo) {
      return new Promise((resolve, reject) => {
        const oModel = (typeof ctx.getModel === "function") ? ctx.getModel("svc") : null;
        if (!oModel) {
          reject(new Error("Modelo OData 'svc' não encontrado. Verifique o manifest e o bootstrap."));
          return;
        }

        const urlParameters = {
          "$apply": _buildApply(dFrom, dTo),
          "$orderby": "equnr"
        };

        oModel.read("/ZC_EQ_MOVTO", {
          urlParameters,
          success: (oData) => {
            // Em V2, oData.results costuma conter as colunas do groupby
            const list = Array.isArray(oData?.results) ? oData.results : [];
            resolve(list.map(r => ({
              equnr: r.equnr,
              eqktx: r.eqktx,
              CATEGORIA: r.CATEGORIA
            })));
          },
          error: (err) => {
            Log.error("Erro ao ler OData de veículos", err);
            reject(err);
          }
        });
      });
    }
  };
});
