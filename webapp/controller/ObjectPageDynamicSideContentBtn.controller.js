sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/formatter"
], function (Controller, JSONModel, formatter) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.ObjectPageDynamicSideContentBtn", {
    formatter: formatter,

    onInit: function () {
      this._router = this.getOwnerComponent().getRouter();
      this._router.getRoute("RouteHistorico").attachPatternMatched(this._onMatched, this);
      this.getView().setModel(new JSONModel({}), "detail");
    },

    _onMatched: function (oEvt) {
      this._veiculoId = oEvt.getParameter("arguments").id;

      // Modelos no COMPONENT (globais)
      this._mMain = this.getOwnerComponent().getModel();              // default -> /veiculos
      this._mMat  = this.getOwnerComponent().getModel("materiais");   // /materiaisPorVeiculo
      this._mAb   = this.getOwnerComponent().getModel("abast");       // /abastecimentosPorVeiculo

      // Espera carregamento assíncrono (JSONModel com "uri")
      var that = this;
      var waitAndBuild = function () {
        var ready =
          !!(that._mMain && that._mMain.getData() && that._mMain.getProperty("/veiculos")) &&
          !!(that._mMat  && that._mMat.getData()) &&
          !!(that._mAb   && that._mAb.getData());

        if (ready) {
          that._buildDetail();
        }
      };

      // Se já estiver tudo carregado, monta já
      waitAndBuild();

      // Caso contrário, escuta os 3
      if (this._mMain && this._mMain.attachRequestCompleted) {
        this._mMain.attachRequestCompleted(waitAndBuild);
      }
      if (this._mMat && this._mMat.attachRequestCompleted) {
        this._mMat.attachRequestCompleted(waitAndBuild);
      }
      if (this._mAb && this._mAb.attachRequestCompleted) {
        this._mAb.attachRequestCompleted(waitAndBuild);
      }
    },

    _buildDetail: function () {
      var veiculoId = this._veiculoId;

      // Veículo base
      var aVeic = (this._mMain.getProperty("/veiculos") || []);
      var vObj  = aVeic.find(v => String(v.id || v.veiculo) === String(veiculoId));
      if (!vObj) {
        this.getView().getModel("detail").setData({ historico: [] });
        return;
      }

      // Preço médio (R$/L) a partir dos agregados do veículo
      var litrosTot = Number(vObj.combustivelLitros || 0);
      var valorTot  = Number(vObj.combustivelValor  || 0);
      var precoMedio = litrosTot ? (valorTot / litrosTot) : 0;

      // Materiais/Serviços
      var mats = (this._mMat.getProperty("/materiaisPorVeiculo/" + veiculoId) || []);
      var histMats = mats.map(function (m) {
        var qtde = Number(m.qtde || 0);
        var cu   = Number(m.custoUnit || 0);
        return {
          data: m.dataEntrada || vObj.data || null,
          tipo: (m.tipo || "").match(/serv/i) ? "Serviço" : "Material",
          descricao: [m.nome, m.codMaterial ? ("(" + m.codMaterial + ")") : "", m.deposito ? ("Dep. " + m.deposito) : ""]
            .filter(Boolean).join(" "),
          qtde: qtde,
          custoUnit: cu,
          valor: qtde * cu
        };
      });

      // Abastecimentos (valoriza por preço médio do veículo)
      var fuels = (this._mAb.getProperty("/abastecimentosPorVeiculo/" + veiculoId) || []);
      var histFuel = fuels.map(function (f) {
        var litros = Number(f.litros || 0);
        return {
          data: f.data || vObj.data || null,
          tipo: "Combustível",
          descricao: ["Abastecimento", f.hora ? ("às " + f.hora) : "", f.km ? ("KM " + f.km) : ""]
            .filter(Boolean).join(" — "),
          qtde: litros,
          custoUnit: precoMedio || 0,
          valor: litros * (precoMedio || 0)
        };
      });

      // Junta e ordena desc por data
      var historico = histMats.concat(histFuel).sort(function (a, b) {
        var da = a.data ? new Date(a.data).getTime() : 0;
        var db = b.data ? new Date(b.data).getTime() : 0;
        return db - da;
      });

      // Totais
      var totalComb = histFuel.reduce((s, x) => s + Number(x.valor || 0), 0);
      var totalMat  = histMats.reduce((s, x) => s + Number(x.valor || 0), 0);
      var totalGeral = totalComb + totalMat;

      // Modelo de detalhe
      var detail = Object.assign({}, vObj, {
        historico: historico,
        precoMedioFmt: this.formatter.fmtNum(precoMedio),
        totalCombustivelFmt: this.formatter.fmtBrl(totalComb),
        totalMateriaisFmt: this.formatter.fmtBrl(totalMat),
        totalGeralFmt: this.formatter.fmtBrl(totalGeral)
      });

      this.getView().getModel("detail").setData(detail);
    }
  });
});
