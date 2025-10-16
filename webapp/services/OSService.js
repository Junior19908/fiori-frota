sap.ui.define([], function () {
  "use strict";
  async function getById(){ return null; }
  async function upsert(){ return { ok:false, reason:'offline' }; }
  async function upsertMany(){ return { ok:false, reason:'offline' }; }
  async function removeById(){ return { ok:false, reason:'offline' }; }
  function listByVehicleAndRange(){ return Promise.resolve([]); }
  function listByVehicleAndRangePage(){ return Promise.resolve({ items: [], last: null }); }
  async function listByDateRangePage(){ return { items: [], last: null }; }
  async function countByFilter(){ return 0; }
  return { getById, upsert, upsertMany, removeById, listByVehicleAndRange, listByVehicleAndRangePage, listByDateRangePage, countByFilter };
});
