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

      // 1) Cria os modelos vazios (globais)
      var oVeiculos   = new JSONModel();
      var oMateriais  = new JSONModel();
      var oAbast      = new JSONModel();

      // aumenta o limite de registros para binds longos
      oVeiculos.setSizeLimit(100000);
      oMateriais.setSizeLimit(100000);
      oAbast.setSizeLimit(100000);

      // 2) Registra no Component (default + nomeados)
      this.setModel(oVeiculos);                // "/"  -> veiculos.json deve ter { "veiculos": [...] }
      this.setModel(oMateriais, "materiais");  // "/materiaisPorVeiculo"
      this.setModel(oAbast,     "abast");      // "/abastecimentosPorVeiculo"

      // 3) Carrega os arquivos JSON (ajuste os caminhos se necessário)
      var base = "com/skysinc/frota/frota/model/mockdata/";
      
      // ===== Mocks SOMENTE por ano/mês (sem fallback) =====
      var now = new Date();
      var yyyy = String(now.getFullYear());
      var mm   = String(now.getMonth() + 1).padStart(2, "0");

      function toUrl(p){ return sap.ui.require.toUrl(p); }

      function loadYearMonthOnly(oModel, fileName){
        var url = base + yyyy + "/" + mm + "/" + fileName; // caminho obrigatório /YYYY/MM/file.json
        oModel.loadData(toUrl(url));
        // Loga erro explícito se não existir
        oModel.attachRequestCompleted(function(e){
          if (e.getParameter("success") === false){
            sap.base.Log.error("[Component] Mock não encontrado em " + url + ". Crie o arquivo nesse caminho.");
          }
        });
      }
      // =====================================================

      loadYearMonthOnly(oVeiculos, "veiculos.json");
      loadYearMonthOnly(oMateriais, "materiais.json");
      loadYearMonthOnly(oAbast, "abastecimentos.json");

      // 4) Log básico de erro (opcional, mas ajuda)
      [ ["veiculos", oVeiculos], ["materiais", oMateriais], ["abastecimentos", oAbast] ]
        .forEach(function([nome, model]){
          model.attachRequestCompleted(function(e){
            if (e.getParameter("success") === false) {
              Log.error("[Component] Falha ao carregar " + nome);
            } else {
              Log.info("[Component] " + nome + " carregado");
            }
          });
          model.attachRequestFailed(function(e){
            Log.error("[Component] Erro ao carregar " + nome, e.getParameter("message"));
          });
        });

      // 5) Inicializa o roteador
      this.getRouter().initialize();
    }
  });
});
