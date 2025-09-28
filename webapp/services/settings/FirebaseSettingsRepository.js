sap.ui.define([], function () {
  "use strict";

  // Implementação em ES5 compatível com UI5; usa dynamic import() para Firebase.
  // Permite injeção de mocks no construtor para testes.

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
  function mimeExt(m) {
    if (m === "image/png") return "png";
    if (m === "image/gif") return "gif";
    if (m === "image/webp") return "webp";
    return "jpg"; // default
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var header = parts[0];
    var base64 = parts[1] || "";
    var mimeMatch = header.match(/^data:([^;]+);base64$/);
    var mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    var binary = atob(base64);
    var len = binary.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
    return { blob: new Blob([arr], { type: mime }), mime: mime };
  }

  var FirebaseSettingsRepository = function (opts) {
    this._inject = opts || null; // { db, storage, doc, getDoc, setDoc, updateDoc, ref, uploadBytes, getDownloadURL }
  };

  FirebaseSettingsRepository.prototype._getFirebase = function () {
    var self = this;
    if (self._inject) return Promise.resolve(self._inject);
    // Carrega config e módulos necessários sob demanda
    return Promise.all([
      import("./firebaseConfig.js"),
      import("firebase/firestore"),
      import("firebase/storage")
    ]).then(function (mods) {
      var cfg = mods[0];
      var fs = mods[1];
      var st = mods[2];
      return {
        db: cfg.db,
        storage: cfg.storage,
        doc: fs.doc,
        getDoc: fs.getDoc,
        setDoc: fs.setDoc,
        updateDoc: fs.updateDoc,
        ref: st.ref,
        uploadBytes: st.uploadBytes,
        getDownloadURL: st.getDownloadURL
      };
    });
  };

  FirebaseSettingsRepository.prototype.load = function () {
    var self = this;
    return self._getFirebase().then(function (f) {
      var dref = f.doc(f.db, "userSettings", "anon");
      return f.getDoc(dref).then(function (snap) {
        if (!snap || !snap.exists || !snap.exists()) {
          return DEFAULTS;
        }
        var data = snap.data ? snap.data() : snap.get ? snap.get() : {};
        return Object.assign({}, DEFAULTS, data || {});
      }).catch(function () { return DEFAULTS; });
    });
  };

  FirebaseSettingsRepository.prototype.save = function (settings) {
    var self = this;
    var finalObj = Object.assign({}, settings);
    return self._getFirebase().then(function (f) {
      var p = Promise.resolve(null);
      if (isDataUrl(finalObj.avatarSrc)) {
        var conv = dataUrlToBlob(finalObj.avatarSrc);
        var ext = mimeExt(conv.mime);
        var sref = f.ref(f.storage, "avatars/anon." + ext);
        p = f.uploadBytes(sref, conv.blob, { contentType: conv.mime }).then(function () {
          return f.getDownloadURL(sref).then(function (url) {
            finalObj.avatarSrc = url;
          });
        });
      }
      return p.then(function () {
        var dref = f.doc(f.db, "userSettings", "anon");
        return f.setDoc(dref, finalObj, { merge: true });
      });
    });
  };

  // Regras mínimas (DEV) sugeridas:
  // Firestore rules (DEV): allow read, write: if true;  (NÃO usar em produção)
  // Storage rules (DEV):   allow read, write: if true;  (NÃO usar em produção)
  // Em produção, restrinja por Auth (request.auth.uid)

  return FirebaseSettingsRepository;
});

