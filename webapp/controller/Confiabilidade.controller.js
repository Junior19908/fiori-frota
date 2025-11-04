sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log",
  "sap/ui/core/routing/History",
  "sap/ui/core/ResizeHandler",
  "sap/ui/Device",
  "sap/ui/core/Core",
  "sap/m/MessageToast",
  "com/skysinc/frota/frota/util/ReliabilityService",
  "com/skysinc/frota/frota/util/ChartBuilder",
  "com/skysinc/frota/frota/model/FilterState",
  "com/skysinc/frota/frota/util/Storage",
  "com/skysinc/frota/frota/util/FilterBuilder",
  "com/skysinc/frota/frota/util/CsvUtil"
], function (
  Controller,
  JSONModel,
  Log,
  History,
  ResizeHandler,
  Device,
  Core,
  MessageToast,
  ReliabilityService,
  ChartBuilder,
  FilterState,
  Storage,
  FilterBuilder,
  CsvUtil
) {
  "use strict";

  const NUMBER_FORMAT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const INTEGER_FORMAT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const PERCENT_FORMAT = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const DATE_TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  function throttle(fn, delay) {
    let lastCall = 0;
    let scheduled = null;
    return function () {
      const context = this;
      const args = arguments;
      const now = Date.now();
      const remaining = delay - (now - lastCall);
      if (remaining <= 0) {
        lastCall = now;
        fn.apply(context, args);
      } else if (!scheduled) {
        scheduled = setTimeout(function () {
          scheduled = null;
          lastCall = Date.now();
          fn.apply(context, args);
        }, remaining);
      }
    };
  }

  function createInitialState() {
    return {
      busy: false,
      vehicle: {
        title: "-",
        subtitle: ""
      },
      breadcrumbs: [],
      kpis: {
        mtbfFmt: "-",
        mttrFmt: "-",
        disponibilidadeFmt: "-",
        kmPorQuebraFmt: "-",
        hrPorQuebraFmt: "-",
        proximaQuebraKmFmt: "-",
        proximaQuebraHrFmt: "-",
        falhasResumo: "",
        downtimeResumo: ""
      },
      trend: [],
      availability: [],
      cost: [],
      comparisons: [],
      failures: [],
      failuresCountText: "",
      loadingFailures: false,
      failureFilters: {
        type: "",
        severity: "",
        subsystem: "",
        search: "",
        typeOptions: [],
        severityOptions: [],
        subsystemOptions: []
      }
    };
  }

  function formatHours(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "-";
    }
    return NUMBER_FORMAT.format(value) + " h";
  }

  function formatKm(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return "-";
    }
    return NUMBER_FORMAT.format(value) + " km";
  }

function formatPercent(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return PERCENT_FORMAT.format(Math.max(0, Math.min(1, value)));
}

function resolveBundle(controller) {
  if (!controller) {
    return null;
  }
  const view = controller.getView && controller.getView();
  const viewModel = view && view.getModel && view.getModel("i18n");
  if (viewModel && viewModel.getResourceBundle) {
    return viewModel.getResourceBundle();
  }
  const component = controller.getOwnerComponent && controller.getOwnerComponent();
  const compModel = component && component.getModel && component.getModel("i18n");
  if (compModel && compModel.getResourceBundle) {
    return compModel.getResourceBundle();
  }
  const coreModel = Core.getModel && Core.getModel("i18n");
  return coreModel && coreModel.getResourceBundle ? coreModel.getResourceBundle() : null;
}

