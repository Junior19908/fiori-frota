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
      this.getView().setModel(this.oKpi, "kpi");

      this._setDefaultYesterdayOnDRS();
      this._reloadDistinctOnly().then(() => {
        this._ensureVehiclesCombo();
        this._ensureCategoriasCombo();
        this._recalcAndRefresh();
      });
    },

    onFilterChange: function () {
      this._reloadDistinctOnly().then(() => {
        this._ensureVehiclesCombo();
        this._ensureCategoriasCombo();
        this._recalcAndRefresh();
      }).catch(() => {
        MessageToast.show("Falha ao recarregar.");
      });
    },

    onClearFilters: function () {
      this._setDefaultYesterdayOnDRS();

      const inpVeh = this.byId("inpVeiculo");
      inpVeh?.setSelectedKey("__ALL__");
      inpVeh?.setValue("");

      const inpCat = this.byId("segCat");
      inpCat?.setSelectedKey("__ALL__");
      inpCat?.setValue("");

      this._reloadDistinctOnly().then(() => {
        this._ensureVehiclesCombo();
        this._ensureCategoriasCombo();
        this._recalcAndRefresh();
      });
    },

    // ========= NOVO: Botão de Configuração =========
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
            oRouter.navTo("config"); // sem parâmetro: usuário escolhe na tela
          }
          return;
        }
      } catch (e) {
        // segue para fallback
      }
      MessageToast.show("Rota 'config' não encontrada. Configure o routing no manifest.json.");
    },
    // ========= FIM DO NOVO =========

    onOpenHistorico: function (oEvent) {
      const obj = oEvent.getSource().getBindingContext("vm").getObject();
      const id = String(obj.equnr || obj.veiculo || "");
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id });
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

    onCloseFuel: function () { this.byId("dlgFuel")?.close(); },

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

    _recalcAndRefresh: function () {
      const drs   = this.byId("drs");
      const range = FilterUtil.currentRange(drs);
      Aggregation.recalcAggByRange(this.getView(), range);

      this._applyTableFilters();
      this.byId("tbl")?.getBinding("rows")?.refresh(true);

      const vKey = this.byId("inpVeiculo")?.getSelectedKey();
      const cKey = this.byId("segCat")?.getSelectedKey();
      KpiService.recalc(this.getView(), { vehicleKey: vKey, categoryKey: cKey });
    },

    _yesterdayPair: function () {
      const now = new Date();
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
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
