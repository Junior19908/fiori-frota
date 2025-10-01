sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log"
], function (UIComponent, JSONModel, Log) {
  "use strict";

  // === CONFIGURAÃ‡Ã•ES ===
  const PATH_BASE   = "com/skysinc/frota/frota/model/localdata"; // ajuste se seu caminho mudar
  const DOWNTIME_FILE = PATH_BASE + "/downtime.json";
  const MONTHS_BACK = 18; // quantos meses para trÃ¡s carregar automaticamente

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

  // ConstrÃ³i URL relativa ao require
  function toUrl(p) { return sap.ui.require.toUrl(p); }

  // === Helpers p/ merge de coleÃ§Ãµes por veÃ­culo ===
  // Transforma array plano em mapa { [veiculoId]: Array }, se necessÃ¡rio
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

  // Normaliza o JSON de downtime para o formato { eventosPorVeiculo: { [veiculoId]: [events] } }
  // Aceita tanto o formato { downtimes: [...] } quanto um mapa jÃ¡ estruturado.
  function normalizeDowntime(raw) {
    if (!raw) return {};
    // Se jÃ¡ vier no formato { eventosPorVeiculo: { ... } }
    if (raw.eventosPorVeiculo && typeof raw.eventosPorVeiculo === 'object') {
      return raw.eventosPorVeiculo;
    }
    // Se vier como { downtimes: [...] }
    if (Array.isArray(raw.downtimes)) {
      const map = {};
      raw.downtimes.forEach((it) => {
        const key = String(it.equnr || it.veiculo || it.veiculoId || it.idVeiculo || '');
        if (!key) return;
        if (!map[key]) map[key] = [];
        map[key].push(it);
      });
      return map;
    }
    // Se vier como array raiz
    if (Array.isArray(raw)) {
      const map = {};
      raw.forEach((it) => {
        const key = String(it.equnr || it.veiculo || it.veiculoId || it.idVeiculo || '');
        if (!key) return;
        if (!map[key]) map[key] = [];
        map[key].push(it);
      });
      return map;
    }
    // Se vier como objeto plano que jÃ¡ Ã© um map por veÃ­culo, assume-o
    if (typeof raw === 'object') {
      return raw;
    }
    return {};
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

  // ConstrÃ³i um objeto vehConf compatÃ­vel com o que os controllers esperam.
  // Se 'ranges' for fornecido (conteÃºdo de ranges_config.json), podemos
  // inicializar valores padrÃµes por veÃ­culo com base nos ranges ou apenas expor
  // a estrutura mÃ­nima necessÃ¡ria.
  function createVehConfFromRanges(ranges) {
    const defaults = {
      MaxJumpKm: 100,
      MaxNegativeKm: 0,
      RolloverMaxKm: 1000,
      MaxKmPerHour: 120,
      MaxLitersPerFill: 200,
      MaxLph: 50,
      TankCapacity: 400,
      FuelType: "",
      EnableValidation: false,
      StrictMode: false
    };

    const result = {
      globals: Object.assign({}, defaults),
      vehicles: {}
    };

    if (ranges && Array.isArray(ranges.veiculos)) {
      // Preenche chaves de veÃ­culos com os defaults (permite override futuro via UI)
      ranges.veiculos.forEach((r) => {
        const key = String(r.veiculo || r.id || r.veiculoId || "");
        if (!key) return;
        result.vehicles[key] = Object.assign({}, defaults);
      });
    }

    return result;
  }

  // Transforma ranges_config.json (array `veiculos`) no formato esperado pelo Config.controller
  var Component = UIComponent.extend("com.skysinc.frota.frota.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Modelos cumulativos:
      // - /veiculos e "materiais" agora NÃƒO sÃ£o carregados de arquivo â€” ficam para OData/Services preencherem
      this.setModel(new JSONModel({ veiculos: [] }));                       // default (preenchido por OData no fluxo da app)
      this.setModel(new JSONModel({ materiaisPorVeiculo: {} }), "materiais"); // idem
      this.setModel(new JSONModel({ abastecimentosPorVeiculo: {} }), "abast"); // este sim virÃ¡ de arquivos locais


      // Modelo de configuraÃ§Ã£o por veÃ­culo (para a tela Config e validaÃ§Ãµes)
      // Criar um modelo inicial sÃ­ncrono para que o controller/route encontre /current imediatamente
      var initialVehConf = createVehConfFromRanges(null);
      this.setModel(new JSONModel(initialVehConf), "vehConf");
      this.setModel(new JSONModel({}), "ranges");
      this.setModel(new JSONModel({ eventosPorVeiculo: {} }), "downtime");

      var that = this;
      // Carrega e substitui assincronamente
      fetchJSON(toUrl(PATH_BASE + "/config/ranges_config.json")).then(function(data) {
        var vehConf = createVehConfFromRanges(data);
        that.setModel(new JSONModel(vehConf), "vehConf");
        // tambÃ©m expÃµe o JSON cru para visualizaÃ§Ã£o direta
        that.setModel(new JSONModel(data || {}), "ranges");
      });

      fetchJSON(toUrl(DOWNTIME_FILE)).then(function(data) {
        const map = normalizeDowntime(data);
        var downtimeModel = that.getModel("downtime");
        if (downtimeModel) {
          downtimeModel.setData({ eventosPorVeiculo: map });
        } else {
          downtimeModel = new JSONModel({ eventosPorVeiculo: map });
          that.setModel(downtimeModel, "downtime");
        }

        try {
          var eventBus = sap && sap.ui && sap.ui.getCore ? sap.ui.getCore().getEventBus() : null;
          if (eventBus && eventBus.publish) {
            eventBus.publish("downtime", "ready");
          }
        } catch (e) {
          // noop
        }
      });

      // Carregamento automÃ¡tico: Ãºltimos N meses (somente abastecimentos locais)
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 28); // dia pouco sensÃ­vel

      this.loadAllHistoryInRange(start, end).then(() => {
        this.getRouter().initialize();
      });


        // --- Settings model (global) ---
        (function initSettingsModel(ComponentInstance){
          const STORAGE_KEY = "frota.settings.v1";
          const defaults = {
            showAllOS: false,
            osTypes: ["ZF1","ZF2","ZF3"],
            autoLoadMain: false,
            autoLoadIntervalSec: 30,
            mainDatePref: "yesterday",
            saveLocal: true,
            theme: "sap_horizon",
            avatarSrc: "",
            avatarInitials: "CJ"
          };
          let saved = null;
          try { saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)); } catch(e){}
          const settingsData = Object.assign({}, defaults, saved || {});
          const oSettingsModel = new sap.ui.model.json.JSONModel(settingsData);
          ComponentInstance.setModel(oSettingsModel, "settings");
          try { sap.ui.getCore().applyTheme(settingsData.theme); } catch(e){}
        })(this);

    },

    /**
     * Carrega e MERGEIA todos os meses entre start e end, sem limpar os acumulados.
     * A PARTIR DE AGORA:
     *  - NÃƒO lÃª veiculos.json
     *  - NÃƒO lÃª materiais.json
     *  - **SOMENTE** lÃª abastecimentos.json
     *
     * Aceita formatos de abastecimentos:
     *  - { abastecimentosPorVeiculo: {...} } OU Array plano com veiculoId/veiculo
     */
    loadAllHistoryInRange: async function (start, end) {
      const abModel = this.getModel("abast");

      const months = monthsBetween(start, end);
      if (!months.length) return;

      let abMap  = abModel.getProperty("/abastecimentosPorVeiculo") || {};
      const missingMonths = [];

      // ForÃ§a consumo remoto (Firebase Storage) em vez de arquivos locais
      const useLocal = (function(){
        try { return /(?:[?&])useLocalAbastecimentos=1(?:[&#]|$)/.test(String(window.location && window.location.search || "")); }
        catch(e){ return false; }
      })();

      for (const { y, m } of months) {
        let aData = null;
        if (useLocal) {
          const aUrl  = toUrl(`${PATH_BASE}/${y}/${mm2(m)}/abastecimentos.json`);
          aData = await fetchJSON(aUrl);
        } else {
          try {
            aData = await new Promise(function(resolve){
              sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
                svc.fetchMonthlyFromFirestore(y, m).then(function (d) { resolve(d); }).catch(function(){ resolve(null); });
              });
            });
          } catch (e) { aData = null; }
        }

        // Sem fallback local: se remoto indisponÃ­vel, mÃªs ficarÃ¡ sem dados

        if (aData) {
          const map = aData.abastecimentosPorVeiculo
            ? aData.abastecimentosPorVeiculo
            : ensureMap(aData);
          abMap = mergeByVehicle(abMap, map);
        } else {
          // marca mÃªs como ausente no Storage remoto
          missingMonths.push(`${y}-${mm2(m)}`);
        }
      }

      // Atualiza SOMENTE o modelo de abastecimentos
      abModel.setProperty("/abastecimentosPorVeiculo", abMap);

      if (missingMonths.length > 0) {
        try {
          sap.ui.require(["sap/m/MessageToast"], function (MessageToast) {
            const list = missingMonths.slice(0, 6).join(", ");
            const extra = missingMonths.length > 6 ? ` +${missingMonths.length - 6}` : "";
            MessageToast.show(`Meses sem dados no Firebase: ${list}${extra}`);
          });
        } catch (e) { /* no-op */ }
      }

      Log.info("[Component] HistÃ³rico de abastecimentos (local) carregado: " +
        months.length + " mÃªs(es)");
    },

    /**
     * Compatibilidade: garante que (year, mm) esteja carregado e mesclado (abastecimentos).
     * NÃƒO apaga dados anteriores; apenas adiciona se faltar.
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


