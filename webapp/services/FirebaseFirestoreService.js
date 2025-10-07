sap.ui.define([], function () {
  "use strict";

  function pad2(n){ return String(n).padStart(2, "0"); }

  function toUrl(p) { return sap.ui.require.toUrl(p); }

  function fetchMonthlyLocal(y, m) {
    return new Promise(function(resolve){
      const mm = pad2(m);
      const url = toUrl("com/skysinc/frota/frota/model/localdata/" + y + "/" + mm + "/abastecimentos.json");
      jQuery.ajax({ url: url, dataType: "json", cache: false, success: (d)=> resolve(d), error: ()=> resolve(null) });
    });
  }

  function getFirebase() {
    // Carrega config e SDK firestore sob demanda; suporta db pronto exportado
    return import("./settings/firebaseConfig.js").then(function (cfg) {
      if (cfg && cfg.db) {
        return Promise.all([
          import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
        ]).then(function (mods) {
          var fs = mods[0];
          return {
            db: cfg.db,
            doc: fs.doc,
            getDoc: fs.getDoc,
            setDoc: fs.setDoc,
            updateDoc: fs.updateDoc,
            collection: fs.collection,
            getDocs: fs.getDocs,
            query: fs.query,
            where: fs.where,
            orderBy: fs.orderBy,
            limit: fs.limit,
            startAfter: fs.startAfter,
            startAt: fs.startAt,
            endBefore: fs.endBefore,
            documentId: fs.documentId
          };
        });
      }
      var firebaseConfig = cfg && (cfg.firebaseConfig || cfg.default || null);
      if (!firebaseConfig) throw new Error("firebaseConfig.js nÃ£o encontrado ou invÃ¡lido.");
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
          // Fallback para ambientes sem getApps/getApp
          try { app = appMod.initializeApp(firebaseConfig); } catch(_) { app = appMod.getApp ? appMod.getApp() : null; }
        }
        var db = fs.getFirestore(app);
        return {
          db: db,
          doc: fs.doc,
          getDoc: fs.getDoc,
          setDoc: fs.setDoc,
          getDocs: fs.getDocs,
          collection: fs.collection,
          updateDoc: fs.updateDoc,
          deleteDoc: fs.deleteDoc,
          query: fs.query,
          where: fs.where,
          orderBy: fs.orderBy,
          limit: fs.limit,
          startAfter: fs.startAfter,
          startAt: fs.startAt,
          endBefore: fs.endBefore,
          documentId: fs.documentId
        };
      });
    });
  }

  function docIdOf(y, m) { return String(y) + "-" + pad2(m); }

  function fetchMonthlyFromFirestore(y, m) {
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var dref = f.doc(f.db, "abastecimentos", id);
      return f.getDoc(dref).then(function (snap) {
        if (!snap || !snap.exists || (snap.exists && !snap.exists())) return null;
        return snap.data ? snap.data() : (snap.get ? snap.get() : null);
      }).catch(function (e) {
        try { console.warn("[Firestore] Falha ao ler", id, e && (e.code || e.message || e)); } catch(_){}
        return null;
      });
    });
  }

  function saveMonthlyToFirestore(y, m, json) {
    if (!json) return Promise.resolve({ ok: false, reason: "empty" });
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var dref = f.doc(f.db, "abastecimentos", id);
      return f.setDoc(dref, json).then(function(){ return { ok: true, id: id }; })
        .catch(function (e) { return { ok: false, reason: (e && (e.code || e.message)) || String(e) }; });
    });
  }

  function mergeMonthlyFields(y, m, partial) {
    if (!partial || typeof partial !== 'object') return Promise.resolve({ ok: false, reason: 'empty' });
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var dref = f.doc(f.db, "abastecimentos", id);
      return f.setDoc(dref, partial, { merge: true }).then(function(){ return { ok: true, id: id }; })
        .catch(function (e) { return { ok: false, reason: (e && (e.code || e.message)) || String(e) }; });
    });
  }

  function deleteMonthlyFromFirestore(y, m) {
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var dref = f.doc(f.db, "abastecimentos", id);
      return import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(function (fs) {
        return fs.deleteDoc(dref).then(function(){ return { ok: true, id: id }; })
          .catch(function (e) { return { ok: false, reason: (e && (e.code || e.message)) || String(e) }; });
      });
    });
  }

  // ---------------- V2 (paginado em subcoleções) ----------------
  function appendVehicleEventsPaged(y, m, veiculo, events, pageSize) {
    pageSize = Math.max(1, Number(pageSize || 500));
    events = Array.isArray(events) ? events : [];
    if (!veiculo || !events.length) return Promise.resolve({ ok: true, empty: true });
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var monthRef = f.doc(f.db, "abastecimentos", id);
      var pagesCol = f.collection(f.db, "abastecimentos", id, "veiculos", String(veiculo), "pages");
      return f.getDocs(pagesCol).then(function (snap) {
        var all = [];
        try {
          var docs = snap && snap.docs ? snap.docs : [];
          docs.forEach(function (d) { var data = d && d.data && d.data() || {}; var arr = Array.isArray(data.items) ? data.items : []; all = all.concat(arr); });
        } catch(_) {}
        var map = new Map();
        all.forEach(function (e) { if (e && e.idEvento) map.set(e.idEvento, e); });
        events.forEach(function (e) { if (e && e.idEvento) map.set(e.idEvento, e); });
        var merged = Array.from(map.values()).sort(function(a,b){ return (a.sequencia||0)-(b.sequencia||0); });
        // split into pages and write
        var writes = [];
        for (var i=0;i<merged.length;i+=pageSize) {
          var pageItems = merged.slice(i, i+pageSize);
          var pageId = String(Math.floor(i/pageSize)+1).padStart(4,'0');
          var pref = f.doc(f.db, "abastecimentos", id, "veiculos", String(veiculo), "pages", pageId);
          writes.push(f.setDoc(pref, { items: pageItems }));
        }
        // mark metadata on month
        writes.push(f.setDoc(monthRef, { schema: 'v2', vehicles: (function(){ var o={}; o[String(veiculo)]=true; return o; })() }, { merge: true }));
        return Promise.all(writes).then(function(){ return { ok: true, pages: Math.ceil(merged.length/pageSize) }; });
      });
    });
  }

  function fetchMonthlyEventsV2(y, m) {
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var monthRef = f.doc(f.db, "abastecimentos", id);
      return f.getDoc(monthRef).then(function (snap) {
        var data = snap && (snap.data ? snap.data() : null) || {};
        var vehicles = Object.keys(data && data.vehicles || {});
        if (!vehicles.length) return [];
        var allPromises = vehicles.map(function (veh) {
          var col = f.collection(f.db, "abastecimentos", id, "veiculos", String(veh), "pages");
          return f.getDocs(col).then(function (psnap) {
            var arr = [];
            try { (psnap.docs||[]).forEach(function (d) { var v = d && d.data && d.data() || {}; var items = Array.isArray(v.items) ? v.items : []; items.forEach(function (it){ arr.push(Object.assign({ veiculo: veh }, it)); }); }); } catch(_){}
            return arr;
          });
        });
        return Promise.all(allPromises).then(function (lists) { return lists.flat(); });
      });
    });
  }

  function migrateMonthV1toV2(y, m, pageSize) {
    pageSize = Math.max(1, Number(pageSize || 500));
    return fetchMonthlyFromFirestore(y, m).then(function (data) {
      data = data || {};
      var map = data.abastecimentosPorVeiculo || {};
      var vehicles = Object.keys(map);
      if (!vehicles.length) return { ok: true, migrated: 0 };
      return getFirebase().then(function (f) {
        var id = docIdOf(y, m);
        var dref = f.doc(f.db, "abastecimentos", id);
        var ops = [];
        var vset = {};
        vehicles.forEach(function (veh) {
          var arr = Array.isArray(map[veh]) ? map[veh] : [];
          if (!arr.length) return;
          vset[String(veh)] = true;
          ops.push(appendVehicleEventsPaged(y, m, veh, arr, pageSize));
        });
        return Promise.all(ops).then(function(){
          // substitui o doc do mês por metadados V2
          return f.setDoc(dref, { schema: 'v2', vehicles: vset });
        }).then(function(){ return { ok: true, migrated: vehicles.length }; });
      });
    });
  }

  function removeVehicleEventsPaged(y, m, veiculo, eventIds, pageSize) {
    pageSize = Math.max(1, Number(pageSize || 500));
    eventIds = Array.isArray(eventIds) ? eventIds : [];
    if (!veiculo || !eventIds.length) return Promise.resolve({ ok: true, empty: true });
    var idSet = new Set(eventIds.filter(Boolean));
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var pagesCol = f.collection(f.db, "abastecimentos", id, "veiculos", String(veiculo), "pages");
      return f.getDocs(pagesCol).then(function (snap) {
        var all = [];
        var existingPageIds = [];
        try {
          var docs = snap && snap.docs ? snap.docs : [];
          docs.forEach(function (d) { existingPageIds.push(d && d.id); var data = d && d.data && d.data() || {}; var arr = Array.isArray(data.items) ? data.items : []; all = all.concat(arr); });
        } catch(_) {}
        var kept = all.filter(function (e) { return !(e && e.idEvento && idSet.has(e.idEvento)); });
        // Rewrite pages
        var writes = [];
        // Delete all existing pages first
        existingPageIds.forEach(function (pid) { var pref = f.doc(f.db, "abastecimentos", id, "veiculos", String(veiculo), "pages", pid); writes.push(f.deleteDoc(pref)); });
        for (var i=0;i<kept.length;i+=pageSize) {
          var pageItems = kept.slice(i, i+pageSize);
          var pageId = String(Math.floor(i/pageSize)+1).padStart(4,'0');
          var pref2 = f.doc(f.db, "abastecimentos", id, "veiculos", String(veiculo), "pages", pageId);
          writes.push(f.setDoc(pref2, { items: pageItems }));
        }
        return Promise.all(writes).then(function(){ return { ok: true, removed: eventIds.length, remainingPages: Math.ceil(kept.length/pageSize) }; });
      });
    });
  }

  function deleteMonthlyDeep(y, m) {
    return getFirebase().then(function (f) {
      var id = docIdOf(y, m);
      var monthRef = f.doc(f.db, "abastecimentos", id);
      return f.getDoc(monthRef).then(function (snap) {
        var data = snap && (snap.data ? snap.data() : null) || {};
        var vehicles = Object.keys(data.vehicles || {});
        if (!vehicles.length) {
          return f.deleteDoc(monthRef).then(function(){ return { ok: true, id: id, vehicles: 0 }; });
        }
        var deletions = [];
        vehicles.forEach(function (veh) {
          var pagesCol = f.collection(f.db, "abastecimentos", id, "veiculos", String(veh), "pages");
          deletions.push(
            f.getDocs(pagesCol).then(function (snapP) {
              var dd = [];
              (snapP.docs||[]).forEach(function (d) { var pref = f.doc(f.db, "abastecimentos", id, "veiculos", String(veh), "pages", d.id); dd.push(f.deleteDoc(pref)); });
              var vdoc = f.doc(f.db, "abastecimentos", id, "veiculos", String(veh));
              dd.push(f.deleteDoc(vdoc));
              return Promise.all(dd);
            })
          );
        });
        return Promise.all(deletions).then(function(){ return f.deleteDoc(monthRef).then(function(){ return { ok: true, id: id, vehicles: vehicles.length }; }); });
      });
    });
  }

  function createTestDoc(payload) {
    return getFirebase().then(function (f) {
      var id = String(Date.now());
      var dref = f.doc(f.db, "TESTE", id);
      var data = Object.assign({ ts: new Date().toISOString(), ok: true }, payload || {});
      return f.setDoc(dref, data).then(function(){ return { ok: true, id: id }; })
        .catch(function (e) { return { ok: false, reason: (e && (e.code || e.message)) || String(e) }; });
    });
  }

  function exportMonth(y, m) {
    return fetchMonthlyLocal(y, m).then(function (data) {
      if (!data) return { ok: false, reason: "not-found" };
      return saveMonthlyToFirestore(y, m, data);
    });
  }

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

  // Lista todas as OS da coleção 'ordensServico'
  function listAllOrders() {
    return getFirebase().then(function (f) {
      var cref = f.collection(f.db, "ordensServico");
      if (!f.getDocs) {
        try { console.warn("[Firestore] getDocs indisponível no SDK carregado"); } catch(_){}
        return Promise.resolve([]);
      }
      return f.getDocs(cref).then(function (snap) {
        var arr = [];
        try {
          if (snap && Array.isArray(snap.docs)) {
            snap.docs.forEach(function (d) {
              var data = (d && d.data && d.data()) || {};
              data._id = d && d.id || data._id || "";
              arr.push(data);
            });
          } else if (snap && typeof snap.forEach === 'function') {
            snap.forEach(function (d) {
              var data = (d && d.data && d.data()) || {};
              data._id = d && d.id || data._id || "";
              arr.push(data);
            });
          }
        } catch (e) {
          try { console.warn("[Firestore] Erro ao iterar snapshot", e && (e.code || e.message || e)); } catch(_){}
        }
        return arr;
      }).catch(function (e) {
        try { console.warn("[Firestore] Falha ao listar ordensServico", e && (e.code || e.message || e)); } catch(_){}
        return [];
      });
    });
  }

  // ===== Leitura filtrada e cache =====
  const _ordersCache = new Map(); // key -> { ts, data }
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

  function _cacheGet(key) {
    const e = _ordersCache.get(key);
    if (!e) return null;
    if ((Date.now() - e.ts) > CACHE_TTL_MS) { _ordersCache.delete(key); return null; }
    return e.data;
  }
  function _cacheSet(key, data) { _ordersCache.set(key, { ts: Date.now(), data }); }

  // Consulta por veículo e período, com limite e duas queries (abertura/fechamento) para cobrir intervalos
  function listOrdersByVehicleAndRange(params) {
    const equnr = String(params && (params.equnr || params.vehicle || "")).trim();
    const start = (params && (params.start || params.from)) || null;
    const end   = (params && (params.end   || params.to))   || null;
    const limitN = Number((params && params.limit) || 500);

    if (!equnr || !(start instanceof Date)) {
      return Promise.resolve([]);
    }

    const sDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0,0,0,0);
    const eDate = end instanceof Date
      ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23,59,59,999)
      : new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 23,59,59,999);

    const cacheKey = [equnr, sDate.getTime(), eDate.getTime(), limitN].join("|");
    const cached = _cacheGet(cacheKey);
    if (cached && Array.isArray(cached.items) && cached.items.length) return Promise.resolve(cached);

    return getFirebase().then(function (f) {
      const cref = f.collection(f.db, "ordensServico");

      async function runQ(field) {
        const sIso = sDate.toISOString();
        const eIso = eDate.toISOString();

        async function run(parts) {
          try {
            const q = f.query.apply(null, parts);
            const snap = await f.getDocs(q);
            const arr = [];
            try {
              if (snap && Array.isArray(snap.docs)) {
                snap.docs.forEach(function (d) { var data = (d && d.data && d.data()) || {}; data._id = (d && d.id) || data._id || ""; arr.push(data); });
              } else if (snap && typeof snap.forEach === 'function') {
                snap.forEach(function (d) { var data = (d && d.data && d.data()) || {}; data._id = (d && d.id) || data._id || ""; arr.push(data); });
              }
            } catch(_) {}
            return arr;
          } catch (e) { return []; }
        }

        // 1) Date/Timestamp
        let arr = await run([cref, f.where('Equipamento','==',equnr), f.orderBy(field), f.where(field,'>=',sDate), f.where(field,'<=',eDate), f.limit(limitN)]);
        if (arr.length) return arr;
        // 2) String ISO completa
        arr = await run([cref, f.where('Equipamento','==',equnr), f.orderBy(field), f.where(field,'>=',sIso), f.where(field,'<=',eIso), f.limit(limitN)]);
        if (arr.length) return arr;
        // 3) Somente data YYYY-MM-DD
        const sY = sIso.substring(0,10), eY = eIso.substring(0,10);
        arr = await run([cref, f.where('Equipamento','==',equnr), f.orderBy(field), f.where(field,'>=',sY), f.where(field,'<=',eY), f.limit(limitN)]);
        return arr;
      }

      // Busca OS ainda abertas: DataFechamento vazio/null e DataAbertura <= fim do período
      async function runOpen() {
        const sIso = sDate.toISOString();
        const eIso = eDate.toISOString();
        const sY = sIso.substring(0,10);
        const eY = eIso.substring(0,10);

        async function pull(whereCloseEq) {
          // Date/Timestamp
          let arr = await (async () => {
            try {
              const parts = [cref,
                f.where('Equipamento','==',equnr),
                f.orderBy('DataAbertura'),
                f.where('DataAbertura','<=',eDate),
                f.where('DataFechamento','==', whereCloseEq)
              ];
              const q = f.query.apply(null, parts);
              return await getDocsSafe(q);
            } catch(_) { return []; }
          })();
          if (arr.length) return arr;
          // ISO completo
          arr = await (async () => {
            try {
              const parts = [cref,
                f.where('Equipamento','==',equnr),
                f.orderBy('DataAbertura'),
                f.where('DataAbertura','<=',eIso),
                f.where('DataFechamento','==', whereCloseEq)
              ];
              const q = f.query.apply(null, parts);
              return await getDocsSafe(q);
            } catch(_) { return []; }
          })();
          if (arr.length) return arr;
          // YYYY-MM-DD
          arr = await (async () => {
            try {
              const parts = [cref,
                f.where('Equipamento','==',equnr),
                f.orderBy('DataAbertura'),
                f.where('DataAbertura','<=',eY),
                f.where('DataFechamento','==', whereCloseEq)
              ];
              const q = f.query.apply(null, parts);
              return await getDocsSafe(q);
            } catch(_) { return []; }
          })();
          return arr;
        }

        const a1 = await pull("");
        const a2 = await pull(null);
        // de-dup por id
        const map = new Map();
        [...a1, ...a2].forEach((it)=>{ if (it && (it._id || it.NumeroOS)) map.set(it._id || it.NumeroOS, it); });
        return Array.from(map.values());
      }

      return Promise.all([ runQ('DataAbertura'), runQ('DataFechamento'), runOpen() ]).then(function (lists) {
        const map = new Map();
        lists.forEach(function (arr) { (arr || []).forEach(function (it) { if (it && (it._id || it.NumeroOS)) map.set(it._id || it.NumeroOS, it); }); });
        const out = Array.from(map.values());
        _cacheSet(cacheKey, out);
        return out;
      });
    });
  }

  function probe() { return getFirebase().then(function(){ return true; }); }

  // Página de OS por veículo e período, ordenado por DataAbertura asc
  // params: { equnr, start:Date, end:Date, limit?:number, after?: { date: Date, id: string } }
  function listOrdersByVehicleAndRangePage(params) {
    const equnr = String(params && (params.equnr || params.vehicle || "")).trim();
    const start = (params && (params.start || params.from)) || null;
    const end   = (params && (params.end   || params.to))   || null;
    const limitN = Math.max(1, Math.min(1000, Number((params && params.limit) || 200)));
    const after  = params && params.after ? params.after : null;

    if (!equnr || !(start instanceof Date)) {
      return Promise.resolve({ items: [], last: null });
    }

    const sDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0,0,0,0);
    const eDate = end instanceof Date
      ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23,59,59,999)
      : new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 23,59,59,999);

    const afterKey = after ? (Number(new Date(after.date).getTime()) + ":" + String(after.id || "")) : "";
    const cacheKey = [equnr, sDate.getTime(), eDate.getTime(), limitN, afterKey].join("|");
    const cached = _cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);

    return getFirebase().then(function (f) {
      const cref = f.collection(f.db, "ordensServico");
      const parts = [
        cref,
        f.where('Equipamento', '==', equnr),
        f.where('DataAbertura', '>=', sDate),
        f.where('DataAbertura', '<=', eDate),
        f.orderBy('DataAbertura', 'asc'),
        f.orderBy(f.documentId(), 'asc')
      ];
      if (after && after.date) {
        const dt = new Date(after.date);
        parts.push(f.startAfter(dt, String(after.id || "")));
      }
      parts.push(f.limit(limitN));
      const q = f.query.apply(null, parts);
      return f.getDocs(q).then(function (snap) {
        const items = [];
        let last = null;
        try {
          const iter = (snap && Array.isArray(snap.docs)) ? snap.docs : null;
          if (iter) {
            iter.forEach(function (d) {
              const data = (d && d.data && d.data()) || {};
              data._id = d && d.id || data._id || "";
              items.push(data);
            });
            const ld = iter[iter.length - 1];
            if (ld) {
              const dv = (ld.data && ld.data()) ? ld.data() : {};
              last = { id: ld.id, date: dv && dv.DataAbertura ? dv.DataAbertura : null };
            }
          }
        } catch(_) {}
        if (!items.length) { throw { code: '__EMPTY__' }; }
        const result = { items, last };
        _cacheSet(cacheKey, result);
        return result;
      }).catch(function (e) {
        try { console.warn('[Firestore] Falha paginação OS', e && (e.code || e.message || e)); } catch(_){}
        // Fallback com consulta por strings ISO
        try {
          const parts2 = [
            cref,
            f.where('Equipamento', '==', equnr),
            f.where('DataAbertura', '>=', sDate.toISOString()),
            f.where('DataAbertura', '<=', eDate.toISOString()),
            f.orderBy('DataAbertura', 'asc'),
            f.orderBy(f.documentId(), 'asc')
          ];
          if (after && after.date) { parts2.push(f.startAfter(String(after.date || ''), String(after.id || ''))); }
          parts2.push(f.limit(limitN));
          const q2 = f.query.apply(null, parts2);
          return f.getDocs(q2).then(function (snap) {
            const items = [];
            let last = null;
            try {
              const iter = (snap && Array.isArray(snap.docs)) ? snap.docs : null;
              if (iter) {
                iter.forEach(function (d) { const data = (d && d.data && d.data()) || {}; data._id = d && d.id || data._id || ''; items.push(data); });
                const ld = iter[iter.length - 1];
                if (ld) { const dv = (ld.data && ld.data()) ? ld.data() : {}; last = { id: ld.id, date: dv && dv.DataAbertura ? dv.DataAbertura : null }; }
              }
            } catch(_) {}
            const result = { items, last };
            _cacheSet(cacheKey, result);
            return result;
          }).catch(function () {
            // Segundo fallback: datas como 'YYYY-MM-DD'
            try {
              const parts3 = [
                cref,
                f.where('Equipamento', '==', equnr),
                f.where('DataAbertura', '>=', sDate.toISOString().substring(0,10)),
                f.where('DataAbertura', '<=', eDate.toISOString().substring(0,10)),
                f.orderBy('DataAbertura', 'asc'),
                f.orderBy(f.documentId(), 'asc')
              ];
              if (after && after.date) { parts3.push(f.startAfter(String(after.date || ''), String(after.id || ''))); }
              parts3.push(f.limit(limitN));
              const q3 = f.query.apply(null, parts3);
              return f.getDocs(q3).then(function (snap3) {
                const items = [];
                let last = null;
                try {
                  const iter = (snap3 && Array.isArray(snap3.docs)) ? snap3.docs : null;
                  if (iter) {
                    iter.forEach(function (d) { const data = (d && d.data && d.data()) || {}; data._id = d && d.id || data._id || ''; items.push(data); });
                    const ld = iter[iter.length - 1];
                    if (ld) { const dv = (ld.data && ld.data()) ? ld.data() : {}; last = { id: ld.id, date: dv && dv.DataAbertura ? dv.DataAbertura : null }; }
                  }
                } catch(_) {}
                const result = { items, last };
                _cacheSet(cacheKey, result);
                return result;
              }).catch(function(){ return { items: [], last: null }; });
            } catch(_) { return { items: [], last: null }; }
          });
        } catch(_) {
          return { items: [], last: null };
        }
      });
    });
  }

  function getAuthUid() {
    return import("./settings/firebaseConfig.js").then(function (cfg) {
      var firebaseConfig = cfg && (cfg.firebaseConfig || cfg.default || null);
      if (!firebaseConfig && cfg && cfg.db) {
        // App já fornecido externamente; ainda assim tentaremos auth com config ausente
        return Promise.resolve("anon");
      }
      return Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js")
      ]).then(function (mods) {
        var appMod = mods[0];
        var authMod = mods[1];
        var app;
        try {
          app = appMod.getApps && appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
        } catch (e) {
          app = appMod.initializeApp(firebaseConfig);
        }
        var auth = authMod.getAuth(app);
        if (auth && auth.currentUser && auth.currentUser.uid) {
          return auth.currentUser.uid;
        }
        return authMod.signInAnonymously(auth).then(function (cred) {
          return (cred && cred.user && cred.user.uid) || "anon";
        }).catch(function(){ return "anon"; });
      });
    });
  }

  return {
    getFirebase: getFirebase,
    getAuthUid: getAuthUid,
    fetchMonthlyFromFirestore: fetchMonthlyFromFirestore,
    saveMonthlyToFirestore: saveMonthlyToFirestore,
    mergeMonthlyFields: mergeMonthlyFields,
    appendVehicleEventsPaged: appendVehicleEventsPaged,
    fetchMonthlyEventsV2: fetchMonthlyEventsV2,
    removeVehicleEventsPaged: removeVehicleEventsPaged,
    deleteMonthlyDeep: deleteMonthlyDeep,
    migrateMonthV1toV2: migrateMonthV1toV2,
    deleteMonthlyFromFirestore: deleteMonthlyFromFirestore,
    createTestDoc: createTestDoc,
    exportMonth: exportMonth,
    exportRange: exportRange,
    listAllOrders: listAllOrders,
    listOrdersByVehicleAndRange: listOrdersByVehicleAndRange,
    listOrdersByVehicleAndRangePage: listOrdersByVehicleAndRangePage,
    probe: probe
  };
});
