sap.ui.define([
  "sap/ui/core/Core",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/base/Log",
  "com/skysinc/frota/frota/util/FilterBuilder",
  "com/skysinc/frota/frota/services/ReliabilityService"
], function (Core, Filter, FilterOperator, Log, FilterBuilder, LegacyReliabilityService) {
  "use strict";

  const DEFAULT_PATHS = {
    kpis: "/ReliabilityKpiSet",
    trend: "/ReliabilityTrendSet",
    failures: "/ReliabilityFailureSet"
  };

  function getModel(options) {
    if (options && options.model) {
      return options.model;
    }
    try {
      const core = Core.getConfiguration ? Core : sap.ui.getCore();
      return core.getModel && core.getModel("svc");
    } catch (err) {
      Log.warning("[ReliabilityService] Unable to resolve OData model", err);
      return null;
    }
  }

  function normalizeSelection(filterState) {
    const selection = FilterBuilder.normaliseSelection(filterState && filterState.selection);
    return {
      categories: selection.categories || [],
      vehicles: selection.vehicles || [],
      dateFrom: selection.dateFrom instanceof Date ? selection.dateFrom : (selection.dateFrom ? new Date(selection.dateFrom) : null),
      dateTo: selection.dateTo instanceof Date ? selection.dateTo : (selection.dateTo ? new Date(selection.dateTo) : null)
    };
  }

  function buildFilters(selection, vehicleId, customFieldMap) {
    const fieldMap = Object.assign({
      date: "DataEvento",
      categories: "Categoria",
      vehicles: "Veiculo"
    }, customFieldMap || {});
    const baseFilters = FilterBuilder.buildOData({ selection: selection }, fieldMap) || [];
    const filters = baseFilters.slice();
    if (vehicleId) {
      filters.push(new Filter(fieldMap.vehicles, FilterOperator.EQ, vehicleId));
    }
    return filters;
  }

  function readOData(model, path, filters, parameters) {
    return new Promise(function (resolve, reject) {
      if (!model || !model.read) {
        reject(new Error("OData model unavailable"));
        return;
      }
      model.read(path, {
        filters: filters,
        urlParameters: parameters || {},
        success: function (data) {
          resolve(data && (data.results || data));
        },
        error: function (err) {
          reject(err);
        }
      });
    });
  }

  function enumerateMonths(rangeStart, rangeEnd, fallbackCount) {
    const months = [];
    if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date) || rangeEnd < rangeStart) {
      const now = new Date();
      for (let i = fallbackCount - 1; i >= 0; i--) {
        const candidate = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
        months.push(candidate);
      }
      return months;
    }
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1, 0, 0, 0, 0);
    while (cursor <= end) {
      months.push(new Date(cursor.getTime()));
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setDate(1);
    }
    return months;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function getMonthKey(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1);
  }

  function getMonthHours(date) {
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return daysInMonth * 24;
  }

  function toISOStringWithoutTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }
    return [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate())
    ].join("-") + "T00:00:00";
  }

  function formatDateTime(date, time) {
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (date && typeof date === "string") {
      const candidate = time ? (date + "T" + time) : date;
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return null;
  }

  function mergeWithFallback(mapper) {
    return function (options) {
      const opts = options || {};
      const model = getModel(opts);
      const vehicleId = opts.vehicleId;
      const selection = normalizeSelection(opts.selection);
      const paths = Object.assign({}, DEFAULT_PATHS, opts.paths);
      const filters = buildFilters(selection, vehicleId, opts.fieldMap);

      return readOData(model, paths[mapper.pathKey], filters, mapper.parameters && mapper.parameters(opts))
        .then(function (result) {
          return mapper.transformFromOData(result, opts);
        })
        .catch(function (err) {
          Log.debug("[ReliabilityService] Falling back to local data for " + mapper.pathKey, err);
          return LegacyReliabilityService.mergeDataPorVeiculo({
            vehicleId: vehicleId,
            range: {
              from: selection.dateFrom,
              to: selection.dateTo
            }
          }).then(function (payload) {
            return mapper.transformFromLegacy(payload, opts);
          });
        });
    };
  }

  function mapLegacyFailures(payload, selection) {
    const rangeFrom = selection.dateFrom instanceof Date ? selection.dateFrom : null;
    const rangeTo = selection.dateTo instanceof Date ? selection.dateTo : null;
    return (payload.osEventos || []).filter(function (row) {
      if (!(row.startDate instanceof Date)) {
        return false;
      }
      if (rangeFrom && row.startDate < rangeFrom) {
        return false;
      }
      if (rangeTo && row.startDate > rangeTo) {
        return false;
      }
      return true;
    }).map(function (row) {
      const raw = row.raw || {};
      return {
        os: row.numero,
        descricao: row.descricao,
        inicio: formatDateTime(row.startDate),
        fim: formatDateTime(row.endDate),
        downtimeH: Number(row.downtimeHoras || 0),
        downtimeFmt: row.downtimeFmt || "",
        kmEvento: Number(row.kmEvento || 0),
        horasEvento: Number(row.hrEvento || 0),
        categoria: row.categoria || "",
        subsistema: raw.Subsistema || raw.SubsistemaManutencao || "",
        severidade: raw.Severidade || raw.Prioridade || "",
        custoTotal: Number(raw.CustoTotal || raw.CustoEstimado || 0)
      };
    });
  }

  return {
    getKpis: mergeWithFallback({
      pathKey: "kpis",
      parameters: function (options) {
        return {
          "$top": 1
        };
      },
      transformFromOData: function (result) {
        const first = Array.isArray(result) ? result[0] : result;
        if (!first) {
          return {
            mtbfH: 0,
            mttrH: 0,
            disponibilidadePct: 0,
            kmPorQuebra: 0,
            horasPorQuebra: 0,
            proximaQuebraKm: 0,
            proximaQuebraH: 0,
            totalFalhas: 0
          };
        }
        return {
          mtbfH: Number(first.MTBF || first.mtbf || 0),
          mttrH: Number(first.MTTR || first.mttr || 0),
          disponibilidadePct: Number(first.Disponibilidade || first.disponibilidade || 0),
          kmPorQuebra: Number(first.KmPorQuebra || first.kmPorQuebra || 0),
          horasPorQuebra: Number(first.HorasPorQuebra || first.hrPorQuebra || 0),
          proximaQuebraKm: Number(first.ProximaQuebraKm || first.proximaQuebraKm || 0),
          proximaQuebraH: Number(first.ProximaQuebraH || first.proximaQuebraHr || 0),
          totalFalhas: Number(first.TotalFalhas || first.falhas || 0),
          downtimeHoras: Number(first.DowntimeHoras || first.downtimeHoras || first.TotalDowntime || 0)
        };
      },
      transformFromLegacy: function (payload) {
        const metrics = payload && payload.metrics ? payload.metrics : {};
        return {
          mtbfH: Number(metrics.mtbf || 0),
          mttrH: Number(metrics.mttr || 0),
          disponibilidadePct: Number(metrics.disponibilidade || 0),
          kmPorQuebra: Number(metrics.kmPorQuebra || 0),
          horasPorQuebra: Number(metrics.hrPorQuebra || 0),
          proximaQuebraKm: Number(metrics.proximaQuebraKm || 0),
          proximaQuebraH: Number(metrics.proximaQuebraHr || 0),
          totalFalhas: Number(metrics.falhas || 0),
          downtimeHoras: Number(metrics.downtimeTotal || metrics.downtimeHoras || metrics.downtime || 0)
        };
      }
    }),

    getTrend: mergeWithFallback({
      pathKey: "trend",
      parameters: function () {
        return {
          "$top": 60,
          "$orderby": "Mes asc"
        };
      },
      transformFromOData: function (result) {
        const list = Array.isArray(result) ? result : (result && result.results) || [];
        return list.map(function (row) {
          const month = row.Mes || row.Month || row.Periodo || "";
          return {
            mes: month,
            falhas: Number(row.Falhas || row.TotalFalhas || row.falhas || 0),
            disponibilidadePct: Number(row.Disponibilidade || row.disponibilidade || 0),
            custoFalhas: Number(row.CustoFalhas || row.custoFalhas || 0)
          };
        });
      },
      transformFromLegacy: function (payload, options) {
        const selection = normalizeSelection(options.selection);
        const months = enumerateMonths(selection.dateFrom, selection.dateTo, 12);
        const monthMap = new Map();
        months.forEach(function (monthDate) {
          const key = getMonthKey(monthDate);
          monthMap.set(key, {
            mes: key,
            falhas: 0,
            disponibilidadePct: 1,
            custoFalhas: 0
          });
        });

        const events = mapLegacyFailures(payload, selection);
        events.forEach(function (item) {
          const startIso = item.inicio;
          if (!startIso) {
            return;
          }
          const startDate = new Date(startIso);
          if (Number.isNaN(startDate.getTime())) {
            return;
          }
          const key = getMonthKey(startDate);
          if (!monthMap.has(key)) {
            monthMap.set(key, {
              mes: key,
              falhas: 0,
              disponibilidadePct: 1,
              custoFalhas: 0
            });
          }
          const entry = monthMap.get(key);
          entry.falhas += 1;
          entry.custoFalhas += Number(item.custoTotal || 0);
          const downtime = Number(item.downtimeH || 0);
          const monthReference = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
          const hoursInMonth = getMonthHours(monthReference);
          const disponibilidade = hoursInMonth > 0 ? Math.max(0, 1 - (downtime / hoursInMonth)) : 1;
          entry.disponibilidadePct = disponibilidade;
        });

        return Array.from(monthMap.values()).sort(function (a, b) {
          return a.mes.localeCompare(b.mes);
        });
      }
    }),

    getFailures: mergeWithFallback({
      pathKey: "failures",
      transformFromOData: function (result) {
        const list = Array.isArray(result) ? result : (result && result.results) || [];
        return list.map(function (row) {
          return {
            os: row.Ordem || row.OS || row.os || "",
            descricao: row.Descricao || row.descricao || "",
            inicio: row.Inicio || toISOStringWithoutTime(row.DataInicio || row.inicio),
            fim: row.Fim || toISOStringWithoutTime(row.DataFim || row.fim),
            downtimeH: Number(row.DowntimeHoras || row.downtimeHoras || 0),
            downtimeFmt: row.DowntimeFmt || row.downtimeFmt || "",
            kmEvento: Number(row.KmEvento || row.kmEvento || 0),
            horasEvento: Number(row.HorasEvento || row.horasEvento || 0),
            categoria: row.Categoria || row.categoria || "",
            subsistema: row.Subsistema || row.subsistema || "",
            severidade: row.Severidade || row.severidade || "",
            custoTotal: Number(row.CustoTotal || row.custoTotal || 0)
          };
        });
      },
      transformFromLegacy: function (payload, options) {
        const selection = normalizeSelection(options.selection);
        return mapLegacyFailures(payload, selection);
      }
    })
  };
});