function safeText(controller, key, args, fallback) {
  const bundle = controller._resourceBundle || resolveBundle(controller);
  if (bundle && typeof bundle.getText === "function") {
    if (!controller._resourceBundle) {
      controller._resourceBundle = bundle;
    }
    try {
      return bundle.getText(key, args);
    } catch (err) {
      // ignore missing key
    }
  }
  return fallback != null ? fallback : key;
}

  function normaliseDate(date) {
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    }
    if (typeof date === "string" && date) {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) {
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
      }
    }
    return null;
  }

  function buildComparisonItems(trend, resourceBundle) {
    if (!Array.isArray(trend) || !trend.length) {
      return [];
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    const previousYear = currentYear - 1;
    const currentTotals = { year: currentYear, falhas: 0, custo: 0 };
    const previousTotals = { year: previousYear, falhas: 0, custo: 0 };

    trend.forEach(function (entry) {
      const parts = (entry.mes || "").split("-");
      if (parts.length !== 2) {
        return;
      }
      const year = Number(parts[0]);
      if (year === currentYear) {
        currentTotals.falhas += Number(entry.falhas || 0);
        currentTotals.custo += Number(entry.custoFalhas || 0);
      } else if (year === previousYear) {
        previousTotals.falhas += Number(entry.falhas || 0);
        previousTotals.custo += Number(entry.custoFalhas || 0);
      }
    });

    const formatCurrency = function (value) {
      return "R$ " + NUMBER_FORMAT.format(value || 0);
    };

    return [
      {
        title: resourceBundle.getText("reliab.compare.failuresCurrent", currentYear),
        value: currentTotals.falhas || 0,
        displayValue: INTEGER_FORMAT.format(currentTotals.falhas || 0),
        description: resourceBundle.getText("reliab.compare.failuresCost", [formatCurrency(currentTotals.custo || 0)]),
        cost: currentTotals.custo || 0
      },
      {
        title: resourceBundle.getText("reliab.compare.failuresPrevious", previousYear),
        value: previousTotals.falhas || 0,
        displayValue: INTEGER_FORMAT.format(previousTotals.falhas || 0),
        description: resourceBundle.getText("reliab.compare.failuresCost", [formatCurrency(previousTotals.custo || 0)]),
        cost: previousTotals.custo || 0
      }
    ];
  }

  return Controller.extend("com.skysinc.frota.frota.controller.Confiabilidade", {
    onInit: function () {
      this._component = this.getOwnerComponent();
      this._resourceBundle = resolveBundle(this);

      const persistedFilters = Storage.load() || {};
      this._filterModel = FilterState.create(persistedFilters);
      this._filterModel.setDefaultBindingMode("TwoWay");
      this._filterModel.setProperty("/lists", Object.assign({
        categories: [],
        vehicles: []
      }, persistedFilters.lists || {}));

      this._reliabModel = new JSONModel(createInitialState());
      this._reliabModel.setSizeLimit(2000);

      this.getView().setModel(this._filterModel, "filters");
      this.getView().setModel(this._reliabModel, "reliab");

      this._allFailures = [];
      this._resizeHandlers = [];
      this._searchQuery = "";
      this._lastQueryString = "";

      this._loadDataDebounced = debounce(this._loadAll.bind(this), 300);
      this._renderChartsThrottled = throttle(this._renderCharts.bind(this), 200);
      this._charts = {};
      this._orientationHandler = null;

      const router = this._component.getRouter && this._component.getRouter();
      if (router && router.getRoute) {
        const route = router.getRoute("confiabilidade");
        if (route && route.attachPatternMatched) {
          route.attachPatternMatched(this._onRouteMatched, this);
        }
      }
    },

    onAfterRendering: function () {
      this._registerResizeHandler();
    },

    onExit: function () {
      this._deregisterResizeHandlers();
    },

    onNavBack: function () {
      const history = History.getInstance();
      const previousHash = history.getPreviousHash();
      if (previousHash !== undefined) {
        window.history.go(-1);
      } else {
        const router = this._component.getRouter();
        if (router) {
          router.navTo("RouteMain", {}, true);
        }
      }
    },

    onFilterChanged: function () {
      const categoriesControl = this.byId("filterCategories");
      const vehiclesControl = this.byId("filterVehicles");
      const dateRange = this.byId("filterDateRange");

      const categories = categoriesControl ? categoriesControl.getSelectedKeys() : [];
      const vehicles = vehiclesControl ? vehiclesControl.getSelectedKeys() : [];
      let dateFrom = dateRange ? dateRange.getDateValue() : null;
      let dateTo = dateRange ? dateRange.getSecondDateValue() : null;

      dateFrom = normaliseDate(dateFrom);
      dateTo = normaliseDate(dateTo);

      this._filterModel.setProperty("/selection/categories", categories);
      this._filterModel.setProperty("/selection/vehicles", vehicles);
      this._filterModel.setProperty("/selection/dateFrom", dateFrom);
      this._filterModel.setProperty("/selection/dateTo", dateTo);

      Storage.save(this._filterModel.getData());

      if (!this._vehicleId || vehicles.indexOf(this._vehicleId) === -1) {
        this._vehicleId = vehicles[0] || this._vehicleId;
      }

      this._updateVehicleMetadata();
      this._updateHashFromState();
      this._loadDataDebounced();
    },

    onSearchFailures: function (oEvent) {
      const value = (oEvent && oEvent.getParameter && oEvent.getParameter("query")) || (oEvent && oEvent.getSource && oEvent.getSource().getValue && oEvent.getSource().getValue()) || "";
      this._searchQuery = (value || "").trim();
      this._reliabModel.setProperty("/failureFilters/search", this._searchQuery);
      this._updateHashFromState();
      this._applyFailureFilters();
    },

    onFailureFilterChange: function () {
      const typeSelect = this.byId("selFailureType");
      const severitySelect = this.byId("selFailureSeverity");
      const subsystemSelect = this.byId("selFailureSubsystem");

      this._reliabModel.setProperty("/failureFilters/type", typeSelect ? typeSelect.getSelectedKey() : "");
      this._reliabModel.setProperty("/failureFilters/severity", severitySelect ? severitySelect.getSelectedKey() : "");
      this._reliabModel.setProperty("/failureFilters/subsystem", subsystemSelect ? subsystemSelect.getSelectedKey() : "");

      this._applyFailureFilters();
    },

    onResetFailureFilters: function () {
      this._reliabModel.setProperty("/failureFilters/type", "");
      this._reliabModel.setProperty("/failureFilters/severity", "");
      this._reliabModel.setProperty("/failureFilters/subsystem", "");
      this._searchQuery = "";
      this._reliabModel.setProperty("/failureFilters/search", "");

      const search = this.byId("filterSearch");
      if (search) {
        search.setValue("");
      }
      ["selFailureType", "selFailureSeverity", "selFailureSubsystem"].forEach((id) => {
        const control = this.byId(id);
        if (control && control.clearSelection) {
          control.clearSelection();
        } else if (control && typeof control.setSelectedKey === "function") {
          control.setSelectedKey("");
        }
      });

      this._applyFailureFilters();
      this._updateHashFromState();
    },

    onExportFailures: function () {
      if (!this._allFailures.length) {
        MessageToast.show(safeText(this, "reliab.failures.export.empty"));
        return;
      }
      const filename = "confiabilidade_" + (this._vehicleId || "veiculo") + ".csv";
      const rows = this._reliabModel.getProperty("/failures").map(function (item) {
        return {
          OS: item.os,
          Descricao: item.descricao,
          Inicio: item.inicioFmt,
          Fim: item.fimFmt,
          DowntimeHoras: item.downtimeH,
          DowntimeFmt: item.downtimeFmt,
          KmEvento: item.kmEventoFmt,
          HorasEvento: item.horasEventoFmt,
          Categoria: item.categoria,
          Subsistema: item.subsistema,
          Severidade: item.severidade
        };
      });
      CsvUtil.exportToCsv(filename, rows);
    },

    onOpenFailureDetail: function () {
      MessageToast.show(safeText(this, "reliab.failures.detailSoon"));
    },

    _onRouteMatched: function (oEvent) {
      const args = oEvent && oEvent.getParameter && oEvent.getParameter("arguments")
        ? oEvent.getParameter("arguments")
        : {};
      this._vehicleId = args.vehicleId || this._vehicleId;
      const queryFromRoute = args.query || args["?query"];
      this._applyQueryToState(queryFromRoute);
      this._ensureVehicleSelection();
      this._applyStateToControls();
      this._updateVehicleMetadata();
      this._loadDataDebounced();
    },

    _applyQueryToState: function (query) {
      if (!this._filterModel) {
        return;
      }
      let queryString = "";
      if (typeof query === "string") {
        queryString = query;
      } else if (query && typeof query === "object") {
        try {
          const params = new URLSearchParams();
          Object.keys(query).forEach(function (key) {
            params.set(key, query[key]);
          });
          queryString = params.toString();
        } catch (err) {
          queryString = "";
        }
      } else {
        const hash = window.location.hash || "";
        const index = hash.indexOf("?");
        if (index !== -1) {
          queryString = hash.slice(index + 1);
        }
      }

      if (!queryString) {
        return;
      }

      try {
        const params = new URLSearchParams(queryString);
        const parseKeys = function (value) {
          if (!value) {
            return [];
          }
          return value.split(",").map(function (item) {
            return item.trim();
          }).filter(Boolean);
        };
        const parseDate = function (value) {
          if (!value) {
            return null;
          }
          const candidate = new Date(value);
          return Number.isNaN(candidate.getTime()) ? null : candidate;
        };
        const categories = parseKeys(params.get("cat"));
        const vehicles = parseKeys(params.get("veh"));
        const dateFrom = parseDate(params.get("from"));
        const dateTo = parseDate(params.get("to"));
        const search = params.get("q") || "";

        if (categories.length) {
          this._filterModel.setProperty("/selection/categories", categories);
        }
        if (vehicles.length) {
          this._filterModel.setProperty("/selection/vehicles", vehicles);
        }
        if (dateFrom) {
          this._filterModel.setProperty("/selection/dateFrom", normaliseDate(dateFrom));
        }
        if (dateTo) {
          this._filterModel.setProperty("/selection/dateTo", normaliseDate(dateTo));
        }
        this._searchQuery = search;
        this._reliabModel.setProperty("/failureFilters/search", search);
        Storage.save(this._filterModel.getData());
      } catch (err) {
        Log.warning("[Confiabilidade] Unable to parse query string", err);
      }
    },

    _applyStateToControls: function () {
      const selection = this._filterModel.getProperty("/selection") || {};

      const categoriesControl = this.byId("filterCategories");
      if (categoriesControl && categoriesControl.setSelectedKeys) {
        categoriesControl.setSelectedKeys(selection.categories || []);
      }

      const vehiclesControl = this.byId("filterVehicles");
      if (vehiclesControl && vehiclesControl.setSelectedKeys) {
        vehiclesControl.setSelectedKeys(selection.vehicles || []);
      }

      const dateRange = this.byId("filterDateRange");
      if (dateRange) {
        dateRange.setDateValue(selection.dateFrom || null);
        dateRange.setSecondDateValue(selection.dateTo || null);
      }

      const search = this.byId("filterSearch");
      if (search) {
        search.setValue(this._searchQuery || "");
      }
    },

    _ensureVehicleSelection: function () {
      const selection = this._filterModel.getProperty("/selection/vehicles") || [];
      if (!this._vehicleId) {
        this._vehicleId = selection[0] || "";
      }
      if (this._vehicleId && selection.indexOf(this._vehicleId) === -1) {
        const updated = selection.slice();
        updated.unshift(this._vehicleId);
        this._filterModel.setProperty("/selection/vehicles", updated);
      }
      Storage.save(this._filterModel.getData());
    },

    _updateVehicleMetadata: function () {
      const vehicles = (this._filterModel && this._filterModel.getProperty("/lists/vehicles")) || [];
      const match = vehicles.find(function (item) {
        return item.key === String(this._vehicleId || "");
      }, this);

      let title = this._vehicleId || "-";
      let subtitle = "";
      if (match) {
        title = match.key;
        subtitle = match.text && match.text.indexOf(" - ") !== -1 ? match.text.split(" - ").slice(1).join(" - ") : match.text;
      }

      this._reliabModel.setProperty("/vehicle/title", title || "-");
      this._reliabModel.setProperty("/vehicle/subtitle", subtitle || "");
      this._reliabModel.setProperty("/breadcrumbs", [{
        text: safeText(this, "reliab.title", [], "Confiabilidade")
      }]);
    },

    _buildQueryString: function () {
      const selection = this._filterModel.getProperty("/selection") || {};
      const params = new URLSearchParams();

      const categories = Array.isArray(selection.categories) ? selection.categories.filter(Boolean) : [];
      const vehicles = Array.isArray(selection.vehicles) ? selection.vehicles.filter(Boolean) : [];
      if (categories.length) {
        params.set("cat", categories.join(","));
      }
      if (vehicles.length) {
        params.set("veh", vehicles.join(","));
      }
      if (selection.dateFrom instanceof Date && !Number.isNaN(selection.dateFrom.getTime())) {
        params.set("from", selection.dateFrom.toISOString().slice(0, 10));
      }
      if (selection.dateTo instanceof Date && !Number.isNaN(selection.dateTo.getTime())) {
        params.set("to", selection.dateTo.toISOString().slice(0, 10));
      }
      if (this._searchQuery) {
        params.set("q", this._searchQuery);
      }
      return params.toString();
    },

    _updateHashFromState: function () {
      const queryString = this._buildQueryString();
      if (this._lastQueryString === queryString) {
        return;
      }
      this._lastQueryString = queryString;
      const router = this._component.getRouter();
      if (router && router.navTo) {
        const vehicleId = this._vehicleId || (this._filterModel.getProperty("/selection/vehicles") || [])[0] || "0";
        router.navTo("confiabilidade", {
          vehicleId: vehicleId,
          query: queryString
        }, true);
      }
    },

    _loadAll: function () {
      if (!this._vehicleId) {
        Log.warning("[Confiabilidade] Vehicle id missing, aborting load");
        return;
      }
      const model = this._component.getModel && this._component.getModel("svc");
      const selection = this._filterModel.getData();
      const options = {
        model: model,
        vehicleId: this._vehicleId,
        selection: selection,
        component: this._component
      };

      this._reliabModel.setProperty("/busy", true);
      this._reliabModel.setProperty("/loadingFailures", true);

      Promise.all([
        ReliabilityService.getKpis(options),
        ReliabilityService.getTrend(options),
        ReliabilityService.getFailures(options)
      ]).then(function (payloads) {
        this._reliabModel.setProperty("/busy", false);
        this._reliabModel.setProperty("/loadingFailures", false);

        this._applyKpis(payloads[0] || {});
        this._applyTrend(payloads[1] || []);
        this._applyFailures(payloads[2] || []);
        this._renderCharts();
      }.bind(this)).catch(function (err) {
        this._reliabModel.setProperty("/busy", false);
        this._reliabModel.setProperty("/loadingFailures", false);
        Log.error("[Confiabilidade] Failed to load data", err);
        MessageToast.show(safeText(this, "reliab.load.error"));
      }.bind(this));
    },

    _applyKpis: function (kpis) {
      const falhas = Number(kpis.totalFalhas || 0);
      const downtime = Number(kpis.downtimeHoras || kpis.downtimeTotal || 0);
      const summary = {
        mtbfFmt: formatHours(kpis.mtbfH),
        mttrFmt: formatHours(kpis.mttrH),
        disponibilidadeFmt: formatPercent(kpis.disponibilidadePct),
        kmPorQuebraFmt: formatKm(kpis.kmPorQuebra),
        hrPorQuebraFmt: formatHours(kpis.horasPorQuebra),
        proximaQuebraKmFmt: formatKm(kpis.proximaQuebraKm),
        proximaQuebraHrFmt: formatHours(kpis.proximaQuebraH),
        falhasResumo: safeText(this, "reliab.kpi.failures", [INTEGER_FORMAT.format(falhas)], "Falhas no per�odo: " + INTEGER_FORMAT.format(falhas)),
        downtimeResumo: safeText(this, "reliab.kpi.downtime", [formatHours(downtime)], "Indisponibilidade total: " + formatHours(downtime))
      };
      this._reliabModel.setProperty("/kpis", summary);
    },

    _applyTrend: function (trendData) {
      const trend = (Array.isArray(trendData) ? trendData : []).map(function (entry) {
        const month = entry.mes || "";
        const parts = month.split("-");
        let label = month;
        if (parts.length === 2) {
          label = parts[1] + "/" + parts[0];
        }
        return {
          mes: month,
          label: label,
          falhas: Number(entry.falhas || 0),
          disponibilidadePct: Number(entry.disponibilidadePct || 0),
          custoFalhas: Number(entry.custoFalhas || 0)
        };
      });
      this._reliabModel.setProperty("/trend", trend);
      this._reliabModel.setProperty("/availability", trend);
      this._reliabModel.setProperty("/cost", trend);
      this._reliabModel.setProperty("/comparisons", buildComparisonItems(trend, this._resourceBundle || resolveBundle(this)));
    },

    _applyFailures: function (failuresData) {
      const formatValue = function (value, formatter) {
        if (!Number.isFinite(value) || value === 0) {
          return "-";
        }
        return formatter(value);
      };

      const failures = (Array.isArray(failuresData) ? failuresData : []).map(function (row) {
        const inicio = row.inicio ? new Date(row.inicio) : null;
        const fim = row.fim ? new Date(row.fim) : null;
        return Object.assign({}, row, {
          inicioFmt: inicio && !Number.isNaN(inicio.getTime()) ? DATE_TIME_FORMAT.format(inicio) : "-",
          fimFmt: fim && !Number.isNaN(fim.getTime()) ? DATE_TIME_FORMAT.format(fim) : "-",
          kmEventoFmt: formatValue(row.kmEvento, function (value) { return NUMBER_FORMAT.format(value) + " km"; }),
          horasEventoFmt: formatValue(row.horasEvento, function (value) { return NUMBER_FORMAT.format(value) + " h"; }),
          downtimeFmt: formatValue(row.downtimeH, function (value) { return NUMBER_FORMAT.format(value) + " h"; })
        });
      });

      this._allFailures = failures;
      this._updateFailureFilterOptions(failures);
      this._applyFailureFilters();
    },

    _applyFailureFilters: function () {
      const filters = this._reliabModel.getProperty("/failureFilters") || {};
      const type = String(filters.type || "").toLowerCase();
      const severity = String(filters.severity || "").toLowerCase();
      const subsystem = String(filters.subsystem || "").toLowerCase();
      const search = String(this._searchQuery || filters.search || "").toLowerCase();

      const filtered = this._allFailures.filter(function (item) {
        if (type && String(item.categoria || "").toLowerCase() !== type) {
          return false;
        }
        if (severity && String(item.severidade || "").toLowerCase() !== severity) {
          return false;
        }
        if (subsystem && String(item.subsistema || "").toLowerCase() !== subsystem) {
          return false;
        }
        if (search) {
          const haystack = [
            item.os,
            item.descricao,
            item.categoria,
            item.subsistema,
            item.severidade
          ].join(" ").toLowerCase();
          if (haystack.indexOf(search) === -1) {
            return false;
          }
        }
        return true;
      });

      const countText = safeText(this, "reliab.failures.count", [filtered.length], filtered.length + " registro(s)");
      this._reliabModel.setProperty("/failures", filtered);
      this._reliabModel.setProperty("/failuresCountText", countText);
    },

    _updateFailureFilterOptions: function (failures) {
      const toOption = function (key) {
        return {
          key: key,
          text: key || "-"
        };
      };
      const unique = function (values) {
        return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
          return a.localeCompare(b, "pt-BR");
        });
      };

      const types = unique(failures.map(function (item) { return String(item.categoria || ""); }));
      const severities = unique(failures.map(function (item) { return String(item.severidade || ""); }));
      const subsystems = unique(failures.map(function (item) { return String(item.subsistema || ""); }));

      const allOption = {
        key: "",
        text: safeText(this, "common.all", [], "Todos")
      };

      this._reliabModel.setProperty("/failureFilters/typeOptions", [allOption].concat(types.map(toOption)));
      this._reliabModel.setProperty("/failureFilters/severityOptions", [allOption].concat(severities.map(toOption)));
      this._reliabModel.setProperty("/failureFilters/subsystemOptions", [allOption].concat(subsystems.map(toOption)));
    },

    _renderCharts: function () {
      const view = this.getView();
      if (!view) {
        return;
      }
      if (typeof view.isActive === "function" && !view.isActive()) {
        return;
      }
      this._charts = this._charts || {};

      const trendData = this._reliabModel.getProperty("/trend") || [];
      const availabilityData = this._reliabModel.getProperty("/availability") || [];
      const costData = this._reliabModel.getProperty("/cost") || [];

      this._destroyCharts();

      const trendContainer = this.byId("trendChartContainer");
      if (trendContainer) {
        trendContainer.removeAllItems();
        const chart = ChartBuilder.buildColumn({
          data: trendData,
          dimensionName: safeText(this, "reliab.chart.month", [], "Mes"),
          dimensionPath: "label",
          measures: [{
            name: safeText(this, "reliab.trend.failures", [], "Falhas"),
            path: "falhas",
            feed: "valueAxis"
          }],
          properties: {
            plotArea: {
              dataLabel: {
                visible: true
              }
            },
            valueAxis: {
              title: {
                visible: false
              }
            },
            categoryAxis: {
              title: {
                visible: false
              }
            }
          }
        });
        trendContainer.addItem(chart);
        this._charts.trend = chart;
      }

      const availabilityContainer = this.byId("availabilityChartContainer");
      if (availabilityContainer) {
        availabilityContainer.removeAllItems();
        const chart = ChartBuilder.buildLine({
          data: availabilityData,
          dimensionName: safeText(this, "reliab.chart.month", [], "Mes"),
          dimensionPath: "label",
          measures: [{
            name: safeText(this, "reliab.trend.availability", [], "Disponibilidade"),
            path: "disponibilidadePct",
            feed: "valueAxis"
          }],
          properties: {
            plotArea: {
              dataLabel: {
                visible: false
              }
            },
            valueAxis: {
              title: {
                visible: false
              }
            },
            categoryAxis: {
              title: {
                visible: false
              }
            }
          }
        });
        availabilityContainer.addItem(chart);
        this._charts.availability = chart;
      }

      const costContainer = this.byId("costChartContainer");
      if (costContainer) {
        costContainer.removeAllItems();
        const chart = ChartBuilder.buildColumn({
          data: costData,
          dimensionName: safeText(this, "reliab.chart.month", [], "Mes"),
          dimensionPath: "label",
          measures: [{
            name: safeText(this, "reliab.trend.cost", [], "Custo por falha"),
            path: "custoFalhas",
            feed: "valueAxis"
          }],
          properties: {
            plotArea: {
              dataLabel: {
                visible: false
              }
            },
            valueAxis: {
              title: {
                visible: false
              }
            },
            categoryAxis: {
              title: {
                visible: false
              }
            }
          }
        });
        costContainer.addItem(chart);
        this._charts.cost = chart;
      }

      const comparisonContainer = this.byId("comparisonChartContainer");
      if (comparisonContainer) {
        comparisonContainer.removeAllItems();
      const comparisons = this._reliabModel.getProperty("/comparisons") || [];
      if (comparisons.length) {
        const chart = ChartBuilder.buildComparison({
          items: comparisons.map(function (item) {
            return {
              title: item.title,
              value: item.value || 0,
              color: "Neutral"
            };
          })
        });
        comparisonContainer.addItem(chart);
          this._charts.comparison = chart;
        }
      }
    },

    _registerResizeHandler: function () {
      const objectPage = this.byId("objectPage");
      if (!objectPage || typeof objectPage.getDomRef !== "function") {
        return;
      }
      const domRef = objectPage.getDomRef();
      if (!domRef) {
        return;
      }
      if (!this._charts) {
        this._charts = {};
      }
      if (this._resizeHandlers.length === 0) {
        const handlerId = ResizeHandler.register(domRef, this._renderChartsThrottled.bind(this));
        this._resizeHandlers.push(handlerId);
      }
      if (Device.support.touch) {
        if (!this._orientationHandler) {
          this._orientationHandler = this._renderChartsThrottled.bind(this);
        }
        window.addEventListener("orientationchange", this._orientationHandler);
      }
    },

    _deregisterResizeHandlers: function () {
      this._resizeHandlers.forEach(function (id) {
        try {
          ResizeHandler.deregister(id);
        } catch (err) {
          Log.warning("[Confiabilidade] Failed to deregister resize handler", err);
        }
      });
      this._resizeHandlers = [];
      if (Device.support.touch) {
        if (this._orientationHandler) {
          window.removeEventListener("orientationchange", this._orientationHandler);
          this._orientationHandler = null;
        }
      }
      this._destroyCharts();
    },

    _destroyCharts: function () {
      if (!this._charts) {
        this._charts = {};
        return;
      }
      Object.keys(this._charts).forEach(function (key) {
        const chart = this._charts[key];
        if (chart && chart.destroy) {
          chart.destroy();
        }
        this._charts[key] = null;
      }, this);
      this._charts = {};
    }
  });
});


















