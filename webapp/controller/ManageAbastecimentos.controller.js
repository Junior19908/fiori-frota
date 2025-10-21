sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/ui/core/BusyIndicator",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, BusyIndicator, MessageBox) {
  "use strict";

  function pad2(n){ return String(n).padStart(2, "0"); }
  function normalizeMonth(s){ var m = String(s||"").trim(); var mm = m.match(/^(\d{4})-(\d{2})$/); return mm ? (mm[1]+"-"+mm[2]) : ""; }
  function flattenAbast(data){ var out = []; if (!data || !data.abastecimentosPorVeiculo) return out; Object.keys(data.abastecimentosPorVeiculo).forEach(function(veh){ var arr = Array.isArray(data.abastecimentosPorVeiculo[veh]) ? data.abastecimentosPorVeiculo[veh] : []; arr.forEach(function(ev, idx){ out.push(Object.assign({ veiculo: veh, _idx: idx }, ev)); }); }); out.sort(function(a,b){ var ta = new Date((a.data||"1970-01-01")+"T"+(a.hora||"00:00:00")).getTime(); var tb = new Date((b.data||"1970-01-01")+"T"+(b.hora||"00:00:00")).getTime(); return ta - tb; }); return out; }

  // Paginação (client-side)
  function _clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
  function _slicePage(items, page, pageSize){
    var total = Array.isArray(items) ? items.length : 0;
    var size = Math.max(1, Number(pageSize)||50);
    var totalPages = Math.max(1, Math.ceil((total||0) / size));
    var cur = _clamp(Number(page)||1, 1, totalPages);
    var start = (cur - 1) * size;
    var end   = Math.min(start + size, total);
    return { paged: (items||[]).slice(start, end), page: cur, pageSize: size, total: total, totalPages: totalPages, from: total ? (start+1) : 0, to: total ? end : 0 };
  }

  return Controller.extend("com.skysinc.frota.frota.controller.ManageAbastecimentos", {
    onInit: function () {
      var initial = { items: [], pagedItems: [], ym: "", page: 1, pageSize: 50, totalPages: 1, totalCount: 0, from: 0, to: 0 };
      var model = new JSONModel(initial);
      var that = this;
      var _origSetData = model.setData.bind(model);
      model.setData = function(data){ _origSetData(data); try { that._recomputePaging(); } catch(_){} };
      var _origSetProperty = model.setProperty.bind(model);
      model.setProperty = function(path, value){ var res = _origSetProperty(path, value); try { var p = String(path||''); if (p === '/items' || p === '/page' || p === '/pageSize') { that._recomputePaging(); } } catch(_){} return res; };
      this.getView().setModel(model, "ab");
      this._recomputePaging();
    },
    _recomputePaging: function(){ var m=this.getView().getModel("ab"); if(!m) return; var d=m.getData()||{}; var calc=_slicePage(d.items||[], d.page||1, d.pageSize||50); m.setProperty("/pagedItems", calc.paged); m.setProperty("/page", calc.page); m.setProperty("/pageSize", calc.pageSize); m.setProperty("/totalPages", calc.totalPages); m.setProperty("/totalCount", calc.total); m.setProperty("/from", calc.from); m.setProperty("/to", calc.to); },
    onPageSizeChange: function(e){ var src=e&&e.getSource&&e.getSource(); var key=src&&src.getSelectedKey?src.getSelectedKey():null; var size=Number(key||50)||50; var m=this.getView().getModel("ab"); if(!m) return; m.setProperty("/pageSize", size); m.setProperty("/page", 1); this._recomputePaging(); var t=this.byId("tblEvents"); if(t&&t.removeSelections) t.removeSelections(true); },
    onPagePrev: function(){ var m=this.getView().getModel("ab"); if(!m) return; var p=(m.getProperty("/page")||1)-1; m.setProperty("/page", _clamp(p,1,Math.max(1,m.getProperty("/totalPages")||1))); this._recomputePaging(); var t=this.byId("tblEvents"); if(t&&t.removeSelections) t.removeSelections(true); },
    onPageNext: function(){ var m=this.getView().getModel("ab"); if(!m) return; var max=Math.max(1,m.getProperty("/totalPages")||1); var p=(m.getProperty("/page")||1)+1; m.setProperty("/page", _clamp(p,1,max)); this._recomputePaging(); var t=this.byId("tblEvents"); if(t&&t.removeSelections) t.removeSelections(true); },
    onPageFirst: function(){ var m=this.getView().getModel("ab"); if(!m) return; m.setProperty("/page", 1); this._recomputePaging(); var t=this.byId("tblEvents"); if(t&&t.removeSelections) t.removeSelections(true); },
    onPageLast: function(){ var m=this.getView().getModel("ab"); if(!m) return; var max=Math.max(1,m.getProperty("/totalPages")||1); m.setProperty("/page", max); this._recomputePaging(); var t=this.byId("tblEvents"); if(t&&t.removeSelections) t.removeSelections(true); },
    onNavBack: function(){ try { this.getOwnerComponent().getRouter().navTo("settings"); } catch(_){} },
    onLoad: function(){ var ym = normalizeMonth(this.byId("inpMonth").getValue()); if (!ym) { MessageToast.show("Informe Mês YYYY-MM."); return; } var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]); var that = this; BusyIndicator.show(0); var url1 = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/abastecimento/" + y + "/" + pad2(m) + "/abastecimentos.json"); var url2 = sap.ui.require.toUrl("com/skysinc/frota/frota/model/localdata/" + y + "/" + pad2(m) + "/abastecimentos.json"); jQuery.ajax({ url: url1, dataType: 'json', cache: false, success: function(local){ var items = flattenAbast(local); that.getView().getModel("ab").setData({ items: items, ym: ym }); MessageToast.show(items.length + " evento(s) carregado(s) (local)."); }, error: function(){ jQuery.ajax({ url: url2, dataType: 'json', cache: false, success: function(local){ var items = flattenAbast(local); that.getView().getModel("ab").setData({ items: items, ym: ym }); MessageToast.show(items.length + " evento(s) carregado(s) (local)."); }, error: function(){ MessageToast.show("Mês não encontrado."); } }); } }).always(function(){ BusyIndicator.hide(); }); },
    _getSelection: function(){ var tbl = this.byId("tblEvents"); var ctxs = tbl.getSelectedContexts(true); return ctxs.map(function (c) { return c.getObject && c.getObject(); }).filter(Boolean); },
    onDeleteSelected: function(){ var sel = this._getSelection(); if (!sel.length) { MessageToast.show("Selecione ao menos um evento."); return; } var model = this.getView().getModel("ab"); var data = model.getData(); var ym = data.ym || ""; var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]); var toDelete = new Set(sel.map(function(e){ return String(e.veiculo||'')+"|"+String(e.idEvento||''); })); var items = Array.isArray(model.getProperty("/items")) ? model.getProperty("/items") : []; var kept = items.filter(function(ev){ var k = String(ev.veiculo||'')+"|"+String(ev.idEvento||''); return !toDelete.has(k); }); var map = {}; kept.forEach(function(ev){ var veh = String(ev.veiculo||''); if(!veh) return; if(!map[veh]) map[veh]=[]; map[veh].push(ev); }); var json = { abastecimentosPorVeiculo: map }; try { var blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); var fname = 'abastecimentos-' + String(y) + '-' + String(m).padStart(2,'0') + '.json'; a.href = url; a.download = fname; document.body.appendChild(a); a.click(); setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0); MessageToast.show("JSON atualizado gerado: " + fname); this.getView().getModel('ab').setProperty('/items', kept); this._recomputePaging(); var t=this.byId("tblEvents"); if(t&&t.removeSelections) t.removeSelections(true); } catch (e) { console.error(e); MessageToast.show("Falha ao gerar JSON."); } },
    onDeleteMonth: function(){ var ym = (this.getView().getModel("ab").getData().ym || "").trim(); if (!ym) { MessageToast.show("Informe/Carregue o mês."); return; } var mm = ym.split("-"); var y = Number(mm[0]), m = Number(mm[1]); var that = this; MessageBox.error("Tem certeza que deseja excluir TODO o mês " + ym + "?", { actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL], onClose: function (act) { if (act !== MessageBox.Action.OK) return; var json = { abastecimentosPorVeiculo: {} }; try { var blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); var fname = 'abastecimentos-' + String(y) + '-' + String(m).padStart(2,'0') + '.json'; a.href = url; a.download = fname; document.body.appendChild(a); a.click(); setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0); MessageToast.show("Arquivo vazio gerado: " + fname); that.getView().getModel("ab").setData({ items: [], ym: ym }); } catch (e) { console.error(e); MessageToast.show("Falha ao gerar JSON."); } } }); }
  });
});
