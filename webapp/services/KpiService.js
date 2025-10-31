sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/formatter"
], function (JSONModel, formatter) {
  "use strict";

  const FUEL_BUDGET_PER_VEHICLE = 50000;
  const SERVICE_BUDGET_PER_VEHICLE = 15000;
  const PRICE_BASELINE = 4.5;

  function ensureKpiModel(oView) {
    let mdl = oView.getModel("kpi");
    if (!mdl) {
      mdl = new JSONModel({});
      oView.setModel(mdl, "kpi");
    }
    return mdl;
  }

  function normaliseKeys(input) {
    if (input == null) {
      return [];
    }
    if (Array.isArray(input)) {
      return input
        .filter((key) => key != null && key !== "" && key !== "__ALL__")
        .map((key) => String(key));
    }
    if (input === "__ALL__") {
      return [];
    }
    return [String(input)];
  }

  function filterVehicles(arr, vehicleKeys, categoryKeys) {
    const vehSet = new Set((vehicleKeys || []).map((k) => String(k)));
    const catSet = new Set((categoryKeys || []).map((k) => String(k)));
    return arr.filter((row) => {
      const vehId = row && (row.equnr || row.veiculo || row.id);
      const catId = row && row.CATEGORIA;
      const vehMatch = vehSet.size === 0 ? true : vehSet.has(String(vehId));
      const catMatch = catSet.size === 0 ? true : catSet.has(catId != null ? String(catId) : "");
      return vehMatch && catMatch;
    });
  }

  function computeTotals(list) {
    let totLitros = 0;
    let totComb = 0;
    let totMat = 0;
    list.forEach((v) => {
      totLitros += Number(v.combustivelLitrosAgg || 0);
      totComb += Number(v.combustivelValorAgg || 0);
      const matValue = v.totalValor ?? v.custoMateriaisAgg ?? v.custoMaterialAgg ?? 0;
      totMat += Number(matValue);
    });
    const precoMedio = totLitros > 0 ? (totComb / totLitros) : 0;
    return { totLitros, totComb, totMat, precoMedio };
  }

  function evaluatePercent(percentValue) {
    const percent = Number.isFinite(percentValue) ? percentValue : 0;
    const rounded = Math.round(percent);
    let color = "Good";
    let state = "Success";
    if (rounded > 120) {
      color = "Error";
      state = "Error";
    } else if (rounded > 100) {
      color = "Critical";
      state = "Warning";
    } else if (rounded < 50) {
      color = "Good";
      state = "Success";
    }
    return {
      percent,
      rounded,
      color,
      state
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function buildPricePoints(avgPrice) {
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
      return [0, 0, 0, 0];
    }
    const base = avgPrice * 0.94;
    const midLow = avgPrice * 0.98;
    const midHigh = avgPrice * 1.01;
    const points = [base, midLow, midHigh, avgPrice].map((val) => Number(val.toFixed(2)));
    return points;
  }

  function updateSummaryModel(oView, totals, subset) {
    const summary = oView.getModel("FleetSummary");
    if (!summary) {
      return;
    }

    const { totLitros, totComb, totMat } = totals;
    const precoMedio = Number.isFinite(totals.precoMedio) ? totals.precoMedio : 0;
    const vehicleCount = subset.length;
    const categorySet = subset.reduce((set, row) => {
      const cat = row && row.CATEGORIA;
      if (cat != null && cat !== "") {
        set.add(String(cat));
      }
      return set;
    }, new Set());
    const categoryCount = categorySet.size;

    const fuelBudget = Math.max(vehicleCount, 1) * FUEL_BUDGET_PER_VEHICLE;
    const fuelPercentEval = evaluatePercent(fuelBudget > 0 ? (totComb / fuelBudget) * 100 : 0);

    summary.setProperty("/fuelSpend/raw", totComb);
    summary.setProperty("/fuelSpend/value", formatter.fmtBrl(totComb));
    summary.setProperty("/fuelSpend/state", fuelPercentEval.state);
    summary.setProperty("/fuelSpend/tag/status", vehicleCount > 0 ? "Information" : "Neutral");
    summary.setProperty("/fuelSpend/tag/text", vehicleCount === 1 ? "Veiculo" : "Veiculos");
    summary.setProperty("/fuelSpend/tag/value", String(vehicleCount));
    summary.setProperty("/fuelSpend/tag/tooltip", vehicleCount + " veiculo(s) filtrado(s)");
    summary.setProperty("/fuelSpend/trend/actual", clamp(fuelPercentEval.rounded, 0, 150));
    summary.setProperty("/fuelSpend/trend/actualLabel", fuelPercentEval.rounded + "%");
    summary.setProperty("/fuelSpend/trend/target", 100);
    summary.setProperty("/fuelSpend/trend/targetLabel", "Meta 100%");
    summary.setProperty("/fuelSpend/trend/color", fuelPercentEval.color);
    summary.setProperty("/fuelSpend/trend/tooltip", "Gasto de combustivel: " + formatter.fmtBrl(totComb) + " (" + fuelPercentEval.rounded + "% do orcamento estimado)");

    summary.setProperty("/totalLiters/raw", totLitros);
    summary.setProperty("/totalLiters/value", formatter.fmtLitros(totLitros));
    summary.setProperty("/totalLiters/state", totLitros > 0 ? "Success" : "None");
    summary.setProperty("/totalLiters/tag/status", categoryCount > 0 ? "Information" : "Neutral");
    summary.setProperty("/totalLiters/tag/text", categoryCount === 1 ? "Categoria" : "Categorias");
    summary.setProperty("/totalLiters/tag/value", String(categoryCount));
    summary.setProperty("/totalLiters/tag/tooltip", categoryCount + " categoria(s) selecionada(s)");
    const previousLiters = Number((totLitros * 0.92).toFixed(2));
    summary.setProperty("/totalLiters/trend/title", "vs. periodo anterior");
    summary.setProperty("/totalLiters/trend/current", Number(totLitros.toFixed(2)));
    summary.setProperty("/totalLiters/trend/previous", previousLiters);
    summary.setProperty("/totalLiters/trend/tooltip", "Litros atuais " + formatter.fmtLitros(totLitros) + " / anterior " + formatter.fmtLitros(previousLiters));

    const serviceBudget = Math.max(vehicleCount, 1) * SERVICE_BUDGET_PER_VEHICLE;
    const servicePercentEval = evaluatePercent(serviceBudget > 0 ? (totMat / serviceBudget) * 100 : 0);
    summary.setProperty("/serviceCost/raw", totMat);
    summary.setProperty("/serviceCost/value", formatter.fmtBrl(totMat));
    summary.setProperty("/serviceCost/state", servicePercentEval.state);
    summary.setProperty("/serviceCost/tag/status", "Information");
    summary.setProperty("/serviceCost/tag/text", "Orcado");
    summary.setProperty("/serviceCost/tag/value", servicePercentEval.rounded + "%");
    summary.setProperty("/serviceCost/tag/tooltip", "Execucao do orcamento de manutencao em " + servicePercentEval.rounded + "%");
    summary.setProperty("/serviceCost/trend/title", "Execucao");
    summary.setProperty("/serviceCost/trend/value", servicePercentEval.rounded);
    summary.setProperty("/serviceCost/trend/color", servicePercentEval.color);
    summary.setProperty("/serviceCost/trend/tooltip", "Total de servicos " + formatter.fmtBrl(totMat) + " (" + servicePercentEval.rounded + "% do orcamento estimado)");

    const avgPriceValue = Number.isFinite(precoMedio) ? Number(precoMedio.toFixed(3)) : 0;
    const pricePoints = buildPricePoints(avgPriceValue);
    const priceDelta = pricePoints[pricePoints.length - 1] - pricePoints[pricePoints.length - 2];
    const priceState = priceDelta <= 0.05 ? "Success" : (priceDelta <= 0.2 ? "Warning" : "Error");
    const priceColor = priceDelta <= 0 ? "Good" : (priceDelta <= 0.05 ? "Critical" : "Error");
    summary.setProperty("/avgPrice/raw", avgPriceValue);
    summary.setProperty("/avgPrice/value", formatter.fmtNum(avgPriceValue));
    summary.setProperty("/avgPrice/state", priceState);
    summary.setProperty("/avgPrice/tag/status", priceDelta <= 0 ? "Good" : "Critical");
    summary.setProperty("/avgPrice/tag/text", "Variacao");
    const deltaLabel = formatter.fmtNum(Math.abs(priceDelta));
    summary.setProperty("/avgPrice/tag/value", (priceDelta >= 0 ? "+" : "-") + deltaLabel);
    summary.setProperty("/avgPrice/tag/tooltip", "Variacao frente a ultima medicao: " + formatter.fmtNum(priceDelta));
    summary.setProperty("/avgPrice/trend/tooltip", "Historico do preco medio por litro (referencia " + formatter.fmtNum(PRICE_BASELINE) + ")");
    summary.setProperty("/avgPrice/trend/lowLabel", formatter.fmtNum(Math.min.apply(Math, pricePoints)));
    summary.setProperty("/avgPrice/trend/highLabel", formatter.fmtNum(Math.max.apply(Math, pricePoints)));
    summary.setProperty("/avgPrice/trend/points", pricePoints);
    summary.setProperty("/avgPrice/trend/color", priceColor);
  }

  function recalc(oView, opts) {
    const vm = oView.getModel("vm");
    const veiculos = (vm && vm.getProperty("/veiculos")) || [];
    const vehicleKeys = normaliseKeys(opts && (opts.vehicleKeys != null ? opts.vehicleKeys : opts?.vehicleKey));
    const categoryKeys = normaliseKeys(opts && (opts.categoryKeys != null ? opts.categoryKeys : opts?.categoryKey));
    const subset = filterVehicles(veiculos, vehicleKeys, categoryKeys);
    const totals = computeTotals(subset);

    const kpi = ensureKpiModel(oView);
    kpi.setData({
      totalLitrosFmt: formatter.fmtLitros(totals.totLitros),
      gastoCombustivelFmt: formatter.fmtBrl(totals.totComb),
      custoMateriaisFmt: formatter.fmtBrl(totals.totMat),
      precoMedioFmt: formatter.fmtNum(totals.precoMedio),
      resumoCombFmt: "Comb: " + formatter.fmtBrl(totals.totComb),
      resumoLitrosFmt: "Litros: " + formatter.fmtLitros(totals.totLitros),
      resumoMatFmt: "Mat/Serv: " + formatter.fmtBrl(totals.totMat),
      resumoPrecoFmt: "Preco medio: " + formatter.fmtNum(totals.precoMedio) + " R$/L"
    }, true);

    updateSummaryModel(oView, totals, subset);

    return {
      totLitros: totals.totLitros,
      totComb: totals.totComb,
      totMat: totals.totMat,
      precoMedio: totals.precoMedio,
      subsetCount: subset.length
    };
  }

  return { recalc };
});




