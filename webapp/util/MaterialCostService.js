sap.ui.define([
  "sap/base/Log",
  "com/skysinc/frota/frota/services/ODataMaterials"
], function (Log, ODataMaterials) {
  "use strict";

  const CHUNK_SIZE = 40;

  function uniqueOrders(list) {
    return Array.from(new Set((list || []).map(function (item) {
      return item != null ? String(item).trim() : "";
    }).filter(Boolean)));
  }

  function chunk(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  function aggregate(items) {
    const map = new Map();
    let total = 0;
    (items || []).forEach(function (item) {
      const order = item.nOrdem || item.nrOrdem || item.aufnr || "";
      if (!order) {
        return;
      }
      const cost = Number(item.valorTotal || (item.qtde * item.custoUnit) || 0);
      if (!Number.isFinite(cost) || cost === 0) {
        return;
      }
      map.set(order, (map.get(order) || 0) + cost);
      total += cost;
    });
    return {
      byOrder: map,
      total: total
    };
  }

  function loadCostsByOrders(options) {
    const opts = options || {};
    const component = opts.component;
    const vehicleId = opts.vehicleId;
    const orders = uniqueOrders(opts.orders);
    if (!component || !vehicleId || !orders.length) {
      return Promise.resolve({
        items: [],
        byOrder: new Map(),
        total: 0
      });
    }

    const range = opts.range || {};
    const chunks = chunk(orders, CHUNK_SIZE);
    const promises = chunks.map(function (chunkOrders) {
      return ODataMaterials.loadMaterials(component, {
        equnr: vehicleId,
        startDate: range.from || new Date(0),
        endDate: range.to || new Date(),
        orders: chunkOrders,
        showBusy: opts.showBusy
      });
    });

    return Promise.all(promises).then(function (results) {
      const flat = [].concat.apply([], results);
      const agg = aggregate(flat);
      return {
        items: flat,
        byOrder: agg.byOrder,
        total: agg.total
      };
    }).catch(function (error) {
      Log.warning("[MaterialCostService] Falha ao carregar materiais por OS", error);
      return {
        items: [],
        byOrder: new Map(),
        total: 0
      };
    });
  }

  return {
    loadCostsByOrders: loadCostsByOrders
  };
});
