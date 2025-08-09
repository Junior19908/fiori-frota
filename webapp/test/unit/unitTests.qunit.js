/* global QUnit */
QUnit.config.autostart = false;

sap.ui.getCore().attachInit(function () {
	"use strict";

	sap.ui.require([
		"com/skysinc/frota/frota/test/unit/AllTests"
	], function () {
		QUnit.start();
	});
});
