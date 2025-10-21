/* global QUnit, sinon */

sap.ui.getCore().attachInit(function () {
  "use strict";

  sap.ui.require([
    "com/skysinc/frota/frota/test/unit/controller/OSDialog.qunit"
  ], function () {
    QUnit.start();
  });
});

