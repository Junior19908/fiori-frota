sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/skysinc/frota/frota/util/formatter",
  "com/skysinc/frota/frota/services/FirebaseFirestoreService"
], function (JSONModel, Fragment, MessageToast, MessageBox, formatter, FirebaseFS) {
  "use strict";

  const _byViewId = new Map();

  function _toYmd(val){
    try {
      if (!val) return "";
      if (val instanceof Date) {
        const d = new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
        return d.toISOString().substring(0,10);
      }
      const s = String(val);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d2 = new Date(s);
      if (!isNaN(d2.getTime())) return new Date(Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate())).toISOString().substring(0,10);
      return s;
    } catch(_) { return String(val||""); }
  }

  function _combineDateTime(dateStr, timeStr, fallbackStart) {
    try {
      const ds = String(dateStr || '').trim();
      if (!ds) return null;
      const ts = String(timeStr || '').trim();
      const hhmm = /^\d{1,2}:\d{2}$/;
      const time = hhmm.test(ts) ? ts : (fallbackStart ? '00:00' : '23:59');
      const d = new Date(ds + 'T' + time);
      return isNaN(d.getTime()) ? null : d;
    } catch (_) { return null; }
  }

  function _formatDowntime(hours) {
    try { const m = Math.max(0, Math.round((Number(hours) || 0) * 60)); const h = Math.floor(m/60), mm = m%60; return h + 'h' + String(mm).padStart(2,'0'); } catch(_) { return '0h00'; }
  }

  function _typeLabel(code) {
    try {
      const c = String(code || '').toUpperCase();
      if (c === 'ZF01') return 'Projeto / Melhoria / Reforma';
      if (c === 'ZF02') return 'Corretiva';
      if (c === 'ZF03') return 'Preventiva BÃ¡sica/MecÃ¢nica';
      return c || '';
    } catch (_) { return String(code||''); }
  }

  function _mapToView(list) {
    return (list || []).map(function (o) {
      const ab = _combineDateTime(o.DataAbertura, o.HoraInicio, true) || (o.DataAbertura ? new Date(o.DataAbertura) : null);
      const fe = _combineDateTime(o.DataFechamento, o.HoraFim, false) || (o.DataFechamento ? new Date(o.DataFechamento) : null);
      const downtime = (ab && fe && fe.getTime() > ab.getTime()) ? ((fe.getTime() - ab.getTime())/36e5) : 0;
      const categoria = String(o.Categoria || o.categoria || '').toUpperCase();
      return {
        _id: String(o._id || ""),
        ordem: String(o.NumeroOS || ""),
        veiculo: String(o.Equipamento || ""),
        titulo: String(o.Descricao || ""),
        inicio: _toYmd(o.DataAbertura),
        fim: _toYmd(o.DataFechamento),
        horaInicio: String(o.HoraInicio || ''),
        horaFim: String(o.HoraFim || ''),
        _abertura: ab || (o.DataAbertura || null),
        _fechamento: fe || (o.DataFechamento || null),
        parada: downtime > 0,
        downtime: downtime,
        downtimeFmt: _formatDowntime(Number(downtime) || 0),
        tipoManual: String(o.TipoManual || ""),
        categoria: categoria,
        tipoLabel: _typeLabel(categoria)
      };
    });
  }

  function _ensure(view) {
    const vid = view.getId();
    if (_byViewId.has(vid)) return _byViewId.get(vid);
    const dlgModel = new JSONModel({ titulo: 'OS', os: [], _base: [], total: 0, page: { index:1, size:200, hasPrev:false, hasNext:false, pageText:'PÃ¡gina 1' } });
    let dialogRef = null;

    let pageIndex = 0;
    let limit = 200;
    let cursors = [ null ];
    let lastCursor = null;

    const fragController = {
      formatter: formatter,

      onCloseOS: function () { dialogRef && dialogRef.close(); },

      // Timeline helpers
      fmtBarLeft: function (abertura, fechamento, metaStart, metaEnd) {
        try {
          const toMs = (v)=>{ try{ if(!v) return 0; if(typeof v==='number') return v>0?v:0; if(v instanceof Date) return isNaN(v.getTime())?0:v.getTime(); const s=String(v); if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const d=new Date(s+'T00:00:00'); return isNaN(d.getTime())?0:d.getTime(); } const d2=new Date(s); return isNaN(d2.getTime())?0:d2.getTime(); }catch(_){return 0;} };
          let S = toMs(metaStart), E=toMs(metaEnd);
          if (!S || !E || E<=S) {
            const arr = dlgModel.getProperty('/os') || [];
            arr.forEach((it)=>{ const A=toMs(it._abertura); const F=toMs(it._fechamento); if(A) S=S?Math.min(S,A):A; if(F) E=E?Math.max(E,F):F; });
          }
          if (!S || !E || E<=S) return '0%';
          const A = toMs(abertura) || S; const a = Math.max(S, Math.min(E, A));
          return Math.max(0, Math.min(100, ((a-S)/(E-S))*100)).toFixed(2) + '%';
        } catch(_) { return '0%'; }
      },
      fmtBarWidth: function (abertura, fechamento, metaStart, metaEnd) {
        try {
          const toMs = (v)=>{ try{ if(!v) return 0; if(typeof v==='number') return v>0?v:0; if(v instanceof Date) return isNaN(v.getTime())?0:v.getTime(); const s=String(v); if(/^\d{4}-\d{2}-\d{2}$/.test(s)){ const d=new Date(s+'T00:00:00'); return isNaN(d.getTime())?0:d.getTime(); } const d2=new Date(s); return isNaN(d2.getTime())?0:d2.getTime(); }catch(_){return 0;} };
          let S = toMs(metaStart), E=toMs(metaEnd);
          if (!S || !E || E<=S) {
            const arr = dlgModel.getProperty('/os') || [];
            arr.forEach((it)=>{ const A=toMs(it._abertura); const F=toMs(it._fechamento); if(A) S=S?Math.min(S,A):A; if(F) E=E?Math.max(E,F):F; });
          }
          if (!S || !E || E<=S) return '100%';
          const A = toMs(abertura) || S; const F = toMs(fechamento) || E; const a=Math.max(S,Math.min(E,A)); const f=Math.max(S,Math.min(E,F));
          return Math.max(0, Math.min(100, ((f-a)/(E-S))*100)).toFixed(2) + '%';
        } catch(_) { return '100%'; }
      },
      fmtBarCss: function (tipoLabel, parada) {
        try { const t=String(tipoLabel||'').toLowerCase(); const base='osBarFill'; if(t.indexOf('corretiva')>=0) return base+' osBarFillCorretiva'; if(t.indexOf('preventiva')>=0) return base+' osBarFillPreventiva'; if(t.indexOf('projeto')>=0||t.indexOf('melhoria')>=0||t.indexOf('reforma')>=0) return base+' osBarFillProjeto'; return base; } catch(_) { return 'osBarFill'; }
      },
      fmtBarTooltip: function (inicio, horaIni, fim, horaFim, durFmt) {
        try { const i = (inicio||'') + (horaIni?(' '+horaIni):''); const f=(fim||'') + (horaFim?(' '+horaFim):''); const d = durFmt||''; return 'InÃ­cio: '+i+'\nFim: '+f+'\nDuraÃ§Ã£o: '+d; } catch(_) { return ''; }
      },

      onShowOSDetails: function (oEvent) {
        try {
          const src = oEvent && oEvent.getSource && oEvent.getSource();
          const ctx = src && src.getBindingContext && src.getBindingContext('osDlg');
          const o = ctx && ctx.getObject && ctx.getObject();
          if (!o) { MessageToast.show('Falha ao carregar detalhes da OS.'); return; }
          const title = 'OS ' + (o.ordem || '');
          const dlg = new sap.m.Dialog({ title: title, contentWidth: '32rem', horizontalScrolling: true });
          function row(label, value){ return new sap.m.HBox({ alignItems:'Center', items:[ new sap.m.Label({ text: label, width: '11rem', design:'Bold' }), new sap.m.Text({ text: String(value==null?'':value) }) ] }); }
          const vb = new sap.m.VBox({ width:'100%', items:[
            row('VeÃ­culo', o.veiculo||''), row('Ordem', o.ordem||''), row('TÃ­tulo', o.titulo||''), row('Tipo OS', o.tipoLabel||''), row('Tipo (manual)', o.tipoManual||''), row('InÃ­cio', (o.inicio||'') + (o.horaInicio?(' '+o.horaInicio):'')), row('Fim', (o.fim||'') + (o.horaFim?(' '+o.horaFim):'')), row('Parada', o.parada?'Sim':'NÃ£o'), row('Inatividade', o.downtimeFmt||'')
          ]});
          dlg.addContent(vb);
          dlg.addButton(new sap.m.Button({ text:'Fechar', type:'Transparent', press: function(){ dlg.close(); } }));
          dlg.attachAfterClose(function(){ dlg.destroy(); });
          try { view.addDependent(dlg); } catch(_){}
          dlg.open();
        } catch(e){ try{ console.error('[OSDialog.onShowOSDetails]', e);}catch(_){} }
      },

      onLiveSearch: function (ev) {
        const q = (ev?.getParameter?.('newValue') || ev?.getParameter?.('query') || '').toString().toLowerCase();
        const data = dlgModel.getData() || {};
        const base = Array.isArray(data._base) ? data._base : (data.os || []);
        if (!q) { dlgModel.setProperty('/os', base); dlgModel.setProperty('/total', base.length); return; }
        const filtered = base.filter((it)=>{ const s1=(it.veiculo||'').toLowerCase(); const s2=(it.ordem||'').toLowerCase(); const s3=(it.titulo||'').toLowerCase(); return s1.includes(q)||s2.includes(q)||s3.includes(q); });
        dlgModel.setProperty('/os', filtered);
        dlgModel.setProperty('/total', filtered.length);
      },

      onExportOS: function () {
        const data = dlgModel.getData() || {};
        const rows = (data.os || []).map((o)=>({ Veiculo:o.veiculo||'', Ordem:o.ordem||'', Titulo:o.titulo||'', Inicio:o.inicio||'', Fim:o.fim||'', Parada:o.parada?'Sim':'NÃ£o', Inatividade_h:String(o.downtimeFmt||''), TipoManual:o.tipoManual||'', HoraInicio:o.horaInicio||'', HoraFim:o.horaFim||'', TipoOS:o.tipoLabel||'' }));
        if (!rows.length) { MessageToast.show('Sem OS no filtro atual.'); return; }
        const headers = Object.keys(rows[0]); const esc=(v)=>{ if(v==null) return ''; if(typeof v==='number') return v.toString(); let s=String(v); if(/[;"\n\r]/.test(s)) s='"'+s.replace(/"/g,'""')+'"'; return s; };
        const lines=[headers.join(';')]; rows.forEach(r=>lines.push(headers.map(h=>esc(r[h])).join(';'))); const csv='\uFEFF'+lines.join('\n');
        try{ const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='os_lista.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url),1000); MessageToast.show('CSV gerado com sucesso.'); }catch(e){ console.error('[OSDialog.onExportOS]',e); MessageBox.error('NÃ£o foi possÃ­vel gerar o CSV.'); }
      },

      onCloseSelectedOS: async function () {
        try {
          const tbl = view.byId('tblOSGrid');
          const idxs = tbl?.getSelectedIndices?.() || [];
          if (!idxs.length) { MessageToast.show('Selecione ao menos uma OS.'); return; }
          const data = dlgModel.getData() || {}; const list = data.os || []; const sel = idxs.map(i=>list[i]).filter(Boolean);
          if (!sel.length) { MessageToast.show('SeleÃ§Ã£o vazia.'); return; }
          const nowIso = new Date().toISOString(); const nowYmd = nowIso.substring(0,10);
          const fb = await FirebaseFS.getFirebase();
          const updates = sel.map(async (o)=>{ if(!o._id) return {ok:false}; const dref = fb.doc(fb.db,'ordensServico', o._id); try { await fb.updateDoc(dref, { DataFechamento: nowYmd }); o.fim = _toYmd(nowYmd); const A = o._abertura ? new Date(o._abertura).toISOString() : null; const dt = (A ? ((new Date(nowIso).getTime() - new Date(A).getTime())/36e5) : 0); o.downtime = dt; o.downtimeFmt = _formatDowntime(dt); o.parada = (dt>0); return {ok:true}; } catch(e){ return {ok:false, reason:e && (e.code||e.message)} } });
          const results = await Promise.all(updates); const ok = results.filter(r=>r.ok).length; dlgModel.refresh(true); MessageToast.show(ok + ' OS concluÃ­da(s).');
        } catch(e){ console.error('[OSDialog.onCloseSelectedOS]', e); MessageBox.error('Falha ao concluir OS selecionadas.'); }
      },

      onSetTypeSelectedOS: function () {
        const tbl = view.byId('tblOSGrid');
        const idxs = tbl?.getSelectedIndices?.() || [];
        if (!idxs.length) { MessageToast.show('Selecione ao menos uma OS.'); return; }
        const dlg = new sap.m.Dialog({ title: 'Definir tipo (manual)', contentWidth: '20rem' });
        const inp = new sap.m.Input({ placeholder: 'Ex.: Preventiva/Corretiva/Outro' }); dlg.addContent(inp);
        dlg.addButton(new sap.m.Button({ text:'Cancelar', press: ()=> dlg.close() }));
        dlg.addButton(new sap.m.Button({ text:'Aplicar', type:'Emphasized', press: async ()=>{
          const val = (inp.getValue()||'').trim(); if(!val){ MessageToast.show('Informe um tipo.'); return; }
          try { const data = dlgModel.getData()||{}; const list = data.os||[]; const sel = idxs.map(i=>list[i]).filter(Boolean); const fb = await FirebaseFS.getFirebase(); const updates = sel.map(async (o)=>{ if(!o._id) return {ok:false}; const dref = fb.doc(fb.db,'ordensServico', o._id); try { await fb.updateDoc(dref, { TipoManual: val }); o.tipoManual = val; return {ok:true}; } catch(e){ return {ok:false, reason:e && (e.code||e.message)} } }); const res = await Promise.all(updates); const ok = res.filter(r=>r.ok).length; dlgModel.refresh(true); MessageToast.show(ok + ' OS atualizada(s).'); } catch(e){ console.error('[OSDialog.onSetTypeSelectedOS]', e); MessageBox.error('Falha ao atualizar tipo.'); } finally { dlg.close(); }
        }}));
        dlg.attachAfterClose(()=> dlg.destroy()); view.addDependent(dlg); dlg.open();
      },

      onNextPage: async function () {
        const meta = dlgModel.getProperty('/__meta') || {}; let veh = meta.equnr; let start = meta.start; let end = meta.end; if(!veh){ const arr=dlgModel.getProperty('/os')||[]; veh = arr.length ? String(arr[0].veiculo||'') : ''; }
        if (!(start instanceof Date)) { end = new Date(); start = new Date(); start.setDate(end.getDate()-60); }
        if (!veh || !lastCursor) return; pageIndex += 1; cursors[pageIndex] = lastCursor; await _loadPage(veh, start, end, cursors[pageIndex]);
      },

      onPrevPage: async function () {
        const meta = dlgModel.getProperty('/__meta') || {}; let veh = meta.equnr; let start = meta.start; let end = meta.end; if(!veh){ const arr=dlgModel.getProperty('/os')||[]; veh = arr.length ? String(arr[0].veiculo||'') : ''; }
        if (!(start instanceof Date)) { end = new Date(); start = new Date(); start.setDate(end.getDate()-60); }
        if (!veh || pageIndex === 0) return; pageIndex -= 1; const cursor = cursors[pageIndex] || null; await _loadPage(veh, start, end, cursor);
      }
    };

    const state = { dlgModel, fragController, get dialogRef(){ return dialogRef; }, set dialogRef(v){ dialogRef = v; }, get lastCursor(){ return lastCursor; }, set lastCursor(v){ lastCursor = v; }, get limit(){ return limit; }, set limit(v){ limit=v; }, get pageIndex(){ return pageIndex; }, set pageIndex(v){ pageIndex=v; }, cursors, view };
    _byViewId.set(vid, state);
    return state;
  }

  async function _loadPage(veh, start, end, after){
    const st = _byViewId.values().next().value; // simple single-view usage
    const res = await FirebaseFS.listOrdersByVehicleAndRangePage({ equnr: veh, start, end, limit: st.limit, after });
    const mapped = _mapToView(res.items);
    st.lastCursor = res.last || null; const hasNext = !!(st.lastCursor && mapped.length >= st.limit); const hasPrev = st.pageIndex > 0; const pageText = 'PÃ¡gina ' + String(st.pageIndex + 1);
    st.dlgModel.setProperty('/os', mapped); st.dlgModel.setProperty('/_base', mapped.slice()); st.dlgModel.setProperty('/total', mapped.length); st.dlgModel.setProperty('/page', { index: st.pageIndex + 1, size: st.limit, hasPrev, hasNext, pageText });
  }

  async function open(view, payload){
    const st = _ensure(view);
    try {
      const veh = String(payload?.equnr || payload?.veiculo || '').trim();
      const range = payload?.range || null; const start = Array.isArray(range) ? range[0] : (range?.from || null); const end = Array.isArray(range) ? range[1] : (range?.to || null);
      if (!veh) { MessageToast.show('Selecione um veÃ­culo para listar as OS.'); return; }
      const list = await FirebaseFS.listOrdersByVehicleAndRange({ equnr: veh, start, end, limit: 200 });
      const mapped = _mapToView(list);
      st.dlgModel.setData({ titulo: payload?.titulo || ('Ordens de Serviço' + (veh ? (' - ' + veh) : '')), os: mapped, _base: mapped.slice(), total: mapped.length });
      // forÃ§a meta-range conforme filtro global
      st.dlgModel.setProperty('/__meta', { equnr: veh, start, end });

      const name = 'com.skysinc.frota.frota.fragments.OSDialog'; const id = view.getId();
      let loaded = st.dialogRef; if (!loaded) loaded = await Fragment.load({ name, id, controller: st.fragController });
      let dlg = Array.isArray(loaded) ? (loaded.find && loaded.find(c=>c && c.isA && c.isA('sap.m.Dialog'))) || loaded[0] : loaded;
      st.dialogRef = dlg; if (dlg && dlg.addDependent) view.addDependent(dlg); if (dlg && dlg.setModel) dlg.setModel(st.dlgModel, 'osDlg'); else throw new TypeError('OSDialog fragment did not resolve to a Dialog control');
      // aplica filtro de tipos permitido conforme settings (se existir)
      try { const sModel = view.getModel && view.getModel('settings'); const showAll = !!(sModel && sModel.getProperty && sModel.getProperty('/showAllOS')); const allowed = (sModel && sModel.getProperty && sModel.getProperty('/osTypes')) || []; if (!showAll && Array.isArray(allowed) && allowed.length){ const set = new Set(allowed.map((x)=>String(x).toUpperCase())); const arr = st.dlgModel.getProperty('/os') || []; const filtered = arr.filter((o)=> !o.categoria || set.has(String(o.categoria||'').toUpperCase())); st.dlgModel.setProperty('/os', filtered); st.dlgModel.setProperty('/_base', filtered.slice()); st.dlgModel.setProperty('/total', filtered.length); } } catch(_){ }
      dlg.open();
      return dlg;
    } catch(e){ try{ console.error('[OSDialog.open] Falha ao abrir OS', e);}catch(_){} MessageToast.show('Falha ao abrir OS.'); }
  }

  return { open };
});





