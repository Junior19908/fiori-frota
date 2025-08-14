sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log"
], function (UIComponent, JSONModel, Log) {
  "use strict";

  // === CONFIGURAÇÕES ===
  const PATH_BASE   = "com/skysinc/frota/frota/model/localdata"; // ajuste se seu caminho mudar
  const MONTHS_BACK = 18; // quantos meses para trás carregar automaticamente

  function mm2(m) { return String(m).padStart(2, "0"); }

  // Busca JSON tolerante: retorna null no 404/erro
  function fetchJSON(url) {
    return new Promise((resolve) => {
      jQuery.ajax({
        url,
        dataType: "json",
        cache: false,
        success: (data) => resolve(data),
        error: () => resolve(null)
      });
    });
  }

  // Constrói URL relativa ao require
  function toUrl(p) { return sap.ui.require.toUrl(p); }

  // === Merge helpers ===
  // Mapa: { [veiculoId]: Array }
  function ensureMap(arrOrMap, keyField) {
    // Se já veio um mapa por veículo:
    if (arrOrMap && typeof arrOrMap === "object" && !Array.isArray(arrOrMap)) {
      return arrOrMap;
    }
    // Caso venha array plano -> transformar em mapa por veículo
    const map = {};
    (Array.isArray(arrOrMap) ? arrOrMap : []).forEach((row) => {
      const key = String(row.veiculoId || row.veiculo || row.idVeiculo || "");
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(row);
    });
    return map;
  }

  // Dedup simples por (data + id|nItem|nome)
  function uidOf(it) {
    return String(it.data || "") + "|" + String(it.id || it.nItem || it.nome || "");
  }

  function mergeByVehicle(dstMap, srcMap) {
    Object.keys(srcMap || {}).forEach((veh) => {
      const srcArr = Array.isArray(srcMap[veh]) ? srcMap[veh] : [];
      if (!dstMap[veh]) dstMap[veh] = [];
      const seen = new Set(dstMap[veh].map(uidOf));
      srcArr.forEach((row) => {
        const u = uidOf(row);
        if (!seen.has(u)) {
          dstMap[veh].push(row);
          seen.add(u);
        }
      });
    });
    return dstMap;
  }

  // Veículos: aceita array ou { veiculos:[...] }, deduplica por (id|veiculo)
  function mergeVehicles(dstArr, src) {
    const srcArr = Array.isArray(src) ? src : (src && Array.isArray(src.veiculos) ? src.veiculos : []);
    if (!Array.isArray(dstArr)) dstArr = [];
    const seen = new Set(dstArr.map(v => String(v.id || v.veiculo)));
    srcArr.forEach((v) => {
      const key = String(v.id || v.veiculo);
      if (!key || seen.has(key)) return;
      dstArr.push(v);
      seen.add(key);
    });
    return dstArr;
  }

  // Lista meses (YYYY, MM) entre start e end (Date), inclusive
  function monthsBetween(start, end) {
    const out = [];
    if (!(start instanceof Date) || !(end instanceof Date)) return out;
    let y = start.getFullYear(), m = start.getMonth(); // 0..11
    const y2 = end.getFullYear(), m2 = end.getMonth();
    while (y < y2 || (y === y2 && m <= m2)) {
      out.push({ y, m: m + 1 }); // 1..12
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return out;
  }

  const Component = UIComponent.extend("com.skysinc.frota.frota.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Modelos cumulativos
      this.setModel(new JSONModel({ veiculos: [] }));                       // default
      this.setModel(new JSONModel({ materiaisPorVeiculo: {} }), "materiais");
      this.setModel(new JSONModel({ abastecimentosPorVeiculo: {} }), "abast");

      // Carregamento automático: últimos N meses (independe da Main)
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 28); // dia pouco sensível

      this.loadAllHistoryInRange(start, end).then(() => {
        this.getRouter().initialize();
      });
    },

    /**
     * Carrega e MERGEIA todos os meses entre start e end, sem limpar os acumulados.
     * Aceita formatos:
     *  - veiculos.json: Array ou { veiculos: [...] }
     *  - materiais.json: { materiaisPorVeiculo: {...} } OU Array plano com veiculoId/veiculo
     *  - abastecimentos.json: { abastecimentosPorVeiculo: {...} } OU Array plano
     */
    loadAllHistoryInRange: async function (start, end) {
      const baseModel  = this.getModel();
      const matModel   = this.getModel("materiais");
      const abModel    = this.getModel("abast");

      const months = monthsBetween(start, end);
      if (!months.length) return;

      let veic = baseModel.getProperty("/veiculos") || [];
      let matMap = matModel.getProperty("/materiaisPorVeiculo") || {};
      let abMap  = abModel.getProperty("/abastecimentosPorVeiculo") || {};

      for (const { y, m } of months) {
        const ym = `${y}/${mm2(m)}`;
        const vUrl  = toUrl(`${PATH_BASE}/${y}/${mm2(m)}/veiculos.json`);
        const mUrl  = toUrl(`${PATH_BASE}/${y}/${mm2(m)}/materiais.json`);
        const aUrl  = toUrl(`${PATH_BASE}/${y}/${mm2(m)}/abastecimentos.json`);

        const [vData, mData, aData] = await Promise.all([
          fetchJSON(vUrl), fetchJSON(mUrl), fetchJSON(aUrl)
        ]);

        // Veículos
        if (vData) veic = mergeVehicles(veic, vData);

        // Materiais
        if (mData) {
          const map = mData.materiaisPorVeiculo
            ? mData.materiaisPorVeiculo
            : ensureMap(mData, "veiculoId");
          matMap = mergeByVehicle(matMap, map);
        }

        // Abastecimentos
        if (aData) {
          const map = aData.abastecimentosPorVeiculo
            ? aData.abastecimentosPorVeiculo
            : ensureMap(aData, "veiculoId");
          abMap = mergeByVehicle(abMap, map);
        }
      }

      baseModel.setProperty("/veiculos", veic);
      matModel.setProperty("/materiaisPorVeiculo", matMap);
      abModel.setProperty("/abastecimentosPorVeiculo", abMap);

      Log.info("[Component] Histórico cumulativo carregado: " +
        months.length + " mês(es)");
    },

    /**
     * Compatibilidade: garante que (year, mm) esteja carregado e mesclado.
     * NÃO apaga dados anteriores; apenas adiciona se faltar.
     */
    setMockYM: async function (year, mm) {
      const y = Number(year);
      const m = Number(mm);
      this.__currentYM = `${y}-${mm2(m)}`;
      const start = new Date(y, m - 1, 1);
      const end   = new Date(y, m - 1, 28);
      await this.loadAllHistoryInRange(start, end);
      return Promise.resolve();
    },

    /**
     * API que você já tinha — agora implementada chamando o método robusto.
     * Mantida para não quebrar chamadas existentes.
     */
    setMockRange: function (startDate, endDate) {
      if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
        return Promise.resolve();
      }
      return this.loadAllHistoryInRange(startDate, endDate);
    }
  });

  return Component;
});
