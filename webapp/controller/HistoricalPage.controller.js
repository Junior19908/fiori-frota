sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/base/Log",
  "sap/ui/core/Core",
  "com/skysinc/frota/frota/util/formatter",
  "com/skysinc/frota/frota/services/ODataMaterials",
  "com/skysinc/frota/frota/services/AvailabilityService",
  "com/skysinc/frota/frota/util/ReliabilityService",
  "com/skysinc/frota/frota/util/ChartBuilder"
], function (Controller, JSONModel, MessageToast, Log, Core, formatter, ODataMaterials, AvailabilityService, ReliabilityService, ChartBuilder) {
  "use strict";

  // ===== helpers numericos / formatacao =====
  const toNum  = (v) => Number(v || 0);
  const fmtBrl = (v) => {
    try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNum(v)); }
    catch { return v; }
  };
  const fmtNum = (v) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctFmt = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtHours = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return "-";
    }
    if (num <= 0) {
      return "0,00 h";
    }
    return fmtNum(num) + " h";
  };
  const fmtKm = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return "-";
    }
    if (num <= 0) {
      return "0,00 km";
    }
    return fmtNum(num) + " km";
  };
  const fmtPct = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return "-";
    }
    const clamped = Math.max(0, Math.min(1, num));
    return pctFmt.format(clamped);
  };

  function resolveBundle(controller) {
    if (!controller || !controller.getView) {
      return null;
    }
    const view = controller.getView();
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

  function safeText(bundle, key, args, fallback) {
    if (bundle && typeof bundle.getText === "function") {
      try {
        return bundle.getText(key, args);
      } catch (err) {
        // ignore
      }
    }
    return fallback != null ? fallback : key;
  }
  const MONTH_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const sum = (arr, pick) => (arr||[]).reduce((s,x)=> s + toNum(pick(x)), 0);

  // ===== datas (LOCAL para UI / filtros) =====
  const startOfDay = (d)=>{ const x=new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay   = (d)=>{ const x=new Date(d); x.setHours(23,59,59,999); return x; };

  // Parser LOCAL robusto: aceita 'YYYY-MM-DD' e 'YYYY-MM-DDTHH:mm(:ss)'
  function parseLocalDateTime(s) {
    if (!s) return null;
    const str = String(s);

    // YYYY-MM-DD
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);

    // YYYY-MM-DDTHH:mm(:ss)
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0), 0);

    // Date ja valido
    if (s instanceof Date) return new Date(s.getTime());
    return null;
  }

  // Converte Date -> 'YYYY-MM-DD' preservando o "dia" em UTC (para datas OData)
  function toYMD_UTC(d) {
    if (!(d instanceof Date)) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Converte Date -> 'YYYY-MM-DD' em horario LOCAL (para strings locais)
  function toYMD(d) {
    if (!(d instanceof Date)) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function combineDateTime(dateStr, timeStr) {
    if (!dateStr) return null;
    const cleanDate = String(dateStr).trim();
    if (!cleanDate) return null;
    const rawTime = String(timeStr || "").trim();
    const hhmm = rawTime && /^\d{1,2}:\d{2}/.test(rawTime) ? rawTime : "00:00";
    const candidate = `${cleanDate}T${hhmm}`;
    const parsed = parseLocalDateTime(candidate);
    if (parsed) return parsed;
    return parseLocalDateTime(cleanDate);
  }

  function normalizeAscii(value) {
    try {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
    } catch (e) {
      return String(value || "").toUpperCase();
    }
  }

  function formatHoursLabel(hours) {
    try {
      const minutes = Math.max(0, Math.round((Number(hours) || 0) * 60));
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return h + "h" + String(m).padStart(2, "0");
    } catch (e) {
      return "0h00";
    }
  }

  function calcDurationHours(startDt, endDt) {
    const start = (startDt instanceof Date && !Number.isNaN(startDt.getTime())) ? startDt : null;
    const finish = (endDt instanceof Date && !Number.isNaN(endDt.getTime())) ? endDt : null;
    if (!start) {
      return 0;
    }
    const now = new Date();
    const effectiveFinish = finish || now;
    const diffMs = Math.max(0, effectiveFinish.getTime() - start.getTime());
    return diffMs / 36e5;
  }

  function createReliabilityState() {
    return {
      filters: {
        vehicleId: "",
        range: { from: null, to: null }
      },
      loading: false,
      metrics: {
        mtbfFmt: "-",
        mttrFmt: "-",
        disponibilidadeFmt: "-",
        kmPorQuebraFmt: "-",
        falhasResumo: "",
        downtimeResumo: ""
      },
      sparkline: []
    };
  }

  function calcProgress(hours, isClosed) {
    const total = Number(hours) || 0;
    const pct = Math.max(0, Math.min(100, Math.round((total / 24) * 100)));
    let state = "Information";
    if (isClosed && total > 0) {
      state = "Success";
    } else if (!isClosed && pct >= 80) {
      state = "Warning";
    }
    const text = pct + "%";
    return { pct, text, state };
  }

  // ======= CONFIG MAPA (MapLibre + PMTiles locais) =======
  const MAP_DEFAULT_CENTER = { lng: -36.5, lat: -9.3 }; // Centro aproximado AL/PE
  const MAP_DEFAULT_ZOOM = 7;
  const _scriptPromises = Object.create(null);
  let _mapLibreConfigured = false;

  function _loadScriptOnce(url, key) {
    var cacheKey = key || url;
    if (_scriptPromises[cacheKey]) {
      return _scriptPromises[cacheKey];
    }

    _scriptPromises[cacheKey] = new Promise(function (resolve, reject) {
      try {
        var selector = "script[data-map-loader='" + cacheKey + "']";
        var existing = document.querySelector(selector);
        if (existing) {
          if (existing.getAttribute("data-loaded") === "true") {
            resolve();
            return;
          }
          existing.addEventListener("load", function () { resolve(); }, { once: true });
          existing.addEventListener("error", function () { reject(new Error("Falha ao recarregar script: " + url)); }, { once: true });
          return;
        }

        var script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.crossOrigin = "anonymous";
        script.setAttribute("data-map-loader", cacheKey);
        script.addEventListener("load", function () {
          script.setAttribute("data-loaded", "true");
          resolve();
        }, { once: true });
        script.addEventListener("error", function (evt) {
          reject(new Error("Falha ao carregar script: " + url + " (" + (evt && evt.message || "erro desconhecido") + ")"));
        }, { once: true });
        document.head.appendChild(script);
      } catch (err) {
        reject(err);
      }
    });

    return _scriptPromises[cacheKey];
  }
  const MAP_MODEL_PATH = "com/skysinc/frota/frota/model/mock/os_map.json";
  const MAP_ROUTE_SOURCE_ID = "historical-routes";
  const MAP_ROUTE_LAYER_ID = "historical-routes-line";
  const MAP_STATUS_META = {
    delay_gt_1h: { label: "> 1h delay", color: "#d13438", state: "Error" },
    delay_lt_1h: { label: "< 1h delay", color: "#f1c40f", state: "Warning" },
    ontime:      { label: "on time",    color: "#2ecc71", state: "Success" }
  };
  const MAP_TRANSPORT_LABEL = { truck: "Truck", train: "Train" };

  function formatIsoToLocale(isoStr) {
    if (!isoStr) return "";
    try {
      const dt = new Date(isoStr);
      if (Number.isNaN(dt.getTime())) return String(isoStr);
      return dt.toLocaleString("pt-BR", { hour12: false });
    } catch (e) {
      return String(isoStr);
    }
  }

  function typeLabel(code) {
    const normalized = normalizeAscii(code);
    if (normalized === "ZF01") return "Projeto / Melhoria / Reforma";
    if (normalized === "ZF02") return "Corretiva";
    if (normalized === "ZF03") return "Preventiva Basica/Mecanica";
    return String(code || "");
  }

  // ===== helpers de datas extras =====
  function addDays(d, n) {
    if (!(d instanceof Date)) return null;
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }
  function addDaysYMD(ymd, n) {
    if (!ymd) return ymd;
    const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return ymd;
    const d = new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
    return toYMD(addDays(d, n));
  }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function toABAPDateOnly(d){
    const x = new Date(d);
    return x.getFullYear() + pad2(x.getMonth()+1) + pad2(x.getDate()); // YYYYMMDD
  }

  // ===== outras helpers =====
  function padEqunr(e) {
    const digits = String(e || "").replace(/\D/g, "");
    return digits.padStart(18, "0");
  }

  function pickDescMaterial(r){
    return r?.nome
        || r?.material
        || r?.MAKTX
        || r?.maktx
        || r?.descricao
        || r?.textoBreve
        || r?.TXT_BREVE
        || "Item";
  }

  return Controller.extend("com.skysinc.frota.frota.controller.HistoricalPage", {
    formatter: formatter,

    /* ======================== LIFECYCLE ======================== */
    onInit: function () {
      this._i18n = resolveBundle(this);
      this.getOwnerComponent().getRouter()
        .getRoute("RouteHistorico")
        .attachPatternMatched(this._onRouteMatched, this);

      // Filtros default: de 1 ano atras ate hoje (apenas no Historical)
      const now = new Date();
      const d2 = now;
      const d1 = new Date(now); d1.setFullYear(now.getFullYear() - 1);
      this.getView().setModel(new JSONModel({ tipo:"__ALL__", q:"", d1, d2 }), "hfilter");

      // Detail/KPIs + status manutencao de hoje
      this.getView().setModel(new JSONModel({
        veiculo:"", descricao:"", categoria:"",
        imageUrl:"",
        localInstalacao:"",
        localInstalacaoSec:"",
        historico: [],
        historicoComb: [], historicoMateriais: [], historicoServicos: [], historicoOs: [],
        countComb:0, countMateriais:0, countServicos:0, countOs:0,
        totalCombustivel:0, totalMateriais:0, totalServicos:0, totalGeral:0,
        precoMedio:0,
        totalCombustivelFmt:"R$ 0,00", totalMateriaisFmt:"R$ 0,00",
        totalServicosFmt:"R$ 0,00", totalGeralFmt:"R$ 0,00",
        precoMedioFmt:"0,00",
        manutencaoHoje:false,
        manutencaoTexto:"Operacional",
        manutencaoState:"Success",
        _src:{ base:[], os:[] }
      }), "detail");

      // Chart principal + lateral
      this._historyModel = new JSONModel({ chartType:"column", points:[], subtitle:"" });
      this.getView().setModel(this._historyModel, "history");
      this._sideChartModel = new JSONModel({ header:"", rows:[] });
      this.getView().setModel(this._sideChartModel, "chart");

      this._reliabilityModel = new JSONModel(createReliabilityState());
      this.getView().setModel(this._reliabilityModel, "reliability");

      this._viewModel = new JSONModel({
        filter: {
          transport: { truck: true, train: true },
          status: { delay_gt_1h: true, delay_lt_1h: true, ontime: true },
          location: { Frankfurt: true, Hamburg: true, Munich: true }
        }
      });
      this.getView().setModel(this._viewModel, "viewModel");

      // Estado do mapa
      this._mapReadyPromise = null;
      this._mapReady = false;
      this._mapDataPromise = null;
      this._mapAssetsPromise = null;
      this._pmtilesProtocol = null;
      this._map = null;
      this._layers = null;
      this._routeLines = [];
      this._markers = new Map();
      this._usgaMarker = null;
      this._occurrenceIndex = Object.create(null);

      this._applyVizProps();
    },

    onAfterRendering: function () {
      this._applyVizProps();
      this._connectPopover();
      this._ensureMapAssets()
        .catch(() => { /* erro já logado em _ensureMapAssets */ })
        .finally(() => {
          this._ensureMapIfActive();
        });
    },

    _applyVizProps: function () {
      const common = {
        legend: { visible:true },
        title: { visible:false },
        plotArea: { dataLabel:{ visible:true } },
        valueAxis: { title:{ visible:false } },
        categoryAxis: { title:{ visible:false } },
        interaction: { selectability:{ mode:"SINGLE" } }
      };
      const vf = this.byId("vf"); if (vf) vf.setVizProperties(common);
      const bar = this.byId("barCompare"); if (bar) bar.setVizProperties(common);
    },

    _connectPopover: function () {
      const oVf = this.byId("vf");
      const oPop = this.byId("vfPopover");
      if (oVf && oPop && typeof oPop.connect === "function") {
        try { oPop.connect(oVf.getVizUid()); } catch(e) { /* noop */ }
      }
    },

    _ensureMapIfActive: function () {
      const tabBar = this.byId("historicalTabs");
      if (tabBar && typeof tabBar.getSelectedKey === "function" && tabBar.getSelectedKey() === "MAP") {
        this._ensureMapReady();
      }
    },

    /* ======================== MAPA ======================== */
    onHistoricoTabSelect: function (oEvent) {
      const key = oEvent.getParameter("key");
      if (key === "MAP") {
        this._ensureMapReady();
      }
    },

    onLegendFilterChange: function () {
      if (this._mapReadyPromise) {
        this._mapReadyPromise
          .then(() => this._applyFilters())
          .catch(() => { /* erro já registrado */ });
      }
    },

    // --- carregamento dos dados do mapa (JSON) ---
    _ensureMapData: function () {
      if (this._mapDataPromise) return this._mapDataPromise;

      const component = this.getOwnerComponent();
      const existing = component.getModel("osMap");
      if (existing) {
        this._osMapData = existing.getData() || {};
        this._indexOccurrences();
        this._mapDataPromise = Promise.resolve(this._osMapData);
        return this._mapDataPromise;
      }

      const jsonModel = new JSONModel();
      const url = sap.ui.require.toUrl(MAP_MODEL_PATH);
      this._mapDataPromise = new Promise((resolve, reject) => {
        const onCompleted = () => {
          jsonModel.detachRequestCompleted(onCompleted);
          jsonModel.detachRequestFailed(onFailed);
          component.setModel(jsonModel, "osMap");
          this._osMapData = jsonModel.getData() || {};
          this._indexOccurrences();
          resolve(this._osMapData);
        };
        const onFailed = (oEvent) => {
          jsonModel.detachRequestCompleted(onCompleted);
          jsonModel.detachRequestFailed(onFailed);
          const params = oEvent && typeof oEvent.getParameters === "function" ? oEvent.getParameters() : {};
          const msg = params?.message || params?.statusText || "Falha ao carregar os dados do mapa";
          reject(new Error(msg));
        };
        jsonModel.attachRequestCompleted(onCompleted);
        jsonModel.attachRequestFailed(onFailed);
        jsonModel.loadData(url);
      }).catch((err) => {
        console.error("[HistoricalPage] erro ao carregar os_map.json", err);
        this._mapDataPromise = null;
        throw err;
      });

      return this._mapDataPromise;
    },

    _ensureMapAssets: function () {
      if (this._mapAssetsPromise) {
        return this._mapAssetsPromise;
      }

      this._mapAssetsPromise = new Promise((resolve, reject) => {
        const basePath = "com/skysinc/frota/frota/thirdparty/";
        const cssUrl = sap.ui.require.toUrl(basePath + "maplibre-gl.css");
        const mapLibreUrl = sap.ui.require.toUrl(basePath + "maplibre-gl.js");
        const pmtilesUrl = sap.ui.require.toUrl(basePath + "pmtiles.js");

        // Garante que o CSS do MapLibre seja carregado
        try {
          jQuery.sap.includeStyleSheet(cssUrl);
        } catch (cssErr) {
          // eslint-disable-next-line no-console
          console.warn("[HistoricalPage] falha ao incluir CSS do MapLibre", cssErr);
        }

        const ensurePmtiles = () => _loadScriptOnce(pmtilesUrl, "pmtiles-script").then(function () {
          if (!window.pmtiles) {
            throw new Error("PMTiles nao esta disponivel.");
          }
        });

        const ensureMapLibre = () => new Promise(function (res, rej) {
          if (window.maplibregl) {
            res();
            return;
          }
          try {
            if (!_mapLibreConfigured) {
              const modulePath = mapLibreUrl.replace(/\.js($|\?)/, "");
              sap.ui.loader.config({
                paths: {
                  "maplibre-gl-local": modulePath
                },
                shim: {
                  "maplibre-gl-local": {
                    exports: "maplibregl"
                  }
                }
              });
              _mapLibreConfigured = true;
            }
            sap.ui.require(["maplibre-gl-local"], function (maplibregl) {
              if (maplibregl && !window.maplibregl) {
                window.maplibregl = maplibregl;
              }
              if (!window.maplibregl) {
                rej(new Error("MapLibre nao esta disponivel."));
                return;
              }
              res();
            }, function (err) {
              rej(err);
            });
          } catch (err) {
            rej(err);
          }
        });

        ensureMapLibre()
          .then(() => ensurePmtiles())
          .then(resolve)
          .catch(reject);
      }).catch((err) => {
        this._mapAssetsPromise = null;
        console.error("[HistoricalPage] falha ao carregar recursos do mapa", err);
        throw err;
      });

      return this._mapAssetsPromise;
    },
    _ensureMapReady: function () {
      this._mapReady = true;
      return Promise.resolve();
    },

    _initMap: function () {
      if (this._map) {
        try {
          if (typeof this._map.resize === "function") {
            this._map.resize();
          }
        } catch (e) { /* noop */ }
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const view = this.getView();
        const containerControl = view && typeof view.byId === "function" ? view.byId("map") : null;
        const container = containerControl && typeof containerControl.getDomRef === "function"
          ? containerControl.getDomRef()
          : null;

        if (!container) {
          setTimeout(() => {
            this._initMap().then(resolve).catch(reject);
          }, 120);
          return;
        }

        try {
          if (!this._pmtilesProtocol && window.pmtiles && typeof window.pmtiles.Protocol === "function") {
            this._pmtilesProtocol = new window.pmtiles.Protocol();
            if (window.maplibregl && typeof window.maplibregl.addProtocol === "function") {
              window.maplibregl.addProtocol("pmtiles", this._pmtilesProtocol.tile);
            }
          }

          // DEV (fallback) — usar SOMENTE para teste local leve; não usar em produção:
          // const style = {
          //   version: 8,
          //   sources: {
          //     osm: {
          //       type: "raster",
          //       tiles: ["https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png"],
          //       tileSize: 256,
          //       attribution: "© OpenStreetMap contributors"
          //     }
          //   },
          //   layers: [{ id: "osm", type: "raster", source: "osm" }]
          // };

          const style = {
            version: 8,
            sources: {
              basemap: {
                type: "raster",
                tiles: ["pmtiles://maps/al_pe_raster.pmtiles/{z}/{x}/{y}"],
                tileSize: 256
              }
            },
            layers: [
              { id: "basemap", type: "raster", source: "basemap" }
            ]
          };

          this._map = new window.maplibregl.Map({
            container: container,
            style: style,
            center: [MAP_DEFAULT_CENTER.lng, MAP_DEFAULT_CENTER.lat],
            zoom: MAP_DEFAULT_ZOOM
          });

          this._map.addControl(new window.maplibregl.NavigationControl(), "top-right");

          this._map.once("load", () => {
            this._layers = { truck: [], train: [] };
            this._routeLines = [];
            this._markers = new Map();
            this._addExampleMarker();
            resolve();
          });

          // eslint-disable-next-line no-console
          this._map.on("error", (e) => console.warn("[HistoricalPage] erro no mapa", e));
        } catch (err) {
          reject(err);
        }
      });
    },

    _addExampleMarker: function () {
      if (!this._map || !window.maplibregl) {
        return;
      }

      if (this._usgaMarker && typeof this._usgaMarker.remove === "function") {
        this._usgaMarker.remove();
      }

      const markerEl = document.createElement("div");
      markerEl.style.width = "14px";
      markerEl.style.height = "14px";
      markerEl.style.borderRadius = "50%";
      markerEl.style.background = "#1976d2";
      markerEl.style.boxShadow = "0 0 0 3px rgba(25,118,210,0.25)";
      markerEl.style.border = "2px solid #ffffff";

      const popup = new window.maplibregl.Popup({ offset: 8 })
        .setHTML("<b>USGA</b><br>São José da Laje/AL");

      this._usgaMarker = new window.maplibregl.Marker({ element: markerEl })
        .setLngLat([-36.033, -9.159])
        .setPopup(popup)
        .addTo(this._map);
    },

    _renderRoutes: function () {
      if (!this._map || !this._osMapData || !window.maplibregl) return;

      const map = this._map;
      const styleReady = typeof map.isStyleLoaded === "function" ? map.isStyleLoaded() : true;
      if (!styleReady) {
        map.once("load", () => this._renderRoutes());
        return;
      }

      const routes = this._osMapData.rotas || [];
      const features = routes.map((route) => {
        if (!Array.isArray(route?.coordenadas)) {
          return null;
        }
        const coords = route.coordenadas
          .map((pair) => {
            const lat = Number(pair && pair[0]);
            const lng = Number(pair && pair[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              return null;
            }
            return [lng, lat];
          })
          .filter(Boolean);
        if (coords.length < 2) {
          return null;
        }
        return {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords
          },
          properties: {}
        };
      }).filter(Boolean);

      const hasFeatures = features.length > 0;
      const sourceExists = typeof map.getSource === "function" && map.getSource(MAP_ROUTE_SOURCE_ID);

      if (!hasFeatures) {
        if (sourceExists) {
          if (map.getLayer && map.getLayer(MAP_ROUTE_LAYER_ID)) {
            map.removeLayer(MAP_ROUTE_LAYER_ID);
          }
          map.removeSource(MAP_ROUTE_SOURCE_ID);
        }
        return;
      }

      const data = {
        type: "FeatureCollection",
        features: features
      };

      if (sourceExists) {
        map.getSource(MAP_ROUTE_SOURCE_ID).setData(data);
      } else {
        map.addSource(MAP_ROUTE_SOURCE_ID, {
          type: "geojson",
          data: data
        });
        map.addLayer({
          id: MAP_ROUTE_LAYER_ID,
          type: "line",
          source: MAP_ROUTE_SOURCE_ID,
          paint: {
            "line-color": "#5dade2",
            "line-width": 3,
            "line-opacity": 0.85
          }
        });
      }
    },

    _renderMarkers: function () {
      if (!this._map || !this._osMapData || !window.maplibregl) return;

      if (!this._layers) {
        this._layers = { truck: [], train: [] };
      }
      Object.keys(this._layers).forEach((key) => {
        const arr = this._layers[key] || [];
        arr.forEach((marker) => {
          if (marker && typeof marker.remove === "function") {
            marker.remove();
          }
        });
        this._layers[key] = [];
      });

      if (!(this._markers instanceof Map)) {
        this._markers = new Map();
      }
      this._markers.forEach((marker) => {
        if (marker && typeof marker.remove === "function") {
          marker.remove();
        }
      });
      this._markers.clear();

      const infoWindow = this._infoWindow || new gmaps.InfoWindow({ maxWidth: 320 });
      this._infoWindow = infoWindow;

      const occurrences = this._osMapData.ocorrencias || [];
      const filter = this._viewModel?.getProperty("/filter") || {};

      occurrences.forEach((occ) => {
        if (!this._isOccurrenceVisible(occ, filter)) return;

        const coords = Array.isArray(occ?.coords) ? occ.coords : [];
        const lat = Number(coords[0]);
        const lng = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        let markerElement = null;
        try {
          markerElement = this._buildMarkerElement(occ);
        } catch (err) {
          console.error("[HistoricalPage] erro ao criar elemento do marcador", err);
        }

        const markerOptions = markerElement ? { element: markerElement } : {};
        let marker;
        try {
          marker = new window.maplibregl.Marker(markerOptions)
            .setLngLat([lng, lat]);
        } catch (err) {
          console.error("[HistoricalPage] erro ao instanciar marcador", err);
          return;
        }

        const popupHtml = this._buildPopupContent(occ);
        if (popupHtml) {
          const popup = new window.maplibregl.Popup({ offset: 12 }).setHTML(popupHtml);
          popup.on("open", () => {
            try {
              const selector = `[data-map-action='open-os'][data-os='${occ.os}']`;
              const btn = document.querySelector(selector);
              if (btn) {
                btn.addEventListener("click", () => this.onAbrirOS(occ.os), { once: true });
              }
            } catch (e) { /* noop */ }
          });
          marker.setPopup(popup);
        }

        marker.addTo(this._map);

        const layerKey = occ?.tipoTransporte || "other";
        if (!this._layers[layerKey]) {
          this._layers[layerKey] = [];
        }
        this._layers[layerKey].push(marker);
        if (occ.os) {
          this._markers.set(occ.os, marker);
        }
      });
    },

    _buildMarkerElement: function (occ) {
      const statusCfg = MAP_STATUS_META[occ?.status] || { color: "#1070ca" };
      const glyph = occ?.tipoTransporte === "train" ? "🚆" : "🚚";
      const borderColor = statusCfg.color || "#1070ca";

      const container = document.createElement("div");
      container.style.width = "42px";
      container.style.height = "42px";
      container.style.borderRadius = "50%";
      container.style.background = "#ffffff";
      container.style.border = `4px solid ${borderColor}`;
      container.style.boxShadow = "0 6px 14px rgba(0,0,0,0.25)";
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";
      container.style.transform = "translate(-21px, -21px)";
      container.style.cursor = "pointer";
      container.style.fontSize = "20px";
      container.style.lineHeight = "1";
      container.textContent = glyph;

      return container;
    },

    _buildPopupContent: function (occ) {
      const statusCfg = MAP_STATUS_META[occ.status] || { label: occ.status, color: "#6c757d" };
      const transport = MAP_TRANSPORT_LABEL[occ.tipoTransporte] || occ.tipoTransporte;
      const dateFmt = formatIsoToLocale(occ.dataHora);
      const statusColor = statusCfg.color;
      const statusLabel = statusCfg.label || occ.status;
      return [
        "<div class=\"map-popup-content\" style=\"min-width:220px;\">",
        "<h3 style=\"margin:0 0 0.5rem 0;font-size:1rem;\">OS #", occ.os, "</h3>",
        "<div style=\"font-size:0.875rem;line-height:1.4;\">",
        "<div><strong>Transporte:</strong> ", transport, "</div>",
        "<div><strong>Status:</strong> <span style=\"color:", statusColor, ";font-weight:600;\">", statusLabel, "</span></div>",
        "<div><strong>Cidade:</strong> ", occ.cidade, "</div>",
        "<div><strong>Data/hora:</strong> ", dateFmt, "</div>",
        "<div style=\"margin-top:0.5rem;\">", occ.resumo || "", "</div>",
        "</div>",
        "<button type=\"button\" data-map-action=\"open-os\" data-os=\"", occ.os,
        "\" style=\"margin-top:0.75rem;padding:0.35rem 0.75rem;border:0;border-radius:0.5rem;",
        "background-color:#0a6ed1;color:#ffffff;font-weight:600;cursor:pointer;\">Abrir OS</button>",
        "</div>"
      ].join("");
    },

    _isOccurrenceVisible: function (occ, filter) {
      if (!occ) return false;
      const transportOk = filter?.transport?.[occ.tipoTransporte] !== false;
      const statusOk = filter?.status?.[occ.status] !== false;
      const locationOk = filter?.location?.[occ.cidade] !== false;
      return transportOk && statusOk && locationOk;
    },

    _fitBounds: function () {
      if (!this._map || !this._osMapData || !window.maplibregl) return;

      let bounds;
      try {
        bounds = new window.maplibregl.LngLatBounds();
      } catch (e) {
        return;
      }
      let hasPoint = false;

      const addCoord = (coord) => {
        if (!Array.isArray(coord)) return;
        const lat = Number(coord[0]);
        const lng = Number(coord[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          bounds.extend([lng, lat]);
          hasPoint = true;
        }
      };

      addCoord([MAP_DEFAULT_CENTER.lat, MAP_DEFAULT_CENTER.lng]);
      (this._osMapData.rotas || []).forEach((route) => {
        if (Array.isArray(route?.coordenadas)) {
          route.coordenadas.forEach(addCoord);
        }
      });
      (this._osMapData.ocorrencias || []).forEach((occ) => {
        addCoord(occ?.coords);
      });

      if (hasPoint) {
        try {
          this._map.fitBounds(bounds, { padding: 48, maxZoom: 12 });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[HistoricalPage] falha ao ajustar limites do mapa", e);
        }
      } else {
        try {
          this._map.setCenter([MAP_DEFAULT_CENTER.lng, MAP_DEFAULT_CENTER.lat]);
          this._map.setZoom(MAP_DEFAULT_ZOOM);
        } catch (e) { /* noop */ }
      }
    },

    _applyFilters: function () {
      if (!this._mapReady) return;
      this._renderMarkers();
    },

    _indexOccurrences: function () {
      this._occurrenceIndex = Object.create(null);
      const occs = this._osMapData?.ocorrencias || [];
      occs.forEach((occ) => {
        if (occ && occ.os) {
          this._occurrenceIndex[occ.os] = occ;
        }
      });
    },

    focusOnOs: function (osId, coordsOptional) {
      if (!osId) return Promise.resolve();

      const tabBar = this.byId("historicalTabs");
      if (tabBar?.setSelectedKey && tabBar.getSelectedKey() !== "MAP") {
        tabBar.setSelectedKey("MAP");
      }

      return this._ensureMapReady()
        .then(() => {
          const coords = Array.isArray(coordsOptional) ? coordsOptional : this._occurrenceIndex?.[osId]?.coords;
          if (coords && this._map) {
            const lat = Number(coords[0]);
            const lng = Number(coords[1]);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              try {
                if (typeof this._map.easeTo === "function") {
                  this._map.easeTo({ center: [lng, lat], zoom: Math.max(12, MAP_DEFAULT_ZOOM) });
                } else {
                  if (typeof this._map.setCenter === "function") {
                    this._map.setCenter([lng, lat]);
                  }
                  if (typeof this._map.setZoom === "function") {
                    this._map.setZoom(Math.max(12, MAP_DEFAULT_ZOOM));
                  }
                }
              } catch (e) { /* noop */ }
            }
          }
          const marker = this._markers?.get(osId);
          if (marker && this._map) {
            const occ = this._occurrenceIndex?.[osId];
            const popupHtml = occ ? this._buildPopupContent(occ) : null;
            const popup = marker.getPopup && marker.getPopup();
            if (popup) {
              if (popupHtml) {
                popup.setHTML(popupHtml);
              }
              popup.addTo(this._map);
            }
          }
        })
        .catch(() => { /* logado anteriormente */ });
    },

    onAbrirOS: function (osId) {
      if (!osId) {
        MessageToast.show("OS não informada.");
        return;
      }
      MessageToast.show(`Abrindo OS #${osId} (mock)`);
    },

    /* ======================== ROUTE ======================== */
    _onRouteMatched: function (oEvent) {
      const argId = (oEvent.getParameter("arguments")||{}).id || "";
      this._equnrRaw = String(argId);
      this._equnr = padEqunr(this._equnrRaw);

      // Busca veiculo
      const vmVeic = this.getView().getModel("vm")?.getProperty("/veiculos") || [];
      const comp   = this.getOwnerComponent();
      const baseVeic = comp.getModel()?.getProperty("/veiculos") || [];
      const allVeic = vmVeic.length ? vmVeic : baseVeic;

      const found = allVeic.find(v => {
        const e = String(v.equnr || v.veiculo || v.id || "");
        return e === this._equnrRaw || padEqunr(e) === this._equnr;
      }) || null;

      const detail = this.getView().getModel("detail");
      detail.setProperty("/veiculo", this._equnrRaw);
      detail.setProperty("/descricao",
        found?.descricao || found?.eqktx || found?.DESCRICAO || found?.Descricao || found?.txt || "");
      detail.setProperty("/categoria",
        found?.categoria || found?.CATEGORIA || found?.Categoria || "");
      detail.setProperty("/imageUrl",
        found?.imageUrl || found?.imagem || found?.image || found?.foto || "");
      detail.setProperty("/localInstalacao",
        found?.locinstaladesc || found?.instalacao || found?.local || "");
      detail.setProperty("/localInstalacaoSec",
        found?.locinstaladesc1 || found?.instalacaoSec || found?.instalacaoExtra || found?.local2 || "");

      if (this._reliabilityModel) {
        const hfModel = this.getView().getModel("hfilter");
        const hfData = hfModel ? hfModel.getData() : {};
        const defaultFrom = startOfDay(hfData.d1 || new Date());
        const defaultTo = endOfDay(hfData.d2 || hfData.d1 || new Date());
        this._reliabilityModel.setProperty("/filters/vehicleId", this._equnrRaw);
        this._reliabilityModel.setProperty("/filters/range", { from: defaultFrom, to: defaultTo });
      }

      // Carregar e montar historico
      this.onRefresh();
    },

    /* ======================== DATA LOAD ======================== */
    onRefresh: function () {
      const hf = this.getView().getModel("hfilter").getData();
      const from = startOfDay(hf.d1 || new Date());
      const to   = endOfDay(hf.d2 || hf.d1 || new Date());

      // LOG: selecao e datas ABAP "date-only"
      const abapStart = toABAPDateOnly(from);
      const abapEnd   = toABAPDateOnly(to);

      Promise.all([
        this._loadMateriaisServicosOData(from, to, { abapStart, abapEnd }),
        this._loadAbastecimentosLocal(from, to),
        this._loadOrdensServico(from, to)
      ]).then(([matServ, abast, ordens]) => {
        const base = [];

        // Materiais / Servicos (OData) normaliza e soma +1 dia
        (matServ || []).forEach((r) => {
          const tipoU = normalizeAscii(r.tipo || r.TIPO || "");
          const isSrv = (tipoU === "SERVICO" || r.isServico === true);

          const desc = pickDescMaterial(r);
          const qt   = toNum(r.qtde || r.QTDE || r.menge || r.MENGE || 1);
          const pUni = toNum(r.custoUnit || r.CUSTO_UNIT || r.preco || r.PRECO || r.precoUnit || 0);
          const val  = toNum(r.valor || r.VALOR || r.dmbtr || r.DMBTR || (qt * pUni));

          const rawDate = r.data || r.DATA || r.budat_mkpf || r.cpudt || null;
          let dataYMD = null;
          if (rawDate instanceof Date) {
            const ymdUtc = toYMD_UTC(rawDate);
            dataYMD = addDaysYMD(ymdUtc, 1);
          } else {
            const dLocal = parseLocalDateTime(rawDate);
            dataYMD = dLocal ? toYMD(addDays(dLocal, 1)) : null;
          }

          base.push({
            data: dataYMD,           // YYYY-MM-DD (corrigido +1 dia)
            tipo: isSrv ? "Servico" : "Material",
            descricao: desc,
            qtde: qt,
            custoUnit: pUni,
            valor: val
          });
        });

        // Abastecimentos (local) aplica +1 dia para alinhar com listas e filtros
        (abast || []).forEach((a) => {
          const litros = toNum(a.litros || 0);
          const precoLinha = toNum(a.precoLitro ?? a.preco ?? a.precoUnit);
          const dAbast = parseLocalDateTime(a.data || null);

          base.push({
            data: dAbast ? toYMD(addDays(dAbast, 1)) : null,  // YYYY-MM-DD (+1 dia)
            tipo: "Combustivel",
            descricao: a.descricao || "Abastecimento",
            qtde: litros,
            custoUnit: precoLinha || 0,
            valor: (precoLinha || 0) * litros
          });
        });

        const self = this;
        const osEntries = (ordens || []).map(function (o) {
          const aberturaData = o?.DataAbertura || o?.dataAbertura || "";
          const fechamentoData = o?.DataFechamento || o?.dataFechamento || "";
          const horaIni = o?.HoraInicio || o?.horaInicio || "";
          const horaFim = o?.HoraFim || o?.horaFim || "";
          const aberturaDt = combineDateTime(aberturaData, horaIni);
          const fechamentoDt = combineDateTime(fechamentoData, horaFim);
          const durationHours = calcDurationHours(aberturaDt, fechamentoDt);
          const isClosed = (fechamentoDt instanceof Date) && !Number.isNaN(fechamentoDt.getTime());
          const progress = calcProgress(durationHours, isClosed);
          const categoriaRaw = String(o?.Categoria || o?.categoria || "");
          const downtimeFmt = formatHoursLabel(durationHours);
          return {
            ordem: String(o?.NumeroOS || o?.ordem || o?.Ordem || ""),
            descricao: String(o?.Descricao || o?.descricao || o?.titulo || ""),
            categoriaOs: categoriaRaw,
            tipoManual: String(o?.TipoManual || o?.tipoManual || ""),
            status: String(o?.Status || o?.status || ""),
            aberturaData: aberturaData || "",
            aberturaHora: horaIni || "",
            fechamentoData: fechamentoData || "",
            fechamentoHora: horaFim || "",
            aberturaDt: aberturaDt || null,
            fechamentoDt: fechamentoDt || null,
            duracao: durationHours,
            downtime: durationHours,
            downtimeFmt: downtimeFmt,
            progressPct: progress.pct,
            progressText: progress.text,
            progressState: progress.state,
            categoria: categoriaRaw,
            tipoLabel: typeLabel(categoriaRaw),
            parada: durationHours > 0,
            equipamento: String(o?.Equipamento || o?.equnr || o?.veiculo || self._equnrRaw || ""),
            origem: o
          };
        }).filter(function (entry) {
          return entry && (entry.ordem || entry.descricao);
        });

        osEntries.sort((a, b) => {
          const da = a.aberturaDt instanceof Date ? a.aberturaDt.getTime() : (a.fechamentoDt instanceof Date ? a.fechamentoDt.getTime() : -Infinity);
          const db = b.aberturaDt instanceof Date ? b.aberturaDt.getTime() : (b.fechamentoDt instanceof Date ? b.fechamentoDt.getTime() : -Infinity);
          return db - da;
        });

        // Ordena por data desc (sempre via parser LOCAL)
        base.sort((x,y)=>{
          const dx = x.data ? parseLocalDateTime(x.data).getTime() : -Infinity;
          const dy = y.data ? parseLocalDateTime(y.data).getTime() : -Infinity;
          return dy - dx;
        });

        const historicoComb      = base.filter(h => normalizeAscii(h.tipo) === "COMBUSTIVEL");
        const historicoMateriais = base.filter(h => normalizeAscii(h.tipo) === "MATERIAL");
        const historicoServicos  = base.filter(h => normalizeAscii(h.tipo) === "SERVICO");

        const detail = this.getView().getModel("detail");
        detail.setProperty("/historico", base);
        detail.setProperty("/historicoComb", historicoComb);
        detail.setProperty("/historicoMateriais", historicoMateriais);
        detail.setProperty("/historicoServicos", historicoServicos);
        detail.setProperty("/historicoOs", osEntries);
        detail.setProperty("/_src/base", base);
        detail.setProperty("/_src/os", osEntries);
        detail.setProperty("/countOs", osEntries.length);

        // Atualiza flag manutencao hoje
        this._updateMaintenanceFlag(base);

        // KPIs e grafico
        this._applyFiltersAndKpis();
        this._buildYearComparison();
        this._connectPopover();

        this._updateReliability();
      });
    },

    _updateMaintenanceFlag: function(base){
      const todayFrom = startOfDay(new Date());
      const todayTo   = endOfDay(new Date());

      const hasToday = (base || []).some((r)=>{
        if (!r) return false;
        const tipoNorm = normalizeAscii(r.tipo);
        if (tipoNorm !== "MATERIAL" && tipoNorm !== "SERVICO") return false;
        const d = r.data ? parseLocalDateTime(r.data) : null;
        return d && d >= todayFrom && d <= todayTo;
      });

      const detail = this.getView().getModel("detail");
      detail.setProperty("/manutencaoHoje", hasToday);
      detail.setProperty("/manutencaoTexto", hasToday ? "Em manutencao hoje" : "Operacional");
      detail.setProperty("/manutencaoState", hasToday ? "Error" : "Success");
    },

    _loadMateriaisServicosOData: function (from, to, extra) {
      return ODataMaterials.loadMaterials(this.getOwnerComponent(), {
        equnr: this._equnr,
        startDate: from,
        endDate: to,
        abapStart: extra?.abapStart,
        abapEnd:   extra?.abapEnd
      }).then(res => {
        return res || [];
      }).catch(() => {
        return[];
      });
    },

    _loadAbastecimentosLocal: function (from, to) {
      const comp = this.getOwnerComponent();
      const abModel = comp.getModel("abast");
      const key = this._equnrRaw;

      const list = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || [];
      return Promise.resolve(
        list.filter(a => {
          const d = a && a.data ? parseLocalDateTime(a.data) : null;
          return d && d >= from && d <= to;
        })
      );
    },

    _loadOrdensServico: function (from, to) {
      const raw = String(this._equnrRaw || "");
      const padded = String(this._equnr || padEqunr(raw));
      return AvailabilityService.fetchOsByVehiclesAndRange([raw, padded], { from, to })
        .then((map) => {
          if (!map || typeof map.forEach !== "function") return [];
          const result = [];
          const wanted = new Set([raw, padded].filter(Boolean));
          map.forEach((arr, key) => {
            if (!Array.isArray(arr) || !arr.length) {
              return;
            }
            const keyStr = String(key || "");
            if (!wanted.size || wanted.has(keyStr)) {
              result.push.apply(result, arr);
              return;
            }
            const filtered = arr.filter((o) => {
              const veh = String(o?.Equipamento || o?.equnr || o?.veiculo || "");
              return wanted.has(veh);
            });
            if (filtered.length) {
              result.push.apply(result, filtered);
            }
          });
          return result;
        })
        .catch(() => []);
    },

    /* ======================== CONFIABILIDADE ======================== */
    onOpenReliabilityDetail: function () {
      const vehicleId = this._equnrRaw || "";
      if (!vehicleId) {
        MessageToast.show(this._i18n.getText("reliab.detail.noVehicle"));
        return;
      }
      const router = this.getOwnerComponent().getRouter();
      if (router && router.navTo) {
        router.navTo("confiabilidade", {
          vehicleId: vehicleId,
          query: this._buildReliabilityQuery()
        });
      }
    },

    _buildReliabilityQuery: function () {
      const params = new URLSearchParams();
      if (this._equnrRaw) {
        params.set("veh", this._equnrRaw);
      }
      const hfModel = this.getView().getModel("hfilter");
      const filter = hfModel ? hfModel.getData() : {};
      if (filter?.tipo && filter.tipo !== "__ALL__") {
        params.set("cat", filter.tipo);
      }
      if (filter?.q) {
        params.set("q", filter.q);
      }
      if (filter?.d1 instanceof Date) {
        params.set("from", filter.d1.toISOString().slice(0, 10));
      }
      if (filter?.d2 instanceof Date) {
        params.set("to", filter.d2.toISOString().slice(0, 10));
      }
      return params.toString();
    },

    _updateReliability: function () {
      if (!this._reliabilityModel) {
        return;
      }
      const vehicleId = this._equnrRaw || "";
      if (!vehicleId) {
        return;
      }
      const hfModel = this.getView().getModel("hfilter");
      const filter = hfModel ? hfModel.getData() : {};
      const from = startOfDay(filter?.d1 || new Date());
      const to = endOfDay(filter?.d2 || new Date());

      this._reliabilityModel.setProperty("/filters/vehicleId", vehicleId);
      this._reliabilityModel.setProperty("/filters/range/from", from);
      this._reliabilityModel.setProperty("/filters/range/to", to);
      this._reliabilityModel.setProperty("/loading", true);

      const selection = {
        selection: {
          vehicles: [vehicleId],
          categories: filter?.tipo && filter.tipo !== "__ALL__" ? [filter.tipo] : [],
          dateFrom: from,
          dateTo: to
        }
      };

      const svcModel = this.getOwnerComponent().getModel("svc");

      Promise.all([
        ReliabilityService.getKpis(Object.assign({ model: svcModel, vehicleId: vehicleId }, selection)),
        ReliabilityService.getTrend(Object.assign({ model: svcModel, vehicleId: vehicleId }, selection))
      ]).then((results) => {
        const kpiData = results[0] || {};
        const trendData = Array.isArray(results[1]) ? results[1] : [];
        this._applyReliabilitySummary(kpiData, trendData);
      }).catch((err) => {
        Log.error("[HistoricalPage] Falha ao atualizar confiabilidade", err);
        this._reliabilityModel.setProperty("/metrics", createReliabilityState().metrics);
        this._reliabilityModel.setProperty("/sparkline", []);
        this._renderReliabilitySparkline([]);
      }).finally(() => {
        this._reliabilityModel.setProperty("/loading", false);
      });
    },

    _applyReliabilitySummary: function (kpis, trend) {
      const bundle = this._i18n || resolveBundle(this);
      const metrics = Object.assign({}, createReliabilityState().metrics, {
        mtbfFmt: fmtHours(kpis?.mtbfH),
        mttrFmt: fmtHours(kpis?.mttrH),
        disponibilidadeFmt: fmtPct(kpis?.disponibilidadePct),
        kmPorQuebraFmt: fmtKm(kpis?.kmPorQuebra),
        falhasResumo: safeText(bundle, "reliab.kpi.failures", [Number(kpis?.totalFalhas || 0)], "Falhas: " + Number(kpis?.totalFalhas || 0)),
        downtimeResumo: safeText(bundle, "reliab.kpi.downtime", [fmtHours(kpis?.downtimeHoras)], "Indisponibilidade: " + fmtHours(kpis?.downtimeHoras))
      });
      this._reliabilityModel.setProperty("/metrics", metrics);

      const points = (trend || []).slice().sort((a, b) => (a.mes || "").localeCompare(b.mes || "")).map((entry, index) => ({
        x: index + 1,
        y: Number(entry.falhas || 0),
        label: entry.mes || ""
      }));
      this._reliabilityModel.setProperty("/sparkline", points);
      this._renderReliabilitySparkline(points);
    },

    _renderReliabilitySparkline: function (points) {
      const container = this.byId("historicalReliabSpark");
      if (!container || !container.removeAllItems) {
        return;
      }
      container.removeAllItems();
      if (!Array.isArray(points) || !points.length) {
        return;
      }
      const chart = ChartBuilder.buildSparklines({
        points: points.map((item) => item.y)
      });
      const bundle = this._i18n || resolveBundle(this);
      chart.setTooltip(safeText(bundle, "reliab.sparkline.tooltip", [], ""));
      container.addItem(chart);
    },

    /* ======================== FILTER + KPIs ======================== */
    onFilterChangeHist: function () {
      const hf = this.getView().getModel("hfilter").getData();
      console.log("[Hist] Data selecionada:",
        "De:", hf.d1 && hf.d1.toString(),
        "| ate:", hf.d2 && hf.d2.toString()
      );
      this._applyFiltersAndKpis();
      this._buildYearComparison();
      this._connectPopover();
    },

    onClearHistFilters: function(){
      const now = new Date();
      const d2 = now;
      const d1 = new Date(now); d1.setFullYear(now.getFullYear() - 1);
      this.getView().getModel("hfilter").setData({ tipo:"__ALL__", q:"", d1, d2 }, true);
      this.onFilterChangeHist();
    },

    _applyFiltersAndKpis: function () {
      const detail = this.getView().getModel("detail");
      const hf = this.getView().getModel("hfilter").getData();

      const from = startOfDay(hf.d1 || new Date());
      const to   = endOfDay(hf.d2 || hf.d1 || new Date());
      const q    = String(hf.q || "").toLowerCase();
      const tipo = hf.tipo || "__ALL__";

      const base = detail.getProperty("/_src/base") || [];
      const osBase = detail.getProperty("/_src/os") || [];

      const filt = base.filter((row)=>{
        const d = row.data ? parseLocalDateTime(row.data) : null;
        if (!d || d < from || d > to) return false;
        if (tipo !== "__ALL__" && tipo !== "OS") {
          if (normalizeAscii(row.tipo) !== normalizeAscii(tipo)) return false;
        }
        if (q && !String(row.descricao||"").toLowerCase().includes(q)) return false;
        return true;
      });

      const allowOs = (tipo === "__ALL__" || tipo === "OS");
      const fromMs = from.getTime();
      const toMs = to.getTime();
      const osFiltered = allowOs ? osBase.filter((row)=>{
        const startDt = row.aberturaDt instanceof Date ? row.aberturaDt : combineDateTime(row.aberturaData, row.aberturaHora);
        const endDt = row.fechamentoDt instanceof Date ? row.fechamentoDt : combineDateTime(row.fechamentoData, row.fechamentoHora);
        const startMs = startDt instanceof Date ? startDt.getTime() : NaN;
        const endMs = endDt instanceof Date ? endDt.getTime() : NaN;
        const overlapsStart = !Number.isNaN(startMs) && startMs >= fromMs && startMs <= toMs;
        const overlapsEnd = !Number.isNaN(endMs) && endMs >= fromMs && endMs <= toMs;
        const spansRange = !Number.isNaN(startMs) && !Number.isNaN(endMs) && startMs <= fromMs && endMs >= toMs;
        if (!(overlapsStart || overlapsEnd || spansRange)) return false;
        if (q) {
          const txt = String(row.descricao || "").toLowerCase();
          const ordemTxt = String(row.ordem || "").toLowerCase();
          const catTxt = (String(row.categoriaOs || "") + " " + String(row.tipoManual || "") + " " + String(row.status || "")).toLowerCase();
          if (!txt.includes(q) && !ordemTxt.includes(q) && !catTxt.includes(q)) {
            return false;
          }
        }
        return true;
      }) : [];

      const historicoComb      = filt.filter(h => normalizeAscii(h.tipo) === "COMBUSTIVEL");
      const historicoMateriais = filt.filter(h => normalizeAscii(h.tipo) === "MATERIAL");
      const historicoServicos  = filt.filter(h => normalizeAscii(h.tipo) === "SERVICO");

      const totalComb = sum(historicoComb,      h=>h.valor);
      const totalMat  = sum(historicoMateriais, h=>h.valor);
      const totalServ = sum(historicoServicos,  h=>h.valor);
      const totalGeral = totalComb + totalMat + totalServ;

      const totLitros = sum(historicoComb, h=>h.qtde);
      const precoMedio = totLitros ? (totalComb / totLitros) : 0;

      detail.setProperty("/historico", filt);
      detail.setProperty("/historicoComb", historicoComb);
      detail.setProperty("/historicoMateriais", historicoMateriais);
      detail.setProperty("/historicoServicos", historicoServicos);
      detail.setProperty("/historicoOs", osFiltered);

      detail.setProperty("/countComb", historicoComb.length);
      detail.setProperty("/countMateriais", historicoMateriais.length);
      detail.setProperty("/countServicos", historicoServicos.length);
      detail.setProperty("/countOs", osFiltered.length);

      detail.setProperty("/totalCombustivel", totalComb);
      detail.setProperty("/totalMateriais", totalMat);
      detail.setProperty("/totalServicos", totalServ);
      detail.setProperty("/totalGeral", totalGeral);
      detail.setProperty("/precoMedio", precoMedio);

      detail.setProperty("/totalCombustivelFmt", fmtBrl(totalComb));
      detail.setProperty("/totalMateriaisFmt",   fmtBrl(totalMat));
      detail.setProperty("/totalServicosFmt",    fmtBrl(totalServ));
      detail.setProperty("/totalGeralFmt",       fmtBrl(totalGeral));
      detail.setProperty("/precoMedioFmt",       fmtNum(precoMedio));
    },

    /* ======================== CHART ======================== */
    onChartTypeChange: function (oEvent) {
      const key = oEvent.getParameter("item").getKey();
      this._historyModel.setProperty("/chartType", key);
      this._applyVizProps();
      this._connectPopover();
    },

    _buildYearComparison: function () {
      const detail = this.getView().getModel("detail");
      const hf = this.getView().getModel("hfilter").getData();

      const dRef = hf.d2 || new Date();
      const yearCur  = (dRef instanceof Date ? dRef : new Date(dRef)).getFullYear();
      const yearPrev = yearCur - 1;

      const all = detail.getProperty("/historico") || [];
      const sumCur  = new Array(12).fill(0);
      const sumPrev = new Array(12).fill(0);

      all.forEach((r)=>{
        const d = r.data ? parseLocalDateTime(r.data) : null;
        if (!d) return;
        const y = d.getFullYear();
        const m = d.getMonth(); // 0..11
        const v = toNum(r.valor || 0);
        if (y === yearCur)  sumCur[m]  += v;
        if (y === yearPrev) sumPrev[m] += v;
      });

      const points = MONTH_LABELS.map((label, i)=>({ label, current: sumCur[i], previous: sumPrev[i] }));
      const totalCur = sumCur.reduce((a,b)=>a+b,0);
      const totalPrev = sumPrev.reduce((a,b)=>a+b,0);

      this._historyModel.setProperty("/points", points);
      this._historyModel.setProperty("/subtitle", `Ano Atual: ${fmtBrl(totalCur)} | Ano Anterior: ${fmtBrl(totalPrev)}`);
    },

    onExit: function () {
      if (this._usgaMarker && typeof this._usgaMarker.remove === "function") {
        this._usgaMarker.remove();
      }
      this._usgaMarker = null;

      if (this._markers instanceof Map) {
        this._markers.forEach((marker) => {
          if (marker && typeof marker.remove === "function") {
            marker.remove();
          }
        });
        this._markers.clear();
      }

      if (this._layers) {
        Object.keys(this._layers).forEach((key) => {
          const arr = this._layers[key] || [];
          arr.forEach((marker) => {
            if (marker && typeof marker.remove === "function") {
              marker.remove();
            }
          });
        });
      }
      this._layers = null;

      if (this._map) {
        try {
          if (this._map.getLayer && this._map.getLayer(MAP_ROUTE_LAYER_ID)) {
            this._map.removeLayer(MAP_ROUTE_LAYER_ID);
          }
          if (this._map.getSource && this._map.getSource(MAP_ROUTE_SOURCE_ID)) {
            this._map.removeSource(MAP_ROUTE_SOURCE_ID);
          }
          if (typeof this._map.remove === "function") {
            this._map.remove();
          }
        } catch (e) { /* noop */ }
      }

      this._map = null;
      this._mapReady = false;
    }
  });
});



