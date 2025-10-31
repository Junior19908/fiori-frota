sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/skysinc/frota/frota/util/formatter",
  "com/skysinc/frota/frota/util/FilterUtil",
  "com/skysinc/frota/frota/services/MaterialsService",
  "com/skysinc/frota/frota/services/FuelService",
  "com/skysinc/frota/frota/services/KpiService",
  "com/skysinc/frota/frota/services/ODataMovtos",
  "com/skysinc/frota/frota/services/VehiclesService",
  "com/skysinc/frota/frota/Aggregation",
  "com/skysinc/frota/frota/services/ReliabilityService"
], function (
  Controller, JSONModel, Filter, FilterOperator, Fragment, MessageToast, MessageBox,
  formatter, FilterUtil, MaterialsService, FuelService, KpiService, ODataMovtos, VehiclesService, Aggregation, ReliabilityService
) {
  "use strict";

  function pad2(n){ return String(n).padStart(2,"0"); }
  function toODataLocal(d, endOfDay){
    if (!d) return null;
    const x = new Date(d);
    if (endOfDay) x.setHours(23,59,59,999); else x.setHours(0,0,0,0);
    const y = x.getFullYear();
    const m = pad2(x.getMonth()+1);
    const day = pad2(x.getDate());
    const hh = pad2(x.getHours());
    const mm = pad2(x.getMinutes());
    const ss = pad2(x.getSeconds());
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
  }

  function createSummarySkeleton() {
    const defaultTag = { status: "Good", text: "Status", value: "OK", tooltip: "" };
    return {
      fuelSpend: {
        title: "Gasto combustivel",
        subtitle: "Periodo selecionado",
        tooltip: "Valor total gasto com combustivel no periodo selecionado",
        unit: "R$",
        value: "0,00",
        raw: 0,
        state: "Success",
        tag: Object.assign({}, defaultTag),
        trend: {
          actual: 0,
          target: 100,
          actualLabel: "0%",
          targetLabel: "Meta",
          color: "Good",
          tooltip: "Percentual consumido do orcamento definido"
        }
      },
      totalLiters: {
        title: "Litros totais",
        subtitle: "Somatorio de abastecimentos",
        tooltip: "Volume total abastecido no periodo selecionado",
        unit: "L",
        value: "0,00",
        raw: 0,
        state: "Success",
        tag: Object.assign({}, defaultTag),
        trend: {
          title: "Comparativo anterior",
          current: 0,
          previous: 0,
          tooltip: "Comparativo com o periodo imediatamente anterior"
        }
      },
      serviceCost: {
        title: "Custo material/servico",
        subtitle: "Oficinas e pecas",
        tooltip: "Custos consolidados de manutencao e servicos",
        unit: "R$",
        value: "0,00",
        raw: 0,
        state: "Success",
        tag: Object.assign({}, defaultTag),
        trend: {
          title: "Orcado",
          value: 0,
          color: "Good",
          tooltip: "Percentual utilizado frente ao orcamento mensal"
        }
      },
      avgPrice: {
        title: "Preco medio/L",
        subtitle: "Combustiveis ponderados",
        tooltip: "Preco medio ponderado pelos abastecimentos do periodo",
        unit: "R$/L",
        value: "0,00",
        raw: 0,
        state: "Success",
        tag: Object.assign({}, defaultTag),
        trend: {
          tooltip: "Variacao de preco nas ultimas medicoes",
          lowLabel: "0,00",
          highLabel: "0,00",
          points: [0, 0, 0, 0]
        }
      }
    };
  }

  function createEmptyFiltersModel() {
    return {
      categories: [],
      vehicles: [],
      selectedCategories: [],
      selectedVehicles: []
    };
  }

  return Controller.extend("com.skysinc.frota.frota.controller.Main", {
    formatter: formatter,

    onInit: function () {
      this.oTbl = this.byId("tbl");

      if (!this.getView().getModel("vm")) {
        this.getView().setModel(new JSONModel({
          veiculos: [],
          movimentos: [],
          aggregateOn: true
        }), "vm");
      }

      this.oKpi = new JSONModel({
        totalLitrosFmt: "0,00",
        gastoCombustivelFmt: "R$ 0,00",
        custoMateriaisFmt: "R$ 0,00",
        precoMedioFmt: "0,00",
        resumoCombFmt: "Comb: R$ 0,00",
        resumoLitrosFmt: "Litros: 0,00 L",
        resumoMatFmt: "Mat/Serv: R$ 0,00",
        resumoPrecoFmt: "PreÃ§o MÃ©dio: 0,00 R$/L"
      });
      try {
        const router = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (router && router.getRoute) {
          const r = router.getRoute("RouteMain");
          if (r && r.attachPatternMatched) { r.attachPatternMatched(() => { this._applyMainDatePref(); this.onFilterChange(); }); }
        }
      } catch(e){}
      try {
        const s = this.getOwnerComponent().getModel && this.getOwnerComponent().getModel("settings");
        if (s && s.attachPropertyChange) {
          s.attachPropertyChange((ev)=>{
            try {
              const path = ev && ev.getParameter && ev.getParameter("path");
              if (path === "/mainDatePref") { this._applyMainDatePref(); this.onFilterChange(); }
            } catch(__){}
          });
        }
      } catch(e){}
      this.getView().setModel(this.oKpi, "kpi");
      this._summaryModel = new JSONModel(createSummarySkeleton());
      this.getView().setModel(this._summaryModel, "FleetSummary");
      this._filtersModel = new JSONModel(createEmptyFiltersModel());
      this.getView().setModel(this._filtersModel, "FleetFilters");

      this._eventBus = sap.ui.getCore().getEventBus();
      if (this._eventBus && this._eventBus.subscribe) {
        this._eventBus.subscribe("downtime", "ready", this._onDowntimeReady, this);
      }
      const doInitAsync = async () => {
        try {
          this._applyMainDatePref();
          await this._reloadDistinctOnly();
          const range = FilterUtil.currentRange(this.byId("drs"));
          try {
            const comp = this.getOwnerComponent && this.getOwnerComponent();
            if (comp && typeof comp.loadAllHistoryInRange === "function" && Array.isArray(range)) {
              const months = this._monthsSpan(range[0], range[1]);
              if (months > 12) {
                sap.m.MessageToast.show(`PerÃ­odo selecionado muito grande (${months} meses). MÃ¡ximo: 12.`);
              } else {
                await comp.loadAllHistoryInRange(range[0], range[1]);
              }
            }
          } catch(_){}
          await Aggregation.recalcAggByRange(this.getView(), range);
          await this._updateReliabilityForVehicles(this._currentRangeObj());
          this._ensureVehiclesCombo();
          this._ensureCategoriasCombo();
          this._recalcAndRefresh();
        } catch (e) {
          try { sap.m.MessageToast.show("Falha na inicializaÃ§Ã£ assÃ­ncrona."); } catch(_){}
        }
      };
      void doInitAsync();
    },
    onFilterChange: async function () {
      try {
        await this._reloadDistinctOnly();
        const range = FilterUtil.currentRange(this.byId("drs"));
        try {
          const comp = this.getOwnerComponent && this.getOwnerComponent();
          if (comp && typeof comp.loadAllHistoryInRange === "function" && Array.isArray(range)) {
            const months = this._monthsSpan(range[0], range[1]);
            if (months > 12) {
              sap.m.MessageToast.show(`PerÃ­odo selecionado muito grande (${months} meses). MÃ¡ximo: 12.`);
            } else {
              await comp.loadAllHistoryInRange(range[0], range[1]);
            }
          }
        } catch(_){}
        await Aggregation.recalcAggByRange(this.getView(), range);
        await this._updateReliabilityForVehicles(this._currentRangeObj());
        this._ensureVehiclesCombo();
        this._ensureCategoriasCombo();
        this._recalcAndRefresh();
      } catch (e) {
        MessageToast.show("Falha ao recarregar.");
      }
    },

    onMultiCategoryChange: function (oEvent) {
      if (!this._filtersModel) { return; }
      const src = oEvent && oEvent.getSource && oEvent.getSource();
      const keys = (src && typeof src.getSelectedKeys === "function") ? src.getSelectedKeys() : [];
      this._filtersModel.setProperty("/selectedCategories", Array.isArray(keys) ? keys : []);
    },

    onMultiVehicleChange: function (oEvent) {
      if (!this._filtersModel) { return; }
      const src = oEvent && oEvent.getSource && oEvent.getSource();
      const keys = (src && typeof src.getSelectedKeys === "function") ? src.getSelectedKeys() : [];
      this._filtersModel.setProperty("/selectedVehicles", Array.isArray(keys) ? keys : []);
    },

    onClearFilters: async function () {
      this._applyMainDatePref();

      const inpVeh = this.byId("inpVeiculo");
      inpVeh?.setSelectedKeys([]);
      inpVeh?.setValue("");

      const inpCat = this.byId("segCat");
      inpCat?.setSelectedKeys([]);
      inpCat?.setValue("");
      if (this._filtersModel) {
        this._filtersModel.setProperty("/selectedVehicles", []);
        this._filtersModel.setProperty("/selectedCategories", []);
      }

      await this._reloadDistinctOnly();
      const range = FilterUtil.currentRange(this.byId("drs"));
      try {
        const comp = this.getOwnerComponent && this.getOwnerComponent();
        if (comp && typeof comp.loadAllHistoryInRange === "function" && Array.isArray(range)) {
          const months = this._monthsSpan(range[0], range[1]);
          if (months > 12) {
            sap.m.MessageToast.show(`PerÃ­odo selecionado muito grande (${months} meses). MÃ¡ximo: 12.`);
          } else {
            await comp.loadAllHistoryInRange(range[0], range[1]);
          }
        }
      } catch(_){}
      await Aggregation.recalcAggByRange(this.getView(), range);
      this._ensureVehiclesCombo();
      this._ensureCategoriasCombo();
      this._recalcAndRefresh();
    },

    // ========= NOVO: Botâ”œÃ¢â”¬Ãºo de Configuraâ”œÃ¢â”¬Âºâ”œÃ¢â”¬Ãºo =========
    onOpenConfig: function () {
      // Usa o veÃ­culo selecionado no ComboBox "inpVeiculo"
      const oVehCombo = this.byId("inpVeiculo");
      const selectedKeys = (oVehCombo && typeof oVehCombo.getSelectedKeys === "function")
        ? oVehCombo.getSelectedKeys()
        : (this._filtersModel?.getProperty("/selectedVehicles") || []);
      const sEqunr = Array.isArray(selectedKeys) && selectedKeys.length > 0 ? selectedKeys[0] : null;

      try {
        const oRouter = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (oRouter && oRouter.navTo) {
          if (sEqunr) {
            oRouter.navTo("config", { equnr: sEqunr });
          } else {
            oRouter.navTo("config"); // sem parâ”œÃ¢â”¬Ã³metro: usuâ”œÃ¢â”¬Ã­rio escolhe na tela
          }
          return;
        }
      } catch (e) {
        // segue para fallback
      }
      MessageToast.show("Rota 'config' nÃ£o encontrada. Configure o routing no manifest.json.");
    },
    // ========= FIM DO NOVO =========

    // Abre pâ”œÃ¢â”¬Ã­gina de Configuraâ”œÃ¢â”¬Âºâ”œÃ¢â”¬Ães (preferâ”œÃ¢â”¬Â¬ncias do usuâ”œÃ¢â”¬Ã­rio)
    onOpenSettings: function () {
      try {
        const oRouter = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (oRouter && oRouter.navTo) {
          oRouter.navTo("settings");
          return;
        }
      } catch (e) {
        // fallback abaixo
      }
      sap.m.MessageToast.show("Rota 'settings' nÃ£o encontrada. Verifique o routing no manifest.json.");
    },

    onOpenHistorico: function (oEvent) {
      const obj = oEvent.getSource().getBindingContext("vm").getObject();
      const id = String(obj.equnr || obj.veiculo || "");
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id });
    },

    // Novo: abre o dialogo de OS (substitui a tela IW38)
    onOpenOSDialog: async function (oEvent) {
      try {
        const ctxObj = oEvent?.getSource?.()?.getBindingContext("vm")?.getObject?.();
        const equnr = String(ctxObj?.equnr || ctxObj?.veiculo || "");
        const range = FilterUtil.currentRange(this.byId("drs"));
        const rangeObj = this._currentRangeObj();
        const metrics = {
          kmRodados: Number(ctxObj?.kmRodadosAgg || 0),
          horasRodadas: Number(ctxObj?.hrRodadosAgg || 0),
          totalHorasPeriodo: Number(ctxObj?.totalHorasPeriodo || 0),
          totalHorasIndisponiveis: Number(ctxObj?.totalHorasIndisponiveis || ctxObj?.downtimeHorasRange || 0),
          totalHorasDisponiveis: Number(ctxObj?.totalHorasDisponiveis || 0),
          downtimeEventos: Number(ctxObj?.downtimeEventosRange || 0),
          osCount: Number(ctxObj?.osCountRange || 0)
        };
        let reliabilityMetrics = {};
        if (equnr) {
          try {
            const rel = await ReliabilityService.mergeDataPorVeiculo({ vehicleId: equnr, range: rangeObj });
            if (rel && rel.metrics) {
              reliabilityMetrics = Object.assign({}, rel.metrics);
            }
          } catch (err) {
            try { console.warn('[Main.onOpenOSDialog] Reliability metrics unavailable', err); } catch (_) {}
          }
        }
        if (reliabilityMetrics.kmPorQuebraFmt && !reliabilityMetrics.kmPerFailureFmt) {
          reliabilityMetrics.kmPerFailureFmt = reliabilityMetrics.kmPorQuebraFmt;
        }
        if (reliabilityMetrics.hrPorQuebraFmt && !reliabilityMetrics.hrPerFailureFmt) {
          reliabilityMetrics.hrPerFailureFmt = reliabilityMetrics.hrPorQuebraFmt;
        }
        if (reliabilityMetrics.downtimeFmt && !reliabilityMetrics.downtimeTotalFmt) {
          reliabilityMetrics.downtimeTotalFmt = reliabilityMetrics.downtimeFmt;
        }
        const mergedMetrics = Object.assign({}, metrics, reliabilityMetrics);
        sap.ui.require(["com/skysinc/frota/frota/controller/OSDialog"], (OSDlg) => {
          OSDlg.open(this.getView(), {
            equnr,
            range,
            titulo: equnr ? ("OS - " + equnr) : "OS",
            metrics: mergedMetrics
          });
        });
      } catch (e) {
        MessageToast.show("Falha ao abrir OS.");
      }
    },

    // Abre a visualizaâ”œÃ¢â”¬Âºâ”œÃ¢â”¬Ãºo/preview da IW38 (mock local por enquanto)
    onOpenIW38Preview: function (oEvent) {
      try {
        const ctxObj = oEvent?.getSource?.()?.getBindingContext("vm")?.getObject?.();
        // Usa alguma possÃ­vel ordem vinda do contexto, senÃ£o um valor padrâ”œÃ¢â”¬Ãºo do mock
        const equnr = String(ctxObj?.equnr || ctxObj?.veiculo || "");
        const oRouter = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (oRouter && oRouter.navTo) {
          oRouter.navTo("RouteIW38", { equnr });
          return;
        }
      } catch (e) {
        // segue para fallback
      }
      sap.m.MessageToast.show("Rota 'RouteIW38' nÃ£o encontrada. Verifique o routing no manifest.json.");
    },

    onOpenMateriais: function (oEvent) {
      const item = oEvent.getSource().getBindingContext("vm").getObject();
      return MaterialsService.openDialog(
        this.getView(),
        { equnr: item.equnr, descricaoVeiculo: item.eqktx },
        FilterUtil.currentRange(this.byId("drs"))
      );
    },

    onExportMateriais: function () {
      if (!this._dlgModel) { MessageToast.show("Abra o diâ”œÃ¢â”¬Ã­logo de materiais primeiro."); return; }
      sap.ui.require(["com/skysinc/frota/frota/services/MaterialsService"], (Svc) => {
        Svc.exportCsv(this._dlgModel, this.byId("drs"));
      });
    },

    onPrintMateriais: function () {
      const dlg = this.byId("dlgMateriais");
      if (!dlg) { MessageToast.show("Abra o diÃ¡logo de materiais primeiro."); return; }
      const win = window.open("", "_blank", "noopener,noreferrer");
      if (!win) { MessageBox.warning("Bloqueador de pop-up? Permita para imprimir."); return; }

      const title = (this._dlgModel?.getProperty("/titulo")) || "Materiais";
      const contentDom = dlg.getAggregation("content")[0].getDomRef()?.cloneNode(true);

      win.document.write("<html><head><meta charset='utf-8'><title>"+ title +"</title>");
      win.document.write("<style>body{font-family:Arial,Helvetica,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;font-size:12px} th{background:#f5f5f5} h1{font-size:18px;margin:0 0 12px}</style>");
      win.document.write("</head><body><h1>"+ title +"</h1>");
      if (contentDom) {
        const toolbars = contentDom.querySelectorAll(".sapMTB");
        toolbars.forEach((tb) => tb.parentNode && tb.parentNode.removeChild(tb));
        win.document.body.appendChild(contentDom);
      }
      win.document.write("</body></html>");
      win.document.close();
      win.focus(); win.print(); win.close();
    },

    _toIso: function (d, endOfDay) {
      return toODataLocal(d, endOfDay);
    },

    _getPeriodoAtual: function () {
      const drs = this.byId("drs");
      const d1  = drs?.getDateValue?.();
      const d2  = drs?.getSecondDateValue?.();
      return {
        startIso: this._toIso(d1 || new Date(), false),
        endIso:   this._toIso(d2 || d1 || new Date(), true)
      };
    },

    _openFragment: function (sName, sDialogId, mModels) {
      Object.entries(mModels || {}).forEach(([name, mdl]) => {
        this.getView().setModel(mdl, name);
      });

      if (!this._fragments) this._fragments = {};
      if (!this._fragments[sName]) {
        this._fragments[sName] = sap.ui.core.Fragment.load({
          id: this.getView().getId(),
          name: sName,
          controller: this
        }).then((oDialog) => {
          this.getView().addDependent(oDialog);
          return oDialog;
        });
      }
      return this._fragments[sName].then((oDialog) => {
        oDialog.open();
        return oDialog;
      });
    },

    onOpenAbastecimentos: function (oEvent) {
      const ctx = oEvent.getSource().getBindingContext("vm");
      const item = ctx && ctx.getObject ? ctx.getObject() : null;

      if (!item || !item.equnr) {
        sap.m.MessageToast.show("Selecione um veÃ­culo vÃ¡lido.");
        return;
      }

      const drs = this.byId("drs");
      if (!drs) {
        sap.m.MessageToast.show("Componente de perÃ­odo nÃ£o encontrado.");
        return;
      }
      const range = FilterUtil.currentRange(drs);

      return FuelService.openFuelDialog(
        this,
        {
          equnr: item.equnr,
          veiculo: item.equnr,
          eqktx: item.eqktx,
          descricao: item.eqktx
        },
        range
      );
    },

    onCloseFuel: function () {
      // Apenas fecha, sem salvar.
      if (this._fuelDialogState?._persistTimer) {
        clearTimeout(this._fuelDialogState._persistTimer);
      }
      this.byId("dlgFuel")?.close();
      this._fuelDialogState = null;
    },

    onSaveFuelLimits: function () {
      try {
        FuelService.saveFuelLimits(this, { reason: "manual" })
          .then((ok) => {
            if (ok) MessageToast.show("Limites salvos.");
            else MessageToast.show("nÃ£o foi possÃ­vel salvar os limites.");
          });
      } catch (e) {
        MessageToast.show("nÃ£o foi possÃ­vel salvar os limites.");
      }
    },

    onLimiteKmMinChange: function (oEvent) {
      this._applyFuelLimitOverride("limiteKmMin", oEvent);
    },

    onLimiteKmChange: function (oEvent) {
      this._applyFuelLimitOverride("limiteKm", oEvent);
    },

    onLimiteHrMinChange: function (oEvent) {
      this._applyFuelLimitOverride("limiteHrMin", oEvent);
    },

    onLimiteHrChange: function (oEvent) {
      this._applyFuelLimitOverride("limiteHr", oEvent);
    },

    _applyFuelLimitOverride: function (prop, oEvent) {
      if (!this._fuelModel || !this._fuelDialogState) return;

      const source = oEvent?.getSource?.();
      const rawValue = oEvent?.getParameter?.("value");
      const parsed = Number(rawValue != null ? rawValue : source?.getValue?.());
      if (!Number.isFinite(parsed)) return;

      const sanitized = Math.max(0, parsed);
      const currentOverrides = this._fuelDialogState.overrides || {};
      if (currentOverrides[prop] === sanitized) return;

      const overrides = {};
      overrides[prop] = sanitized;

      const adjustPair = (minProp, maxProp) => {
        const model = this._fuelModel;
        const minActive = !!model.getProperty("/" + minProp + "Active");
        const maxActive = !!model.getProperty("/" + maxProp + "Active");
        const currentMin = Number(model.getProperty("/" + minProp));
        const currentMax = Number(model.getProperty("/" + maxProp));

        if (prop === minProp && maxActive && Number.isFinite(currentMax) && sanitized > currentMax) {
          overrides[maxProp] = sanitized;
        }
        if (prop === maxProp && minActive && Number.isFinite(currentMin) && sanitized < currentMin) {
          overrides[minProp] = sanitized;
        }
      };

      adjustPair("limiteKmMin", "limiteKm");
      adjustPair("limiteHrMin", "limiteHr");

      FuelService.updateFuelLimits(this, overrides);
    },

    onDumpVm: function () {},

    _ensureVehiclesCombo: function () {
      const filtersModel = this.getView().getModel("FleetFilters");
      if (!filtersModel) { return; }
      const rawVehicles = (this.getView().getModel("vm")?.getProperty("/veiculos") || []);
      const map = new Map();

      rawVehicles.forEach((row) => {
        const key = row?.equnr || row?.veiculo || row?.id;
        if (!key) { return; }
        const keyStr = String(key);
        if (!map.has(keyStr)) {
          const secondary = row?.eqktx || row?.DESCR || row?.descricao || "";
          map.set(keyStr, {
            key: keyStr,
            text: keyStr,
            secondary: secondary || ""
          });
        }
      });

      const sorter = (a, b) => {
        try { return a.text.localeCompare(b.text, "pt-BR"); } catch(e) { return a.text < b.text ? -1 : (a.text > b.text ? 1 : 0); }
      };

      const vehicles = Array.from(map.values()).sort(sorter);
      const selected = filtersModel.getProperty("/selectedVehicles") || [];
      const filteredSelected = selected.filter((key) => map.has(String(key)));

      filtersModel.setProperty("/vehicles", vehicles);
      filtersModel.setProperty("/selectedVehicles", filteredSelected);

      const control = this.byId("inpVeiculo");
      if (control && typeof control.setSelectedKeys === "function") {
        control.setSelectedKeys(filteredSelected);
      }
    },

    _ensureCategoriasCombo: function () {
      const filtersModel = this.getView().getModel("FleetFilters");
      if (!filtersModel) { return; }

      const rawVehicles = (this.getView().getModel("vm")?.getProperty("/veiculos") || []);
      const map = new Map();

      rawVehicles.forEach((row) => {
        const catRaw = (row && row.CATEGORIA != null && row.CATEGORIA !== "") ? row.CATEGORIA : null;
        if (!catRaw) { return; }
        const key = String(catRaw);
        if (!map.has(key)) {
          map.set(key, {
            key,
            text: key,
            group: row?.GRUPO || row?.grupo || ""
          });
        }
      });

      const sorter = (a, b) => {
        try { return a.text.localeCompare(b.text, "pt-BR"); } catch(e) { return a.text < b.text ? -1 : (a.text > b.text ? 1 : 0); }
      };

      const categories = Array.from(map.values()).sort(sorter);
      const selected = filtersModel.getProperty("/selectedCategories") || [];
      const filteredSelected = selected.filter((key) => map.has(String(key)));

      filtersModel.setProperty("/categories", categories);
      filtersModel.setProperty("/selectedCategories", filteredSelected);

      const control = this.byId("segCat");
      if (control && typeof control.setSelectedKeys === "function") {
        control.setSelectedKeys(filteredSelected);
      }
    },

    _getSelectedVehicleKeys: function () {
      const ctrl = this.byId("inpVeiculo");
      let keys = [];
      if (ctrl && typeof ctrl.getSelectedKeys === "function") {
        keys = ctrl.getSelectedKeys() || [];
      }
      if (!Array.isArray(keys) || keys.length === 0) {
        const fromModel = this._filtersModel?.getProperty("/selectedVehicles");
        keys = Array.isArray(fromModel) ? fromModel : [];
      }
      const dedup = Array.from(new Set((keys || []).map((k) => String(k))));
      return dedup;
    },

    _getSelectedCategoryKeys: function () {
      const ctrl = this.byId("segCat");
      let keys = [];
      if (ctrl && typeof ctrl.getSelectedKeys === "function") {
        keys = ctrl.getSelectedKeys() || [];
      }
      if (!Array.isArray(keys) || keys.length === 0) {
        const fromModel = this._filtersModel?.getProperty("/selectedCategories");
        keys = Array.isArray(fromModel) ? fromModel : [];
      }
      const dedup = Array.from(new Set((keys || []).map((k) => String(k))));
      return dedup;
    },

    _updateReliabilityForVehicles: async function (rangeObj) {
      const vmModel = this.getView().getModel("vm");
      if (!vmModel) { return; }
      const vehicles = vmModel.getProperty("/veiculos") || [];
      if (!Array.isArray(vehicles) || vehicles.length === 0) {
        vmModel.refresh(true);
        return;
      }
      const from = (rangeObj && rangeObj.from instanceof Date) ? rangeObj.from : null;
      const to   = (rangeObj && rangeObj.to   instanceof Date) ? rangeObj.to   : null;
      const rangePayload = { from, to };

      const tasks = vehicles.map(async (vehicle) => {
        const vehId = String(vehicle.equnr || vehicle.veiculo || vehicle.id || "").trim();
        if (!vehId) {
          vehicle.mtbf = 0;
          vehicle.mtbfFmt = vehicle.mtbfFmt || "-";
          vehicle.mttr = 0;
          vehicle.mttrFmt = vehicle.mttrFmt || "-";
          vehicle.disponibilidade = vehicle.disponibilidade || 0;
          vehicle.disponibilidadeFmt = vehicle.disponibilidadeFmt || "-";
          vehicle.falhas = vehicle.falhas || 0;
          vehicle.kmPorQuebra = vehicle.kmPorQuebra || 0;
          vehicle.kmPorQuebraFmt = vehicle.kmPorQuebraFmt || "-";
          vehicle.kmPerFailureFmt = vehicle.kmPerFailureFmt || vehicle.kmPorQuebraFmt || "-";
          vehicle.hrPorQuebra = vehicle.hrPorQuebra || 0;
          vehicle.hrPorQuebraFmt = vehicle.hrPorQuebraFmt || "-";
          vehicle.hrPerFailureFmt = vehicle.hrPerFailureFmt || vehicle.hrPorQuebraFmt || "-";
          vehicle.proximaQuebraKm = vehicle.proximaQuebraKm || 0;
          vehicle.proximaQuebraKmFmt = vehicle.proximaQuebraKmFmt || "-";
          vehicle.proximaQuebraHr = vehicle.proximaQuebraHr || 0;
          vehicle.proximaQuebraHrFmt = vehicle.proximaQuebraHrFmt || "-";
          vehicle.downtimeTotalFmt = vehicle.downtimeTotalFmt || "0h00";
          return;
        }
        try {
          const rel = await ReliabilityService.mergeDataPorVeiculo({ vehicleId: vehId, range: rangePayload });
          const metrics = (rel && rel.metrics) ? Object.assign({}, rel.metrics) : null;
          if (metrics) {
            if (metrics.kmPorQuebraFmt && !metrics.kmPerFailureFmt) { metrics.kmPerFailureFmt = metrics.kmPorQuebraFmt; }
            if (metrics.hrPorQuebraFmt && !metrics.hrPerFailureFmt) { metrics.hrPerFailureFmt = metrics.hrPorQuebraFmt; }
            if (metrics.downtimeFmt && !metrics.downtimeTotalFmt) { metrics.downtimeTotalFmt = metrics.downtimeFmt; }
            vehicle.reliability = metrics;
            vehicle.mtbf = metrics.mtbf || 0;
            vehicle.mtbfFmt = metrics.mtbfFmt || "-";
            vehicle.mttr = metrics.mttr || 0;
            vehicle.mttrFmt = metrics.mttrFmt || "-";
            vehicle.disponibilidade = metrics.disponibilidade || 0;
            vehicle.disponibilidadeFmt = metrics.disponibilidadeFmt || "-";
            vehicle.falhas = metrics.falhas || 0;
            vehicle.kmPorQuebra = metrics.kmPorQuebra || 0;
            vehicle.kmPorQuebraFmt = metrics.kmPorQuebraFmt || "-";
            vehicle.kmPerFailureFmt = metrics.kmPerFailureFmt || metrics.kmPorQuebraFmt || "-";
            vehicle.hrPorQuebra = metrics.hrPorQuebra || 0;
            vehicle.hrPorQuebraFmt = metrics.hrPorQuebraFmt || "-";
            vehicle.hrPerFailureFmt = metrics.hrPerFailureFmt || metrics.hrPorQuebraFmt || "-";
            vehicle.proximaQuebraKm = metrics.proximaQuebraKm || 0;
            vehicle.proximaQuebraKmFmt = metrics.proximaQuebraKmFmt || "-";
            vehicle.proximaQuebraHr = metrics.proximaQuebraHr || 0;
            vehicle.proximaQuebraHrFmt = metrics.proximaQuebraHrFmt || "-";
            vehicle.downtimeTotalFmt = metrics.downtimeFmt || metrics.downtimeTotalFmt || "0h00";
          } else {
            vehicle.reliability = { };
            vehicle.mtbf = 0; vehicle.mtbfFmt = "-";
            vehicle.mttr = 0; vehicle.mttrFmt = "-";
            vehicle.disponibilidade = 0; vehicle.disponibilidadeFmt = "-";
            vehicle.falhas = 0;
            vehicle.kmPorQuebra = 0; vehicle.kmPorQuebraFmt = "-"; vehicle.kmPerFailureFmt = "-";
            vehicle.hrPorQuebra = 0; vehicle.hrPorQuebraFmt = "-"; vehicle.hrPerFailureFmt = "-";
            vehicle.proximaQuebraKm = 0; vehicle.proximaQuebraKmFmt = "-";
            vehicle.proximaQuebraHr = 0; vehicle.proximaQuebraHrFmt = "-";
            vehicle.downtimeTotalFmt = "0h00";
          }
        } catch (err) {
          try { console.warn('[Main._updateReliabilityForVehicles] Falha ao calcular para ' + vehId, err); } catch (_) {}
          vehicle.reliability = vehicle.reliability || {};
          vehicle.mtbf = 0; vehicle.mtbfFmt = "-";
          vehicle.mttr = 0; vehicle.mttrFmt = "-";
          vehicle.disponibilidade = 0; vehicle.disponibilidadeFmt = "-";
          vehicle.falhas = 0;
          vehicle.kmPorQuebra = 0; vehicle.kmPorQuebraFmt = "-"; vehicle.kmPerFailureFmt = "-";
          vehicle.hrPorQuebra = 0; vehicle.hrPorQuebraFmt = "-"; vehicle.hrPerFailureFmt = "-";
          vehicle.proximaQuebraKm = 0; vehicle.proximaQuebraKmFmt = "-";
          vehicle.proximaQuebraHr = 0; vehicle.proximaQuebraHrFmt = "-";
          vehicle.downtimeTotalFmt = "0h00";
        }
      });

      await Promise.all(tasks);
      vmModel.refresh(true);
    },

    _applyTableFilters: function () {
      const oBinding = this.oTbl && this.oTbl.getBinding("rows");
      if (!oBinding) return;

      const aFilters = [];

      const vehicleKeys = this._getSelectedVehicleKeys();
      if (vehicleKeys.length > 0) {
        const vehFilters = vehicleKeys.map((key) => new Filter("equnr", FilterOperator.EQ, key));
        if (vehFilters.length === 1) {
          aFilters.push(vehFilters[0]);
        } else {
          aFilters.push(new Filter({ filters: vehFilters, and: false }));
        }
      }

      const categoryKeys = this._getSelectedCategoryKeys();
      if (categoryKeys.length > 0) {
        const catFilters = categoryKeys.map((key) => new Filter("CATEGORIA", FilterOperator.EQ, key));
        if (catFilters.length === 1) {
          aFilters.push(catFilters[0]);
        } else {
          aFilters.push(new Filter({ filters: catFilters, and: false }));
        }
      }

      oBinding.filter(aFilters);
    },

    _getFilteredVehiclesArray: function () {
      const vm = this.getView().getModel("vm");
      const all = (vm && vm.getProperty("/veiculos")) || [];

      const vehicleKeys = this._getSelectedVehicleKeys();
      const categoryKeys = this._getSelectedCategoryKeys();

      return all.filter((row) => {
        const vehicleId = row && (row.equnr || row.veiculo || row.id);
        const categoryId = row && row.CATEGORIA;
        const byVeh = vehicleKeys.length === 0 ? true : vehicleKeys.includes(String(vehicleId));
        const byCat = categoryKeys.length === 0 ? true : categoryKeys.includes(String(categoryId || ""));
        return byVeh && byCat;
      });
    },

    _updateKpisFromList: function (list) {
      let totLitros = 0, totCombR$ = 0, totMatR$ = 0;
      list.forEach((v) => {
        totLitros += Number(v.combustivelLitrosAgg || 0);
        totCombR$ += Number(v.combustivelValorAgg || 0);
        totMatR$  += Number(v.custoMaterialAgg   || 0);
      });

      const precoMedio = (totLitros > 0) ? (totCombR$ / totLitros) : 0;

      this.oKpi.setData({
        totalLitrosFmt: this.formatter.fmtLitros(totLitros),
        gastoCombustivelFmt: this.formatter.fmtBrl(totCombR$),
        custoMateriaisFmt: this.formatter.fmtBrl(totMatR$),
        precoMedioFmt: this.formatter.fmtNum(precoMedio),
        resumoCombFmt: "Comb: " + this.formatter.fmtBrl(totCombR$),
        resumoLitrosFmt: "Litros: " + this.formatter.fmtLitros(totLitros),
        resumoMatFmt: "Mat/Serv: " + this.formatter.fmtBrl(totMatR$),
        resumoPrecoFmt: "PreÃ§o MÃ©dio: " + this.formatter.fmtNum(precoMedio) + " R$/L"
      }, true);
    },

    _onDowntimeReady: async function () {
      try {
        await this._updateReliabilityForVehicles(this._currentRangeObj());
        this._recalcAndRefresh();
      } catch (e) {
        // ignore failures triggered during teardown
      }
    },

    onExit: function () {
      if (this._eventBus && this._eventBus.unsubscribe) {
        this._eventBus.unsubscribe("downtime", "ready", this._onDowntimeReady, this);
      }
    },

    _recalcAndRefresh: function () {
      this._applyTableFilters();
      this.byId("tbl")?.getBinding("rows")?.refresh(true);

      const vehicleKeys = this._getSelectedVehicleKeys();
      const categoryKeys = this._getSelectedCategoryKeys();
      KpiService.recalc(this.getView(), { vehicleKeys, categoryKeys });
    },

    _todayPair: function () {
      const now = new Date();
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
      return [t, t];
    },

    _applyMainDatePref: function () {
      try {
        const drs = this.byId("drs");
        if (!drs) return;
        const s = this.getOwnerComponent().getModel && this.getOwnerComponent().getModel("settings");
        const pref = s && s.getProperty ? s.getProperty("/mainDatePref") : null;
        let d1d2;
        if (pref === "today") d1d2 = this._todayPair();
        else d1d2 = this._yesterdayPair();
        drs.setDateValue(d1d2[0]);
        drs.setSecondDateValue(d1d2[1]);
      } catch(e){}
    },

    _yesterdayPair: function () {
      const now = new Date();
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0, 0);
      return [y, y];
    },

    _setDefaultYesterdayOnDRS: function () {
      const drs = this.byId("drs");
      if (!drs) return;
      const [d1, d2] = this._yesterdayPair();
      drs.setDateValue(d1);
      drs.setSecondDateValue(d2);
    },

    _currentRangeObj: function () {
      const drs = this.byId("drs");
      const d1 = drs?.getDateValue?.();
      const d2 = drs?.getSecondDateValue?.();
      const [y1, y2] = this._yesterdayPair();
      const range = { from: d1 || y1, to: d2 || d1 || y2 };
      return range;
    },

    _monthsSpan: function (d1, d2) {
      if (!(d1 instanceof Date) || !(d2 instanceof Date)) return 0;
      const y1 = d1.getFullYear();
      const m1 = d1.getMonth(); // 0..11
      const y2 = d2.getFullYear();
      const m2 = d2.getMonth(); // 0..11
      return (y2 - y1) * 12 + (m2 - m1) + 1; // inclusivo
    },

    _reloadDistinctOnly: function () {
      const range = this._currentRangeObj();
      const aggregate = !!this.getView().getModel("vm").getProperty("/aggregateOn");
      return VehiclesService.loadVehiclesDistinctForRange(this.getView(), range, {
        aggregate: aggregate,
        targetPath: "vm>/veiculos"
      }).then(() => {});
    }
  });
});















