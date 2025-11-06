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
  "com/skysinc/frota/frota/services/ReliabilityService",
  "com/skysinc/frota/frota/model/FilterState",
  "com/skysinc/frota/frota/util/FilterBuilder",
  "com/skysinc/frota/frota/util/Storage",
  "com/skysinc/frota/frota/util/KpiUpdater",
  "com/skysinc/frota/frota/util/NotificationService",
  "com/skysinc/frota/frota/model/NotificationModel"
], function (
  Controller, JSONModel, Filter, FilterOperator, Fragment, MessageToast, MessageBox,
  formatter, FilterUtil, MaterialsService, FuelService, KpiService, ODataMovtos, VehiclesService, Aggregation, ReliabilityService,
  FilterState, FilterBuilder, Storage, KpiUpdater, NotificationService, NotificationModel
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

  function debounce(fn, delay) {
    let handle;
    return function () {
      const ctx = this;
      const args = arguments;
      clearTimeout(handle);
      handle = setTimeout(function () {
        fn.apply(ctx, args);
      }, delay);
    };
  }

  function createSummarySkeleton() {
    const defaultTag = { status: "None", text: "Status", value: "OK", tooltip: "" };
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

  return Controller.extend("com.skysinc.frota.frota.controller.Main", {
    formatter: formatter,

    onInit: function () {
      this.oTbl = this.byId("tbl");
      this._isSummaryReady = false;

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
        resumoPrecoFmt: "Preco medio: 0,00 R$/L"
      });

      const persistedFilters = Storage.load() || {};
      this._oFilterModel = FilterState.create(persistedFilters);
      this.getView().setModel(this.oKpi, "kpi");
      this._summaryModel = new JSONModel(createSummarySkeleton());
      this.getView().setModel(this._summaryModel, "FleetSummary");
      this.getView().setModel(this._oFilterModel);

      this._notifModel = NotificationModel.create();
      this.getView().setModel(this._notifModel, "notifModel");
      this._notifPopover = null;
      NotificationService.init({
        view: this.getView(),
        component: this.getOwnerComponent(),
        intervalMs: 60000,
        model: this._notifModel
      }).catch((err) => {
        try {
          console.warn("[Main] Notificacoes indisponiveis", err);
        } catch (e) {
          // ignore console availability issues
        }
      });

      this._applyFiltersDebounced = debounce(this._applyFilters.bind(this), 300);

      this._applyHashToState();
      this._ensureDefaultDateRange();
      this._applyStateToControls();
      Storage.save(this._oFilterModel.getData());

      try {
        const router = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (router && router.getRoute) {
          const r = router.getRoute("RouteMain");
          if (r && r.attachPatternMatched) {
            r.attachPatternMatched(() => {
              this._applyHashToState(true);
              this._ensureDefaultDateRange(true);
              this._applyStateToControls();
              this._applyFilters();
            });
          }
        }
      } catch (e) {
        // router not available, ignore
      }

      try {
        const settingsModel = this.getOwnerComponent().getModel && this.getOwnerComponent().getModel("settings");
        if (settingsModel && settingsModel.attachPropertyChange) {
          settingsModel.attachPropertyChange((ev) => {
            try {
              const path = ev && ev.getParameter && ev.getParameter("path");
              if (path === "/mainDatePref") {
                this._ensureDefaultDateRange(true);
                this._applyStateToControls();
                this._applyFilters();
              }
            } catch (err) {
              // ignore property change issues
            }
          });
        }
      } catch (err) {
        // ignore settings binding issues
      }

      this._eventBus = sap.ui.getCore().getEventBus();
      if (this._eventBus && this._eventBus.subscribe) {
        this._eventBus.subscribe("downtime", "ready", this._onDowntimeReady, this);
      }

      const doInitAsync = async () => {
        try {
          await this._applyFilters();
        } catch (e) {
          try {
            sap.m.MessageToast.show("Falha na inicializacao assincrona.");
          } catch (_) {
            // noop
          }
        }
      };
      void doInitAsync();
    },
    onFilterChanged: function () {
      const view = this.getView();
      const model = this._oFilterModel;
      if (!model || !view) {
        return;
      }

      const categoriesCtrl = view.byId("filterCategories");
      const vehiclesCtrl = view.byId("filterVehicles");
      const drs = view.byId("filterDateRange");
      const categories = categoriesCtrl && categoriesCtrl.getSelectedKeys ? categoriesCtrl.getSelectedKeys() : [];
      const vehicles = vehiclesCtrl && vehiclesCtrl.getSelectedKeys ? vehiclesCtrl.getSelectedKeys() : [];
      const dateFrom = drs && drs.getDateValue ? drs.getDateValue() : null;
      const dateTo = drs && drs.getSecondDateValue ? drs.getSecondDateValue() : null;

      model.setProperty("/selection/categories", Array.isArray(categories) ? categories : []);
      model.setProperty("/selection/vehicles", Array.isArray(vehicles) ? vehicles : []);
      model.setProperty("/selection/dateFrom", dateFrom || null);
      model.setProperty("/selection/dateTo", dateTo || null);

      Storage.save(model.getData());
      this._updateHashFromState();
      this._applyFiltersDebounced();
    },

    _applyFilters: async function () {
      try {
        this._isSummaryReady = false;
        await this._reloadDistinctOnly();
        const range = this._currentRangeArray();
        if (Array.isArray(range)) {
          try {
            const comp = this.getOwnerComponent && this.getOwnerComponent();
            if (comp && typeof comp.loadAllHistoryInRange === "function") {
              const months = this._monthsSpan(range[0], range[1]);
              if (months > 12) {
                MessageToast.show("Periodo selecionado muito grande (" + months + " meses). Maximo: 12.");
              } else {
                await comp.loadAllHistoryInRange(range[0], range[1]);
              }
            }
          } catch (err) {
            // ignore history load errors
          }
          await Aggregation.recalcAggByRange(this.getView(), range, this._getOsFilterPrefs());
        }
        await this._updateReliabilityForVehicles(this._currentRangeObj());
        this._refreshFilterLists();
        this._isSummaryReady = true;
        this._recalcAndRefresh();
        KpiUpdater.refresh(this.getView(), this._oFilterModel.getData());
      } catch (error) {
        MessageToast.show("Falha ao recarregar.");
      }
    },

    onClearFilters: async function () {
      if (!this._oFilterModel) {
        return;
      }
      this._oFilterModel.setProperty("/selection/categories", []);
      this._oFilterModel.setProperty("/selection/vehicles", []);

      this._ensureDefaultDateRange(true);
      this._applyStateToControls();
      Storage.save(this._oFilterModel.getData());
      this._updateHashFromState();
      await this._applyFilters();
    },

    onOpenFilterConfig: function () {
      if (typeof this.onOpenSettings === "function") {
        this.onOpenSettings();
        return;
      }
      MessageToast.show("Configuracoes nao disponiveis.");
    },

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
      sap.m.MessageToast.show("Rota 'settings' nao encontrada. Verifique o routing no manifest.json.");
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
        const range = this._currentRangeArray();
        const rangeObj = this._currentRangeObj();
        const osFilterPrefs = this._getOsFilterPrefs();
        const useUnifiedReliability = this._isUnifiedReliabilityEnabled();
        const metrics = {
          kmRodados: Number(ctxObj?.kmRodadosAgg || 0),
          horasRodadas: Number(ctxObj?.hrRodadosAgg || 0),
          totalHorasPeriodo: Number(ctxObj?.totalHorasPeriodo || 0),
          totalHorasIndisponiveis: Number(ctxObj?.totalHorasIndisponiveis || ctxObj?.downtimeHorasRange || 0),
          totalHorasDisponiveis: Number(ctxObj?.totalHorasDisponiveis || 0),
          downtimeEventos: Number(ctxObj?.downtimeEventosRange || 0),
          osCount: Number(ctxObj?.osCountRange || 0),
          falhas: Number(ctxObj?.osCountRange || 0),
          horasParadasFmt: ctxObj?.horasParadasFmt || "",
          disponibilidadeFmt: ctxObj?.disponibilidadeFmt || "",
          mtbfFmt: ctxObj?.mtbfFmt || "",
          mttrFmt: ctxObj?.mttrFmt || ""
        };
        let reliabilityMetrics = {};
        let unifiedOsMap = null;
        const hasRange = rangeObj && rangeObj.from instanceof Date && rangeObj.to instanceof Date;
        if (equnr && useUnifiedReliability && hasRange) {
          try {
            unifiedOsMap = await ReliabilityService.fetchOsUnifiedByVehiclesAndRange({
              vehicles: [equnr],
              dateFrom: rangeObj.from,
              dateTo: rangeObj.to,
              tiposOS: osFilterPrefs.showAllOS ? undefined : osFilterPrefs.allowedOsTypes
            });
            const summaryMap = ReliabilityService.buildUnifiedReliabilityByVehicleFromMap(unifiedOsMap, {
              vehicles: [equnr],
              dateFrom: rangeObj.from,
              dateTo: rangeObj.to
            }) || {};
            const summary = summaryMap[equnr];
            if (summary) {
              reliabilityMetrics = Object.assign({}, summary);
            }
          } catch (err) {
            try { console.warn('[Main.onOpenOSDialog] Unified reliability metrics unavailable', err); } catch (_) {}
          }
        }
        if (equnr && (!Object.keys(reliabilityMetrics).length || !useUnifiedReliability)) {
          try {
            const rel = await ReliabilityService.mergeDataPorVeiculo({
              vehicleId: equnr,
              range: rangeObj,
              showAllOS: osFilterPrefs.showAllOS,
              allowedOsTypes: osFilterPrefs.allowedOsTypes
            });
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
        const preloadedOsData = useUnifiedReliability && unifiedOsMap ? { map: unifiedOsMap } : null;
        sap.ui.require(["com/skysinc/frota/frota/controller/OSDialog"], (OSDlg) => {
          OSDlg.open(this.getView(), {
            equnr,
            range,
            titulo: equnr ? ("OS - " + equnr) : "OS",
            metrics: mergedMetrics,
            osData: preloadedOsData
          });
        });
      } catch (e) {
        MessageToast.show("Falha ao abrir OS.");
      }
    },

    // Abre a visualizacao/preview da IW38 (mock local por enquanto)
    onOpenIW38Preview: function (oEvent) {
      try {
        const ctxObj = oEvent?.getSource?.()?.getBindingContext("vm")?.getObject?.();
        // Usa alguma possivel ordem vinda do contexto, senao um valor padrao do mock
        const equnr = String(ctxObj?.equnr || ctxObj?.veiculo || "");
        const oRouter = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (oRouter && oRouter.navTo) {
          oRouter.navTo("RouteIW38", { equnr });
          return;
        }
      } catch (e) {
        // segue para fallback
      }
      sap.m.MessageToast.show("Rota 'RouteIW38' nao encontrada. Verifique o routing no manifest.json.");
    },

    onOpenMateriais: function (oEvent) {
      const item = oEvent.getSource().getBindingContext("vm").getObject();
      return MaterialsService.openDialog(
        this.getView(),
        { equnr: item.equnr, descricaoVeiculo: item.eqktx },
        this._currentRangeArray()
      );
    },

    onExportMateriais: function () {
      if (!this._dlgModel) { MessageToast.show("Abra o dialogo de materiais primeiro."); return; }
      sap.ui.require(["com/skysinc/frota/frota/services/MaterialsService"], (Svc) => {
        Svc.exportCsv(this._dlgModel, this.byId("filterDateRange"));
      });
    },

    onPrintMateriais: function () {
      const dlg = this.byId("dlgMateriais");
      if (!dlg) { MessageToast.show("Abra o dialogo de materiais primeiro."); return; }
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
      const range = this._currentRangeObj();
      const start = range.from instanceof Date ? range.from : new Date();
      const end = range.to instanceof Date ? range.to : start;
      return {
        startIso: this._toIso(start, false),
        endIso:   this._toIso(end, true)
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
        sap.m.MessageToast.show("Selecione um veiculo valido.");
        return;
      }

      const drs = this.byId("filterDateRange");
      if (!drs) {
        sap.m.MessageToast.show("Componente de periodo nao encontrado.");
        return;
      }
      const range = this._currentRangeArray();

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
            else MessageToast.show("Nao foi possivel salvar os limites.");
          });
      } catch (e) {
        MessageToast.show("Nao foi possivel salvar os limites.");
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



    _buildQueryString: function () {
      if (!this._oFilterModel) {
        return "";
      }
      const selection = this._oFilterModel.getProperty("/selection") || {};
      const params = new URLSearchParams();
      const categories = Array.isArray(selection.categories) ? selection.categories.filter(Boolean) : [];
      if (categories.length) {
        params.set("cat", categories.join(","));
      }
      const vehicles = Array.isArray(selection.vehicles) ? selection.vehicles.filter(Boolean) : [];
      if (vehicles.length) {
        params.set("veh", vehicles.join(","));
      }
      const formatDate = function (date) {
        if (!(date instanceof Date) || isNaN(date)) {
          return "";
        }
        return date.toISOString().slice(0, 10);
      };
      const from = formatDate(selection.dateFrom);
      const to = formatDate(selection.dateTo);
      if (from) {
        params.set("from", from);
      }
      if (to) {
        params.set("to", to);
      }
      return params.toString();
    },

    _applyHashToState: function () {
      if (!this._oFilterModel) {
        return;
      }
      try {
        const hashChanger = sap.ui.core.routing.HashChanger.getInstance();
        const rawHash = hashChanger && typeof hashChanger.getHash === "function" ? hashChanger.getHash() : "";
        let queryString = "";
        if (rawHash && rawHash.indexOf("?") !== -1) {
          queryString = rawHash.slice(rawHash.indexOf("?") + 1);
        } else {
          queryString = rawHash || "";
        }
        if (queryString.indexOf("query=") === 0) {
          queryString = queryString.slice("query=".length);
        }
        this._lastHashParams = queryString;
        const params = new URLSearchParams(queryString);
        const parseKeys = function (value) {
          if (!value) {
            return [];
          }
          return value.split(",").map(function (item) {
            return item.trim();
          }).filter(Boolean);
        };
        const parseDate = function (value) {
          if (!value) {
            return null;
          }
          const parts = value.split("-");
          if (parts.length !== 3) {
            return null;
          }
          const year = Number(parts[0]);
          const month = Number(parts[1]) - 1;
          const day = Number(parts[2]);
          if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
            return null;
          }
          return new Date(year, month, day, 0, 0, 0, 0);
        };
        this._oFilterModel.setProperty("/selection/categories", parseKeys(params.get("cat")));
        this._oFilterModel.setProperty("/selection/vehicles", parseKeys(params.get("veh")));
        const fromDate = parseDate(params.get("from"));
        const toDate = parseDate(params.get("to"));
        if (fromDate) {
          this._oFilterModel.setProperty("/selection/dateFrom", fromDate);
        }
        if (toDate) {
          this._oFilterModel.setProperty("/selection/dateTo", toDate);
        }
        Storage.save(this._oFilterModel.getData());
      } catch (err) {
        // ignore malformed hash values
      }
    },

    _updateHashFromState: function () {
      try {
        const queryString = this._buildQueryString();
        if (this._lastHashParams === queryString) {
          return;
        }
        this._lastHashParams = queryString;
        const router = sap.ui.core.UIComponent.getRouterFor(this);
        if (router && router.navTo) {
          router.navTo("RouteMain", { query: queryString }, true);
        }
      } catch (err) {
        // best-effort routing update
      }
    },

    _refreshFilterLists: function () {
      if (!this._oFilterModel) {
        return;
      }
      this._ensureVehiclesCombo();
      this._ensureCategoriasCombo();
      this._applyStateToControls();
      Storage.save(this._oFilterModel.getData());
    },

    _ensureVehiclesCombo: function () {
      if (!this._oFilterModel) {
        return;
      }
      const vmModel = this.getView().getModel("vm");
      const rawVehicles = (vmModel && vmModel.getProperty("/veiculos")) || [];
      const map = new Map();

      rawVehicles.forEach((row) => {
        const key = row?.equnr || row?.veiculo || row?.id;
        if (!key && key !== 0) {
          return;
        }
        const keyStr = String(key);
        if (!map.has(keyStr)) {
          const description = row?.eqktx || row?.DESCR || row?.descricao || "";
          map.set(keyStr, {
            key: keyStr,
            text: description ? keyStr + " - " + description : keyStr
          });
        }
      });

      const sorter = (a, b) => {
        try {
          return a.text.localeCompare(b.text, "pt-BR");
        } catch (e) {
          return a.text < b.text ? -1 : (a.text > b.text ? 1 : 0);
        }
      };

      const vehicles = Array.from(map.values()).sort(sorter);
      const currentSelection = this._oFilterModel.getProperty("/selection/vehicles") || [];
      const validSelection = currentSelection.filter((key) => map.has(String(key)));

      this._oFilterModel.setProperty("/lists/vehicles", vehicles);
      this._oFilterModel.setProperty("/selection/vehicles", validSelection.slice());

      const control = this.byId("filterVehicles");
      if (control && typeof control.setSelectedKeys === "function") {
        control.setSelectedKeys(validSelection);
      }
    },

    _ensureCategoriasCombo: function () {
      if (!this._oFilterModel) {
        return;
      }
      const vmModel = this.getView().getModel("vm");
      const rawVehicles = (vmModel && vmModel.getProperty("/veiculos")) || [];
      const map = new Map();

      rawVehicles.forEach((row) => {
        const category = row && row.CATEGORIA != null ? row.CATEGORIA : null;
        if (category == null || category === "") {
          return;
        }
        const key = String(category);
        if (!map.has(key)) {
          const group = row?.GRUPO || row?.grupo || "";
          map.set(key, {
            key: key,
            text: key,
            group: group
          });
        }
      });

      const sorter = (a, b) => {
        try {
          return a.text.localeCompare(b.text, "pt-BR");
        } catch (e) {
          return a.text < b.text ? -1 : (a.text > b.text ? 1 : 0);
        }
      };

      const categories = Array.from(map.values()).sort(sorter);
      const currentSelection = this._oFilterModel.getProperty("/selection/categories") || [];
      const validSelection = currentSelection.filter((key) => map.has(String(key)));

      this._oFilterModel.setProperty("/lists/categories", categories);
      this._oFilterModel.setProperty("/selection/categories", validSelection.slice());

      const control = this.byId("filterCategories");
      if (control && typeof control.setSelectedKeys === "function") {
        control.setSelectedKeys(validSelection);
      }
    },

    _getSelectedVehicleKeys: function () {
      const normalised = this._oFilterModel
        ? FilterBuilder.normaliseSelection(this._oFilterModel.getProperty("/selection"))
        : FilterBuilder.normaliseSelection();
      const arr = Array.isArray(normalised.vehicles) ? normalised.vehicles : [];
      return Array.from(new Set(arr.map(function (key) { return String(key); })));
    },

    _getSelectedCategoryKeys: function () {
      const normalised = this._oFilterModel
        ? FilterBuilder.normaliseSelection(this._oFilterModel.getProperty("/selection"))
        : FilterBuilder.normaliseSelection();
      const arr = Array.isArray(normalised.categories) ? normalised.categories : [];
      return Array.from(new Set(arr.map(function (key) { return String(key); })));
    },

    _getOsFilterPrefs: function () {
      let showAllOS = true;
      let allowedOsTypes = [];
      try {
        const component = this.getOwnerComponent && this.getOwnerComponent();
        const settingsModel = component && component.getModel && component.getModel("settings");
        if (settingsModel && typeof settingsModel.getProperty === "function") {
          showAllOS = !!settingsModel.getProperty("/showAllOS");
          const selected = settingsModel.getProperty("/osTypes");
          if (Array.isArray(selected)) {
            allowedOsTypes = selected.slice();
          }
        }
      } catch (err) {
        // ignore inability to resolve settings
      }
      return { showAllOS, allowedOsTypes };
    },

    _isUnifiedReliabilityEnabled: function () {
      try {
        const component = this.getOwnerComponent && this.getOwnerComponent();
        const settingsModel = component && component.getModel && component.getModel("settings");
        if (!settingsModel || typeof settingsModel.getProperty !== "function") {
          return true;
        }
        const flag = settingsModel.getProperty("/reliability/unifiedPipeline");
        return flag !== false;
      } catch (err) {
        return true;
      }
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
      const osFilterPrefs = this._getOsFilterPrefs();

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
          vehicle.osCountRange = 0;
          return;
        }
        try {
          const rel = await ReliabilityService.mergeDataPorVeiculo({
            vehicleId: vehId,
            range: rangePayload,
            showAllOS: osFilterPrefs.showAllOS,
            allowedOsTypes: osFilterPrefs.allowedOsTypes
          });
          const metrics = (rel && rel.metrics) ? Object.assign({}, rel.metrics) : null;
          const osEvents = (rel && Array.isArray(rel.osEventos)) ? rel.osEventos : [];
          const osEventsCount = Number.isFinite(osEvents.length) ? osEvents.length : 0;
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
            vehicle.osCountRange = osEventsCount;
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
            vehicle.osCountRange = 0;
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
          vehicle.osCountRange = 0;
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
        resumoPrecoFmt: "Preco medio: " + this.formatter.fmtNum(precoMedio) + " R$/L"
      }, true);
    },

    _onDowntimeReady: async function () {
      try {
        if (!this._isSummaryReady) {
          return;
        }
        await this._updateReliabilityForVehicles(this._currentRangeObj());
        this._recalcAndRefresh();
      } catch (e) {
        // ignore failures triggered during teardown
      }
    },

    onOpenNotifications: function (oEvent) {
      const source = oEvent && oEvent.getSource ? oEvent.getSource() : this.byId("btnNotifications");
      const openPopover = () => {
        if (!this._notifPopover) {
          return;
        }
        this._notifPopover.openBy(source);
        NotificationService.toggleOpen(true);
        NotificationService.fetch(true).catch(() => {
          // ignore fetch errors while opening
        });
      };
      if (!this._notifPopover) {
        Fragment.load({
          id: this.getView().getId(),
          name: "com.skysinc.frota.frota.fragments.NotificationsPopover",
          controller: this
        }).then((popover) => {
          this._notifPopover = popover;
          this.getView().addDependent(popover);
          openPopover();
        });
      } else if (this._notifPopover.isOpen()) {
        this._notifPopover.close();
      } else {
        openPopover();
      }
    },

    onNotificationsOpened: function () {
      NotificationService.toggleOpen(true);
    },

    onNotificationsClosed: function () {
      NotificationService.toggleOpen(false);
    },

    onNotificationPress: function (oEvent) {
      const source = oEvent.getSource && oEvent.getSource();
      const context = source && source.getBindingContext && source.getBindingContext("notifModel");
      if (!context) {
        return;
      }
      const data = context.getObject();
      if (!data) {
        return;
      }
      NotificationService.markAsRead(data.id);
      if (data.actionRoute) {
        try {
          const router = this.getOwnerComponent().getRouter();
          if (router && router.navTo) {
            router.navTo(data.actionRoute, data.actionParams || {});
          }
        } catch (err) {
          MessageToast.show(this.getView().getModel("i18n").getResourceBundle().getText("notif.nav.error"));
        }
      }
      if (this._notifPopover) {
        this._notifPopover.close();
      }
    },

    onNotificationMarkRead: function (oEvent) {
      const source = oEvent.getSource && oEvent.getSource();
      const context = source && source.getBindingContext && source.getBindingContext("notifModel");
      if (!context) {
        return;
      }
      const data = context.getObject();
      if (!data) {
        return;
      }
      NotificationService.markAsRead(data.id);
    },

    onNotificationDismiss: function (oEvent) {
      const source = oEvent.getSource && oEvent.getSource();
      const context = source && source.getBindingContext && source.getBindingContext("notifModel");
      if (!context) {
        return;
      }
      const data = context.getObject();
      if (!data) {
        return;
      }
      NotificationService.markAsRead(data.id);
      this._removeNotification(data.id);
    },

    onNotificationMarkAll: function () {
      NotificationService.markAll();
    },

    onNotificationClear: function () {
      NotificationService.clearAll();
    },

    _removeNotification: function (id) {
      if (!this._notifModel) {
        return;
      }
      const remaining = (this._notifModel.getProperty("/items") || []).filter(function (item) {
        return item.id !== id;
      });
      this._notifModel.setProperty("/items", remaining);
      const unread = remaining.filter(function (item) {
        return !item.read;
      }).length;
      this._notifModel.setProperty("/unread", unread);
    },

    onExit: function () {
      if (this._eventBus && this._eventBus.unsubscribe) {
        this._eventBus.unsubscribe("downtime", "ready", this._onDowntimeReady, this);
      }
      if (this._notifPopover) {
        this._notifPopover.destroy();
        this._notifPopover = null;
      }
    },

    _recalcAndRefresh: function () {
      if (!this._isSummaryReady) {
        return;
      }
      const vmModel = this.getView().getModel("vm");
      const veiculos = vmModel?.getProperty("/veiculos");
      if (!Array.isArray(veiculos)) {
        return;
      }
      this._applyTableFilters();
      this.byId("tbl")?.getBinding("rows")?.refresh(true);

      const vehicleKeys = this._getSelectedVehicleKeys();
      const categoryKeys = this._getSelectedCategoryKeys();
      KpiService.recalc(this.getView(), { vehicleKeys, categoryKeys });
    },

    _todayPair: function () {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return [start, end];
    },

    _yesterdayPair: function () {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      return [start, end];
    },

    _getDefaultDateRangePair: function () {
      let pref = null;
      try {
        const settingsModel = this.getOwnerComponent().getModel && this.getOwnerComponent().getModel("settings");
        pref = settingsModel && settingsModel.getProperty ? settingsModel.getProperty("/mainDatePref") : null;
      } catch (e) {
        // ignore missing settings model
      }
      if (pref === "today") {
        return this._todayPair();
      }
      return this._yesterdayPair();
    },

    _ensureDefaultDateRange: function (force) {
      if (!this._oFilterModel) {
        return;
      }
      const selection = this._oFilterModel.getProperty("/selection") || {};
      let from = selection.dateFrom instanceof Date ? selection.dateFrom : (selection.dateFrom ? new Date(selection.dateFrom) : null);
      let to = selection.dateTo instanceof Date ? selection.dateTo : (selection.dateTo ? new Date(selection.dateTo) : null);
      if (!from || !to || force === true) {
        const pair = this._getDefaultDateRangePair();
        from = pair[0];
        to = pair[1];
      }
      this._oFilterModel.setProperty("/selection/dateFrom", from);
      this._oFilterModel.setProperty("/selection/dateTo", to);
    },

    _applyStateToControls: function () {
      if (!this._oFilterModel) {
        return;
      }
      const selection = this._oFilterModel.getProperty("/selection") || {};
      const categoriesCtrl = this.byId("filterCategories");
      if (categoriesCtrl && typeof categoriesCtrl.setSelectedKeys === "function") {
        categoriesCtrl.setSelectedKeys(selection.categories || []);
      }
      const vehiclesCtrl = this.byId("filterVehicles");
      if (vehiclesCtrl && typeof vehiclesCtrl.setSelectedKeys === "function") {
        vehiclesCtrl.setSelectedKeys(selection.vehicles || []);
      }
      const drs = this.byId("filterDateRange");
      if (drs) {
        drs.setDateValue(selection.dateFrom || null);
        drs.setSecondDateValue(selection.dateTo || null);
      }
    },

    _currentRangeArray: function () {
      if (!this._oFilterModel) {
        return null;
      }
      const selection = this._oFilterModel.getProperty("/selection") || {};
      const from = selection.dateFrom instanceof Date ? selection.dateFrom : (selection.dateFrom ? new Date(selection.dateFrom) : null);
      const to = selection.dateTo instanceof Date ? selection.dateTo : (selection.dateTo ? new Date(selection.dateTo) : null);
      if (!(from instanceof Date) || isNaN(from) || !(to instanceof Date) || isNaN(to)) {
        return null;
      }
      const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      return [start, end];
    },

    _currentRangeObj: function () {
      const range = this._currentRangeArray();
      if (!Array.isArray(range)) {
        const fallback = this._getDefaultDateRangePair();
        return { from: fallback[0], to: fallback[1] };
      }
      return { from: range[0], to: range[1] };
    },

    _monthsSpan: function (d1, d2) {
      if (!(d1 instanceof Date) || isNaN(d1) || !(d2 instanceof Date) || isNaN(d2)) {
        return 0;
      }
      const y1 = d1.getFullYear();
      const m1 = d1.getMonth();
      const y2 = d2.getFullYear();
      const m2 = d2.getMonth();
      return (y2 - y1) * 12 + (m2 - m1) + 1;
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


























