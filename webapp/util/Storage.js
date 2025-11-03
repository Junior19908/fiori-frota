sap.ui.define([], function () {
  "use strict";

  var NS = "com.skysinc.frota.filters";

  function load() {
    try {
      var stored = localStorage.getItem(NS);
      return stored ? JSON.parse(stored) : null;
    } catch (err) {
      return null;
    }
  }

  function save(state) {
    try {
      if (state == null) {
        localStorage.removeItem(NS);
        return;
      }
      var payload = JSON.stringify(state);
      localStorage.setItem(NS, payload);
    } catch (err) {
      // ignore quota errors; persistence is best-effort
    }
  }

  function clear() {
    try {
      localStorage.removeItem(NS);
    } catch (err) {
      // ignore
    }
  }

  return {
    load: load,
    save: save,
    clear: clear,
    _namespace: NS
  };
});
