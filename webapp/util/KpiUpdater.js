sap.ui.define([
  "com/skysinc/frota/frota/util/FilterBuilder",
  "com/skysinc/frota/frota/services/KpiService"
], function (FilterBuilder, KpiService) {
  "use strict";

  function ensureSelection(filterState) {
    var selection = FilterBuilder.normaliseSelection(filterState && filterState.selection);
    return selection;
  }

  function refresh(view, filterState, options) {
    if (!view) {
      return null;
    }
    var selection = ensureSelection(filterState);
    var payload = Object.assign({
      vehicleKeys: selection.vehicles,
      categoryKeys: selection.categories,
      dateFrom: selection.dateFrom,
      dateTo: selection.dateTo
    }, options || {});
    return KpiService.recalc(view, payload);
  }

  function updateFromList(view, list, filterState) {
    var selection = ensureSelection(filterState);
    var subset = Array.isArray(list) ? list.filter(function (item) {
      return FilterBuilder.testLocal(item, { selection: selection });
    }) : [];
    var totals = {
      totLitros: 0,
      totComb: 0,
      totMat: 0,
      precoMedio: 0
    };
    subset.forEach(function (row) {
      totals.totLitros += Number(row?.combustivelLitrosAgg || 0);
      totals.totComb += Number(row?.combustivelValorAgg || 0);
      var materialValue = row?.totalValor ?? row?.custoMateriaisAgg ?? row?.custoMaterialAgg ?? 0;
      totals.totMat += Number(materialValue || 0);
    });
    totals.precoMedio = totals.totLitros > 0 ? (totals.totComb / totals.totLitros) : 0;
    KpiService.recalc(view, {
      vehicleKeys: selection.vehicles,
      categoryKeys: selection.categories
    });
    return totals;
  }

  return {
    refresh: refresh,
    updateFromList: updateFromList
  };
});
