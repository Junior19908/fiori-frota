sap.ui.define([
  "sap/base/Log",
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/services/ODataVehicles"
], function (Log, JSONModel, ODataVehicles) {
  "use strict";

  function _yesterdayRange() {
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return [y, y]; // single-day (ontem), o CDS aceita intervalo SingleRange
  }

  function _normalizeEqunr(equnr) {
    // sua UI mostra sem zeros à esquerda? Ajuste aqui se quiser:
    // return String(Number(equnr));
    return String(equnr || "");
  }

  return {
    /**
     * Carrega veículos do OData e salva no modelo base (/veiculos).
     * @param {sap.ui.core.mvc.View} oView
     * @param {[Date,Date]|null} range Opcional; se vazio, usa ontem
     * @returns {Promise<void>}
     */
    loadVehiclesForRange(oView, range) {
      if (!oView) return Promise.resolve();

      const baseModel = oView.getModel();
      if (!baseModel) {
        oView.setModel(new JSONModel({ veiculos: [] })); // garante o modelo base
      }

      const [dFrom, dTo] = Array.isArray(range) && range[0] && range[1]
        ? range
        : _yesterdayRange();

      return ODataVehicles.loadVehicles(oView, dFrom, dTo)
        .then((raw) => {
          // Mapeia para o formato usado na grid/combos
          const mapped = raw.map((r) => ({
            veiculo: _normalizeEqunr(r.equnr),
            descricao: r.eqktx || "",
            categoria: r.CATEGORIA || "",
            // flags mínimos para a tabela filtrar por "tem atividade no range"
            rangeHasActivity: true,
            dataRef: dTo  // opcional: usado no sorter da tabela
          }));

          // Remove duplicados (se por algum motivo o backend não agregou)
          const seen = new Set();
          const uniq = [];
          for (const v of mapped) {
            const k = `${v.veiculo}||${v.categoria}||${v.descricao}`;
            if (!seen.has(k)) { seen.add(k); uniq.push(v); }
          }

          oView.getModel().setProperty("/veiculos", uniq);
        })
        .catch((e) => {
          Log.error("Falha ao carregar veículos do OData", e);
          // mantém estado anterior e não quebra UI
        });
    }
  };
});
