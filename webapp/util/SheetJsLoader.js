sap.ui.define([], function () {
  "use strict";

  const CDN_ESM = "https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs";
  const CDN_FULL = "https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.full.min.js";
  let _promise = null;

  function normalizeModule(mod) {
    if (!mod) {
      return null;
    }
    const candidate = mod.default && (mod.default.read || mod.default.utils) ? mod.default : mod;
    if (candidate && typeof candidate.read === "function" && candidate.utils) {
      return candidate;
    }
    return null;
  }

  function ensureSheetJS() {
    if (_promise) {
      return _promise;
    }
    _promise = new Promise(function (resolve, reject) {
      function loadFromGlobal() {
        if (typeof window !== "undefined" && window.XLSX && typeof window.XLSX.read === "function") {
          resolve(window.XLSX);
          return;
        }
        if (typeof jQuery === "undefined" || !jQuery.sap || !jQuery.sap.includeScript) {
          reject(new Error("Biblioteca XLSX indisponível"));
          return;
        }
        jQuery.sap.includeScript(CDN_FULL, "sheetjs-xlsx", function () {
          if (typeof window !== "undefined" && window.XLSX && typeof window.XLSX.read === "function") {
            resolve(window.XLSX);
          } else {
            reject(new Error("Falha ao carregar XLSX"));
          }
        }, function (err) {
          reject(err || new Error("Falha ao carregar XLSX"));
        });
      }

      function loadFromEsm() {
        import(CDN_ESM).then(function (esm) {
          const shaped = normalizeModule(esm);
          if (shaped) {
            resolve(shaped);
          } else {
            loadFromGlobal();
          }
        }).catch(function () {
          loadFromGlobal();
        });
      }

      function loadFromAmd() {
        try {
          if (sap && sap.ui && sap.ui.require) {
            sap.ui.require(["xlsx"], function (mod) {
              const shaped = normalizeModule(mod);
              if (shaped) {
                resolve(shaped);
                return;
              }
              loadFromEsm();
            }, function () {
              loadFromEsm();
            });
            return;
          }
        } catch (_) {
          // ignore and fallback
        }
        loadFromEsm();
      }

      loadFromAmd();
    });
    return _promise;
  }

  return {
    load: ensureSheetJS
  };
});
