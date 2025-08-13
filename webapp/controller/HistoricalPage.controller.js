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

  // Classificação tolerante
  function classifyTipo(rawTipo) {
    const t = (rawTipo || "").toString().toLowerCase();
    if (t.startsWith("combust")) return "combustivel";
    if (t.includes("servi"))     return "servico";
    if (t.includes("material"))  return "material";       // "Material" ou "Material/Serviço"
    // default: se não informou tipo, tratamos como material
    return "material";
  }

  const sum = (arr, pick) => arr.reduce((s, x) => s + toNum(pick(x)), 0);

  // Data pura YYYY-MM-DD -> Date local 00:00
  function parseYMDLocal(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  }

  // Busca “elástica” por veículo
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

  return Controller.extend("com.skysinc.frota.frota.controller.HistoricalPage", {
    formatter: formatter,

    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("RouteHistorico")
        .attachPatternMatched(this._onRouteMatched, this);

      // Modelo de filtro do histórico
      this._histFilter = new JSONModel({
        tipo: "__ALL__",      // __ALL__ | Combustível | Material | Serviço
        q: "",                // busca por descrição
        d1: null,             // Date (JS) início
        d2: null              // Date (JS) fim
      });
      this.getView().setModel(this._histFilter, "hfilter");
    },

    _onRouteMatched: function (oEvent) {
      const sId = String(oEvent.getParameter("arguments").id || "");
      const oComp = this.getOwnerComponent();

      // 1) Veículo
      const aVeiculos = oComp.getModel()?.getProperty("/veiculos") || [];
      const oVeiculo  = aVeiculos.find(v => String(v.id) === sId) ||
                        aVeiculos.find(v => String(v.veiculo) === sId);
      if (!oVeiculo) {
        sap.m.MessageToast.show("Veículo não encontrado");
        return;
      }

      // 2) Listas
      const { aMat, aAb } = getListsByVehicle(oComp, sId, oVeiculo);

      // 3) Preço médio base do veículo (fallback)
      const litrosMes  = toNum(oVeiculo.combustivelLitros);
      const valorMes   = toNum(oVeiculo.combustivelValor);
      const precoMedioVeic = litrosMes ? (valorMes / litrosMes) : 0;

      // 4) Histórico unificado (BASE — não filtrar aqui)
      const base = [];

      // Materiais/Serviços
      aMat.forEach((m) => {
        const q   = Math.abs(toNum(m.qtde));
        const cu  = toNum(m.custoUnit);
        const tp  = classifyTipo(m.tipo);
        const desc = m.nome || m.descricao || "Item";
        base.push({
          data: m.data || null,
          tipo: tp === "servico" ? "Serviço" : "Material", // padroniza label
          descricao: desc,
          qtde: q,
          custoUnit: cu,
          valor: q * cu
        });
      });

      // Combustível
      aAb.forEach((a) => {
        const litros = toNum(a.litros);
        const precoLinha = toNum(a.precoLitro ?? a.preco); // aceita precoLitro ou preco
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

      // Ordenação inicial (data desc; nulos por último)
      base.sort((x, y) => {
        const dx = x.data ? new Date(x.data).getTime() : -Infinity;
        const dy = y.data ? new Date(y.data).getTime() : -Infinity;
        return dy - dx;
      });

      // Quebras iniciais (sem filtro)
      const historicoComb       = base.filter(h => h.tipo === "Combustível");
      const historicoMateriais  = base.filter(h => h.tipo === "Material");
      const historicoServicos   = base.filter(h => h.tipo === "Serviço");

      // Totais iniciais
      const totalComb = sum(historicoComb,      h => h.valor);
      const totalMat  = sum(historicoMateriais, h => h.valor);
      const totalServ = sum(historicoServicos,  h => h.valor);
      const totalGeral = totalComb + totalMat + totalServ;

      // Preço médio efetivo (base)
      const totLitros = sum(historicoComb, h => h.qtde);
      const precoMedioCalc = totLitros ? (totalComb / totLitros) : 0;
      const precoMedio = precoMedioVeic || precoMedioCalc;

      // Model "detail" + preserva base para filtros
      const oDetail = new JSONModel(Object.assign({}, oVeiculo, {
        // listas exibidas (começam com base)
        historico: base,
        historicoComb,
        historicoMateriais,
        historicoServicos,

        // contagens
        countComb: historicoComb.length,
        countMateriais: historicoMateriais.length,
        countServicos: historicoServicos.length,

        // numéricos
        totalCombustivel: totalComb,
        totalMateriais: totalMat,
        totalServicos: totalServ,
        totalGeral: totalGeral,
        precoMedio: precoMedio,

        // formatados
        totalCombustivelFmt: fmtBrl(totalComb),
        totalMateriaisFmt:   fmtBrl(totalMat),
        totalServicosFmt:    fmtBrl(totalServ),
        totalGeralFmt:       fmtBrl(totalGeral),
        precoMedioFmt:       fmtNum(precoMedio),

        // --- fonte base para filtros ---
        _src: {
          base
        }
      }));

      this.getView().setModel(oDetail, "detail");

      // limpa filtros ao entrar
      this._histFilter.setData({ tipo: "__ALL__", q: "", d1: null, d2: null });
    },

    // ============== Filtros do Histórico ==============
    onFilterChangeHist: function () {
      const m = this._histFilter.getData();
      const d1 = m.d1, d2 = m.d2;
      const tipo = m.tipo || "__ALL__";
      const q = (m.q || "").toLowerCase();

      const oDetail = this.getView().getModel("detail");
      if (!oDetail) return;

      const base = oDetail.getProperty("/_src/base") || [];

      // 1) aplica filtros na base
      const start = d1 ? new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 0,0,0,0) : null;
      const end   = d2 ? new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23,59,59,999) : null;

      const filt = base.filter((h) => {
        // tipo
        if (tipo !== "__ALL__" && h.tipo !== tipo) return false;
        // data
        if (start && end) {
          const dh = h.data ? parseYMDLocal(h.data) : null;
          if (!dh || dh < start || dh > end) return false;
        }
        // busca por descrição
        if (q) {
          const desc = (h.descricao || "").toLowerCase();
          if (!desc.includes(q)) return false;
        }
        return true;
      });

      // 2) requebras
      const historicoComb       = filt.filter(h => h.tipo === "Combustível");
      const historicoMateriais  = filt.filter(h => h.tipo === "Material");
      const historicoServicos   = filt.filter(h => h.tipo === "Serviço");

      // 3) totals + preço médio efetivo (no resultado filtrado)
      const totalComb = sum(historicoComb,      h => h.valor);
      const totalMat  = sum(historicoMateriais, h => h.valor);
      const totalServ = sum(historicoServicos,  h => h.valor);
      const totalGeral = totalComb + totalMat + totalServ;
      const totLitros = sum(historicoComb, h => h.qtde);
      const precoMedio = totLitros ? (totalComb / totLitros) : 0;

      // 4) aplica no model detail
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
    },

    onClearHistFilters: function(){
      this._histFilter.setData({ tipo: "__ALL__", q: "", d1: null, d2: null });
      // reaplica sem filtros
      this.onFilterChangeHist();
    }
  });
});
