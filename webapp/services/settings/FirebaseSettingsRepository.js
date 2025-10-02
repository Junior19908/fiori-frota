sap.ui.define([], function () {
  "use strict";

  var DEFAULTS = {
    showAllOS: false,
    osTypes: ["ZF1", "ZF2", "ZF3"],
    autoLoadMain: false,
    autoLoadIntervalSec: 30,
    mainDatePref: "yesterday",
    saveLocal: false,
    theme: "sap_horizon",
    avatarSrc: "",
    avatarInitials: "CJ"
  };

  function isDataUrl(s) { return typeof s === "string" && /^data:[^;]+;base64,/.test(s); }

  var FirebaseSettingsRepository = function (opts) {
    this._inject = opts || null; // { db, doc, getDoc, setDoc, updateDoc }
  };

  FirebaseSettingsRepository.prototype._getFirebase = function () {
    var self = this;
    if (self._inject) return Promise.resolve(self._inject);
    return new Promise(function (resolve) {
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
        svc.getFirebase().then(function (f) {
          resolve({ db: f.db, doc: f.doc, getDoc: f.getDoc, setDoc: f.setDoc, updateDoc: f.updateDoc });
        });
      });
    });
  };

  FirebaseSettingsRepository.prototype._getUid = function () {
    return new Promise(function (resolve) {
      try {
        sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
          try { svc.getAuthUid().then(function (uid) { resolve(uid || "anon"); }).catch(function(){ resolve("anon"); }); }
          catch (e) { resolve("anon"); }
        });
      } catch (e) { resolve("anon"); }
    });
  };

  FirebaseSettingsRepository.prototype.load = function () {
    var self = this;
    return Promise.all([ self._getFirebase(), self._getUid() ]).then(function (arr) {
      var f = arr[0];
      var uid = arr[1] || "anon";
      var dref = f.doc(f.db, "userSettings", uid);
      return f.getDoc(dref).then(function (snap) {
        if (!snap || !snap.exists || (snap.exists && !snap.exists())) {
          // Cria coleção/documento com defaults no primeiro uso
          return f.setDoc(dref, DEFAULTS, { merge: true }).then(function(){ return DEFAULTS; }).catch(function(){ return DEFAULTS; });
        }
        var data = snap.data ? snap.data() : (snap.get ? snap.get() : {});
        return Object.assign({}, DEFAULTS, data || {});
      }).catch(function () { return DEFAULTS; });
    });
  };

  FirebaseSettingsRepository.prototype.save = function (settings) {
    var self = this;
    var finalObj = Object.assign({}, settings);
    return Promise.all([ self._getFirebase(), self._getUid() ]).then(function (arr) {
      var f = arr[0];
      var uid = arr[1] || "anon";
      // Persiste objeto diretamente no Firestore.
      // Se avatarSrc for Data URL, mantém o valor em linha.
      if (!isDataUrl(finalObj.avatarSrc) && typeof finalObj.avatarSrc !== "string") {
        finalObj.avatarSrc = "";
      }
      var dref = f.doc(f.db, "userSettings", uid);
      return f.setDoc(dref, finalObj, { merge: true });
    });
  };

  return FirebaseSettingsRepository;
});

