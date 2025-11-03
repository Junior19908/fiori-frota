sap.ui.define([
  "sap/ui/model/json/JSONModel"
], function (JSONModel) {
  "use strict";

  const DEFAULT = {
    lists: {
      categories: [],
      vehicles: []
    },
    selection: {
      categories: [],
      vehicles: [],
      dateFrom: null,
      dateTo: null
    }
  };

  function deepClone(source) {
    if (source == null || typeof source !== "object") {
      return source;
    }
    if (Array.isArray(source)) {
      return source.map(deepClone);
    }
    const target = {};
    Object.keys(source).forEach(function (key) {
      target[key] = deepClone(source[key]);
    });
    return target;
  }

  return {
    create: function (initial) {
      const safeInitial = initial && typeof initial === "object" ? deepClone(initial) : {};
      const merged = Object.assign({}, DEFAULT, safeInitial);
      // ensure nested structures exist before cloning defaults
      merged.lists = Object.assign({ categories: [], vehicles: [] }, DEFAULT.lists, safeInitial.lists);
      merged.selection = Object.assign({ categories: [], vehicles: [], dateFrom: null, dateTo: null }, DEFAULT.selection, safeInitial.selection);

      // normalise date serialization (localStorage stores as string)
      if (merged.selection.dateFrom && !(merged.selection.dateFrom instanceof Date)) {
        merged.selection.dateFrom = new Date(merged.selection.dateFrom);
      }
      if (merged.selection.dateTo && !(merged.selection.dateTo instanceof Date)) {
        merged.selection.dateTo = new Date(merged.selection.dateTo);
      }

      const model = new JSONModel(merged);
      model.setDefaultBindingMode("TwoWay");
      return model;
    },
    DEFAULT: deepClone(DEFAULT)
  };
});
