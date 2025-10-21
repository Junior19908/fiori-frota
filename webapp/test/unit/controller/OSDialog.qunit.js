/* global QUnit, sinon */

sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment"
], function (JSONModel, Fragment) {
  "use strict";

  QUnit.module("OSDialog - open()", {
    beforeEach: function () {
      this.sandbox = sinon.createSandbox();
      // Fake dialog returned by Fragment.load
      this.fakeDialog = {
        models: {},
        addDependent: function () {},
        setModel: function (m, name) { this.models[name || undefined] = m; },
        isA: function (t) { return t === "sap.m.Dialog"; },
        open: function () {}
      };
      this.sandbox.stub(Fragment, "load").callsFake(function () {
        return Promise.resolve(this.fakeDialog);
      }.bind(this));

      // Stub AvailabilityService
      this.availStub = this.sandbox.stub();
      // Preload stubbed module
      sap.ui.loader._.declareModule("com/skysinc/frota/frota/services/AvailabilityService");
      sap.ui.loader._.defineModule("com/skysinc/frota/frota/services/AvailabilityService", [], function () {
        return { fetchOsByVehiclesAndRange: this.availStub };
      }.bind(this));

      // Minimal fake view
      this.fakeView = {
        getId: function () { return "unitView"; },
        addDependent: function () {},
        getModel: function () { return null; },
        setModel: function () {}
      };
    },
    afterEach: function () {
      this.sandbox.restore();
    }
  });

  QUnit.test("carrega OS do AvailabilityService e popula modelo", function (assert) {
    const done = assert.async();
    const veh = "20020406";
    const sample = [{
      NumeroOS: "4863104",
      Equipamento: veh,
      Descricao: "LUBRIFICAÇÃO (GRAXA)",
      DataAbertura: "2025-10-06",
      DataFechamento: "",
      HoraInicio: "10:23",
      HoraFim: "00:00",
      Categoria: "ZF03"
    }];
    const map = new Map();
    map.set(veh, sample);
    this.availStub.resolves(map);

    sap.ui.require(["com/skysinc/frota/frota/controller/OSDialog"], function (OSDlg) {
      OSDlg.open(this.fakeView, { equnr: veh, range: [new Date(2025,9,1), new Date(2025,9,31)] })
        .then(function () {
          const m = this.fakeDialog.models["osDlg"]; // JSONModel set in dialog
          assert.ok(m instanceof JSONModel, "modelo JSONModel foi setado no diálogo");
          const data = m.getData();
          assert.ok(Array.isArray(data.os), "lista os existe");
          assert.equal(data.os.length, 1, "1 OS carregada");
          assert.equal(data.os[0].veiculo, veh, "veículo mapeado corretamente");
          assert.equal(data.os[0].ordem, "4863104", "ordem mapeada");
          done();
        }.bind(this));
    }.bind(this));
  });

});

