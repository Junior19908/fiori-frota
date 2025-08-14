sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log"
], function (UIComponent, JSONModel, Log) {
  "use strict";

  return UIComponent.extend("com.skysinc.frota.frota.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // 1) Modelos globais
      var oVeiculos   = new JSONModel();
      var oMateriais  = new JSONModel();
      var oAbast      = new JSONModel();

      oVeiculos.setSizeLimit(100000);
      oMateriais.setSizeLimit(100000);
      oAbast.setSizeLimit(100000);

      this.setModel(oVeiculos);                // "/" → { veiculos: [...] }
      this.setModel(oMateriais, "materiais");  // "/materiaisPorVeiculo"
      this.setModel(oAbast,     "abast");      // "/abastecimentosPorVeiculo"

      // 2) Base dos mocks
      var base = "com/skysinc/frota/frota/model/localdata/";
      this.__currentYM = this.__currentYM || (function () {
        var n = new Date();
        return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0");
      })();

      function toUrl(p) { return sap.ui.require.toUrl(p); }

      function _loadModelOnce(oModel, url) {
        return new Promise(function (resolve, reject) {
          var completed = function (e) {
            oModel.detachRequestCompleted(completed);
            oModel.detachRequestFailed(failed);
            if (e.getParameter("success")) resolve();
            else reject(new Error("Falha ao carregar " + url));
          };
          var failed = function () {
            oModel.detachRequestCompleted(completed);
            oModel.detachRequestFailed(failed);
            reject(new Error("Falha ao carregar " + url));
          };
          oModel.attachRequestCompleted(completed);
          oModel.attachRequestFailed(failed);
          oModel.loadData(toUrl(url));
        });
      }

      // Helper: obter JSON cru (para mesclar múltiplos meses)
      function fetchJson(url) {
        return new Promise(function (resolve, reject) {
          jQuery.ajax({
            url: toUrl(url),
            dataType: "json",
            cache: false,
            success: function (data) { resolve(data); },
            error: function (_, __, err) { reject(err || new Error("Erro em " + url)); }
          });
        });
      }

      // Mesclagem: arrays (concat) e mapas (merge por chave)
      function mergeArray(dst, src) {
        if (!Array.isArray(dst)) dst = [];
        if (!Array.isArray(src)) src = [];
        return dst.concat(src);
      }
      function mergeMap(dst, src) {
        dst = dst || {};
        src = src || {};
        Object.keys(src).forEach(function (k) {
          if (Array.isArray(src[k])) {
            dst[k] = (dst[k] || []).concat(src[k]);
          } else if (src[k] && typeof src[k] === "object") {
            dst[k] = mergeMap(dst[k] || {}, src[k]);
          } else {
            dst[k] = src[k];
          }
        });
        return dst;
      }

      // API: fixa UM mês/ano (compatível com versões anteriores)
      this.setMockYM = function (yyyy, mm) {
        var ym = String(yyyy) + "-" + String(mm).padStart(2, "0");
        this.__currentYM = ym;
        var prefix = base + yyyy + "/" + String(mm).padStart(2, "0") + "/";
        var p1 = _loadModelOnce(this.getModel(),            prefix + "veiculos.json");
        var p2 = _loadModelOnce(this.getModel("materiais"), prefix + "materiais.json");
        var p3 = _loadModelOnce(this.getModel("abast"),     prefix + "abastecimentos.json");
        return Promise.all([p1, p2, p3]);
      };

      // ✅ API: intervalo multi-mês (YYYY-MM inclusivo) — unifica em memória
      this.setMockRange = function (startDate, endDate) {
        // Gera (YYYY,MM) únicos entre start e end (inclusivo)
        var months = [];
        if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
          return Promise.resolve(); // sem datas → não faz nada
        }
        var y = startDate.getFullYear(), m = startDate.getMonth();
        var yEnd = endDate.getFullYear(), mEnd = endDate.getMonth();
        while (y < yEnd || (y === yEnd && m <= mEnd)) {
          months.push({ yyyy: y, mm: String(m + 1).padStart(2, "0") });
          m++;
          if (m > 11) { m = 0; y++; }
        }
        if (!months.length) return Promise.resolve();

        var that = this;
        var aggVeiculos = { veiculos: [] };
        var aggMateriais = { materiaisPorVeiculo: {} };
        var aggAbast = { abastecimentosPorVeiculo: {} };

        return Promise.all(months.map(function (mo) {
          var prefix = base + mo.yyyy + "/" + mo.mm + "/";
          return Promise.all([
            fetchJson(prefix + "veiculos.json").catch(function(){ return { veiculos: [] }; }),
            fetchJson(prefix + "materiais.json").catch(function(){ return { materiaisPorVeiculo: {} }; }),
            fetchJson(prefix + "abastecimentos.json").catch(function(){ return { abastecimentosPorVeiculo: {} }; })
          ]).then(function (res) {
            var v = res[0] || {}, mat = res[1] || {}, ab = res[2] || {};
            aggVeiculos.veiculos = mergeArray(aggVeiculos.veiculos, v.veiculos || []);
            aggMateriais.materiaisPorVeiculo = mergeMap(aggMateriais.materiaisPorVeiculo, mat.materiaisPorVeiculo || {});
            aggAbast.abastecimentosPorVeiculo = mergeMap(aggAbast.abastecimentosPorVeiculo, ab.abastecimentosPorVeiculo || {});
          });
        })).then(function () {
          that.getModel().setData(aggVeiculos);
          that.getModel("materiais").setData(aggMateriais);
          that.getModel("abast").setData(aggAbast);
        });
      };

      // 3) Carga inicial (mês atual)
      (function () {
        var now = new Date();
        var yyyy = String(now.getFullYear());
        var mm   = String(now.getMonth() + 1).padStart(2, "0");
        var urlV = base + yyyy + "/" + mm + "/veiculos.json";
        var urlM = base + yyyy + "/" + mm + "/materiais.json";
        var urlA = base + yyyy + "/" + mm + "/abastecimentos.json";

        _loadModelOnce(oVeiculos,  urlV);
        _loadModelOnce(oMateriais, urlM);
        _loadModelOnce(oAbast,     urlA);
      })();

      // 4) Log
      [["veiculos", oVeiculos], ["materiais", oMateriais], ["abastecimentos", oAbast]]
        .forEach(function ([nome, model]) {
          model.attachRequestCompleted(function (e) {
            if (e.getParameter("success") === false) {
              Log.error("[Component] Falha ao carregar " + nome);
            } else {
              Log.info("[Component] " + nome + " carregado");
            }
          });
          model.attachRequestFailed(function (e) {
            Log.error("[Component] Erro ao carregar " + nome, e.getParameter("message"));
          });
        });

      // 5) Router
      this.getRouter().initialize();
    }
  });
});
