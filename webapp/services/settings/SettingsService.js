sap.ui.define([
  "com/skysinc/frota/frota/services/settings/LocalSettingsRepository",
  "sap/base/Log"
], function (LocalSettingsRepository, Log) {
  "use strict";

  var STORAGE_KEY = "frota.settings.v1";

  var DEFAULTS = {
    showAllOS: false,
    osTypes: ["ZF01", "ZF02", "ZF03"],
    autoLoadMain: false,
    autoLoadIntervalSec: 30,
    mainDatePref: "yesterday",
    saveLocal: false,
    theme: "sap_horizon",
    avatarSrc: "",
    avatarInitials: "CJ"
  };

  function parseOr(v, d) {
    try { return JSON.parse(v); } catch (e) { return d; }
  }

  function getRepository(/* saveLocal */) {
    // Apenas repositório local (sem Firestore)
    return new LocalSettingsRepository();
  }

  function loadSettings() {
    // Persistência de preferência de local/remote em localStorage
    var persisted = parseOr(window.localStorage.getItem(STORAGE_KEY), null) || {};
    var repo = getRepository(true);

    return repo.load().then(function (obj) {
      var merged = Object.assign({}, DEFAULTS, obj || {});
      try { sap.ui.getCore().applyTheme(merged.theme); } catch (e) { /* ignore */ }
      return merged;
    }).catch(function (e) {
      Log.error("SettingsService.loadSettings fallback localStorage", e);
      var fallback = Object.assign({}, DEFAULTS, persisted || {});
      try { sap.ui.getCore().applyTheme(fallback.theme); } catch (e2) { /* ignore */ }
      return fallback;
    });
  }

  function saveSettings(settings) {
    var repo = getRepository(true);
    return repo.save(settings);
  }

  return {
    DEFAULTS: DEFAULTS,
    getRepository: getRepository,
    loadSettings: loadSettings,
    saveSettings: saveSettings
  };
});
