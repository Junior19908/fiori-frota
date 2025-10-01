sap.ui.define([], function () {
  "use strict";

  function pad2(n){ return String(n).padStart(2, "0"); }

  function monthsBetween(start, end) {
    const out = [];
    if (!(start instanceof Date) || !(end instanceof Date)) return out;
    let y = start.getFullYear(), m = start.getMonth();
    const y2 = end.getFullYear(), m2 = end.getMonth();
    while (y < y2 || (y === y2 && m <= m2)) {
      out.push({ y, m: m + 1 });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return out;
  }

  function toUrl(p) { return sap.ui.require.toUrl(p); }

  function fetchMonthlyLocal(y, m) {
    return new Promise(function(resolve){
      const mm = pad2(m);
      const url = toUrl("com/skysinc/frota/frota/model/localdata/" + y + "/" + mm + "/abastecimentos.json");
      jQuery.ajax({ url: url, dataType: "json", cache: false, success: (d)=> resolve(d), error: ()=> resolve(null) });
    });
  }

  function asBlob(obj) {
    const json = JSON.stringify(obj || {}, null, 2);
    try {
      return new Blob([json], { type: "application/json" });
    } catch (e) {
      // IE fallback not needed here
      return null;
    }
  }

  function getFirebase() {
    // Tenta carregar config local e SDK via CDN para evitar dependÃªncias de build
    return import("./settings/firebaseConfig.js").then(function (cfg) {
      if (cfg && cfg.storage) {
        // Config fornece instÃ¢ncias prontas
        return Promise.all([
          import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js")
        ]).then(function (mods) {
          var st = mods[0];
          return {
            storage: cfg.storage,
            ref: st.ref,
            uploadBytes: st.uploadBytes,
            getDownloadURL: st.getDownloadURL
          };
        });
      }
      var firebaseConfig = cfg && (cfg.firebaseConfig || cfg.default || null);
      if (!firebaseConfig) throw new Error("firebaseConfig.js nÃ£o encontrado ou invÃ¡lido.");
      return Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js")
      ]).then(function (mods) {
        var appMod = mods[0];
        var st = mods[1];
        var app = appMod.initializeApp(firebaseConfig);
        var storage = st.getStorage(app);
        return {
          storage: storage,
          ref: st.ref,
          uploadBytes: st.uploadBytes,
          getDownloadURL: st.getDownloadURL
        };
      });
    });
  }

  function getBucketFromConfig() {
    return import("./settings/firebaseConfig.js").then(function (cfg) {
      if (cfg && cfg.firebaseConfig && cfg.firebaseConfig.storageBucket) {
        return cfg.firebaseConfig.storageBucket;
      }
      // Se storage foi exportado, nÃ£o hÃ¡ mÃ©todo simples para extrair o bucket
      // entÃ£o retornamos null e caÃ­mos no caminho do SDK.
      return null;
    });
  }

  function restDownloadJson(bucket, path) {
    if (!bucket) return Promise.resolve(null);
    // Em dev, quando rodando via ui5-local.yaml, usamos proxy /storage para evitar CORS
    var base = (function(){ try { return /localhost|127\.0\.0\.1/.test(window.location.host) ? "/storage" : "https://firebasestorage.googleapis.com"; } catch(e){ return "https://firebasestorage.googleapis.com"; } })();
    var url = base + "/v0/b/" + encodeURIComponent(bucket) +
              "/o/" + encodeURIComponent(path) + "?alt=media";
    return new Promise(function (resolve) {
      jQuery.ajax({
        url: url,
        dataType: "text", // baixa como texto e tenta parsear
        cache: false,
        success: function (txt) {
          try { resolve(JSON.parse(txt)); }
          catch (e) {
            try { resolve(typeof txt === 'string' ? JSON.parse(txt.trim()) : null); }
            catch (_) { console.warn("[Firebase] NÃ£o foi possÃ­vel parsear JSON:", url); resolve(null); }
          }
        },
        error: function (xhr) {
          try {
            if (xhr && (xhr.status === 0 || xhr.readyState === 0)) {
              console.warn("[Firebase] Falha no GET (possÃ­vel CORS). Verifique CORS do bucket e a origem do app.", url);
            } else {
              console.warn("[Firebase] Falha no GET:", url, xhr && xhr.status, xhr && xhr.statusText);
            }
          } catch(_){}
          resolve(null);
        }
      });
    });
  }

  function parseGsUrl(gsUrl) {
    // gs://bucket/path/to/file
    if (typeof gsUrl !== "string" || gsUrl.indexOf("gs://") !== 0) return null;
    var s = gsUrl.substring(5);
    var slash = s.indexOf("/");
    if (slash <= 0) return null;
    return { bucket: s.substring(0, slash), path: s.substring(slash + 1) };
  }

  function uploadMonthlyToStorage(y, m, json) {
    if (!json) return Promise.resolve({ ok: false, reason: "empty" });
    return getFirebase().then(function (f) {
      const mm = pad2(m);
      const path = "abastecimentos/" + y + "/" + mm + "/abastecimentos.json";
      const sref = f.ref(f.storage, path);
      const blob = asBlob(json) || new Blob([JSON.stringify(json || {})], { type: "application/json" });
      return f.uploadBytes(sref, blob, { contentType: "application/json" })
        .then(function(){ return { ok: true, path: path }; })
        .catch(function (e) {
          var reason = (e && (e.message || e.code)) || "unknown";
          try {
            // Firebase Storage error may contain serverResponse on customData
            var sr = e && (e.serverResponse || (e.customData && e.customData.serverResponse));
            if (sr) reason += ": " + sr;
          } catch(_){}
          return { ok: false, reason: reason };
        });
    });
  }

  function exportMonth(y, m) {
    return fetchMonthlyLocal(y, m).then(function (data) {
      if (!data) return { ok: false, reason: "not-found" };
      return uploadMonthlyToStorage(y, m, data);
    });
  }

  function exportRange(start, end) {
    const months = monthsBetween(start, end);
    const results = [];
    let chain = Promise.resolve();
    months.forEach(function (it) {
      chain = chain.then(function(){
        return exportMonth(it.y, it.m).then(function (r) {
          results.push({ y: it.y, m: it.m, result: r });
        }).catch(function (e) {
          results.push({ y: it.y, m: it.m, result: { ok: false, reason: String(e && e.message || e) } });
        });
      });
    });
    return chain.then(function(){ return results; });
  }

  function fetchMonthlyFromStorage(y, m) {
    const mm = pad2(m);
    const path = "abastecimentos/" + y + "/" + mm + "/abastecimentos.json";
    // Usa diretamente o SDK para obter uma URL de download assinada (evita problemas de CORS/token)
    return getFirebase().then(function (f) {
      const sref = f.ref(f.storage, path);
      return f.getDownloadURL(sref).then(function (url) {
        return new Promise(function(resolve){
          jQuery.ajax({
            url: url,
            dataType: "text",
            cache: false,
            success: function (txt) {
              try { resolve(JSON.parse(txt)); }
              catch(_) { try { resolve(JSON.parse((txt||'').trim())); } catch(e2){ console.warn("[Firebase] JSON invÃ¡lido em", url); resolve(null);} }
            },
            error: function (xhr) {
              try {
                if (xhr && (xhr.status === 0 || xhr.readyState === 0)) {
                  console.warn("[Firebase] Falha no download (possÃ­vel CORS):", url, xhr && xhr.status, xhr && xhr.statusText);
                  console.warn("[Firebase] Dica: configure CORS no bucket do Storage para a origem deste app (ex.: http://localhost:8080)");
                } else {
                  console.warn("[Firebase] Falha no download URL:", url, xhr && xhr.status, xhr && xhr.statusText);
                }
              } catch(_){}
              resolve(null);
            }
          });
        });
      }).catch(function (e) {
        try {
          var reason = (e && (e.code || e.message)) || e || "unknown";
          var sr = e && (e.serverResponse || (e.customData && e.customData.serverResponse));
          if (sr) reason += ": " + sr;
          console.warn("[Firebase] getDownloadURL falhou para", path, reason);
        } catch(_){}
        // Fallback: tenta baixar via REST direto usando o bucket do config
        return getBucketFromConfig().then(function (bucket) {
          if (!bucket) return null;
          return restDownloadJson(bucket, path);
        });
      });
    });
  }

  function probe() {
    return getFirebase().then(function(){ return true; });
  }

  return {
    exportMonth: exportMonth,
    exportRange: exportRange,
    fetchMonthlyFromStorage: fetchMonthlyFromStorage,
    probe: probe,
    parseGsUrl: parseGsUrl,
    restDownloadJson: restDownloadJson
  };
});
