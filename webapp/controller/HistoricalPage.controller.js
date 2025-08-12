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

  return Controller.extend("com/skysinc.frota.frota.controller.HistoricalPage", {
    formatter: formatter,

    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("RouteHistorico")
        .attachPatternMatched(this._onRouteMatched, this);
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

      // 4) Histórico unificado
      const historico = [];

      // Materiais/Serviços
      aMat.forEach((m) => {
        const q   = Math.abs(toNum(m.qtde));
        const cu  = toNum(m.custoUnit);
        const tp  = classifyTipo(m.tipo);
        const desc = m.nome || m.descricao || "Item";
        historico.push({
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
        const precoLinha = toNum(a.precoLitro);
        const pL = precoLinha || precoMedioVeic || 0;
        historico.push({
          data: a.data || null,
          tipo: "Combustível",
          descricao: a.descricao || "Abastecimento",
          qtde: litros,
          custoUnit: pL,
          valor: pL * litros
        });
      });

      // Ordenação (data desc; nulos por último)
      historico.sort((x, y) => {
        const dx = x.data ? new Date(x.data).getTime() : -Infinity;
        const dy = y.data ? new Date(y.data).getTime() : -Infinity;
        return dy - dx;
      });

      // 5) Quebras por categoria (usando os rótulos padronizados acima)
      const historicoComb       = historico.filter(h => h.tipo === "Combustível");
      const historicoMateriais  = historico.filter(h => h.tipo === "Material");
      const historicoServicos   = historico.filter(h => h.tipo === "Serviço");

      // 6) Totais
      const totalComb = sum(historicoComb,      h => h.valor);
      const totalMat  = sum(historicoMateriais, h => h.valor);
      const totalServ = sum(historicoServicos,  h => h.valor);
      const totalGeral = totalComb + totalMat + totalServ;

      // 7) Preço médio efetivo
      const totLitros = sum(historicoComb, h => h.qtde);
      const precoMedioCalc = totLitros ? (totalComb / totLitros) : 0;
      const precoMedio = precoMedioVeic || precoMedioCalc;

      // 8) JSONModel "detail"
      const oDetail = new JSONModel(Object.assign({}, oVeiculo, {
        // listas
        historico,
        historicoComb,
        historicoMateriais,
        historicoServicos,

        // contagens (útil pra debug/abas)
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
        precoMedioFmt:       fmtNum(precoMedio)
      }));

      this.getView().setModel(oDetail, "detail");
    }
  });
});
