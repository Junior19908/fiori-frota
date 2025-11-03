sap.ui.define([
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/Device"
], function (Filter, FilterOperator, Device) {
  "use strict";

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function dateToSap(date) {
    if (!(date instanceof Date)) {
      return null;
    }
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + "T00:00:00";
  }

  function normaliseSelection(selection) {
    var safe = selection || {};
    var clone = {
      categories: Array.isArray(safe.categories) ? safe.categories.slice() : [],
      vehicles: Array.isArray(safe.vehicles) ? safe.vehicles.slice() : [],
      dateFrom: safe.dateFrom instanceof Date ? safe.dateFrom : (safe.dateFrom ? new Date(safe.dateFrom) : null),
      dateTo: safe.dateTo instanceof Date ? safe.dateTo : (safe.dateTo ? new Date(safe.dateTo) : null)
    };
    return clone;
  }

  function buildMultiOrFilters(fieldName, values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    var filters = values.map(function (value) {
      return new Filter(fieldName, FilterOperator.EQ, value);
    });
    if (filters.length === 1) {
      return filters[0];
    }
    return new Filter({
      and: false,
      filters: filters
    });
  }

  function buildOData(filterState, customMap) {
    var list = [];
    var selection = normaliseSelection(filterState && filterState.selection);
    var fieldMap = Object.assign({
      categories: "Categoria",
      vehicles: "Veiculo",
      date: "Data"
    }, customMap || {});

    var catFilter = buildMultiOrFilters(fieldMap.categories, selection.categories);
    if (catFilter) {
      list.push(catFilter);
    }

    var vehFilter = buildMultiOrFilters(fieldMap.vehicles, selection.vehicles);
    if (vehFilter) {
      list.push(vehFilter);
    }

    if (selection.dateFrom) {
      list.push(new Filter(fieldMap.date, FilterOperator.GE, dateToSap(selection.dateFrom)));
    }
    if (selection.dateTo) {
      list.push(new Filter(fieldMap.date, FilterOperator.LE, dateToSap(selection.dateTo)));
    }
    return list;
  }

  function matchesLocal(item, filterState, options) {
    var selection = normaliseSelection(filterState && filterState.selection);
    var opts = Object.assign({
      categoryField: "Categoria",
      vehicleField: "Veiculo",
      dateField: "Data"
    }, options || {});

    function inSet(values, value) {
      if (!values || values.length === 0) {
        return true;
      }
      return values.indexOf(value) !== -1;
    }

    function normaliseDate(value) {
      if (value instanceof Date) {
        return value;
      }
      if (value && typeof value === "string") {
        var normalized = value.replace(/Z$/, "");
        var parsed = new Date(normalized);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      if (typeof value === "number") {
        var direct = new Date(value);
        if (!isNaN(direct.getTime())) {
          return direct;
        }
      }
      return null;
    }

    var itemCategory = item && item[opts.categoryField];
    var itemVehicle = item && (item[opts.vehicleField] || item.equnr || item.veiculo || item.id);
    var itemDate = item && item[opts.dateField];
    var dateValue = normaliseDate(itemDate);

    if (!inSet(selection.categories, itemCategory != null ? String(itemCategory) : "")) {
      return false;
    }

    if (!inSet(selection.vehicles, itemVehicle != null ? String(itemVehicle) : "")) {
      return false;
    }

    if (!selection.dateFrom && !selection.dateTo) {
      return true;
    }

    if (!dateValue) {
      return false;
    }

    var time = dateValue.getTime();
    if (selection.dateFrom && time < selection.dateFrom.getTime()) {
      return false;
    }
    if (selection.dateTo) {
      var endTime = selection.dateTo.getTime();
      if (Device.system.phone) {
        // on mobile the DateRangeSelection often aligns to midnight, so keep inclusive end of day
        endTime = endTime + 86399999; // add 23:59:59.999
      }
      if (time > endTime) {
        return false;
      }
    }
    return true;
  }

  return {
    buildOData: buildOData,
    testLocal: matchesLocal,
    normaliseSelection: normaliseSelection,
    dateToSap: dateToSap
  };
});
