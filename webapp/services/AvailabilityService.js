sap.ui.define([
  "sap/ui/thirdparty/jquery"
], function ($) {
  "use strict";

  var __fb = null; // { db, collection, getDocs, query, where, orderBy, limit, startAfter }
  var __appInitPromise = null;

  function parseISOZ(s) {
    if (!s) return null;
    try {
      var str = String(s).trim();
      if (!str) return null;
      var d = new Date(str);
      return isNaN(d) ? null : d;
    } catch (e) { return null; }
  }

  function initFirebaseIfNeeded() {
    if (__fb) return Promise.resolve(__fb);
    if (__appInitPromise) return __appInitPromise;

    __appInitPromise = import("./settings/firebaseConfig.js").then(function (cfg) {
      var firebaseConfig = cfg && (cfg.firebaseConfig || cfg.default || null);
      if (cfg && cfg.db) {
        // db já fornecido externamente (ambiente hospedado)
        return Promise.all([
          import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
        ]).then(function (mods) {
          var fs = mods[0];
          __fb = {
            db: cfg.db,
            collection: fs.collection,
            getDocs: fs.getDocs,
            query: fs.query,
            where: fs.where,
            orderBy: fs.orderBy,
            limit: fs.limit,
            startAfter: fs.startAfter
          };
          return __fb;
        });
      }
      if (!firebaseConfig) throw new Error("firebaseConfig ausente.");
      return Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
      ]).then(function (mods) {
        var appMod = mods[0];
        var fs = mods[1];
        var app;
        try {
          app = appMod.getApps && appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
        } catch (e) {
          app = appMod.initializeApp(firebaseConfig);
        }
        var db = fs.getFirestore(app);
        __fb = {
          db: db,
          collection: fs.collection,
          getDocs: fs.getDocs,
          query: fs.query,
          where: fs.where,
          orderBy: fs.orderBy,
          limit: fs.limit,
          startAfter: fs.startAfter
        };
        return __fb;
      });
    }).catch(function (e) {
      __appInitPromise = null;
      throw e;
    });

    return __appInitPromise;
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function fetchOsByVehiclesAndRange(vehicleIds, range) {
    await initFirebaseIfNeeded();

    var map = new Map();
    var ids = Array.isArray(vehicleIds) ? vehicleIds.map(function (v){ return String(v || "").trim(); }).filter(Boolean) : [];
    // dedup
    ids = Array.from(new Set(ids));
    if (!ids.length) return map;

    var rangeFrom = (range && range.from instanceof Date) ? range.from : null;
    var rangeTo   = (range && range.to   instanceof Date) ? range.to   : null;

    // Firestore: where('in') suporta até 10 valores
    var chunks = chunk(ids, 10);

    for (var c = 0; c < chunks.length; c++) {
      var list = chunks[c];
      try {
        var cref = __fb.collection(__fb.db, "ordensServico");
        var q = __fb.query(cref, __fb.where("Equipamento", "in", list));

        var snap = await __fb.getDocs(q);
        if (!snap) continue;

        var docs = [];
        if (Array.isArray(snap.docs)) docs = snap.docs;
        else if (typeof snap.forEach === 'function') {
          snap.forEach(function (d) { docs.push(d); });
        }

        for (var i = 0; i < docs.length; i++) {
          var d = docs[i];
          var data = (d && d.data && d.data()) || {};
          var equipamento = String(data.Equipamento || "").trim();
          if (!equipamento) continue;

          var abStr = data.DataAbertura || data.dataAbertura || data.Abertura || data.AberturaData || null;
          var feStr = data.DataFechamento || data.dataFechamento || data.Fechamento || data.FechamentoData || null;
          var abertura = parseISOZ(abStr);
          var fechamento = parseISOZ(feStr);

          // Filtro de interseção no cliente
          var okByDate = true;
          if (rangeFrom || rangeTo) {
            var abOk = abertura && ( !rangeTo || (abertura.getTime() <= rangeTo.getTime()) );
            var feOk = (!fechamento) || ( !rangeFrom || (fechamento.getTime() >= rangeFrom.getTime()) );
            okByDate = !!(abOk && feOk);
          }
          if (!okByDate) continue;

          var arr = map.get(equipamento);
          if (!arr) { arr = []; map.set(equipamento, arr); }
          arr.push(Object.assign({}, data));
        }
      } catch (e) {
        try { console.warn("[AvailabilityService] Falha ao consultar chunk", e && (e.code || e.message || e)); } catch(_){}
      }
    }

    return map;
  }

  return { initFirebaseIfNeeded: initFirebaseIfNeeded, fetchOsByVehiclesAndRange: fetchOsByVehiclesAndRange };
});

