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
            collection: fs.collection
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
        var app = appMod.initializeApp(firebaseConfig);
        var db = fs.getFirestore(app);
        return {
          db: db,
          doc: fs.doc,
          getDoc: fs.getDoc,
          setDoc: fs.setDoc,
          updateDoc: fs.updateDoc,
          collection: fs.collection
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

  function probe() { return getFirebase().then(function(){ return true; }); }

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
    createTestDoc: createTestDoc,
    exportMonth: exportMonth,
    exportRange: exportRange,
    probe: probe
  };
});
