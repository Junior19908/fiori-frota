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

      // KPI
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
          this._recalcAggByRange();
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

    // -------- Dialog Materiais (com correção de DATA + HORA)
    onOpenMateriais: function (oEvent) {
  var item = this._ctx(oEvent);
  var key  = item.id || item.veiculo;

  // 1) fontes
  var matModel  = this.getView().getModel("materiais");
  var fromModel = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || [];
  var fromItem  = Array.isArray(item.materiais) ? item.materiais : [];

  // 2) união deduplicada por assinatura robusta
  var mergeBySig = function (A, B) {
    var sig = m => [
      m.data || "",
      m.horaEntrada || "",
      String(m.nReserva ?? ""),
      String(m.nOrdem ?? ""),
      String(m.nItem ?? ""),
      String(m.codMaterial ?? "")
    ].join("|");
    var map = new Map();
    (A || []).forEach(m => map.set(sig(m), m));
    (B || []).forEach(m => map.set(sig(m), m));
    return Array.from(map.values());
  };
  var arr = mergeBySig(fromModel, fromItem);

  // 3) logs de origem
  console.groupCollapsed("[Materiais] Fonte e contagem para veículo", key);
  console.log("fromModel:", fromModel.length);
  console.table(fromModel.map((m,i)=>({idx:i,Data:m.data,Hora:m.horaEntrada,nItem:m.nItem,Cod:m.codMaterial,Item:m.nome||m.material||m.descricao,Qtde:m.qtde,Custo:m.custoUnit})));
  console.log("fromItem :", fromItem.length);
  console.table(fromItem.map((m,i)=>({idx:i,Data:m.data,Hora:m.horaEntrada,nItem:m.nItem,Cod:m.codMaterial,Item:m.nome||m.material||m.descricao,Qtde:m.qtde,Custo:m.custoUnit})));
  console.log("arr(merge):", arr.length);
  console.table(arr.map((m,i)=>({idx:i,Data:m.data,Hora:m.horaEntrada,nItem:m.nItem,Cod:m.codMaterial,Item:m.nome||m.material||m.descricao,Qtde:m.qtde,Custo:m.custoUnit})));
  console.groupEnd();

  // 4) filtro por período (data + hora)
  var rng = this._currentRange();
  var arrFiltrada = arr, start, end;
  if (rng) {
    start = rng[0]; end = rng[1];
    var parseDateTime = function (m) {
      var d = this._parseAnyDate(m.data); if (!d) return null;
      if (m.horaEntrada && /^\d{2}:\d{2}:\d{2}$/.test(String(m.horaEntrada))) {
        var p = m.horaEntrada.split(":").map(Number);
        d.setHours(p[0]||0, p[1]||0, p[2]||0, 0);
      } else {
        d.setHours(23,59,59,999);
      }
      return d;
    }.bind(this);
    arrFiltrada = arr.filter(m => {
      var dt = parseDateTime(m);
      return dt && dt >= start && dt <= end;
    });
  }

  // 5) logs pós-filtro
  console.groupCollapsed("[Materiais] Pós-filtro DRS", key);
  if (start && end) console.log("Período:", start, "→", end);
  console.log("Filtrados:", arrFiltrada.length);
  console.table(arrFiltrada.map((m,i)=>({idx:i,Data:m.data,Hora:m.horaEntrada,nItem:m.nItem,Cod:m.codMaterial,Item:m.nome||m.material||m.descricao,Qtde:m.qtde,Custo:m.custoUnit})));
  console.groupEnd();

  // 6) totals + abrir diálogo
  var totalItens = arrFiltrada.length;
  var totalQtd   = arrFiltrada.reduce((s,m)=>s+(+m.qtde||0),0);
  var totalValor = arrFiltrada.reduce((s,m)=>s+((+m.qtde||0)*(+m.custoUnit||0)),0);

  this._dlgModel = this._dlgModel || new sap.ui.model.json.JSONModel();
  this._dlgModel.setData({
    titulo: `Materiais — ${item.veiculo} — ${item.descricao || ""}`,
    veiculo: item.veiculo || "",
    descricaoVeiculo: item.descricao || "",
    materiais: arrFiltrada,
    totalItens, totalQtd, totalValor
  });
  this._openFragment("com.skysinc.frota.frota.fragments.MaterialsDialog", "dlgMateriais", { dlg: this._dlgModel });
}
,

    onCloseMateriais: function () { this.byId("dlgMateriais")?.close(); },

    // -------- Exportar / Imprimir (botões do fragment)
    onExportMateriais: function () {
      var dlgModel = this._dlgModel;
      if (!dlgModel) { sap.m.MessageToast.show("Abra o diálogo de materiais primeiro."); return; }

      var data = dlgModel.getData() || {};
      var rows = (data.materiais || []).map(function (m) {
        var qtde  = Number(m.qtde || 0);
        var custo = Number(m.custoUnit || 0);
        var total = qtde * custo;
        return {
          Veiculo: data.veiculo || "",
          DescricaoVeiculo: data.descricaoVeiculo || "",
          Item: m.nome || m.material || m.descricao || "",
          Tipo: m.tipo || "",
          Quantidade: qtde,
          CustoUnitario: custo,
          TotalItem: total,
          CodMaterial: m.codMaterial || "",
          Deposito: m.deposito || "",
          Hora: this.formatter.fmtHora(m.horaEntrada || ""),
          Data: this.formatter.fmtDate(m.data || ""),
          N_Ordem: m.nOrdem || "",
          N_Reserva: m.nReserva || "",
          N_Item: m.nItem || "",
          Recebedor: m.recebedor || "",
          Unid: m.unid || "",
          Usuario: m.usuario || "",
          Status: (this.formatter.isDevolucao && this.formatter.isDevolucao(m.qtde)) ? "DEVOLUÇÃO" : ""
        };
      }.bind(this));

      if (!rows.length) {
        sap.m.MessageToast.show("Sem materiais no período selecionado.");
        return;
      }

      var drs = this.byId("drs");
      var d1 = drs?.getDateValue(), d2 = drs?.getSecondDateValue();
      var nome = "materiais_" +
        (data.veiculo || "veiculo") + "_" +
        (d1 ? this._ymd(d1) : "inicio") + "_" +
        (d2 ? this._ymd(d2) : "fim") + ".csv";

      var csv = this._buildCsv(rows);
      this._downloadCsv(csv, nome);
    },

    onPrintMateriais: function () {
      var dlg = this.byId("dlgMateriais");
      if (!dlg) { sap.m.MessageToast.show("Abra o diálogo de materiais primeiro."); return; }

      var win = window.open("", "_blank", "noopener,noreferrer");
      if (!win) { sap.m.MessageBox.warning("Bloqueador de pop-up? Permita para imprimir."); return; }

      var title = (this._dlgModel?.getProperty("/titulo")) || "Materiais";
      var contentDom = dlg.getAggregation("content")[0].getDomRef()?.cloneNode(true);

      win.document.write("<html><head><meta charset='utf-8'><title>"+ title +"</title>");
      win.document.write("<style>body{font-family:Arial,Helvetica,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;font-size:12px} th{background:#f5f5f5} h1{font-size:18px;margin:0 0 12px}</style>");
      win.document.write("</head><body><h1>"+ title +"</h1>");
      if (contentDom) {
        var toolbars = contentDom.querySelectorAll(".sapMTB");
        toolbars.forEach(function(tb){ tb.parentNode && tb.parentNode.removeChild(tb); });
        win.document.body.appendChild(contentDom);
      }
      win.document.write("</body></html>");
      win.document.close();
      win.focus();
      win.print();
      win.close();
    },

    // -------- Abastecimentos (sem alterações funcionais)
    onOpenAbastecimentos: function (oEvent) {
      var item = this._ctx(oEvent);
      var key  = item.id || item.veiculo;

      var abModel = this.getView().getModel("abast");
      var arr = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || item.abastecimentos || [];

      var rng = this._currentRange();
      var list = arr;
      if (rng) {
        var start = rng[0], end = rng[1];
        list = arr.filter(function (a) {
          var d = this._parseAnyDate(a.data);
          return d && d >= start && d <= end;
        }.bind(this));
      }

      var toTime = function (ev) {
        var d = this._parseAnyDate(ev.data) || new Date(0,0,1);
        if (ev.hora && /^\d{2}:\d{2}:\d{2}$/.test(String(ev.hora))) {
          var parts = ev.hora.split(":").map(Number);
          d.setHours(parts[0]||0, parts[1]||0, parts[2]||0, 0);
        }
        return d.getTime();
      }.bind(this);
      list = list.slice().sort(function (a,b){ return toTime(a) - toTime(b); });

      var parseNum = function (v) {
        if (v == null) return NaN;
        if (typeof v === "number") return v;
        var s = String(v).replace(/\s|Km/gi, "").replace(/\./g, "").replace(",", ".");
        var n = Number(s);
        return isNaN(n) ? NaN : n;
      };
      var readKm = function (ev) { return parseNum(ev.quilometragem ?? ev.km ?? ev.hodometro ?? ev.quilometragemKm); };
      var readHr = function (ev) { return parseNum(ev.hr); };

      var MAX_KM_DELTA = 2000;
      var MAX_HR_DELTA = 200;

      var totalLitros = 0;
      var somaKmDelta = 0;
      var somaHrDelta = 0;
      var hasKmDelta  = false;
      var hasHrDelta  = false;

      for (var j = 0; j < list.length; j++) {
        var ev = list[j];
        var litros = Number(ev.litros || 0);
        totalLitros += litros;

        ev._kmPerc = ev._kmPorL = ev._lPorKm = ev._lPorHr = null;

        if (j === 0) continue;
        var prev = list[j-1];

        var kmCur = readKm(ev),   kmAnt = readKm(prev);
        var hrCur = readHr(ev),   hrAnt = readHr(prev);

        var dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : NaN;
        var dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : NaN;

        var kmValido = isFinite(dKm) && dKm > 0 && dKm <= MAX_KM_DELTA;
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

      var mediaKmPorL = (totalLitros > 0 && somaKmDelta > 0) ? (somaKmDelta / totalLitros) : 0;
      var mediaLPorHr = (somaHrDelta > 0) ? (totalLitros / somaHrDelta) : 0;

      var showKm = false, showHr = false;
      if (hasKmDelta) {
        showKm = true;  showHr = false;
      } else if (hasHrDelta) {
        showKm = false; showHr = true;
      } else {
        showKm = true;  showHr = true;
      }

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

      this._openFragment(
        "com.skysinc.frota.frota.fragments.FuelDialog",
        "dlgFuel",
        { fuel: this._fuelModel }
      );
    },
    onCloseFuel: function () { this.byId("dlgFuel")?.close(); },

    // =========================
    // HELPERS CSV / UTIL
    // =========================
    _buildCsv: function (rows) {
      if (!Array.isArray(rows) || rows.length === 0) return "";
      var headers = Object.keys(rows[0]);

      var esc = function (v) {
        if (v == null) return "";
        if (typeof v === "number") {
          return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        var s = String(v);
        if (/[;"\n\r]/.test(s)) {
          s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      var lines = [];
      lines.push(headers.join(";"));
      rows.forEach(function (r) {
        var line = headers.map(function (h) { return esc(r[h]); }).join(";");
        lines.push(line);
      });

      return "\uFEFF" + lines.join("\n"); // BOM para Excel
    },

    _downloadCsv: function (csvString, filename) {
      try {
        var blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename || "dados.csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
        sap.m.MessageToast.show("CSV gerado com sucesso.");
      } catch (e) {
        console.error("Falha ao baixar CSV:", e);
        sap.m.MessageBox.error("Não foi possível gerar o CSV. Verifique o console.");
      }
    },

    _ymd: function (d) {
      var yyyy = d.getFullYear();
      var mm = String(d.getMonth() + 1).padStart(2, "0");
      var dd = String(d.getDate()).padStart(2, "0");
      return yyyy + "-" + mm + "-" + dd;
    },

    // =========================
    // HELPERS GERAIS
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

    _numBR: function (v) {
      if (v == null || v === "") return 0;
      if (typeof v === "number" && isFinite(v)) return v;
      var s = String(v).trim()
        .replace(/[R$\s]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      var n = Number(s);
      return isFinite(n) ? n : 0;
    },

    _maybeReloadByFilterMonth: function () {
      var drs = this.byId("drs");
      if (!drs) return Promise.resolve();

      var d1 = drs.getDateValue();
      var d2 = drs.getSecondDateValue();
      if (!d1 || !d2) return Promise.resolve();

      var comp = this.getOwnerComponent();

      if (comp && typeof comp.setMockRange === "function") {
        var lastDay = new Date(d2.getFullYear(), d2.getMonth() + 1, 0);
        return comp.setMockRange(
          new Date(d1.getFullYear(), d1.getMonth(), 1),
          lastDay
        ).then(function () {
          this._recalcAggByRange();
        }.bind(this));
      }

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

    _sumDeltasFromAbastecimentos: function (abastecList) {
      if (!Array.isArray(abastecList) || abastecList.length < 2) return { km: 0, hr: 0 };

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

    _recalcAggByRange: function () {
      var baseModel = this.getView().getModel();
      var matModel  = this.getView().getModel("materiais");
      var abModel   = this.getView().getModel("abast");
      if (!baseModel) return;

      var vlist = baseModel.getProperty("/veiculos") || [];
      var rng = this._currentRange();

      vlist.forEach(function (v) {
        var key = v.id || v.veiculo;

        var materiais = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || v.materiais || [];
        var abastec   = (abModel  && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || v.abastecimentos || [];

        var matsInRange = materiais;
        var abInRange   = abastec;

        if (rng) {
          var start = rng[0], end = rng[1];
          var parseDateTime = function (obj) {
            var d = this._parseAnyDate(obj.data);
            if (!d) return null;
            if (obj.horaEntrada && /^\d{2}:\d{2}:\d{2}$/.test(String(obj.horaEntrada))) {
              var p = obj.horaEntrada.split(":").map(Number);
              d.setHours(p[0] || 0, p[1] || 0, p[2] || 0, 0);
            } else {
              d.setHours(23, 59, 59, 999);
            }
            return d;
          }.bind(this);

          matsInRange = materiais.filter(function (m) {
            var dt = parseDateTime(m);
            return dt && dt >= start && dt <= end;
          });

          abInRange = abastec.filter(function (a) {
            var d = this._parseAnyDate(a.data);
            return d && d >= start && d <= end;
          }.bind(this));
        }

        var custoMatAgg = matsInRange.reduce(function (s, m) {
          return s + (Number(m.qtde || 0) * Number(m.custoUnit || 0));
        }, 0);

        var litrosAgg = 0, valorAgg = 0;
        abInRange.forEach(function (ev) {
          var litros = this._numBR(ev.litros);
          litrosAgg += litros;

          var valorTotal = this._numBR(ev.valor);
          if (valorTotal > 0) {
            valorAgg += valorTotal;
          } else {
            var preco = this._numBR(ev.preco ?? ev.precoLitro ?? ev.preco_litro ?? ev.precoUnit ?? ev.preco_unit ?? ev.precoUnitario);
            valorAgg += preco * litros;
          }
        }.bind(this));

        var deltas = this._sumDeltasFromAbastecimentos(abInRange);

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

    _applyTableFilters: function () {
      if (!this.oTbl || !this.oTbl.getBinding("rows")) return;

      var aFilters = [];
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
