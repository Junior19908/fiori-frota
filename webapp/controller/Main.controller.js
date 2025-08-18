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

    // =========================
    // CICLO DE VIDA
    // =========================
    onInit: function () {
      this.oTbl = this.byId("tbl");

      // Modelo de KPIs
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
          this._recalcAggByRange();     // agrega por período
          this._applyTableFilters();     // filtra por atividade
          this._recalcKpis();            // KPIs a partir das linhas visíveis
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

      this._maybeReloadByFilterMonth().then(function () {
        this._recalcAggByRange();
        this._applyTableFilters();
        this._recalcKpis();
      }.bind(this));
    },

    onClearFilters: function () {
      this.byId("drs")?.setDateValue(null);
      this.byId("drs")?.setSecondDateValue(null);
      this.byId("segCat")?.setSelectedKey("__ALL__");
      this.byId("inpVeiculo")?.setSelectedKey("__ALL__");
      this.byId("inpVeiculo")?.setValue("");

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

    // -------- Dialog Materiais
    onOpenMateriais: function (oEvent) {
      var item = this._ctx(oEvent);
      var key  = item.id || item.veiculo;

      var matModel = this.getView().getModel("materiais");
      var arr = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || item.materiais || [];

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

      if (!this._dlgModel) this._dlgModel = new sap.ui.model.json.JSONModel();
      this._dlgModel.setData({
        titulo: `Materiais — ${item.veiculo} — ${item.descricao || ""}`,
        materiais: arrFiltrada,
        totalItens,
        totalQtd,
        totalValor
      });

      this._openFragment(
        "com.skysinc.frota.frota.fragments.MaterialsDialog",
        "dlgMateriais",
        { dlg: this._dlgModel }
      );
    },
    onCloseMateriais: function () { this.byId("dlgMateriais")?.close(); },

    // -------- Dialog Abastecimentos (mantém cálculo Km/L/L/Km)
    onOpenAbastecimentos: function (oEvent) {
      var item = this._ctx(oEvent);
      var key  = item.id || item.veiculo;

      var abModel = this.getView().getModel("abast");
      var arr = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || item.abastecimentos || [];

      // --- FILTRO POR PERÍODO DO DRS ---
      var rng = this._currentRange(); // [start,end] ou null
      var list = arr;
      if (rng) {
        var start = rng[0], end = rng[1];
        list = arr.filter(function (a) {
          var d = this._parseAnyDate(a.data);
          return d && d >= start && d <= end;
        }.bind(this));
      }

      // --- ORDENAÇÃO POR DATA/HORA CRESCENTE ---
      var toTime = function (ev) {
        var d = this._parseAnyDate(ev.data) || new Date(0,0,1);
        if (ev.hora && /^\d{2}:\d{2}:\d{2}$/.test(String(ev.hora))) {
          var parts = ev.hora.split(":").map(Number);
          d.setHours(parts[0]||0, parts[1]||0, parts[2]||0, 0);
        }
        return d.getTime();
      }.bind(this);
      list = list.slice().sort(function (a,b){ return toTime(a) - toTime(b); });

      // --- HELPERS DE PARSE ---
      var parseNum = function (v) {
        if (v == null) return NaN;
        if (typeof v === "number") return v;
        var s = String(v).replace(/\s|Km/gi, "").replace(/\./g, "").replace(",", ".");
        var n = Number(s);
        return isNaN(n) ? NaN : n;
      };
      var readKm = function (ev) { return parseNum(ev.quilometragem ?? ev.km ?? ev.hodometro ?? ev.quilometragemKm); };
      var readHr = function (ev) { return parseNum(ev.hr); };

      // --- LIMIARES PARA EVITAR “ERROS” (ajuste se quiser) ---
      var MAX_KM_DELTA = 2000; // km entre dois abastecimentos
      var MAX_HR_DELTA = 200;  // horas entre dois abastecimentos

      // --- CÁLCULO POR LINHA + TOTAIS/MÉDIAS ---
      var totalLitros = 0;
      var somaKmDelta = 0;
      var somaHrDelta = 0;
      var hasKmDelta  = false;
      var hasHrDelta  = false;

      for (var j = 0; j < list.length; j++) {
        var ev = list[j];
        var litros = Number(ev.litros || 0);
        totalLitros += litros;

        ev._kmPerc = ev._kmPorL = ev._lPorKm = ev._lPorHr = null; // zera

        if (j === 0) continue;
        var prev = list[j-1];

        var kmCur = readKm(ev),   kmAnt = readKm(prev);
        var hrCur = readHr(ev),   hrAnt = readHr(prev);

        var dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : NaN;
        var dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : NaN;

        // valida delta de KM
        var kmValido = isFinite(dKm) && dKm > 0 && dKm <= MAX_KM_DELTA;
        // valida delta de HORAS
        var hrValido = isFinite(dHr) && dHr > 0 && dHr <= MAX_HR_DELTA;

        if (kmValido && litros > 0) {
          ev._kmPerc = dKm;
          ev._kmPorL = dKm / litros;
          ev._lPorKm = litros / dKm;
          somaKmDelta += dKm;
          hasKmDelta = true;
        }
        if (hrValido && litros > 0) {
          ev._lPorHr = litros / dHr;
          somaHrDelta += dHr;
          hasHrDelta = true;
        }
      }

      // --- MÉDIAS PARA O RODAPÉ DO DIALOG ---
      var mediaKmPorL = (totalLitros > 0 && somaKmDelta > 0) ? (somaKmDelta / totalLitros) : 0;
      var mediaLPorHr = (somaHrDelta > 0) ? (totalLitros / somaHrDelta) : 0;

      // --- REGRAS DE VISIBILIDADE (KM x HR) ---
      // Se houver QUALQUER delta de KM válido => mostramos só KM; senão, se houver HR => mostramos só HR.
      var showKm = false, showHr = false;
      if (hasKmDelta) {
        showKm = true;  showHr = false;
      } else if (hasHrDelta) {
        showKm = false; showHr = true;
      } else {
        // Sem deltas válidos: mostra ambos para o usuário ver os dados crus
        showKm = true;  showHr = true;
      }

      // --- MODEL DO DIALOG ---
      if (!this._fuelModel) this._fuelModel = new sap.ui.model.json.JSONModel();
      this._fuelModel.setData({
        titulo: `Abastecimentos — ${item.veiculo} — ${item.descricao || ""}`,
        eventos: list,
        totalLitros: totalLitros,
        mediaKmPorL: mediaKmPorL,
        mediaLPorHr: mediaLPorHr,
        showKm: showKm,
        showHr: showHr
      });

      // --- ABRE O FRAGMENT ---
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
      var s = String(v).trim();

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

    // ---- Parser numérico robusto para valores em pt-BR ----
    _numBR: function (v) {
      if (v == null || v === "") return 0;
      if (typeof v === "number" && isFinite(v)) return v;
      var s = String(v).trim()
        .replace(/[R$\s]/g, "") // remove R$ e espaços
        .replace(/\./g, "")     // remove separador de milhar
        .replace(",", ".");     // vírgula -> ponto
      var n = Number(s);
      return isFinite(n) ? n : 0;
    },

    // Carrega TODOS os meses do intervalo (quando existir API), senão cai para setMockYM
    _maybeReloadByFilterMonth: function () {
      var drs = this.byId("drs");
      if (!drs) return Promise.resolve();

      var d1 = drs.getDateValue();
      var d2 = drs.getSecondDateValue();
      if (!d1 || !d2) return Promise.resolve();

      var comp = this.getOwnerComponent();

      if (comp && typeof comp.setMockRange === "function") {
        // calcula último dia do mês de d2
        var lastDay = new Date(d2.getFullYear(), d2.getMonth() + 1, 0); // último dia do mês
        return comp.setMockRange(
          new Date(d1.getFullYear(), d1.getMonth(), 1),
          lastDay
        ).then(function () {
          this._recalcAggByRange();
        }.bind(this));
      }


      // fallback: ao menos mês de d1
      var yyyy = d1.getFullYear();
      var mm   = String(d1.getMonth() + 1).padStart(2, "0");
      var ym = yyyy + "-" + mm;

      if (comp && comp.setMockYM && comp.__currentYM !== ym) {
        return comp.setMockYM(yyyy, mm).then(function () {
          this._recalcAggByRange();
        }.bind(this));
      }
      return Promise.resolve();
    },

    // ====== DELTAS de KM/HR a partir dos abastecimentos ======
    _sumDeltasFromAbastecimentos: function (abastecList) {
      if (!Array.isArray(abastecList) || abastecList.length < 2) return { km: 0, hr: 0 };

      // ordena por data/hora
      var toTime = function (ev) {
        var d = this._parseAnyDate(ev.data) || new Date(0,0,1);
        if (ev.hora && /^\d{2}:\d{2}:\d{2}$/.test(String(ev.hora))) {
          var [H, M, S] = ev.hora.split(":").map(Number);
          d.setHours(H||0, M||0, S||0, 0);
        }
        return d.getTime();
      }.bind(this);
      var list = abastecList.slice().sort(function (a,b){ return toTime(a)-toTime(b); });

      var toNum = function (v) {
        if (v == null) return NaN;
        if (typeof v === "number") return v;
        var s = String(v).replace(/\s|Km/gi, "").replace(/\./g, "").replace(",", ".");
        var n = Number(s);
        return isNaN(n) ? NaN : n;
      };

      var totalKm = 0, totalHr = 0;
      for (var i = 1; i < list.length; i++) {
        var ant = list[i-1], cur = list[i];
        var kmAnt = toNum(ant.km), kmCur = toNum(cur.km);
        var hrAnt = toNum(ant.hr), hrCur = toNum(cur.hr);

        var dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : 0;
        var dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : 0;

        if (dKm > 0) totalKm += dKm;
        if (dHr > 0) totalHr += dHr;
      }
      return { km: totalKm, hr: totalHr };
    },

    // ======================================================
    // AGREGAÇÃO POR PERÍODO (MATERIAIS + ABASTECIMENTOS + DELTAS)
    // ======================================================
    _recalcAggByRange: function () {
      var baseModel = this.getView().getModel();
      var matModel  = this.getView().getModel("materiais");
      var abModel   = this.getView().getModel("abast");
      if (!baseModel) return;

      var vlist = baseModel.getProperty("/veiculos") || [];
      var rng = this._currentRange(); // [start, end] ou null

      vlist.forEach(function (v) {
        var key = v.id || v.veiculo;

        var materiais = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || v.materiais || [];
        var abastec   = (abModel  && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || v.abastecimentos || [];

        // --- filtra por período ---
        var matsInRange = materiais;
        var abInRange   = abastec;

        if (rng) {
          var start = rng[0], end = rng[1];
          matsInRange = materiais.filter(function (m) {
            var d = this._parseAnyDate(m.data);
            return d && d >= start && d <= end;
          }.bind(this));

          abInRange = abastec.filter(function (a) {
            var d = this._parseAnyDate(a.data);
            return d && d >= start && d <= end;
          }.bind(this));
        }

        // ---- agregações ----
        // (1) Materiais (R$)
        var custoMatAgg = matsInRange.reduce(function (s, m) {
          // manter Number aqui, pois dados de materiais costumam já vir numéricos
          return s + (Number(m.qtde || 0) * Number(m.custoUnit || 0));
        }, 0);

        // (2) Combustível (L e R$) — usando parser BR
        var litrosAgg = 0, valorAgg = 0;
        abInRange.forEach(function (ev) {
          var litros = this._numBR(ev.litros);
          litrosAgg += litros;

          // valor total do abastecimento, quando existir
          var valorTotal = this._numBR(ev.valor);
          if (valorTotal > 0) {
            valorAgg += valorTotal;
          } else {
            // preço por litro em possíveis chaves
            var preco = this._numBR(ev.preco ?? ev.precoLitro ?? ev.preco_litro ?? ev.precoUnit ?? ev.preco_unit ?? ev.precoUnitario);
            valorAgg += preco * litros;
          }
        }.bind(this));

        // (3) DELTAS de km e hr a partir dos abastecimentos do período
        var deltas = this._sumDeltasFromAbastecimentos(abInRange);

        // (4) Data mais recente entre MATERIAIS e ABASTECIMENTOS
        function maxDate(ts, v) {
          var d = this._parseAnyDate(v && v.data);
          return d ? Math.max(ts, d.getTime()) : ts;
        }
        var maxTs = -Infinity;
        matsInRange.forEach(function (m) { maxTs = maxDate.call(this, maxTs, m); }, this);
        abInRange.forEach(function (a) { maxTs = maxDate.call(this, maxTs, a); }, this);

        var dataRef = null;
        if (maxTs > -Infinity) {
          var dref = new Date(maxTs);
          var mm = String(dref.getMonth() + 1).padStart(2, "0");
          var dd = String(dref.getDate()).padStart(2, "0");
          dataRef = dref.getFullYear() + "-" + mm + "-" + dd;
        }

        // ---- aplica nos campos somas/divisões/multiplicações e etc usados na TABELA ----
        v.custoMaterialAgg       = custoMatAgg || 0;
        v.combustivelLitrosAgg   = litrosAgg   || 0;
        v.combustivelValorAgg    = valorAgg    || 0;
        v.kmRodadosAgg           = deltas.km   || 0;
        v.hrRodadosAgg           = deltas.hr   || 0;
        v.dataRef                = dataRef;
        v.rangeHasMateriais      = matsInRange.length > 0;
        v.rangeHasAbastec        = abInRange.length > 0;
        v.rangeHasActivity       = v.rangeHasMateriais || v.rangeHasAbastec;

        v.custoTotalAgg   = (v.custoMaterialAgg || 0) + (v.combustivelValorAgg || 0);
        v.funcaokmcomb    = (v.combustivelLitrosAgg ? (v.kmRodadosAgg / v.combustivelLitrosAgg) : 0);
        v.funcaohrRodados = (v.hrRodadosAgg ? (v.combustivelLitrosAgg / v.hrRodadosAgg) : 0);
      }, this);

      baseModel.setProperty("/veiculos", vlist);
    },

    // Aplica filtros na TABELA (categoria, veículo e "tem atividade no período")
    _applyTableFilters: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      var aFilters = [];

      // Mostra linhas que tenham QUALQUER atividade no período
      aFilters.push(new Filter({
        path: "",
        test: function (oObj) { return !!oObj.rangeHasActivity; }
      }));

      var seg = this.byId("segCat");
      if (seg) {
        var cat = seg.getSelectedKey();
        if (cat && cat !== "__ALL__") {
          aFilters.push(new Filter("categoria", FilterOperator.EQ, cat));
        }
      }

      var cbVeh = this.byId("inpVeiculo");
      if (cbVeh) {
        var vKey = cbVeh.getSelectedKey();
        if (vKey && vKey !== "__ALL__") {
          aFilters.push(new Filter("veiculo", FilterOperator.EQ, vKey));
        }
      }

      this.oTbl.getBinding("rows").filter(aFilters);
    },

    // KPIs a partir das linhas visíveis
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
