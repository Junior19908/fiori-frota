sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/core/Fragment",
  "com/skysinc/frota/frota/util/formatter"
], function (Controller, JSONModel, Filter, FilterOperator, Fragment, formatter) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.Main", {
    formatter: formatter,

    onInit: function () {
      this.oTbl = this.byId("tbl");

      // Modelo KPI
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

      var oMainModel = this.getView().getModel();
      if (oMainModel && oMainModel.attachRequestCompleted) {
        oMainModel.attachRequestCompleted(function () {
          this._ensureCategories();
          this._ensureCategoriesForVehicle();
          this._recalcKpis();
        }, this);
      } else {
        setTimeout(function () {
          this._ensureCategories();
          this._ensureCategoriesForVehicle();
          this._recalcKpis();
        }.bind(this), 0);
      }
    },

    onFilterChange: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      var aFilters = [];

      // Período
      var drs = this.byId("drs");
      if (drs) {
        var d1 = drs.getDateValue(), d2 = drs.getSecondDateValue();
        if (d1 && d2) {
          aFilters.push(new Filter({
            path: "data",
            test: function (val) {
              var x = new Date(val);
              var end = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23, 59, 59);
              return x >= d1 && x <= end;
            }
          }));
        }
      }

      // Categoria (ComboBox)
      var seg = this.byId("segCat");
      if (seg) {
        var cat = seg.getSelectedKey();
        if (cat && cat !== "__ALL__") {
          aFilters.push(new Filter("categoria", FilterOperator.EQ, cat));
        }
      }

      // Veículo (ComboBox)
      var cbVeh = this.byId("inpVeiculo");
      if (cbVeh) {
        var vKey = cbVeh.getSelectedKey();
        if (vKey && vKey !== "__ALL__") {
          aFilters.push(new Filter("veiculo", FilterOperator.EQ, vKey));
        }
      }

      this.oTbl.getBinding("rows").filter(aFilters);
      setTimeout(this._recalcKpis.bind(this), 0);
    },

    onClearFilters: function () {
      this.byId("drs")?.setDateValue(null);
      this.byId("drs")?.setSecondDateValue(null);
      this.byId("segCat")?.setSelectedKey("__ALL__");
      this.byId("inpVeiculo")?.setSelectedKey("__ALL__");
      this.byId("inpVeiculo")?.setValue("");
      this.oTbl?.getBinding("rows")?.filter([]);
      this._recalcKpis();
    },

    // Main.controller.js
    goConverter: function () {
      this.getOwnerComponent().getRouter().navTo("RouteConverter");
    },


    onOpenHistorico: function (oEvent) {
      var obj = oEvent.getSource().getBindingContext().getObject();
      var id = String(obj.id || obj.veiculo);
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id: id });
    },


    onOpenMateriais: function (oEvent) {
      var item = this._ctx(oEvent);
      var key = item.id || item.veiculo;

      var matModel = this.getView().getModel("materiais"); // {materiaisPorVeiculo:{ <key>: [] }}
      var arr = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key))
                || item.materiais || [];

      var totalItens = arr.length; // nº de linhas
      var totalQtd   = arr.reduce((s, m) => s + (Number(m.qtde) || 0), 0);
      var totalValor = arr.reduce((s, m) => s + ((Number(m.qtde) || 0) * (Number(m.custoUnit) || 0)), 0);

      if (!this._dlgModel) {
        this._dlgModel = new sap.ui.model.json.JSONModel();
        this.getView().setModel(this._dlgModel, "dlg");
      }

      this._dlgModel.setData({
        titulo: `Materiais — ${item.veiculo} — ${item.descricao || ""}`,
        materiais: arr,
        totalItens: totalItens,
        totalQtd: totalQtd,
        totalValor: totalValor
      });

      this._openFragment("com.skysinc.frota.frota.fragments.MaterialsDialog", "dlgMateriais");
    },
    onCloseMateriais: function () { this.byId("dlgMateriais")?.close(); },

    onExportMateriais: function(){
      var d = this._dlgModel?.getData(); if (!d || !d.materiais?.length) return;

      var header = [
        'Veículo','Descrição',
        'Item','Tipo','Qtde','Unid','Custo Unit. (BRL)','Total (BRL)',
        'Cód. Material','Depósito','Hora Entrada','N. Ordem','N. Reserva','N. Item',
        'Recebedor','Usuário'
      ];

      var rows = d.materiais.map(m => {
        var total = (Number(m.qtde || 0) * Number(m.custoUnit || 0));
        return [
          d.titulo.split(" — ")[1],              // veículo
          d.titulo.split(" — ")[2] || "",        // descrição veículo
          m.nome, m.tipo || "",
          String(m.qtde ?? "").replace('.', ','), m.unid || "",
          this.formatter.fmtBrl(m.custoUnit),
          this.formatter.fmtBrl(total),
          m.codMaterial || "", m.deposito || "", this.formatter.fmtHora(m.horaEntrada || ""),
          m.nOrdem || "", m.nReserva || "", m.nItem || "",
          m.recebedor || "", m.usuario || ""
        ];
      });

      var csv = [header].concat(rows)
        .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';'))
        .join('\n');

      var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = `materiais_${d.titulo}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    },

    onPrintMateriais: function(){
      var d = this._dlgModel?.getData(); if (!d) return;

      var rows = (d.materiais || []).map(m => {
        var total = (Number(m.qtde || 0) * Number(m.custoUnit || 0));
        return `<tr>
          <td>${m.nome}</td>
          <td>${m.tipo || ''}</td>
          <td style="text-align:right">${m.qtde ?? ''}</td>
          <td>${m.unid || ''}</td>
          <td style="text-align:right">${this.formatter.fmtBrl(m.custoUnit)}</td>
          <td style="text-align:right">${this.formatter.fmtBrl(total)}</td>
          <td>${m.codMaterial || ''}</td>
          <td>${m.deposito || ''}</td>
          <td>${this.formatter.fmtHora(m.horaEntrada || '')}</td>
          <td>${m.nOrdem || ''}</td>
          <td>${m.nReserva || ''}</td>
          <td>${m.nItem || ''}</td>
          <td>${m.recebedor || ''}</td>
          <td>${m.usuario || ''}</td>
        </tr>`;
      }).join('');

      var html = `<!doctype html><html><head><meta charset="utf-8"><title>${d.titulo}</title>
        <style>
          body{font-family:Arial;padding:24px}
          h2{margin:0 0 8px}
          table{width:100%;border-collapse:collapse;margin-top:12px}
          th,td{border:1px solid #ccc;padding:8px}
          th{text-align:left;background:#f8f8f8}
          td.num{text-align:right}
        </style>
      </head><body>
        <h2>${d.titulo}</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th><th>Tipo</th><th>Qtde</th><th>Unid</th><th>Custo Unit.</th><th>Total (R$)</th>
              <th>Cód. Material</th><th>Depósito</th><th>Hora Entrada</th>
              <th>N. Ordem</th><th>N. Reserva</th><th>N. Item</th>
              <th>Recebedor</th><th>Usuário</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="14">Sem materiais</td></tr>'}</tbody>
          <tfoot>
            <tr>
              <th colspan="5" style="text-align:right">Totais:</th>
              <th style="text-align:right">${this.formatter.fmtBrl(d.totalValor)}</th>
              <th colspan="8"></th>
            </tr>
          </tfoot>
        </table>
        <script>window.print();setTimeout(()=>window.close(),300);</script>
      </body></html>`;

      var w = window.open('', '_blank'); w.document.write(html); w.document.close();
    },

    onOpenAbastecimentos: function (oEvent) {
      var item = this._ctx(oEvent);
      var key = item.id || item.veiculo;

      var abModel = this.getView().getModel("abast"); // {abastecimentosPorVeiculo:{ <key>: [] }}
      var arr = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key))
                || item.abastecimentos || [];

      if (!this._fuelModel) {
        this._fuelModel = new sap.ui.model.json.JSONModel();
        this.getView().setModel(this._fuelModel, "fuel");
      }
      this._fuelModel.setData({
        titulo: `Abastecimentos — ${item.veiculo} — ${item.descricao || ""}`,
        eventos: arr
      });

      this._openFragment("com.skysinc.frota.frota.fragments.FuelDialog", "dlgFuel");
    },
    onCloseFuel: function () { this.byId("dlgFuel")?.close(); },

    // Helpers
    _ctx: function (oEvent) {
      return oEvent.getSource().getBindingContext().getObject();
    },
    _openFragment: function (sName, sId) {
      var v = this.getView();
      if (!this.byId(sId)) {
        sap.ui.core.Fragment.load({ name: sName, controller: this, id: v.getId() })
          .then(function (oFrag) { v.addDependent(oFrag); oFrag.open(); });
      } else {
        this.byId(sId).open();
      }
    },

    _ensureCategories: function () {
      // segCat é ComboBox -> use Items, não SegmentedButtonItem
      var cb = this.byId("segCat");
      if (!cb) return;

      cb.destroyItems();
      cb.addItem(new sap.ui.core.Item({ key: "__ALL__", text: "Todas" }));

      var data = (this.getView().getModel()?.getProperty("/veiculos") || []);
      var set = new Set();
      data.forEach(i => { if (i.categoria) set.add(String(i.categoria)); });
      Array.from(set).sort().forEach(c => {
        cb.addItem(new sap.ui.core.Item({ key: c, text: c }));
      });
      cb.setSelectedKey("__ALL__");
    },

    _ensureCategoriesForVehicle: function () {
      var inp = this.byId("inpVeiculo");
      if (!inp) return;

      inp.destroyItems();
      inp.addItem(new sap.ui.core.Item({ key: "__ALL__", text: "Todos" }));

      var data = (this.getView().getModel()?.getProperty("/veiculos") || []);
      var set = new Set();
      data.forEach(i => { if (i.veiculo) set.add(String(i.veiculo)); });
      Array.from(set).sort().forEach(c => {
        inp.addItem(new sap.ui.core.Item({ key: c, text: c }));
      });
      inp.setSelectedKey("__ALL__");
    },

    _recalcKpis: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      var arr = this.oTbl.getBinding("rows").getCurrentContexts().map(c => c.getObject());
      var totalLitros = arr.reduce((s, i) => s + (Number(i.combustivelLitros) || 0), 0);
      var totalValor  = arr.reduce((s, i) => s + (Number(i.combustivelValor) || 0), 0);
      var totalMat    = arr.reduce((s, i) => s + (Number(i.custoMaterial)   || 0), 0);
      var precoMedio  = totalLitros ? (totalValor / totalLitros) : 0;

      this.oKpi.setData({
        totalLitrosFmt: formatter.fmtNum(totalLitros),
        gastoCombustivelFmt: formatter.fmtBrl(totalValor),
        custoMateriaisFmt: formatter.fmtBrl(totalMat),
        precoMedioFmt: formatter.fmtNum(precoMedio),
        resumoCombFmt: `Comb: ${formatter.fmtBrl(totalValor)}`,
        resumoLitrosFmt: `Litros: ${formatter.fmtNum(totalLitros)} L`,
        resumoMatFmt: `Mat/Serv: ${formatter.fmtBrl(totalMat)}`,
        resumoPrecoFmt: `Preço Médio: ${formatter.fmtNum(precoMedio)} R$/L`
      });
    }
  });
});
