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
          this._recalcAggByRange(); // <<< agrega por período (materiais + combustíveis)
          this._applyTableFilters();
          this._recalcKpis();
        }, this);
      } else {
        setTimeout(function () {
          this._ensureCategories();
          this._ensureCategoriesForVehicle();
          this._recalcAggByRange();
          this._applyTableFilters();
          this._recalcKpis();
        }.bind(this), 0);
      }
    },

    // =========================
    // FILTROS DA BARRA SUPERIOR
    // =========================
    onFilterChange: function () {
      if (!this.oTbl) return;

      // Se o usuário mudou o mês, recarregue mocks (se aplicável)
      this._maybeReloadByFilterMonth().then(function () {
        // Recalcula os agregados com base no PERÍODO do DRS
        this._recalcAggByRange();
        // Reaplica filtros (categoria/veículo + "tem materiais no período")
        this._applyTableFilters();
        // Recalcula KPIs
        this._recalcKpis();
      }.bind(this));
    },

    onClearFilters: function () {
      this.byId("drs")?.setDateValue(null);
      this.byId("drs")?.setSecondDateValue(null);
      this.byId("segCat")?.setSelectedKey("__ALL__");
      this.byId("inpVeiculo")?.setSelectedKey("__ALL__");
      this.byId("inpVeiculo")?.setValue("");

      // Recalcula sem recorte de período (mostra tudo)
      this._recalcAggByRange();
      this._applyTableFilters();
      this._recalcKpis();
    },

    // =========================
    // AÇÕES DA TABELA
    // =========================
    onOpenHistorico: function (oEvent) {
      var obj = oEvent.getSource().getBindingContext().getObject();
      var id = String(obj.id || obj.veiculo);
      this.getOwnerComponent().getRouter().navTo("RouteHistorico", { id: id });
    },

    // -------- Materiais (Dialog)
    onOpenMateriais: function (oEvent) {
      var item = this._ctx(oEvent);
      var key  = item.id || item.veiculo;

      var matModel = this.getView().getModel("materiais");
      var arr = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || item.materiais || [];

      // Filtra pelo período do DRS
      var rng = this._currentRange(); // [start,end] ou null
      var arrFiltrada = arr;
      if (rng) {
        var start = rng[0], end = rng[1];
        arrFiltrada = arr.filter(function (m) {
          var d = this._parseAnyDate(m.data);
          return d && d >= start && d <= end;
        }.bind(this));
      }

      var totalItens = arrFiltrada.length;
      var totalQtd   = arrFiltrada.reduce((s, m) => s + (Number(m.qtde) || 0), 0);
      var totalValor = arrFiltrada.reduce((s, m) => s + ((Number(m.qtde) || 0) * (Number(m.custoUnit) || 0)), 0);

      if (!this._dlgModel) {
        this._dlgModel = new sap.ui.model.json.JSONModel();
      }
      this._dlgModel.setData({
        titulo: `Materiais — ${item.veiculo} — ${item.descricao || ""}`,
        materiais: arrFiltrada,
        totalItens,
        totalQtd,
        totalValor
      });

      this._openFragment(
        "com.skysinc.frota.frota.fragments.MaterialsDialog", // use caminho/namespace conforme seu projeto
        "dlgMateriais",
        { dlg: this._dlgModel }
      );
    },
    onCloseMateriais: function () { this.byId("dlgMateriais")?.close(); },

    onExportMateriais: function(){
      var d = this._dlgModel?.getData(); if (!d || !d.materiais?.length) return;

      var header = [
        'Veículo','Descrição',
        'Item','Tipo','Qtde','Unid','Custo Unit. (BRL)','Total (BRL)',
        'Cód. Material','Depósito','Hora','Data','N. Ordem','N. Reserva','N. Item',
        'Recebedor','Usuário'
      ];

      var rows = d.materiais.map(m => {
        var total = (Number(m.qtde || 0) * Number(m.custoUnit || 0));
        return [
          d.titulo.split(" — ")[1],
          d.titulo.split(" — ")[2] || "",
          m.nome, m.tipo || "",
          String(m.qtde ?? "").replace('.', ','), m.unid || "",
          this.formatter.fmtBrl(m.custoUnit),
          this.formatter.fmtBrl(total),
          m.codMaterial || "", m.deposito || "", this.formatter.fmtHora(m.horaEntrada || ""),
          m.data || "", // mantém a data original do material
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
          <td>${m.data || ''}</td>
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
              <th>Data</th><th>N. Ordem</th><th>N. Reserva</th><th>N. Item</th>
              <th>Recebedor</th><th>Usuário</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="15">Sem materiais</td></tr>'}</tbody>
          <tfoot>
            <tr>
              <th colspan="5" style="text-align:right">Totais:</th>
              <th style="text-align:right">${this.formatter.fmtBrl(d.totalValor)}</th>
              <th colspan="9"></th>
            </tr>
          </tfoot>
        </table>
        <script>window.print();setTimeout(()=>window.close(),300);</script>
      </body></html>`;

      var w = window.open('', '_blank'); w.document.write(html); w.document.close();
    },

    // -------- Abastecimentos (Dialog)
onOpenAbastecimentos: function (oEvent) {
  var item = this._ctx(oEvent);
  var key  = item.id || item.veiculo;

  var abModel = this.getView().getModel("abast");
  var arr = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || item.abastecimentos || [];

  // --- FILTRO POR PERÍODO (DRS) ---
  var rng = this._currentRange(); // [start,end] ou null
  var list = arr;
  if (rng) {
    var start = rng[0], end = rng[1];
    list = arr.filter(function (a) {
      var d = this._parseAnyDate(a.data);
      return d && d >= start && d <= end;
    }.bind(this));
  }

  // --- ORDENAÇÃO por data/hora (crescente) para calcular deltas corretos ---
  var toTime = function (ev) {
    var d = this._parseAnyDate(ev.data) || new Date(0,0,1);
    // concatena hora se existir (HH:mm:ss)
    if (ev.hora && /^\d{2}:\d{2}:\d{2}$/.test(String(ev.hora))) {
      var [H, M, S] = ev.hora.split(":").map(Number);
      d.setHours(H||0, M||0, S||0, 0);
    }
    return d.getTime();
  }.bind(this);
  list.sort(function (a,b){ return toTime(a) - toTime(b); });

  var parseOdo = function (v) {
    if (v == null) return NaN;
    if (typeof v === "number") return v;
    var s = String(v).replace(/\s|Km/gi, "");
    // troca milhar e decimal para padrão JS
    // ex.: "149.588,3" -> "149588.3" / "149.588" -> "149588"
    s = s.replace(/\./g, "").replace(",", ".");
    var n = Number(s);
    return isNaN(n) ? NaN : n;
  };

  // --- Calcula Km/L e L/Km por linha (a partir da 2ª) ---
  for (var j = 0; j < list.length; j++) {
    var ev = list[j];
    var odoAtual = parseOdo(ev.quilometragem || ev.km || ev.hodometro || ev.quilometro || ev.quilometragemKm);
    // alguns mocks usam "quilometragem" em número já normalizado; esse parser cobre ambos, irei melhorar na proxima

    if (j === 0) {
      ev._kmPerc = null;
      ev._kmPorL = null;
      ev._lPorKm = null;
    } else {
      var prev = list[j-1];
      var odoPrev = parseOdo(prev.quilometragem || prev.km || prev.hodometro || prev.quilometragemKm);
      var litros  = Number(ev.litros || 0);

      //kmPerc → Quilômetros percorridos
      //kmPorL → Quantos km o veículo percorre por litro
      //lPorKm → Quantos litros o veículo consome por km
      //odoAtual → Hodometro Atual
      //odoPrev → Hodometro Anterior

      var kmPerc = (isFinite(odoAtual) && isFinite(odoPrev)) ? (odoAtual - odoPrev) : NaN;
      if (!isFinite(kmPerc) || kmPerc <= 0 || litros <= 0) {
        ev._kmPerc = null;
        ev._kmPorL = null;
        ev._lPorKm = null;
      } else {
        ev._kmPerc = kmPerc;
        ev._kmPorL = kmPerc / litros;
        ev._lPorKm = litros / kmPerc;
      }
    }
  }

  if (!this._fuelModel) {
    this._fuelModel = new sap.ui.model.json.JSONModel();
  }
  this._fuelModel.setData({
    titulo: `Abastecimentos — ${item.veiculo} — ${item.descricao || ""}`,
    eventos: list
  });

  this._openFragment(
    "com.skysinc.frota.frota.fragments.FuelDialog",
    "dlgFuel",
    { fuel: this._fuelModel }
  );
},
    onCloseFuel: function () { this.byId("dlgFuel")?.close(); },

    // =========================
    // HELPERS
    // =========================
    _ctx: function (oEvent) {
      return oEvent.getSource().getBindingContext().getObject();
    },

    _openFragment: function (sName, sId, mModels) {
      var v = this.getView();
      var p;

      if (!this.byId(sId)) {
        p = sap.ui.core.Fragment.load({
          name: sName,
          controller: this,
          id: v.getId()
        }).then(function (oFrag) {
          v.addDependent(oFrag);
          return oFrag;
        });
      } else {
        p = Promise.resolve(this.byId(sId));
      }

      return p.then(function (oFrag) {
        if (mModels) {
          Object.keys(mModels).forEach(function (name) {
            oFrag.setModel(mModels[name], name);
          });
        }
        if (oFrag.open) { oFrag.open(); }
        return oFrag;
      });
    },

    _ensureCategories: function () {
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

    // ===== Datas =====
    _parseYMD: function (s) {
      if (!s) return null;
      var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    },

    // 'YYYY-MM-DD', 'DD/MM/YYYY' ou Date -> Date local 00:00
    _parseAnyDate: function (v) {
      if (!v) return null;
      if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 0,0,0,0);
      var s = String(v);

      var mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (mIso) return new Date(+mIso[1], +mIso[2]-1, +mIso[3], 0,0,0,0);

      var mBr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (mBr) return new Date(+mBr[3], +mBr[2]-1, +mBr[1], 0,0,0,0);

      return null;
    },

    _currentRange: function () {
      var drs = this.byId("drs");
      if (!drs) return null;
      var d1 = drs.getDateValue(), d2 = drs.getSecondDateValue();
      if (!d1 || !d2) return null;
      var start = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 0, 0, 0, 0);
      var end   = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23, 59, 59, 999);
      return [start, end];
    },

    _maybeReloadByFilterMonth: function () {
      var drs = this.byId("drs");
      if (!drs) return Promise.resolve();
      var d1 = drs.getDateValue();
      if (!d1) return Promise.resolve();
      var yyyy = d1.getFullYear();
      var mm   = String(d1.getMonth() + 1).padStart(2, "0");
      var comp = this.getOwnerComponent();
      var ym = yyyy + "-" + mm;

      if (comp && comp.setMockYM && comp.__currentYM !== ym) {
        return comp.setMockYM(yyyy, mm).then(function () {
          this._recalcAggByRange();
        }.bind(this));
      }
      return Promise.resolve();
    },

    // ======================================================
    // AGREGAÇÃO POR PERÍODO (MATERIAIS + ABASTECIMENTOS)
    // ======================================================
    _recalcAggByRange: function () {
      var baseModel = this.getView().getModel();        // "/veiculos"
      var matModel  = this.getView().getModel("materiais"); // "/materiaisPorVeiculo/<id>"
      var abModel   = this.getView().getModel("abast");     // "/abastecimentosPorVeiculo/<id>"
      if (!baseModel) return;

      var vlist = baseModel.getProperty("/veiculos") || [];
      var rng = this._currentRange(); // [start, end] ou null

      vlist.forEach(function (v) {
        var key = v.id || v.veiculo;

        var materiais = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || v.materiais || [];
        var abastec   = (abModel  && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || v.abastecimentos || [];

        // ---- filtrar por período (se houver) ----
        var matsInRange = materiais;
        if (rng) {
          var start = rng[0], end = rng[1];
          matsInRange = materiais.filter(function (m) {
            var d = this._parseAnyDate(m.data);
            return d && d >= start && d <= end;
          }.bind(this));
        }

        var abInRange = abastec;
        if (rng) {
          var start2 = rng[0], end2 = rng[1];
          abInRange = abastec.filter(function (a) {
            var d = this._parseAnyDate(a.data);
            return d && d >= start2 && d <= end2;
          }.bind(this));
        }

        // ---- agregações ----
        // custo materiais no período
        var custoMatAgg = matsInRange.reduce(function (s, m) {
          return s + (Number(m.qtde || 0) * Number(m.custoUnit || 0));
        }, 0);

        // combustível (litros e valor) do JSON de abastecimentos no período
        var litrosAgg = 0, valorAgg = 0;
        abInRange.forEach(function (ev) {
          var litros = Number(ev.litros || 0);
          var temValorDireto = ev.valor != null;
          var preco = (ev.preco != null ? Number(ev.preco) : (ev.precoLitro != null ? Number(ev.precoLitro) : 0));
          litrosAgg += litros;
          valorAgg  += temValorDireto ? Number(ev.valor || 0) : (preco * litros);
        });

        // data de referência (projetada a partir de MATERIAIS do período)
        // Pegamos a MAIS RECENTE (para ordenação decrescente)
        var dataRef = null;
        if (matsInRange.length > 0) {
          var maxTs = -Infinity;
          matsInRange.forEach(function (m) {
            var d = this._parseAnyDate(m.data);
            if (d && d.getTime() > maxTs) { maxTs = d.getTime(); }
          }.bind(this));
          if (maxTs > -Infinity) {
            var dref = new Date(maxTs);
            // Normaliza para YYYY-MM-DD (string)
            var mm = String(dref.getMonth() + 1).padStart(2, "0");
            var dd = String(dref.getDate()).padStart(2, "0");
            dataRef = dref.getFullYear() + "-" + mm + "-" + dd;
          }
        }

        // ---- escreve nos campos computados do veículo ----
        v.custoMaterialAgg       = custoMatAgg;
        v.combustivelLitrosAgg   = litrosAgg;
        v.combustivelValorAgg    = valorAgg;
        v.dataMatRef             = dataRef;                // usado na coluna "Data"
        v.rangeHasMateriais      = matsInRange.length > 0; // usado para filtrar linhas
      }, this);

      baseModel.setProperty("/veiculos", vlist);

      // Ordena a binding da tabela por dataMatRef desc (se você quiser manter a ordenação)
      // dica: a ordenação já é definida no XML via sorter por 'data'; se quiser, troque para 'dataMatRef' no XML.
    },

    // Aplica filtros na TABELA (categoria, veículo e "tem materiais no período")
    _applyTableFilters: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      var aFilters = [];

      // Filtra somente veículos que têm MATERIAIS no período
      aFilters.push(new Filter({
        path: "", // objeto todo
        test: function (oObj) { return !!oObj.rangeHasMateriais; }
      }));

      // Categoria
      var seg = this.byId("segCat");
      if (seg) {
        var cat = seg.getSelectedKey();
        if (cat && cat !== "__ALL__") {
          aFilters.push(new Filter("categoria", FilterOperator.EQ, cat));
        }
      }

      // Veículo
      var cbVeh = this.byId("inpVeiculo");
      if (cbVeh) {
        var vKey = cbVeh.getSelectedKey();
        if (vKey && vKey !== "__ALL__") {
          aFilters.push(new Filter("veiculo", FilterOperator.EQ, vKey));
        }
      }

      this.oTbl.getBinding("rows").filter(aFilters);
    },

    // KPIs calculados a partir dos agregados por período
    _recalcKpis: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      var arr = this.oTbl.getBinding("rows").getCurrentContexts().map(c => c.getObject());

      var totalLitros = arr.reduce((s, i) => s + (Number(i.combustivelLitrosAgg) || 0), 0);
      var totalValor  = arr.reduce((s, i) => s + (Number(i.combustivelValorAgg)  || 0), 0);
      var totalMat    = arr.reduce((s, i) => s + (Number(i.custoMaterialAgg)     || 0), 0);
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
