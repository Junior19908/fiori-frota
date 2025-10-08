sap.ui.define([
  "sap/ui/thirdparty/jquery",
  "com/skysinc/frota/frota/services/FirebaseFirestoreService"
], function ($, FirebaseFS) {
  "use strict";

  // Utilitário: SHA-1 hex (usa SubtleCrypto quando disponível)
  async function sha1Hex(str) {
    try {
      if (window && window.crypto && window.crypto.subtle) {
        const enc = new TextEncoder();
        const data = enc.encode(String(str || ""));
        const hash = await window.crypto.subtle.digest("SHA-1", data);
        const arr = Array.from(new Uint8Array(hash));
        return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (_) { /* ignore */ }
    // Fallback simplificado (não-criptográfico) para ambientes sem SubtleCrypto
    var s = String(str || "");
    var h1 = 0, h2 = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = (h1 * 31 + c) >>> 0;
      h2 = (h2 * 131 + c) >>> 0;
    }
    return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
  }

  // Constrói ID determinístico para documentos de OS
  async function buildDocId(os) {
    const base = [
      String(os && os.NumeroOS || ""),
      String(os && os.Equipamento || ""),
      String(os && (os.DataAbertura || os.dataAbertura || os.Abertura) || "")
    ].join("|");
    if (!base.replace(/\|/g, "").trim()) {
      // Sem chaves mínimas; gera um ID superficial
      return "os_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    }
    return await sha1Hex(base);
  }

  // Normaliza leitura de Date/ISO para Firestore (aceita Date ou string)
  function toIsoDateOnly(val) {
    try {
      if (!val) return "";
      if (val instanceof Date) {
        const d = new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
        return d.toISOString().substring(0, 10);
      }
      const s = String(val);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d2 = new Date(s);
      if (!isNaN(d2.getTime())) {
        const d = new Date(Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate()));
        return d.toISOString().substring(0, 10);
      }
      return s;
    } catch(_) { return String(val || ""); }
  }

  // CRUD básico ------------------------------------------------------------

  async function getById(id) {
    const fb = await FirebaseFS.getFirebase();
    const dref = fb.doc(fb.db, "ordensServico", String(id));
    const snap = await fb.getDoc(dref);
    if (!snap || (snap.exists && !snap.exists())) return null;
    const data = snap.data ? snap.data() : (snap.get ? snap.get() : null);
    if (data) data._id = String(id);
    return data;
  }

  async function upsert(os, opts) {
    opts = opts || {};
    const fb = await FirebaseFS.getFirebase();
    const docId = String(opts.id || await buildDocId(os));
    const dref = fb.doc(fb.db, "ordensServico", docId);
    const payload = Object.assign({}, os);
    if (payload.DataAbertura) payload.DataAbertura = toIsoDateOnly(payload.DataAbertura);
    if (payload.DataFechamento) payload.DataFechamento = toIsoDateOnly(payload.DataFechamento);
    await fb.setDoc(dref, payload, { merge: true });
    return { ok: true, id: docId };
  }

  async function upsertMany(list, progressCb) {
    const fb = await FirebaseFS.getFirebase();
    let created = 0, updated = 0, skipped = 0;
    for (let i = 0; i < (list || []).length; i++) {
      const o = list[i];
      const docId = await buildDocId(o);
      const dref = fb.doc(fb.db, "ordensServico", docId);
      try {
        let exists = false;
        let existing = null;
        try {
          const snap = await fb.getDoc(dref);
          exists = !!(snap && (snap.exists ? snap.exists() : (snap.exists === true)));
          existing = snap && (snap.data ? snap.data() : (snap.get ? snap.get() : null));
        } catch (_) {}
        const incomingHasClose = !!(o && o.DataFechamento);
        const existingHasClose = !!(existing && existing.DataFechamento);
        if (exists && existingHasClose && !incomingHasClose) {
          skipped += 1; // mantém fechamento existente
        } else {
          const payload = Object.assign({}, o);
          if (payload.DataAbertura) payload.DataAbertura = toIsoDateOnly(payload.DataAbertura);
          if (payload.DataFechamento) payload.DataFechamento = toIsoDateOnly(payload.DataFechamento);
          await fb.setDoc(dref, payload, { merge: true });
          if (exists) updated += 1; else created += 1;
        }
      } catch (_) { /* ignore individual failure */ }
      if (typeof progressCb === 'function') {
        try { progressCb({ index: i + 1, total: list.length, created, updated, skipped }); } catch(_){}
      }
    }
    return { ok: true, created, updated, skipped };
  }

  async function removeById(id) {
    const fb = await FirebaseFS.getFirebase();
    const dref = fb.doc(fb.db, "ordensServico", String(id));
    await (await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")).then((fs) => fs.deleteDoc(dref));
    return { ok: true, id: String(id) };
  }

  // Operações de domínio ---------------------------------------------------

  async function closeOrders(ids, closeDate) {
    const fb = await FirebaseFS.getFirebase();
    const ymd = toIsoDateOnly(closeDate || new Date());
    const arr = Array.isArray(ids) ? ids : [ids];
    const results = await Promise.all(arr.filter(Boolean).map(async (id) => {
      const dref = fb.doc(fb.db, "ordensServico", String(id));
      try { await fb.updateDoc(dref, { DataFechamento: ymd }); return { ok: true, id: String(id) }; }
      catch (e) { return { ok: false, id: String(id), reason: e && (e.code || e.message) }; }
    }));
    const ok = results.filter(r => r.ok).length;
    return { ok: ok === results.length, updated: ok, results };
  }

  async function setManualType(ids, tipo) {
    const fb = await FirebaseFS.getFirebase();
    const val = String(tipo || "");
    const arr = Array.isArray(ids) ? ids : [ids];
    const results = await Promise.all(arr.filter(Boolean).map(async (id) => {
      const dref = fb.doc(fb.db, "ordensServico", String(id));
      try { await fb.updateDoc(dref, { TipoManual: val }); return { ok: true, id: String(id) }; }
      catch (e) { return { ok: false, id: String(id), reason: e && (e.code || e.message) }; }
    }));
    const ok = results.filter(r => r.ok).length;
    return { ok: ok === results.length, updated: ok, results };
  }

  // Listagens (delegam para FirebaseFirestoreService) ----------------------

  function listByVehicleAndRange(params) {
    return FirebaseFS.listOrdersByVehicleAndRange(params);
  }

  function listByVehicleAndRangePage(params) {
    return FirebaseFS.listOrdersByVehicleAndRangePage(params);
  }

  // Consulta paginada somente por período (sem veículo)
  async function listByDateRangePage(params) {
    const start = (params && (params.start || params.from)) || null;
    const end   = (params && (params.end   || params.to))   || null;
    const limitN = Number((params && params.limit) || 100);
    const after  = params && params.after || null; // { date, id }
    if (!(start instanceof Date)) return { items: [], last: null };

    const sDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0,0,0,0);
    const eDate = end instanceof Date
      ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23,59,59,999)
      : new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 23,59,59,999);

    const fb = await FirebaseFS.getFirebase();
    const cref = fb.collection(fb.db, "ordensServico");
    const parts = [
      cref,
      fb.where('DataAbertura', '>=', sDate),
      fb.where('DataAbertura', '<=', eDate),
      fb.orderBy('DataAbertura', 'asc')
    ];
    if (after && after.date) { const dt = new Date(after.date); parts.push(fb.startAfter(dt)); }
    parts.push(fb.limit(limitN));
    try {
      const q = fb.query.apply(null, parts);
      const snap = await fb.getDocs(q);
      const items = [];
      let last = null;
      const iter = (snap && Array.isArray(snap.docs)) ? snap.docs : null;
      if (iter) {
        iter.forEach(function (d) { const data = (d && d.data && d.data()) || {}; data._id = d && d.id || data._id || ''; items.push(data); });
        const ld = iter[iter.length - 1];
        if (ld) { const dv = (ld.data && ld.data()) ? ld.data() : {}; last = { id: ld.id, date: dv && dv.DataAbertura ? dv.DataAbertura : null }; }
      }
      return { items, last };
    } catch (e) {
      // Fallback 1: strings ISO completas (YYYY-MM-DDTHH:mm:ss.sssZ)
      try {
        const parts2 = [
          cref,
          fb.where('DataAbertura', '>=', sDate.toISOString()),
          fb.where('DataAbertura', '<=', eDate.toISOString()),
          fb.orderBy('DataAbertura', 'asc')
        ];
        if (after && after.date) parts2.push(fb.startAfter(String(after.date||'')));
        parts2.push(fb.limit(limitN));
        const q2 = fb.query.apply(null, parts2);
        const snap2 = await fb.getDocs(q2);
        const items = [];
        let last = null;
        const iter = (snap2 && Array.isArray(snap2.docs)) ? snap2.docs : null;
        if (iter) {
          iter.forEach(function (d) { const data = (d && d.data && d.data()) || {}; data._id = d && d.id || data._id || ''; items.push(data); });
          const ld = iter[iter.length - 1];
          if (ld) { const dv = (ld.data && ld.data()) ? ld.data() : {}; last = { id: ld.id, date: dv && dv.DataAbertura ? dv.DataAbertura : null }; }
        }
        if (items.length) return { items, last };
      } catch (_) { /* noop */ }
      // Fallback 2: somente data (YYYY-MM-DD)
      try {
        const sY = sDate.toISOString().substring(0,10);
        const eY = eDate.toISOString().substring(0,10);
        const parts3 = [
          cref,
          fb.where('DataAbertura', '>=', sY),
          fb.where('DataAbertura', '<=', eY),
          fb.orderBy('DataAbertura', 'asc')
        ];
        if (after && after.date) parts3.push(fb.startAfter(String(after.date||'')));
        parts3.push(fb.limit(limitN));
        const q3 = fb.query.apply(null, parts3);
        const snap3 = await fb.getDocs(q3);
        const items3 = [];
        let last3 = null;
        const iter3 = (snap3 && Array.isArray(snap3.docs)) ? snap3.docs : null;
        if (iter3) {
          iter3.forEach(function (d) { const data = (d && d.data && d.data()) || {}; data._id = d && d.id || data._id || ''; items3.push(data); });
          const ld = iter3[iter3.length - 1];
          if (ld) { const dv = (ld.data && ld.data()) ? ld.data() : {}; last3 = { id: ld.id, date: dv && dv.DataAbertura ? dv.DataAbertura : null }; }
        }
        return { items: items3, last: last3 };
      } catch (_) { return { items: [], last: null }; }
    }
  }

  // Contagem por filtro (usa getCountFromServer quando disponível)
  async function countByFilter(params) {
    const equnr = String(params && (params.equnr || params.vehicle || "")).trim();
    const start = (params && (params.start || params.from)) || null;
    const end   = (params && (params.end   || params.to))   || null;
    const fb = await FirebaseFS.getFirebase();
    const cref = fb.collection(fb.db, "ordensServico");
    const fs = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    function rangeParts() {
      if (!(start instanceof Date)) return [];
      const sDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0,0,0,0);
      const eDate = end instanceof Date
        ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23,59,59,999)
        : new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 23,59,59,999);
      return [ fb.where('DataAbertura', '>=', sDate), fb.where('DataAbertura', '<=', eDate) ];
    }

    try {
      let parts = [cref];
      if (equnr) parts.push(fb.where('Equipamento', '==', equnr));
      parts = parts.concat(rangeParts());
      const q = fb.query.apply(null, parts);
      if (typeof fs.getCountFromServer === 'function') {
        const cnt = await fs.getCountFromServer(q);
        const n = cnt && cnt.data && typeof cnt.data().count === 'number' ? cnt.data().count : 0;
        return Number(n) || 0;
      }
      return 0;
    } catch (_) {
      // Fallback 1: comparar como ISO completo (strings)
      try {
        let parts = [cref];
        if (equnr) parts.push(fb.where('Equipamento', '==', equnr));
        const sDate = (start instanceof Date) ? start : new Date(1970,0,1);
        const eDate = (end instanceof Date) ? end : new Date(2100,0,1);
        parts.push(fb.where('DataAbertura', '>=', sDate.toISOString()));
        parts.push(fb.where('DataAbertura', '<=', eDate.toISOString()));
        const q2 = fb.query.apply(null, parts);
        if (typeof fs.getCountFromServer === 'function') {
          const cnt = await fs.getCountFromServer(q2);
          const n = cnt && cnt.data && typeof cnt.data().count === 'number' ? cnt.data().count : 0;
          if (n) return Number(n) || 0;
        }
      } catch (_) { /* noop */ }
      // Fallback 2: comparar como YYYY-MM-DD (strings)
      try {
        let parts3 = [cref];
        if (equnr) parts3.push(fb.where('Equipamento', '==', equnr));
        const sDate = (start instanceof Date) ? start : new Date(1970,0,1);
        const eDate = (end instanceof Date) ? end : new Date(2100,0,1);
        parts3.push(fb.where('DataAbertura', '>=', sDate.toISOString().substring(0,10)));
        parts3.push(fb.where('DataAbertura', '<=', eDate.toISOString().substring(0,10)));
        const q3 = fb.query.apply(null, parts3);
        if (typeof fs.getCountFromServer === 'function') {
          const cnt3 = await fs.getCountFromServer(q3);
          const n3 = cnt3 && cnt3.data && typeof cnt3.data().count === 'number' ? cnt3.data().count : 0;
          return Number(n3) || 0;
        }
      } catch (_) { /* noop */ }
      return 0;
    }
  }

  // API pública
  return {
    getById: getById,
    upsert: upsert,
    upsertMany: upsertMany,
    removeById: removeById,
    closeOrders: closeOrders,
    setManualType: setManualType,
    listByVehicleAndRange: listByVehicleAndRange,
    listByVehicleAndRangePage: listByVehicleAndRangePage,
    listByDateRangePage: listByDateRangePage,
    countByFilter: countByFilter,
    // expõe utilitários quando útil
    buildDocId: buildDocId,
    toIsoDateOnly: toIsoDateOnly
  };
});
