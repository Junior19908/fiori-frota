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
  "com/skysinc/frota/frota/Aggregation"
], function (
  Controller, JSONModel, Filter, FilterOperator, Fragment, MessageToast, MessageBox,
  formatter, FilterUtil, MaterialsService, FuelService, KpiService, ODataMovtos, VehiclesService, Aggregation
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
        resumoPrecoFmt: "Preço Médio: 0,00 R$/L"
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
                sap.m.MessageToast.show(`Período selecionado muito grande (${months} meses). Máximo: 12.`);
              } else {
                await comp.loadAllHistoryInRange(range[0], range[1]);
              }
            }
          } catch(_){}
          await Aggregation.recalcAggByRange(this.getView(), range);
          this._ensureVehiclesCombo();
          this._ensureCategoriasCombo();
          this._recalcAndRefresh();
        } catch (e) {
          try { sap.m.MessageToast.show("Falha na inicializaçã assíncrona."); } catch(_){}
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
              sap.m.MessageToast.show(`Período selecionado muito grande (${months} meses). Máximo: 12.`);
            } else {
              await comp.loadAllHistoryInRange(range[0], range[1]);
            }
          }
        } catch(_){}
        await Aggregation.recalcAggByRange(this.getView(), range);
        this._ensureVehiclesCombo();
        this._ensureCategoriasCombo();
        this._recalcAndRefresh();
      } catch (e) {
        MessageToast.show("Falha ao recarregar.");
      }
    },

    onClearFilters: async function () {
      this._applyMainDatePref();

      const inpVeh = this.byId("inpVeiculo");
      inpVeh?.setSelectedKey("__ALL__");
      inpVeh?.setValue("");

      const inpCat = this.byId("segCat");
      inpCat?.setSelectedKey("__ALL__");
      inpCat?.setValue("");

      await this._reloadDistinctOnly();
      const range = FilterUtil.currentRange(this.byId("drs"));
      try {
        const comp = this.getOwnerComponent && this.getOwnerComponent();
        if (comp && typeof comp.loadAllHistoryInRange === "function" && Array.isArray(range)) {
          const months = this._monthsSpan(range[0], range[1]);
          if (months > 12) {
            sap.m.MessageToast.show(`Período selecionado muito grande (${months} meses). Máximo: 12.`);
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

    // ========= NOVO: Bot├â┬úo de Configura├â┬º├â┬úo =========
    onOpenConfig: function () {
      // Usa o veículo selecionado no ComboBox "inpVeiculo"
      const oVehCombo = this.byId("inpVeiculo");
      const sEqunr = oVehCombo && oVehCombo.getSelectedKey();

      try {
        const oRouter = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (oRouter && oRouter.navTo) {
          if (sEqunr && sEqunr !== "__ALL__") {
            oRouter.navTo("config", { equnr: sEqunr });
          } else {
            oRouter.navTo("config"); // sem par├â┬ómetro: usu├â┬írio escolhe na tela
          }
          return;
        }
      } catch (e) {
        // segue para fallback
      }
      MessageToast.show("Rota 'config' não encontrada. Configure o routing no manifest.json.");
    },
    // ========= FIM DO NOVO =========

    // Abre p├â┬ígina de Configura├â┬º├â┬Áes (prefer├â┬¬ncias do usu├â┬írio)
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
      sap.m.MessageToast.show("Rota 'settings' não encontrada. Verifique o routing no manifest.json.");
    },

    onOpenHistorico: function (oEvent) {
      const obj = oEvent.getSource().getBindingContext("vm").getObject();
      const id = String(obj.equnr || obj.veiculo || "");
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id });
    },

    // Novo: abre o di├ílogo de OS (substitui a tela IW38)
    onOpenOSDialog: function (oEvent) {
      try {
        const ctxObj = oEvent?.getSource?.()?.getBindingContext("vm")?.getObject?.();
        const equnr = String(ctxObj?.equnr || ctxObj?.veiculo || "");
        const range = FilterUtil.currentRange(this.byId("drs"));
        sap.ui.require(["com/skysinc/frota/frota/controller/OSDialog"], (OSDlg) => {
          OSDlg.open(this.getView(), { equnr, range, titulo: equnr ? ("OS ÔÇö " + equnr) : "OS" });
        });
      } catch (e) {
        MessageToast.show("Falha ao abrir OS.");
      }
    },

    // Abre a visualiza├â┬º├â┬úo/preview da IW38 (mock local por enquanto)
    onOpenIW38Preview: function (oEvent) {
      try {
        const ctxObj = oEvent?.getSource?.()?.getBindingContext("vm")?.getObject?.();
        // Usa alguma possível ordem vinda do contexto, senão um valor padr├â┬úo do mock
        const equnr = String(ctxObj?.equnr || ctxObj?.veiculo || "");
        const oRouter = this.getOwnerComponent().getRouter && this.getOwnerComponent().getRouter();
        if (oRouter && oRouter.navTo) {
          oRouter.navTo("RouteIW38", { equnr });
          return;
        }
      } catch (e) {
        // segue para fallback
      }
      sap.m.MessageToast.show("Rota 'RouteIW38' não encontrada. Verifique o routing no manifest.json.");
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
      if (!this._dlgModel) { MessageToast.show("Abra o di├â┬ílogo de materiais primeiro."); return; }
      sap.ui.require(["com/skysinc/frota/frota/services/MaterialsService"], (Svc) => {
        Svc.exportCsv(this._dlgModel, this.byId("drs"));
      });
    },

    onPrintMateriais: function () {
      const dlg = this.byId("dlgMateriais");
      if (!dlg) { MessageToast.show("Abra o diálogo de materiais primeiro."); return; }
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
        sap.m.MessageToast.show("Selecione um veículo válido.");
        return;
      }

      const drs = this.byId("drs");
      if (!drs) {
        sap.m.MessageToast.show("Componente de período não encontrado.");
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
            else MessageToast.show("não foi possível salvar os limites.");
          });
      } catch (e) {
        MessageToast.show("não foi possível salvar os limites.");
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
      const inp = this.byId("inpVeiculo");
      if (!inp) return;
      inp.destroyItems();
      inp.addItem(new sap.ui.core.Item({ key: "__ALL__", text: "Todos" }));

      const data = (this.getView().getModel("vm")?.getProperty("/veiculos") || []);
      const set = new Set();
      data.forEach((i) => { if (i.equnr) set.add(String(i.equnr)); });
      Array.from(set).sort().forEach((c) => inp.addItem(new sap.ui.core.Item({ key: c, text: c })));
      if (!inp.getSelectedKey()) inp.setSelectedKey("__ALL__");
    },

    _ensureCategoriasCombo: function () {
      const inp = this.byId("segCat");
      if (!inp) return;

      inp.destroyItems();
      inp.addItem(new sap.ui.core.Item({ key: "__ALL__", text: "Todas" }));

      const data = (this.getView().getModel("vm")?.getProperty("/veiculos") || []);
      const set = new Set();
      data.forEach((i) => {
        const cat = (i.CATEGORIA != null && i.CATEGORIA !== "") ? String(i.CATEGORIA) : null;
        if (cat) set.add(cat);
      });

      Array.from(set).sort().forEach((c) => {
        inp.addItem(new sap.ui.core.Item({ key: c, text: c }));
      });

      if (!inp.getSelectedKey()) inp.setSelectedKey("__ALL__");
    },

    _applyTableFilters: function () {
      const oBinding = this.oTbl && this.oTbl.getBinding("rows");
      if (!oBinding) return;

      const aFilters = [];

      const cbVeh = this.byId("inpVeiculo");
      const vKey = cbVeh?.getSelectedKey();
      if (vKey && vKey !== "__ALL__") {
        aFilters.push(new Filter("equnr", FilterOperator.EQ, vKey));
      }

      const cbCat = this.byId("segCat");
      const cKey = cbCat?.getSelectedKey();
      if (cKey && cKey !== "__ALL__") {
        aFilters.push(new Filter("CATEGORIA", FilterOperator.EQ, cKey));
      }

      oBinding.filter(aFilters);
    },

    _getFilteredVehiclesArray: function () {
      const vm = this.getView().getModel("vm");
      const all = (vm && vm.getProperty("/veiculos")) || [];

      const vKey = this.byId("inpVeiculo")?.getSelectedKey();
      const cKey = this.byId("segCat")?.getSelectedKey();

      return all.filter((row) => {
        const byVeh = (!vKey || vKey === "__ALL__") ? true : String(row.equnr) === String(vKey);
        const byCat = (!cKey || cKey === "__ALL__") ? true : String(row.CATEGORIA || "") === String(cKey);
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
        resumoPrecoFmt: "Preço Médio: " + this.formatter.fmtNum(precoMedio) + " R$/L"
      }, true);
    },

    _onDowntimeReady: function () {
      try {
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

      const vKey = this.byId("inpVeiculo")?.getSelectedKey();
      const cKey = this.byId("segCat")?.getSelectedKey();
      KpiService.recalc(this.getView(), { vehicleKey: vKey, categoryKey: cKey });
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









