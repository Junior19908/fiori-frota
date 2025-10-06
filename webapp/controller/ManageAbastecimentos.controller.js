sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, BusyIndicator, MessageBox) {
  "use strict";

  function pad2(n){ return String(n).padStart(2, "0"); }

  function normalizeMonth(s){ var m = String(s||"").trim(); var mm = m.match(/^(\d{4})-(\d{2})$/); return mm ? (mm[1]+"-"+mm[2]) : ""; }

  function flattenAbast(data){
    var out = [];
    if (!data || !data.abastecimentosPorVeiculo) return out;
    Object.keys(data.abastecimentosPorVeiculo).forEach(function(veh){
      var arr = Array.isArray(data.abastecimentosPorVeiculo[veh]) ? data.abastecimentosPorVeiculo[veh] : [];
      arr.forEach(function(ev, idx){ out.push(Object.assign({ veiculo: veh, _idx: idx }, ev)); });
    });
    // ordena por data/hora
    out.sort(function(a,b){ var ta = new Date((a.data||"1970-01-01")+"T"+(a.hora||"00:00:00")).getTime(); var tb = new Date((b.data||"1970-01-01")+"T"+(b.hora||"00:00:00")).getTime(); return ta - tb; });
    return out;
  }

  return Controller.extend("com.skysinc.frota.frota.controller.ManageAbastecimentos", {
    onInit: function () {
      this.getView().setModel(new JSONModel({ items: [], ym: "" }), "ab");
    },

    onNavBack: function(){ try { this.getOwnerComponent().getRouter().navTo("settings"); } catch(_){} },

    onLoad: function(){
      var ym = normalizeMonth(this.byId("inpMonth").getValue());
      if (!ym) { MessageToast.show("Informe Mês YYYY-MM."); return; }
      var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]);
      var that = this; BusyIndicator.show(0);
      sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
        svc.fetchMonthlyFromFirestore(y, m).then(function (data) {
          if (data && data.schema === 'v2') {
            return svc.fetchMonthlyEventsV2(y, m).then(function (list) {
              that.getView().getModel("ab").setData({ items: list, ym: ym, schema: 'v2' });
              MessageToast.show(list.length + " evento(s) carregado(s).");
            });
          } else {
            var items = flattenAbast(data);
            that.getView().getModel("ab").setData({ items: items, ym: ym, schema: 'v1' });
            MessageToast.show(items.length + " evento(s) carregado(s).");
            return null;
          }
        }).catch(function(e){ console.error(e); MessageToast.show("Falha ao carregar mês."); })
        .finally(function(){ BusyIndicator.hide(); });
      });
    },

    onMigrateToV2: function(){
      var ym = normalizeMonth(this.byId("inpMonth").getValue());
      if (!ym) { MessageToast.show("Informe Mês YYYY-MM."); return; }
      var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]);
      var that = this;
      MessageBox.warning("Converter o mês " + ym + " para o formato V2 (paginado por veículo)?", {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        onClose: function (act) {
          if (act !== MessageBox.Action.OK) return;
          BusyIndicator.show(0);
          sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
            svc.migrateMonthV1toV2(y, m, 500).then(function(res){
              MessageToast.show("Migrado para V2.");
              return that.onLoad();
            }).catch(function(e){ console.error(e); MessageToast.show("Falha na migração."); })
              .finally(function(){ BusyIndicator.hide(); });
          });
        }
      });
    },

    _getSelection: function(){
      var tbl = this.byId("tblEvents");
      var ctxs = tbl.getSelectedContexts(true);
      return ctxs.map(function (c) { return c.getObject && c.getObject(); }).filter(Boolean);
    },

    onDeleteSelected: function(){
      var sel = this._getSelection();
      if (!sel.length) { MessageToast.show("Selecione ao menos um evento."); return; }
      var model = this.getView().getModel("ab");
      var data = model.getData(); var ym = data.ym || ""; var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]);
      var that = this;
      MessageBox.warning("Excluir " + sel.length + " evento(s) selecionado(s)?", {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        onClose: function (act) {
          if (act !== MessageBox.Action.OK) return;
          BusyIndicator.show(0);
          sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
            svc.fetchMonthlyFromFirestore(y, m).then(function (existing) {
              if (existing && existing.schema === 'v2') {
                // agrupa por veículo
                var byVeh = {};
                sel.forEach(function (e) { var veh = String(e.veiculo||""); if (!byVeh[veh]) byVeh[veh]=[]; byVeh[veh].push(e.idEvento); });
                var ops = Object.keys(byVeh).map(function (veh) { return svc.removeVehicleEventsPaged(y, m, veh, byVeh[veh], 500); });
                return Promise.all(ops);
              } else {
                existing = existing || { abastecimentosPorVeiculo: {} };
                var map = existing.abastecimentosPorVeiculo || {};
                var toDelete = new Map();
                sel.forEach(function (e) { var k = (e.veiculo||"")+"|"+(e.idEvento||""); toDelete.set(k, true); });
                Object.keys(map).forEach(function (veh) {
                  var arr = Array.isArray(map[veh]) ? map[veh] : [];
                  map[veh] = arr.filter(function (ev) { var k = veh+"|"+(ev && ev.idEvento || ""); return !toDelete.has(k); });
                });
                return svc.saveMonthlyToFirestore(y, m, { abastecimentosPorVeiculo: map });
              }
            }).then(function () {
              that.onLoad();
              MessageToast.show("Eventos excluídos.");
            }).catch(function (e) { console.error(e); MessageToast.show("Falha ao excluir."); })
            .finally(function(){ BusyIndicator.hide(); });
          });
        }
      });
    },

    onDeleteMonth: function(){
      var ym = (this.getView().getModel("ab").getData().ym || "").trim();
      if (!ym) { MessageToast.show("Informe/Carregue o mês."); return; }
      var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]);
      var that = this;
      MessageBox.error("Tem certeza que deseja excluir TODO o mês " + ym + "?", {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        onClose: function (act) {
          if (act !== MessageBox.Action.OK) return;
          BusyIndicator.show(0);
          sap.ui.require(["com/skysinc/frota/frota/services/FirebaseFirestoreService"], function (svc) {
            svc.fetchMonthlyFromFirestore(y, m).then(function (data) {
              if (data && data.schema === 'v2') {
                return svc.deleteMonthlyDeep(y, m);
              } else {
                return svc.deleteMonthlyFromFirestore(y, m);
              }
            }).then(function(){ MessageToast.show("Mês excluído."); that.getView().getModel("ab").setData({ items: [], ym: ym }); })
            .catch(function(e){ console.error(e); MessageToast.show("Falha ao excluir mês."); })
            .finally(function(){ BusyIndicator.hide(); });
          });
        }
      });
    }
  });
});
