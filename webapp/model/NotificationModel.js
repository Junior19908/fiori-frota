sap.ui.define([
  "sap/ui/model/json/JSONModel"
], function (JSONModel) {
  "use strict";

  const DEFAULTS = {
    items: [],
    unread: 0,
    isOpen: false,
    lastFetch: null
  };

  return {
    create: function (initialData) {
      const payload = Object.assign({}, DEFAULTS, initialData || {});
      const model = new JSONModel(payload);
      model.setSizeLimit(500);
      return model;
    },
    DEFAULTS: DEFAULTS
  };
});
