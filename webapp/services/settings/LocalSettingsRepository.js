sap.ui.define([
  "com/skysinc/frota/frota/services/settings/SettingsRepository"
], function (SettingsRepository) {
  "use strict";

  var STORAGE_KEY = "frota.settings.v1";

  var DEFAULTS = {
    showAllOS: false,
    osTypes: ["ZF01", "ZF02", "ZF03"],
    autoLoadMain: false,
    autoLoadIntervalSec: 30,
    mainDatePref: "yesterday",
    saveLocal: true,
    theme: "sap_horizon",
    avatarSrc: "",
    avatarInitials: "CJ"
  };

  function parseOr(obj, def) { try { return JSON.parse(obj); } catch (e) { return def; } }

  function postToLocalMiddleware(settings) {
    // Tenta gravar via middleware de dev /local/settings
    var body = JSON.stringify(settings);
    if (typeof fetch === "function") {
      return fetch("/local/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: body })
        .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json().catch(function(){ return {}; }); });
    }
    // fallback com jQuery
    if (window.jQuery && jQuery.ajax) {
      return new Promise(function (resolve, reject) {
        jQuery.ajax({ url: "/local/settings", method: "POST", data: body, contentType: "application/json" })
          .done(function (data) { resolve(data); })
          .fail(function (xhr) { reject(new Error("AJAX " + (xhr && xhr.status))); });
      });
    }
    return Promise.reject(new Error("No fetch/jQuery available"));
  }

  var LocalSettingsRepository = function() { SettingsRepository.call(this); };
  LocalSettingsRepository.prototype = Object.create(SettingsRepository.prototype);
  LocalSettingsRepository.prototype.constructor = LocalSettingsRepository;

  LocalSettingsRepository.prototype.load = function () {
    return new Promise(function (resolve) {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var persisted = raw ? parseOr(raw, null) : null;
      resolve(Object.assign({}, DEFAULTS, persisted || {}));
    });
  };

  LocalSettingsRepository.prototype.save = function (settings) {
    // Sempre atualiza localStorage como fallback
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Falha ao gravar no localStorage", e);
    }
    // Tenta gravar o arquivo no projeto via middleware local (dev)
    return postToLocalMiddleware(settings).catch(function (e) {
      // eslint-disable-next-line no-console
      console.warn("/local/settings indisponÃ­vel; apenas localStorage atualizado.", e);
      // nÃ£o falha a operaÃ§Ã£o para manter a UX fluida em ambientes sem middleware
    });
  };

  return LocalSettingsRepository;
});
