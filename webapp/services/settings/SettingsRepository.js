sap.ui.define([], function () {
  "use strict";

  /**
   * Contrato de persistÃªncia de Settings.
   * ImplementaÃ§Ãµes devem sobrescrever load() e save().
   */
  var SettingsRepository = function() {};

  /**
   * @returns {Promise<object>} Objeto settings no schema definido.
   */
  SettingsRepository.prototype.load = function() {
    throw new Error("Not implemented");
  };

  /**
   * @param {object} settings Objeto settings para persistir
   * @returns {Promise<void>}
   */
  SettingsRepository.prototype.save = function(/* settings */) {
    throw new Error("Not implemented");
  };

  return SettingsRepository;
});

