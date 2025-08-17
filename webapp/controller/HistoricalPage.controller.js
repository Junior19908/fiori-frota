// webapp/controller/HistoricalPage.controller.js
sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/formatter"
], function (Controller, JSONModel, formatter) {
  "use strict";

  // ===== helpers =====
  const toNum = (v) => Number(v || 0);
  const fmtBrl = (v) => {
    try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNum(v)); }
    catch (e) { return v; }
  };
  const fmtNum = (v) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toArray = (maybe) => Array.isArray(maybe) ? maybe : (maybe ? Object.values(maybe) : []);

  function classifyTipo(rawTipo) {
    const t = (rawTipo || "").toString().toLowerCase();
    if (t.startsWith("combust")) return "combustivel";
    if (t.includes("servi"))     return "servico";
    if (t.includes("material"))  return "material";
    return "material";
  }

  const sum = (arr, pick) => arr.reduce((s, x) => s + toNum(pick(x)), 0);

  function parseYMDLocal(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  }

  function getListsByVehicle(oComp, sId, oVeiculo) {
    const aMatById = toArray(oComp.getModel("materiais")?.getProperty("/materiaisPorVeiculo/" + sId));
    const aAbById  = toArray(oComp.getModel("abast")?.getProperty("/abastecimentosPorVeiculo/" + sId));

    const aMatGlobal = toArray(oComp.getModel()?.getProperty("/materiais")).filter(m => String(m.veiculoId) === String(sId));
    const aAbGlobal  = toArray(oComp.getModel()?.getProperty("/abastecimentos")).filter(a => String(a.veiculoId) === String(sId));

    const aMatInVeic = toArray(oVeiculo?.materiais);
    const aAbInVeic  = toArray(oVeiculo?.abastecimentos);

    const aMat = aMatById.length ? aMatById : (aMatGlobal.length ? aMatGlobal : aMatInVeic);
    const aAb  = aAbById.length  ? aAbById  : (aAbGlobal.length  ? aAbGlobal  : aAbInVeic);

    return { aMat, aAb };
  }

  function monthShortPt(m1to12) {
    const t = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    return t[(m1to12 - 1 + 12) % 12];
  }

  function ymKey(y, m) {
    return `${y}-${String(m).padStart(2,"0")}`;
  }

  function lastThreeMonthsAsc(refDate) {
    // retorna [{year, month}] em ordem do mais antigo -> mais recente
    const arr = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(refDate);
      d.setDate(1);                 // evita rollover
      d.setMonth(d.getMonth() - i);
      arr.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    return arr;
  }

  function aggregateByYM(items) {
    const map = new Map(); // "YYYY-MM" -> soma(valor)
    (items || []).forEach(it => {
      const d = it.data ? parseYMDLocal(it.data) : null;
      if (!d) return;
      const key = ymKey(d.getFullYear(), d.getMonth() + 1);
      map.set(key, (map.get(key) || 0) + toNum(it.valor));
    });
    return map;
  }

  return Controller.extend("com.skysinc.frota.frota.controller.HistoricalPage", {
    formatter: formatter,

    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("RouteHistorico")
        .attachPatternMatched(this._onRouteMatched, this);

      this._histFilter = new JSONModel({
        tipo: "__ALL__",
        q: "",
        d1: null,
        d2: null
      });
      this.getView().setModel(this._histFilter, "hfilter");

      // Model do gráfico principal (alternável) e subtítulo
      this._historyModel = new JSONModel({
        chartType: "column",
        points: [],
        subtitle: ""
      });
      this.getView().setModel(this._historyModel, "history");

      // Model do gráfico compacto lateral
      this._chartModel = new JSONModel({ header: "", rows: [] });
      this.getView().setModel(this._chartModel, "chart");

      // Aplica as propriedades dos VizFrames (corrigido: via API, não via XML)
      this._applyVizProps();
    },

    onAfterRendering: function () {
      // Garantia extra (caso o onInit rode antes da criação dos controles)
      this._applyVizProps();
    },

    _applyVizProps: function () {
      const commonProps = {
        legend: { visible: true },
        title: { visible: false },
        plotArea: { dataLabel: { visible: true } },
        valueAxis: { title: { visible: false } },
        categoryAxis: { title: { visible: false } },
        interaction: { selectability: { mode: "SINGLE" } }
      };

      const vf = this.byId("vf");
      if (vf) vf.setVizProperties(commonProps);

      const bar = this.byId("barCompare");
      if (bar) bar.setVizProperties(commonProps);
    },

    _onRouteMatched: function (oEvent) {
      const sId = String(oEvent.getParameter("arguments").id || "");
      const oComp = this.getOwnerComponent();

      const aVeiculos = oComp.getModel()?.getProperty("/veiculos") || [];
      const oVeiculo  = aVeiculos.find(v => String(v.id) === sId) ||
                        aVeiculos.find(v => String(v.veiculo) === sId);
      if (!oVeiculo) {
        sap.m.MessageToast.show("Veículo não encontrado");
        return;
      }

      const { aMat, aAb } = getListsByVehicle(oComp, sId, oVeiculo);

      const litrosMes  = toNum(oVeiculo.combustivelLitros);
      const valorMes   = toNum(oVeiculo.combustivelValor);
      const precoMedioVeic = litrosMes ? (valorMes / litrosMes) : 0;

      const base = [];

      aMat.forEach((m) => {
        const q   = Math.abs(toNum(m.qtde));
        const cu  = toNum(m.custoUnit);
        const tp  = classifyTipo(m.tipo);
        const desc = m.nome || m.descricao || "Item";
        base.push({
          data: m.data || null,
          tipo: tp === "servico" ? "Serviço" : "Material",
          descricao: desc,
          qtde: q,
          custoUnit: cu,
          valor: q * cu
        });
      });

      aAb.forEach((a) => {
        const litros = toNum(a.litros);
        const precoLinha = toNum(a.precoLitro ?? a.preco);
        const pL = precoLinha || precoMedioVeic || 0;
        base.push({
          data: a.data || null,
          tipo: "Combustível",
          descricao: a.descricao || "Abastecimento",
          qtde: litros,
          custoUnit: pL,
          valor: pL * litros
        });
      });

      base.sort((x, y) => {
        const dx = x.data ? new Date(x.data).getTime() : -Infinity;
        const dy = y.data ? new Date(y.data).getTime() : -Infinity;
        return dy - dx;
      });

      const historicoComb       = base.filter(h => h.tipo === "Combustível");
      const historicoMateriais  = base.filter(h => h.tipo === "Material");
      const historicoServicos   = base.filter(h => h.tipo === "Serviço");

      const totalComb = sum(historicoComb,      h => h.valor);
      const totalMat  = sum(historicoMateriais, h => h.valor);
      const totalServ = sum(historicoServicos,  h => h.valor);
      const totalGeral = totalComb + totalMat + totalServ;

      const totLitros = sum(historicoComb, h => h.qtde);
      const precoMedioCalc = totLitros ? (totalComb / totLitros) : 0;
      const precoMedio = precoMedioVeic || precoMedioCalc;

      const oDetail = new JSONModel(Object.assign({}, oVeiculo, {
        historico: base,
        historicoComb,
        historicoMateriais,
        historicoServicos,
        countComb: historicoComb.length,
        countMateriais: historicoMateriais.length,
        countServicos: historicoServicos.length,
        totalCombustivel: totalComb,
        totalMateriais: totalMat,
        totalServicos: totalServ,
        totalGeral: totalGeral,
        precoMedio: precoMedio,
        totalCombustivelFmt: fmtBrl(totalComb),
        totalMateriaisFmt:   fmtBrl(totalMat),
        totalServicosFmt:    fmtBrl(totalServ),
        totalGeralFmt:       fmtBrl(totalGeral),
        precoMedioFmt:       fmtNum(precoMedio),
        _src: { base }
      }));

      this.getView().setModel(oDetail, "detail");

      // Reset filtros e atualiza gráfico
      this._histFilter.setData({ tipo: "__ALL__", q: "", d1: null, d2: null });
      this._updateBothCharts();
    },

    _updateBothCharts: function () {
      // Atualiza gráfico principal (history>/points) + subtítulo
      this._updateMainChartModel();
      // Atualiza gráfico compacto lateral (chart>/rows + header)
      this._updateSideChartModel();
    },

    _updateMainChartModel: function () {
      // Usa o mesmo pipeline do side chart (3 meses atual vs anterior),
      // mas grava em history>/points com labels "Mmm/YY"
      const pack = this._computeThreeMonthsComparison();
      if (!pack) return;

      const points = pack.rows.map(r => ({
        label: r.mes,
        current: r.curr,
        previous: r.prev
      }));

      const subtitle = `Meses: ${pack.rows.map(r => r.mes).join(" • ")} — Ano Atual (${pack.curYearTxt}) × Ano Anterior (${pack.prevYearTxt})`;

      this._historyModel.setData({
        chartType: this._historyModel.getProperty("/chartType") || "column",
        points,
        subtitle
      }, true);
    },

    _updateSideChartModel: function () {
      const pack = this._computeThreeMonthsComparison();
      if (!pack) return;

      this._chartModel.setData({
        header: `Comparativo: Ano Atual (${pack.curYearTxt}) × Ano Anterior (${pack.prevYearTxt}) — Meses: ${pack.rows.map(r => r.mes).join(" • ")}`,
        rows: pack.rows
      }, true);
    },

    _computeThreeMonthsComparison: function () {
      const oDetail = this.getView().getModel("detail");
      if (!oDetail) return null;

      // Considera filtros (se ativos) sobre a base original
      const hf = this._histFilter.getData();
      const filtersActive = (hf.tipo !== "__ALL__") || (hf.q && hf.q.trim()) || hf.d1 || hf.d2;

      let items;
      if (filtersActive) {
        items = []
          .concat(oDetail.getProperty("/historicoComb") || [])
          .concat(oDetail.getProperty("/historicoMateriais") || [])
          .concat(oDetail.getProperty("/historicoServicos") || []);
      } else {
        items = (oDetail.getProperty("/_src/base") || []);
      }

      const byYM = aggregateByYM(items);
      const today = new Date();
      const trip = lastThreeMonthsAsc(today); // [{year, month}] mais antigo -> mais recente
      const prevTrip = trip.map(t => ({ year: t.year - 1, month: t.month }));

      const rows = trip.map((t, i) => {
        const prev = prevTrip[i];
        const currVal = toNum(byYM.get(ymKey(t.year, t.month)));
        const prevVal = toNum(byYM.get(ymKey(prev.year, prev.month)));
        const label = `${monthShortPt(t.month)}/${String(t.year).slice(-2)}`;
        return { mes: label, prev: prevVal, curr: currVal };
      });

      const curYears = [...new Set(trip.map(t => t.year))].sort();
      const prevYears = [...new Set(prevTrip.map(t => t.year))].sort();

      return {
        rows,
        curYearTxt: curYears.join(curYears.length > 1 ? "–" : ""),
        prevYearTxt: prevYears.join(prevYears.length > 1 ? "–" : "")
      };
    },

    onRefresh: function () {
      // Se houver backend, recarregue dados; aqui apenas reprocessa
      this._updateBothCharts();
    },

    onChartTypeChange: function (oEvent) {
      const sKey = oEvent.getParameter("item").getKey();
      this._historyModel.setProperty("/chartType", sKey === "line" ? "line" : "column");
      // Sem necessidade de reprocessar dados; o VizFrame troca o tipo
    },

    onFilterChangeHist: function () {
      const m = this._histFilter.getData();
      const d1 = m.d1, d2 = m.d2;
      const tipo = m.tipo || "__ALL__";
      const q = (m.q || "").toLowerCase();

      const oDetail = this.getView().getModel("detail");
      if (!oDetail) return;

      const base = oDetail.getProperty("/_src/base") || [];

      const start = d1 ? new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 0,0,0,0) : null;
      const end   = d2 ? new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23,59,59,999) : null;

      const filt = base.filter((h) => {
        if (tipo !== "__ALL__" && h.tipo !== tipo) return false;
        if (start && end) {
          const dh = h.data ? parseYMDLocal(h.data) : null;
          if (!dh || dh < start || dh > end) return false;
        }
        if (q) {
          const desc = (h.descricao || "").toLowerCase();
          if (!desc.includes(q)) return false;
        }
        return true;
      });

      const historicoComb       = filt.filter(h => h.tipo === "Combustível");
      const historicoMateriais  = filt.filter(h => h.tipo === "Material");
      const historicoServicos   = filt.filter(h => h.tipo === "Serviço");

      const totalComb = sum(historicoComb,      h => h.valor);
      const totalMat  = sum(historicoMateriais, h => h.valor);
      const totalServ = sum(historicoServicos,  h => h.valor);
      const totalGeral = totalComb + totalMat + totalServ;
      const totLitros = sum(historicoComb, h => h.qtde);
      const precoMedio = totLitros ? (totalComb / totLitros) : 0;

      oDetail.setProperty("/historico", filt);
      oDetail.setProperty("/historicoComb", historicoComb);
      oDetail.setProperty("/historicoMateriais", historicoMateriais);
      oDetail.setProperty("/historicoServicos", historicoServicos);

      oDetail.setProperty("/countComb", historicoComb.length);
      oDetail.setProperty("/countMateriais", historicoMateriais.length);
      oDetail.setProperty("/countServicos", historicoServicos.length);

      oDetail.setProperty("/totalCombustivel", totalComb);
      oDetail.setProperty("/totalMateriais", totalMat);
      oDetail.setProperty("/totalServicos", totalServ);
      oDetail.setProperty("/totalGeral", totalGeral);
      oDetail.setProperty("/precoMedio", precoMedio);

      oDetail.setProperty("/totalCombustivelFmt", fmtBrl(totalComb));
      oDetail.setProperty("/totalMateriaisFmt",   fmtBrl(totalMat));
      oDetail.setProperty("/totalServicosFmt",    fmtBrl(totalServ));
      oDetail.setProperty("/totalGeralFmt",       fmtBrl(totalGeral));
      oDetail.setProperty("/precoMedioFmt",       fmtNum(precoMedio));

      // Recalcula ambos os gráficos com base no resultado filtrado
      this._updateBothCharts();
    },

    onClearHistFilters: function(){
      this._histFilter.setData({ tipo: "__ALL__", q: "", d1: null, d2: null });
      this.onFilterChangeHist();
    }
  });
});
