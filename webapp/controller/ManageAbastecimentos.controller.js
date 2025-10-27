sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, BusyIndicator, MessageBox) {
  "use strict";

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function normalizeMonth(source) {
    var raw = String(source || "").trim();
    var match = raw.match(/^(\d{4})-(\d{2})$/);
    return match ? match[1] + "-" + match[2] : "";
  }

  function flattenAbast(data) {
    var result = [];
    if (!data || !data.abastecimentosPorVeiculo) {
      return result;
    }
    Object.keys(data.abastecimentosPorVeiculo).forEach(function (vehKey) {
      var list = Array.isArray(data.abastecimentosPorVeiculo[vehKey]) ? data.abastecimentosPorVeiculo[vehKey] : [];
      list.forEach(function (event, index) {
        result.push(Object.assign({ veiculo: vehKey, _idx: index }, event));
      });
    });
    result.sort(function (a, b) {
      var aTime = new Date((a.data || "1970-01-01") + "T" + (a.hora || "00:00:00")).getTime();
      var bTime = new Date((b.data || "1970-01-01") + "T" + (b.hora || "00:00:00")).getTime();
      return aTime - bTime;
    });
    return result;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function slicePage(items, page, pageSize) {
    var total = Array.isArray(items) ? items.length : 0;
    var size = Math.max(1, Number(pageSize) || 50);
    var totalPages = Math.max(1, Math.ceil(total / size));
    var current = clamp(Number(page) || 1, 1, totalPages);
    var start = (current - 1) * size;
    var end = Math.min(start + size, total);

    return {
      paged: (items || []).slice(start, end),
      page: current,
      pageSize: size,
      total: total,
      totalPages: totalPages,
      from: total ? start + 1 : 0,
      to: total ? end : 0
    };
  }

  return Controller.extend("com.skysinc.frota.frota.controller.ManageAbastecimentos", {
    onInit: function () {
      var initialData = {
        items: [],
        pagedItems: [],
        ym: "",
        page: 1,
        pageSize: 50,
        totalPages: 1,
        totalCount: 0,
        from: 0,
        to: 0,
        schema: null
      };

      var model = new JSONModel(initialData);
      var that = this;

      var originalSetData = model.setData.bind(model);
      model.setData = function (data) {
        originalSetData(data);
        try {
          that._recomputePaging();
        } catch (err) {
          // no-op
        }
      };

      var originalSetProperty = model.setProperty.bind(model);
      model.setProperty = function (path, value) {
        var result = originalSetProperty(path, value);
        try {
          var normalizedPath = String(path || "");
          if (normalizedPath === "/items" || normalizedPath === "/page" || normalizedPath === "/pageSize") {
            that._recomputePaging();
          }
        } catch (err) {
          // no-op
        }
        return result;
      };

      this.getView().setModel(model, "ab");
      this._recomputePaging();
    },

    _recomputePaging: function () {
      var model = this.getView().getModel("ab");
      if (!model) {
        return;
      }
      var data = model.getData() || {};
      var paging = slicePage(data.items || [], data.page || 1, data.pageSize || 50);
      model.setProperty("/pagedItems", paging.paged);
      model.setProperty("/page", paging.page);
      model.setProperty("/pageSize", paging.pageSize);
      model.setProperty("/totalPages", paging.totalPages);
      model.setProperty("/totalCount", paging.total);
      model.setProperty("/from", paging.from);
      model.setProperty("/to", paging.to);
    },

    _clearTableSelection: function () {
      var table = this.byId("tblEvents");
      if (table && table.removeSelections) {
        table.removeSelections(true);
      }
    },

    onPageSizeChange: function (event) {
      var source = event && event.getSource && event.getSource();
      var key = source && source.getSelectedKey ? source.getSelectedKey() : null;
      var size = Number(key || 50) || 50;
      var model = this.getView().getModel("ab");
      if (!model) {
        return;
      }
      model.setProperty("/pageSize", size);
      model.setProperty("/page", 1);
      this._recomputePaging();
      this._clearTableSelection();
    },

    onPagePrev: function () {
      var model = this.getView().getModel("ab");
      if (!model) {
        return;
      }
      var nextPage = (model.getProperty("/page") || 1) - 1;
      var maxPage = Math.max(1, model.getProperty("/totalPages") || 1);
      model.setProperty("/page", clamp(nextPage, 1, maxPage));
      this._recomputePaging();
      this._clearTableSelection();
    },

    onPageNext: function () {
      var model = this.getView().getModel("ab");
      if (!model) {
        return;
      }
      var maxPage = Math.max(1, model.getProperty("/totalPages") || 1);
      var nextPage = (model.getProperty("/page") || 1) + 1;
      model.setProperty("/page", clamp(nextPage, 1, maxPage));
      this._recomputePaging();
      this._clearTableSelection();
    },

    onPageFirst: function () {
      var model = this.getView().getModel("ab");
      if (!model) {
        return;
      }
      model.setProperty("/page", 1);
      this._recomputePaging();
      this._clearTableSelection();
    },

    onPageLast: function () {
      var model = this.getView().getModel("ab");
      if (!model) {
        return;
      }
      var maxPage = Math.max(1, model.getProperty("/totalPages") || 1);
      model.setProperty("/page", maxPage);
      this._recomputePaging();
      this._clearTableSelection();
    },

    onNavBack: function () {
      try {
        this.getOwnerComponent().getRouter().navTo("settings");
      } catch (err) {
        // no-op
      }
    },

    onLoad: function () {
      var input = this.byId("inpMonth");
      var ym = normalizeMonth(input && input.getValue && input.getValue());
      if (!ym) {
        MessageToast.show("Informe mes YYYY-MM.");
        return;
      }

      var parts = ym.split("-");
      var year = Number(parts[0]);
      var month = Number(parts[1]);
      var model = this.getView().getModel("ab");
      var that = this;

      BusyIndicator.show(0);

      var url1 = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/abastecimento/" + year + "/" + pad2(month) + "/abastecimentos.json");
      var url2 = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/" + year + "/" + pad2(month) + "/abastecimentos.json");

      jQuery.ajax({
        url: url1,
        dataType: "json",
        cache: false,
        success: function (data) {
          var items = flattenAbast(data);
          model.setData({ items: items, ym: ym, schema: data && data.schema ? data.schema : null });
          MessageToast.show(items.length + " evento(s) carregado(s) (local).");
        },
        error: function () {
          jQuery.ajax({
            url: url2,
            dataType: "json",
            cache: false,
            success: function (data) {
              var items = flattenAbast(data);
              model.setData({ items: items, ym: ym, schema: data && data.schema ? data.schema : null });
              MessageToast.show(items.length + " evento(s) carregado(s) (local).");
            },
            error: function () {
              MessageToast.show("Mes nao encontrado.");
            }
          });
        }
      }).always(function () {
        BusyIndicator.hide();
      });
    },

    _getSelection: function () {
      var table = this.byId("tblEvents");
      var contexts = table && table.getSelectedContexts ? table.getSelectedContexts(true) : [];
      return (contexts || []).map(function (ctx) {
        return ctx && ctx.getObject ? ctx.getObject() : null;
      }).filter(Boolean);
    },

    onDeleteSelected: function () {
      var selected = this._getSelection();
      if (!selected.length) {
        MessageToast.show("Selecione ao menos um evento.");
        return;
      }

      var model = this.getView().getModel("ab");
      var data = model.getData() || {};
      var ym = data.ym || "";
      var parts = ym.split("-");
      var year = Number(parts[0]);
      var month = Number(parts[1]);

      var toDelete = new Set(selected.map(function (event) {
        return String(event.veiculo || "") + "|" + String(event.idEvento || "");
      }));

      var items = Array.isArray(model.getProperty("/items")) ? model.getProperty("/items") : [];
      var kept = items.filter(function (event) {
        var key = String(event.veiculo || "") + "|" + String(event.idEvento || "");
        return !toDelete.has(key);
      });

      var map = {};
      kept.forEach(function (event) {
        var veh = String(event.veiculo || "");
        if (!veh) {
          return;
        }
        if (!map[veh]) {
          map[veh] = [];
        }
        map[veh].push(event);
      });

      var json = { abastecimentosPorVeiculo: map };

      try {
        var blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement("a");
        var fileName = "abastecimentos-" + String(year) + "-" + pad2(month) + ".json";
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(function () {
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
        }, 0);
        MessageToast.show("JSON atualizado gerado: " + fileName);
        model.setProperty("/items", kept);
        this._recomputePaging();
        this._clearTableSelection();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        MessageToast.show("Falha ao gerar JSON.");
      }
    },

    onDeleteMonth: function () {
      var model = this.getView().getModel("ab");
      var data = model.getData() || {};
      var ym = String(data.ym || "").trim();
      if (!ym) {
        MessageToast.show("Informe/Carregue o mes.");
        return;
      }

      var parts = ym.split("-");
      var year = Number(parts[0]);
      var month = Number(parts[1]);
      var that = this;

      MessageBox.error("Tem certeza que deseja excluir TODO o mes " + ym + "?", {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        onClose: function (action) {
          if (action !== MessageBox.Action.OK) {
            return;
          }
          var json = { abastecimentosPorVeiculo: {} };
          try {
            var blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
            var url = URL.createObjectURL(blob);
            var anchor = document.createElement("a");
            var fileName = "abastecimentos-" + String(year) + "-" + pad2(month) + ".json";
            anchor.href = url;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            setTimeout(function () {
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
            }, 0);
            MessageToast.show("Arquivo vazio gerado: " + fileName);
            that.getView().getModel("ab").setData({ items: [], ym: ym, schema: null });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            MessageToast.show("Falha ao gerar JSON.");
          }
        }
      });
    }
  });
});

