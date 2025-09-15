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

  // === Helpers p/ merge de coleções por veículo ===
  // Transforma array plano em mapa { [veiculoId]: Array }, se necessário
  function ensureMap(arrOrMap) {
    if (arrOrMap && typeof arrOrMap === "object" && !Array.isArray(arrOrMap)) {
      return arrOrMap;
    }
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

  // ======= Modelo de Configuração de Veículo (vehConf) =======
  // Hierarquia: globals -> categories -> vehicles -> current
  function buildVehConfDefaults() {
    return {
      globals: {
        MaxJumpKm: 500,
        MaxNegativeKm: 0,
        RolloverMaxKm: 999999,
        MaxKmPerHour: 80,
        MaxLitersPerFill: 300,
        MaxLph: 60,
        TankCapacity: 300,
        FuelType: "Diesel S10",
        EnableValidation: true,
        StrictMode: false
      },
      categories: {
        "Caminhao": { MaxJumpKm: 800, MaxKmPerHour: 100, TankCapacity: 400 },
        "Trator":   { MaxJumpKm: 100, MaxKmPerHour: 40,  TankCapacity: 200 }
      },
      vehicles: {
        // Exemplo: overrides por veículo (opcional)
        "20010046": { MaxJumpKm: 600, MaxKmPerHour: 85, TankCapacity: 360, FuelType: "Diesel S10" }
      },
      current: {} // preenchido na tela de Config
    };
  }

  const Component = UIComponent.extend("com.skysinc.frota.frota.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Modelos cumulativos:
      // - /veiculos e "materiais" agora NÃO são carregados de arquivo — ficam para OData/Services preencherem
      this.setModel(new JSONModel({ veiculos: [] }));                       // default (preenchido por OData no fluxo da app)
      this.setModel(new JSONModel({ materiaisPorVeiculo: {} }), "materiais"); // idem
      this.setModel(new JSONModel({ abastecimentosPorVeiculo: {} }), "abast"); // este sim virá de arquivos locais

      // Modelo de configuração por veículo (para a tela Config e validações)
      this.setModel(new JSONModel(buildVehConfDefaults()), "vehConf");

      // Carregamento automático: últimos N meses (somente abastecimentos locais)
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 28); // dia pouco sensível

      this.loadAllHistoryInRange(start, end).then(() => {
        this.getRouter().initialize();
      });
    },

    /**
     * Carrega e MERGEIA todos os meses entre start e end, sem limpar os acumulados.
     * A PARTIR DE AGORA:
     *  - NÃO lê veiculos.json
     *  - NÃO lê materiais.json
     *  - **SOMENTE** lê abastecimentos.json
     *
     * Aceita formatos de abastecimentos:
     *  - { abastecimentosPorVeiculo: {...} } OU Array plano com veiculoId/veiculo
     */
    loadAllHistoryInRange: async function (start, end) {
      const abModel = this.getModel("abast");

      const months = monthsBetween(start, end);
      if (!months.length) return;

      let abMap  = abModel.getProperty("/abastecimentosPorVeiculo") || {};

      for (const { y, m } of months) {
        const aUrl  = toUrl(`${PATH_BASE}/${y}/${mm2(m)}/abastecimentos.json`);

        // Lê APENAS abastecimentos do mês
        const aData = await fetchJSON(aUrl);

        if (aData) {
          const map = aData.abastecimentosPorVeiculo
            ? aData.abastecimentosPorVeiculo
            : ensureMap(aData);
          abMap = mergeByVehicle(abMap, map);
        }
      }

      // Atualiza SOMENTE o modelo de abastecimentos
      abModel.setProperty("/abastecimentosPorVeiculo", abMap);

      Log.info("[Component] Histórico de abastecimentos (local) carregado: " +
        months.length + " mês(es)");
    },

    /**
     * Compatibilidade: garante que (year, mm) esteja carregado e mesclado (abastecimentos).
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
     * Mantida para compatibilidade. Carrega abastecimentos no intervalo.
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
