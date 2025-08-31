sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "sap/m/MessageBox",

  // Utils & Services
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

  return Controller.extend("com.skysinc.frota.frota.controller.Main", {
    formatter: formatter,

    /* ======================== LIFECYCLE ======================== */
    onInit: function () {
      this.oTbl = this.byId("tbl");

      // ViewModel nomeado "vm" (onde ficam veiculos/movimentos/flags)
      if (!this.getView().getModel("vm")) {
        this.getView().setModel(new JSONModel({
          veiculos: [],
          movimentos: [],
          aggregateOn: true // somar dmbtr/menge por veículo
        }), "vm");
      }

      // KPI model
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
      this.getView().setModel(this.oKpi, "kpi");

      // Período padrão (ontem) e primeira carga distinct
      this._setDefaultYesterdayOnDRS();
      this._reloadDistinctOnly().then(() => {
        this._ensureVehiclesCombo();
        this._recalcAndRefresh();
      });

      console.log("[Main] onInit concluído.");
    },

    /* ======================== EVENTS (UI) ======================== */
    onFilterChange: function () {
      this._reloadDistinctOnly().then(() => {
        this._ensureVehiclesCombo();
        this._recalcAndRefresh();
      }).catch((e) => {
        console.error("[Main] onFilterChange erro", e);
        MessageToast.show("Falha ao recarregar. Veja o console.");
      });
    },

    onClearFilters: function () {
      this._setDefaultYesterdayOnDRS();

      const inp = this.byId("inpVeiculo");
      inp?.setSelectedKey("__ALL__");
      inp?.setValue("");

      this._reloadDistinctOnly().then(() => {
        this._ensureVehiclesCombo();
        this._recalcAndRefresh();
      });
    },

    onOpenHistorico: function (oEvent) {
      const obj = oEvent.getSource().getBindingContext("vm").getObject();
      const id = String(obj.equnr || obj.veiculo || "");
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id });
    },

    // Materiais direto do OData (fragment)
    onOpenMateriais: function (oEvent) {
      const item = oEvent.getSource().getBindingContext("vm").getObject();
      return MaterialsService.openDialog(
        this.getView(),
        { equnr: item.equnr, descricaoVeiculo: item.eqktx },
        FilterUtil.currentRange(this.byId("drs"))
      );
    },

    onExportMateriais: function () {
      if (!this._dlgModel) { MessageToast.show("Abra o diálogo de materiais primeiro."); return; }
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

    onOpenAbastecimentos: function (oEvent) {
      const item = oEvent.getSource().getBindingContext("vm").getObject();
      sap.ui.require(["com/skysinc/frota/frota/services/FuelService","com/skysinc/frota/frota/util/FilterUtil"], (FuelSvc, F) => {
        FuelSvc.openFuelDialog(this, { equnr: item.equnr, descricaoVeiculo: item.eqktx }, F.currentRange(this.byId("drs")));
      });
    },
    onCloseFuel: function () { this.byId("dlgFuel")?.close(); },

    // Painel de Depuração (se você incluiu na view)
    onDumpVm: function () {
      const vm = this.getView().getModel("vm");
      const veiculos = vm && vm.getProperty("/veiculos");
      const movimentos = vm && vm.getProperty("/movimentos");
      console.log("[Dump] vm>/veiculos length =", veiculos && veiculos.length);
      if (veiculos && veiculos.length) console.table(veiculos.slice(0, 20));
      console.log("[Dump] vm>/movimentos length =", movimentos && movimentos.length);
      if (movimentos && movimentos.length) console.table(movimentos.slice(0, 20));
    },

    /* ======================== HELPERS (UI/Binding) ======================== */
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

    _applyTableFilters: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      const aFilters = [];
      const cbVeh = this.byId("inpVeiculo");
      const vKey = cbVeh?.getSelectedKey();
      if (vKey && vKey !== "__ALL__") aFilters.push(new Filter("equnr", FilterOperator.EQ, vKey));

      this.oTbl.getBinding("rows").filter(aFilters);
    },

    _recalcAndRefresh: function () {
      // Se você recalcula KPIs a partir de distincts, adapte aqui
      this._applyTableFilters();
      this.byId("tbl")?.getBinding("rows")?.refresh(true);
    },

    /* ======================== DATA (OData) ======================== */
    _yesterdayPair: function () {
      const now = new Date();
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return [y, y]; // SingleRange (requisito do CDS)
    },

    _setDefaultYesterdayOnDRS: function () {
      const drs = this.byId("drs");
      if (!drs) return;
      const [d1, d2] = this._yesterdayPair();
      drs.setDateValue(d1);
      drs.setSecondDateValue(d2);
      console.log("[Main] DRS default (ontem):", d1, d2);
    },

    _currentRangeObj: function () {
      const drs = this.byId("drs");
      const d1 = drs?.getDateValue?.();
      const d2 = drs?.getSecondDateValue?.();
      const [y1, y2] = this._yesterdayPair();
      const range = { from: d1 || y1, to: d2 || d1 || y2 };
      console.log("[Main] DRS → from:", range.from, "to:", range.to);
      return range;
    },

    // Carrega "1 veículo por linha" e grava em vm>/veiculos
    _reloadDistinctOnly: function () {
      const range = this._currentRangeObj();
      const aggregate = !!this.getView().getModel("vm").getProperty("/aggregateOn");
      return VehiclesService.loadVehiclesDistinctForRange(this.getView(), range, {
        aggregate: aggregate,
        targetPath: "vm>/veiculos"
      }).then(() => {
        const vm = this.getView().getModel("vm");
        const arr = vm.getProperty("/veiculos") || [];
        console.log("[Main] pós-load distinct → vm>/veiculos length =", arr.length);
        if (arr.length) console.table(arr.slice(0, 10));
      });
    }
  });
});
