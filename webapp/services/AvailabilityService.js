sap.ui.define([
  "sap/ui/thirdparty/jquery"
], function ($) {
  "use strict";

  var __fb = null; // { db, collection, getDocs, query, where, orderBy, limit, startAfter }
  var __appInitPromise = null;

  // --- Utils ---------------------------------------------------------------

  function parseISOZ(s) {
    if (!s) return null;
    try {
      var str = String(s).trim();
      if (!str) return null;
      var d = new Date(str);
      return isNaN(d) ? null : d;
    } catch (e) { return null; }
  }

  function eod(d) {
    if (!(d instanceof Date)) return null;
    var x = new Date(d.getTime());
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // --- Firebase bootstrap --------------------------------------------------

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

  // --- Core: busca de OS por veículos + filtro por período -----------------

  /**
   * Busca OS no Firestore por lista de veículos e aplica filtro de período
   * com interseção real. Regra especial:
   *  - OS aberta (sem DataFechamento) entra como se fechasse em "agora".
   *  - Só mantém OS cuja DataAbertura seja >= range.from (quando from existir).
   *  - Considera overlap real entre [abertura..(fechamento||agora)] e [from..to(23:59)].
   *
   * Retorna um Map<Equipamento, Array<OS>>. Cada OS recebe campos auxiliares:
   *   __isOpen: boolean
   *   __overlapStart: Date | null
   *   __overlapEnd: Date | null
   */
  async function fetchOsByVehiclesAndRange(vehicleIds, range) {
    await initFirebaseIfNeeded();

    var map = new Map();
    var ids = Array.isArray(vehicleIds) ? vehicleIds.map(function (v){ return String(v || "").trim(); }).filter(Boolean) : [];
    ids = Array.from(new Set(ids)); // dedup
    if (!ids.length) return map;

    var rangeFrom = (range && range.from instanceof Date) ? new Date(range.from.getTime()) : null;
    var rangeToRaw = (range && range.to instanceof Date) ? new Date(range.to.getTime()) : null;
    var rangeTo = rangeToRaw ? eod(rangeToRaw) : null; // fim do dia

    // Firestore: where('in') suporta até 10 valores
    var chunksIds = chunk(ids, 10);

    for (var c = 0; c < chunksIds.length; c++) {
      var list = chunksIds[c];
      try {
        var cref = __fb.collection(__fb.db, "ordensServico");
        var q = __fb.query(cref, __fb.where("Equipamento", "in", list));
        var snap = await __fb.getDocs(q);
        if (!snap) continue;

        var docs = [];
        if (Array.isArray(snap.docs)) {
          docs = snap.docs;
        } else if (typeof snap.forEach === "function") {
          snap.forEach(function (d) { docs.push(d); });
        }

        for (var i = 0; i < docs.length; i++) {
          var doc = docs[i];
          var data = (doc && doc.data && doc.data()) || {};
          var equipamento = String(data.Equipamento || "").trim();
          if (!equipamento) continue;

          // Campos de data com nomes variados
          var abStr = data.DataAbertura || data.dataAbertura || data.Abertura || data.AberturaData || null;
          var feStr = data.DataFechamento || data.dataFechamento || data.Fechamento || data.FechamentoData || null;

          var abertura = parseISOZ(abStr);
          var fechamento = parseISOZ(feStr);
          var isOpen = !fechamento;

          // Se não tenho abertura válida, não dá para decidir — descarta
          if (!(abertura instanceof Date) || isNaN(abertura)) continue;

          // Se for aberta, considera "agora" para fechar
          var feEfetivo = (fechamento instanceof Date && !isNaN(fechamento)) ? fechamento : new Date();

          // ----- Filtro de período (interseção real) -----
          var manter = true;

          // Regra especial: só entra se a abertura for >= início do período (quando 'from' existir)
          if (rangeFrom && abertura.getTime() < rangeFrom.getTime()) {
            manter = false;
          }

          // Se houver qualquer limite (from/to), exigir interseção real com a janela
          if (manter && (rangeFrom || rangeTo)) {
            var wStart = rangeFrom ? rangeFrom.getTime() : abertura.getTime();
            var wEnd   = rangeTo ? rangeTo.getTime() : feEfetivo.getTime();

            var overlapStart = Math.max(abertura.getTime(), wStart);
            var overlapEnd   = Math.min(feEfetivo.getTime(), wEnd);

            if (!(overlapEnd > overlapStart)) {
              // sem interseção
              manter = false;
            } else {
              // anexa info de sobreposição para uso posterior (fragment/aggregation)
              data.__overlapStart = new Date(overlapStart);
              data.__overlapEnd   = new Date(overlapEnd);
            }
          }

          if (!manter) continue;

          // flags auxiliares
          data.__isOpen = !!isOpen;

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

  return {
    initFirebaseIfNeeded: initFirebaseIfNeeded,
    fetchOsByVehiclesAndRange: fetchOsByVehiclesAndRange
  };
});
