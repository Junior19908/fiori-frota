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

      // Base model (garante estrutura mínima)
      if (!this.getView().getModel()) {
        this.getView().setModel(new JSONModel({ veiculos: [] }));
      }

      // Aux model p/ inspecionar movimentos (opcional)
      if (!this.getView().getModel("movtos")) {
        this.getView().setModel(new JSONModel({ results: [] }), "movtos");
      }

      // Define o período padrão (ontem) e carrega veículos do OData
      this._setDefaultYesterdayOnDRS();
      this._reloadVehiclesFromOData().then(() => {
        this._ensureCategories();
        this._ensureVehiclesCombo();
        this._recalcAndRefresh();
      });
    },

    /* ======================== EVENTS (UI) ======================== */
    onFilterChange: function () {
      // sempre que mudar período/categoria/veículo:
      // 1) recarrega veículos do OData se mudou o período
      // 2) recalcula KPIs + aplica filtros locais
      this._reloadVehiclesFromOData().then(() => {
        this._ensureCategories();
        this._ensureVehiclesCombo();
        this._recalcAndRefresh();
      });
    },

    onClearFilters: function () {
      // O serviço OData exige budat_mkpf; ao limpar, voltamos para "ontem"
      this._setDefaultYesterdayOnDRS();

      this.byId("segCat")?.setSelectedKey("__ALL__");
      const inp = this.byId("inpVeiculo");
      inp?.setSelectedKey("__ALL__");
      inp?.setValue("");

      this._reloadVehiclesFromOData().then(() => {
        this._ensureCategories();
        this._ensureVehiclesCombo();
        this._recalcAndRefresh();
      });
    },

    onOpenHistorico: function (oEvent) {
      const obj = oEvent.getSource().getBindingContext().getObject();
      const id = String(obj.id || obj.veiculo);
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id });
    },

    // Materiais direto do OData (fragment)
    onOpenMateriais: function (oEvent) {
      const item = oEvent.getSource().getBindingContext().getObject();
      return MaterialsService.openDialog(
        this.getView(),
        item,
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
      const item = oEvent.getSource().getBindingContext().getObject();
      sap.ui.require(["com/skysinc/frota/frota/services/FuelService","com/skysinc/frota/frota/util/FilterUtil"], (FuelSvc, F) => {
        FuelSvc.openFuelDialog(this, item, F.currentRange(this.byId("drs")));
      });
    },
    onCloseFuel: function () { this.byId("dlgFuel")?.close(); },

    /* ======================== HELPERS (UI/Binding) ======================== */
    _openFragment: function (sName, sId, mModels) {
      const v = this.getView();
      const promise = !this.byId(sId)
        ? sap.ui.core.Fragment.load({ name: sName, controller: this, id: v.getId() }).then((oFrag) => { v.addDependent(oFrag); return oFrag; })
        : Promise.resolve(this.byId(sId));

      return promise.then((oFrag) => {
        if (mModels) Object.keys(mModels).forEach((name) => oFrag.setModel(mModels[name], name));
        if (oFrag.open) oFrag.open();
        return oFrag;
      });
    },

    _ensureCategories: function () {
      const seg = this.byId("segCat");
      if (!seg) return;
      seg.destroyItems();
      seg.addItem(new sap.ui.core.Item({ key: "__ALL__", text: "Todas" }));

      const data = (this.getView().getModel()?.getProperty("/veiculos") || []);
      const set = new Set();
      data.forEach((i) => { if (i.categoria) set.add(String(i.categoria)); });
      Array.from(set).sort().forEach((c) => seg.addItem(new sap.ui.core.Item({ key: c, text: c })));
      if (!seg.getSelectedKey()) seg.setSelectedKey("__ALL__");
    },

    _ensureVehiclesCombo: function () {
      const inp = this.byId("inpVeiculo");
      if (!inp) return;
      inp.destroyItems();
      inp.addItem(new sap.ui.core.Item({ key: "__ALL__", text: "Todos" }));

      const data = (this.getView().getModel()?.getProperty("/veiculos") || []);
      const set = new Set();
      data.forEach((i) => { if (i.veiculo) set.add(String(i.veiculo)); });
      Array.from(set).sort().forEach((c) => inp.addItem(new sap.ui.core.Item({ key: c, text: c })));
      if (!inp.getSelectedKey()) inp.setSelectedKey("__ALL__");
    },

    _applyTableFilters: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      const aFilters = [];
      // só exibe veículos com atividade no período
      aFilters.push(new Filter({ path: "", test: (oObj) => !!oObj.rangeHasActivity }));

      const seg = this.byId("segCat");
      const cbVeh = this.byId("inpVeiculo");

      const cat = seg?.getSelectedKey();
      if (cat && cat !== "__ALL__") aFilters.push(new Filter("categoria", FilterOperator.EQ, cat));

      const vKey = cbVeh?.getSelectedKey();
      if (vKey && vKey !== "__ALL__") aFilters.push(new Filter("veiculo", FilterOperator.EQ, vKey));

      this.oTbl.getBinding("rows").filter(aFilters);
    },

    _getFilteredVehicles: function () {
      const baseModel = this.getView().getModel();
      if (!baseModel) return [];
      const list = baseModel.getProperty("/veiculos") || [];

      const seg = this.byId("segCat");
      const cbVeh = this.byId("inpVeiculo");
      const catKey = seg ? seg.getSelectedKey() : "__ALL__";
      const vehKey = cbVeh ? cbVeh.getSelectedKey() : "__ALL__";

      return list.filter((v) => {
        if (!v.rangeHasActivity) return false;
        if (catKey && catKey !== "__ALL__" && String(v.categoria) !== String(catKey)) return false;
        if (vehKey && vehKey !== "__ALL__" && String(v.veiculo)   !== String(vehKey)) return false;
        return true;
      });
    },

    _recalcAndRefresh: function () {
      const range = FilterUtil.currentRange(this.byId("drs"));
      Aggregation.recalcAggByRange(this.getView(), range);
      this._applyTableFilters();

      const kpis = KpiService.computeKpis(this._getFilteredVehicles());
      this.getView().getModel("kpi").setData(kpis);
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
    },

    _reloadVehiclesFromOData: function () {
      // Lê o range atual da DRS; se estiver vazio, usa ontem
      const drs = this.byId("drs");
      let range = null;

      const d1 = drs?.getDateValue?.();
      const d2 = drs?.getSecondDateValue?.();
      if (d1 && d2) {
        range = [d1, d2];
      } else {
        range = this._yesterdayPair();
      }

      return VehiclesService.loadVehiclesForRange(this.getView(), range);
    },

    // opcional: carregar movimentos do período para outro grid/modelo
    loadMovtosForCurrentRange: function () {
      const range = FilterUtil.currentRange(this.byId("drs"));
      const start = range ? range[0] : this._yesterdayPair()[0];
      const end   = range ? range[1] : this._yesterdayPair()[1];
      return ODataMovtos.loadMovtos(this.getOwnerComponent(), start, end)
        .then(({ results }) => {
          this.getView().getModel("movtos").setData({ results });
        });
    }
  });
});
