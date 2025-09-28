sap.ui.define([
  "com/skysinc/frota/frota/services/settings/LocalSettingsRepository",
  "com/skysinc/frota/frota/services/settings/FirebaseSettingsRepository",
  "sap/base/Log"
], function (LocalSettingsRepository, FirebaseSettingsRepository, Log) {
  "use strict";

  var STORAGE_KEY = "frota.settings.v1";
  var DEFAULTS = {
    showAllOS: false,
    osTypes: ["ZF1", "ZF2", "ZF3"],
    autoLoadMain: false,
    autoLoadIntervalSec: 30,
    mainDatePref: "yesterday",
    saveLocal: true,
    theme: "sap_horizon",
    avatarSrc: "",
    avatarInitials: "CJ"
  };

  function parseOr(v, d) { try { return JSON.parse(v); } catch (e) { return d; } }

  function getRepository(saveLocal) {
    if (saveLocal === false) {
      return new FirebaseSettingsRepository();
    }
    return new LocalSettingsRepository();
  }

  function loadSettings() {
    // Persistência de preferência de local/remote em localStorage
    var persisted = parseOr(window.localStorage.getItem(STORAGE_KEY), null) || {};
    var saveLocal = (typeof persisted.saveLocal === "boolean") ? persisted.saveLocal : true;
    var repo = getRepository(saveLocal);
    return repo.load().then(function (obj) {
      var merged = Object.assign({}, DEFAULTS, obj || {});
      try { sap.ui.getCore().applyTheme(merged.theme); } catch (e) {}
      return merged;
    }).catch(function (e) {
      Log.error("SettingsService.loadSettings fallback localStorage", e);
      var fallback = Object.assign({}, DEFAULTS, persisted || {});
      try { sap.ui.getCore().applyTheme(fallback.theme); } catch (e2) {}
      return fallback;
    });
  }

  function saveSettings(settings) {
    var repo = getRepository(!!settings.saveLocal);
    return repo.save(settings);
  }

  return {
    DEFAULTS: DEFAULTS,
    getRepository: getRepository,
    loadSettings: loadSettings,
    saveSettings: saveSettings
  };
});

