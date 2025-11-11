sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "com/skysinc/frota/frota/util/formatter",
  "com/skysinc/frota/frota/services/ReliabilityService",
  "com/skysinc/frota/frota/services/ReliabilityCore",
  "com/skysinc/frota/frota/util/timeOverlap"
], function (JSONModel, Fragment, MessageToast, MessageBox, formatter, ReliabilityService, ReliabilityCore, timeOverlap) {
  "use strict";

  const _byViewId = new Map();
  const timeOverlapUtil = timeOverlap || {};
  const overlapMinutesFn = typeof timeOverlapUtil.overlapMinutes === "function" ? timeOverlapUtil.overlapMinutes : null;
  const formatHmFn = typeof timeOverlapUtil.formatHm === "function" ? timeOverlapUtil.formatHm : null;
  const coerceDayjsFn = typeof timeOverlapUtil.coerceDayjs === "function" ? timeOverlapUtil.coerceDayjs : null;

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
    try {
      const m = Math.max(0, Math.round((Number(hours) || 0) * 60));
      if (formatHmFn) {
        return formatHmFn(m);
      }
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return h + "h" + String(mm).padStart(2, "0");
    } catch(_) { return '0h00'; }
  }

  function _updateTotals(model, list) {
    if (!model || typeof model.setProperty !== 'function') { return; }
    const arr = Array.isArray(list) ? list : [];
    const totals = arr.reduce((acc, item) => {
      const minutes = Number(item && item._overlapMinutes);
      const safeMinutes = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
      if (safeMinutes > 0) {
        acc.totalMinutes += safeMinutes;
        acc.considered += 1;
        if (item._countsToDowntime) {
          acc.zf02Minutes += safeMinutes;
          if (!item.parada) {
            acc.openZF02 += 1;
          }
        }
        if (item._countsToProjects) {
          acc.projectsMinutes += safeMinutes;
          if (!item.parada && String(item.categoria || '').toUpperCase() === 'ZF03') {
            acc.openZF03 += 1;
          }
        }
      }
      return acc;
    }, { totalMinutes: 0, zf02Minutes: 0, projectsMinutes: 0, openZF02: 0, openZF03: 0, considered: 0 });
    const totalHours = totals.totalMinutes / 60;

    //Configuração de cálculo decimal
    const totalHoursDecimal = (Math.round(totalHours * 100) / 100).toFixed(2);
    const totalHorasDecimalFmt = `${totalHoursDecimal.replace('.',',')} h`;
    model.setProperty('/totalHorasDecimalFmt', totalHorasDecimalFmt);
    

    const totalFmt = formatHmFn ? formatHmFn(Math.round(totals.totalMinutes)) : _formatDowntime(totalHours);
    try { model.setProperty('/total', arr.length); } catch (_) {}
    try { model.setProperty('/totalHoras', `${totalHours.toFixed(2).replace('.',',')} h`); } catch (_) {}
    try { model.setProperty('/totalHorasFmt', totalFmt); } catch (_) {}
    const zf02Fmt = formatHmFn ? formatHmFn(Math.round(totals.zf02Minutes)) : _formatDowntime(totals.zf02Minutes / 60);
    const projFmt = formatHmFn ? formatHmFn(Math.round(totals.projectsMinutes)) : _formatDowntime(totals.projectsMinutes / 60);
    try { model.setProperty('/metrics/horasZF02', totals.zf02Minutes / 60); } catch (_) {}
    try { model.setProperty('/metrics/horasZF02Fmt', zf02Fmt); } catch (_) {}
    try { model.setProperty('/metrics/horasZF01_ZF03', totals.projectsMinutes / 60); } catch (_) {}
    try { model.setProperty('/metrics/horasZF01_ZF03Fmt', projFmt); } catch (_) {}
    try { model.setProperty('/metrics/qtdAbertasZF02', totals.openZF02); } catch (_) {}
    try { model.setProperty('/metrics/qtdAbertasZF03', totals.openZF03); } catch (_) {}
    try { model.setProperty('/metrics/osConsideradas', totals.considered); } catch (_) {}
  }

  function _refreshTotalsFromModel(model) {
    if (!model || typeof model.getProperty !== 'function') { return; }
    const list = model.getProperty('/os');
    _updateTotals(model, Array.isArray(list) ? list : []);
  }

  function _calcProgress(hours) {
    try {
      const totalHours = Number(hours) || 0;
      if (!isFinite(totalHours) || totalHours <= 0) {
        return { pct: 0, text: '0%', state: 'Information' };
      }
      const pct = Math.max(0, Math.min(100, Math.round((totalHours / 24) * 100)));
      return {
        pct,
        text: pct.toString() + '%',
        state: 'Information'
      };
    } catch (_) {
      return { pct: 0, text: '0%', state: 'Information' };
    }
  }

  function _isUnifiedReliabilityEnabled(view) {
    try {
      const settings = view && view.getModel && view.getModel('settings');
      if (!settings || typeof settings.getProperty !== 'function') {
        return true;
      }
      const flag = settings.getProperty('/reliability/unifiedPipeline');
      return flag !== false;
    } catch (err) {
      return true;
    }
  }

  function _getReliabilitySettings(view) {
    try {
      const settings = view && view.getModel && view.getModel("settings");
      if (!settings || typeof settings.getProperty !== "function") {
        return {};
      }
      const cfg = settings.getProperty("/reliability") || {};
      const clone = Object.assign({}, cfg);
      if (cfg.breakEstimator && typeof cfg.breakEstimator === "object") {
        clone.breakEstimator = Object.assign({}, cfg.breakEstimator);
      }
      return clone;
    } catch (err) {
      return {};
    }
  }

  const LEGACY_WARNED = new Set();
  function _warnLegacyReliability(vehicleId) {
    const key = String(vehicleId || '').trim();
    if (!key || LEGACY_WARNED.has(key)) {
      return;
    }
    LEGACY_WARNED.add(key);
    try {
      console.warn(`[RELIABILITY] Mixed sources detected for vehicle ${key}. Please migrate to unified pipeline.`);
    } catch (err) {
      // ignore
    }
  }

  function _typeLabel(code) {
    try {
      const c = String(code || '').toUpperCase();
      if (c === 'ZF01') return 'Projeto / Melhoria / Reforma - ZF01';
      if (c === 'ZF02') return 'Corretiva - ZF02';
      if (c === 'ZF03') return 'Preventiva Basica/Mecanica - ZF03';
      return c || '';
    } catch (_) { return String(code||''); }
  }

  function _mapToView(list, options = {}) {
    const now = options.now || (ReliabilityCore && typeof ReliabilityCore.nowLocal === "function"
      ? ReliabilityCore.nowLocal()
      : new Date());
    const filterStart = options.filterStart || null;
    const filterEnd = options.filterEnd || null;
    return (list || []).map(function (o) {
      const dataInicio = o.DataAbertura || o.dataAbertura;
      const dataFim = o.DataFechamento || o.dataFechamento;
      const horaInicio = o.HoraInicio || o.horaInicio;
      const horaFim = o.HoraFim || o.horaFim;
      const ab = _combineDateTime(dataInicio, horaInicio, true) || (dataInicio ? new Date(dataInicio) : null);
      const originalEnd = _combineDateTime(dataFim, horaFim, false) || (dataFim ? new Date(dataFim) : null);
      const hasRealEnd = originalEnd instanceof Date && !Number.isNaN(originalEnd);
      let effectiveEnd = null;
      if (ab) {
        if (originalEnd && originalEnd.getTime() >= ab.getTime()) {
          effectiveEnd = originalEnd;
        } else if (!originalEnd) {
          effectiveEnd = now;
        }
      }
      if (effectiveEnd && ab && effectiveEnd.getTime() < ab.getTime()) {
        effectiveEnd = ab;
      }
      const downtime = (ab && effectiveEnd) ? ((effectiveEnd.getTime() - ab.getTime()) / 36e5) : 0;
      const overlapMinutesVal = (overlapMinutesFn && filterStart && filterEnd && ab)
        ? overlapMinutesFn(ab, effectiveEnd, filterStart, filterEnd, now)
        : Math.max(0, Math.round((Number(downtime) || 0) * 60));
      const categoria = String(o.Categoria || o.categoria || '').toUpperCase();
      const progress = _calcProgress(downtime);
      return {
        _id: String(o._id || ""),
        ordem: String(o.NumeroOS || o.numero || ""),
        veiculo: String(o.Equipamento || o.equipamento || ""),
        titulo: String(o.Descricao || o.descricao || ""),
        inicio: _toYmd(dataInicio),
        fim: _toYmd(dataFim),
        horaInicio: String(horaInicio || ''),
        horaFim: String(horaFim || ''),
        _abertura: ab || (dataInicio || null),
        _fechamento: effectiveEnd || (dataFim || null),
        parada: hasRealEnd,
        _isOpen: !hasRealEnd,
        downtime: downtime,
        downtimeFmt: _formatDowntime(Number(downtime) || 0),
        _overlapMinutes: overlapMinutesVal,
        _overlapFmt: formatHmFn ? formatHmFn(Math.round(overlapMinutesVal)) : _formatDowntime(overlapMinutesVal / 60),
        _countsToDowntime: categoria === "ZF02",
        _countsToProjects: categoria === "ZF01" || categoria === "ZF03",
        categoria: categoria,
        tipoManual: String(o.TipoManual || o.tipoManual || ""),
        tipoLabel: (categoria === 'ZF03' ? 'Preventiva Basica/Mecanica - ZF03' : _typeLabel(categoria)),
        progressPct: progress.pct,
        progressText: progress.text,
        progressState: progress.state
      };
    });
  }

  function _resolveOsFilter(view) {
    let showAll = true;
    let allowed = [];
    try {
      const sModel = view && view.getModel && view.getModel('settings');
      if (sModel && typeof sModel.getProperty === 'function') {
        showAll = !!sModel.getProperty('/showAllOS');
        const selected = sModel.getProperty('/osTypes');
        if (Array.isArray(selected)) {
          allowed = selected.slice();
        }
      }
    } catch (_) {
      showAll = true;
      allowed = [];
    }
    const allowedSet = new Set(
      (Array.isArray(allowed) ? allowed : [])
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean)
    );
    return { showAll, allowed, allowedSet };
  }

  function _resolveFilterBounds(view, range) {
    try {
      const localModel = view && view.getModel && view.getModel("local");
      if (localModel && typeof localModel.getProperty === "function") {
        const localStart = localModel.getProperty("/filter/fStart");
        const localEnd = localModel.getProperty("/filter/fEnd");
        if (localStart && localEnd) {
          return { start: localStart, end: localEnd };
        }
      }
    } catch (_) {
      // ignore issues resolving local model
    }
    const from = (range && range.from instanceof Date) ? range.from : (Array.isArray(range) ? range[0] : null);
    const to = (range && range.to instanceof Date) ? range.to : (Array.isArray(range) ? range[1] : null);
    return {
      start: coerceDayjsFn ? coerceDayjsFn(from) : null,
      end: coerceDayjsFn ? coerceDayjsFn(to) : null
    };
  }

  function _ensure(view) {
    const vid = view.getId();
    if (_byViewId.has(vid)) return _byViewId.get(vid);
    const dlgModel = new JSONModel({
      titulo: 'OS',
      os: [],
      _base: [],
      total: 0,
      totalHoras: 0,
      totalHorasFmt: '0h00',
      metrics: {
        falhas: 0,
        downtimeFmt: '-',
        downtimeTotalFmt: '0,00 Hr',
        horasParadasFmt: '0,00 h',
        mtbf: 0,
        mtbfFmt: '-',
        mttr: 0,
        mttrFmt: '-',
        disponibilidade: 0,
        disponibilidadeFmt: '-',
        kmPorQuebra: 0,
        kmPorQuebraFmt: '-',
        kmPerFailureFmt: '-',
        hrPorQuebra: 0,
        hrPorQuebraFmt: '-',
        hrPerFailureFmt: '-',
        proximaQuebraKm: 0,
        proximaQuebraKmFmt: '-',
        proximaQuebraHr: 0,
        proximaQuebraHrFmt: '-',
        horasZF02: 0,
        horasZF02Fmt: '0,00 h',
        horasZF01_ZF03: 0,
        horasZF01: 0,
        horasZF01Fmt: '0,00 h',
        horasZF03: 0,
        horasZF03Fmt: '0,00 h',
        qtdAbertasZF02: 0,
        qtdAbertasZF03: 0
      }
    });
    let dialogRef = null;

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
        try { const i = (inicio||'') + (horaIni?(' '+horaIni):''); const f=(fim||'') + (horaFim?(' '+horaFim):''); const d = durFmt||''; return 'In+Â¡cio: '+i+'\nFim: '+f+'\nDura+Âº+Ãºo: '+d; } catch(_) { return ''; }
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
            row('Ve+Â¡culo', o.veiculo||''), row('Ordem', o.ordem||''), row('TÃtulo', o.titulo||''), row('Tipo OS', o.tipoLabel||''), row('Tipo (manual)', o.tipoManual||''), row('In+Â¡cio', (o.inicio||'') + (o.horaInicio?(' '+o.horaInicio):'')), row('Fim', (o.fim||'') + (o.horaFim?(' '+o.horaFim):'')), row('Parada', o.parada?'Sim':'N+Ãºo'), row('Inatividade', o.downtimeFmt||'')
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
        if (!q) {
          dlgModel.setProperty('/os', base);
        _updateTotals(dlgModel, base);
        try { const mx0 = base.reduce((m,o)=>Math.max(m, (Number(o._overlapMinutes)||0)/60), 0); dlgModel.setProperty('/__stats', { max: mx0 }); } catch(_){}
        return;
      }
        const filtered = base.filter((it)=>{ const s1=(it.veiculo||'').toLowerCase(); const s2=(it.ordem||'').toLowerCase(); const s3=(it.titulo||'').toLowerCase(); return s1.includes(q)||s2.includes(q)||s3.includes(q); });
        dlgModel.setProperty('/os', filtered);
        _updateTotals(dlgModel, filtered);
        try { const mx = filtered.reduce((m,o)=>Math.max(m, (Number(o._overlapMinutes)||0)/60), 0); dlgModel.setProperty('/__stats', { max: mx }); } catch(_){}
      },

      onExportOS: function () {
        const data = dlgModel.getData() || {};
        const rows = (data.os || []).map((o)=>({
          'Ve+Â¡culo': o.veiculo || '',
          Ordem: o.ordem || '',
          'T+Â¡tulo': o.titulo || '',
          'In+Â¡cio': o.inicio || '',
          Fim: o.fim || '',
          Parada: o.parada ? 'Sim' : 'N+Ãºo',
          'Inatividade (filtro)': String(o._overlapFmt || o.downtimeFmt || ''),
          'Progresso': o.progressText || '',
          'Tipo (manual)': o.tipoManual || '',
          'Hora In+Â¡cio': o.horaInicio || '',
          'Hora Fim': o.horaFim || '',
          'Tipo OS': o.tipoLabel || ''
        }));
        if (!rows.length) { MessageToast.show('Sem OS no filtro atual.'); return; }
        const headers = Object.keys(rows[0]); const esc=(v)=>{ if(v==null) return ''; if(typeof v==='number') return v.toString(); let s=String(v); if(/[;"\n\r]/.test(s)) s='"'+s.replace(/"/g,'""')+'"'; return s; };
        const lines=[headers.join(';')]; rows.forEach(r=>lines.push(headers.map(h=>esc(r[h])).join(';'))); const csv='\uFEFF'+lines.join('\n');
        try{ const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='os_lista.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(()=>URL.revokeObjectURL(url),1000); MessageToast.show('CSV gerado com sucesso.'); }catch(e){ console.error('[OSDialog.onExportOS]',e); MessageBox.error('N+Ãºo foi poss+Â¡vel gerar o CSV.'); }
      },

      onCloseSelectedOS: async function () {
        try {
          const tbl = view.byId('tblOSGrid');
          const idxs = tbl?.getSelectedIndices?.() || [];
          if (!idxs.length) { MessageToast.show('Selecione ao menos uma OS.'); return; }
          const data = dlgModel.getData() || {}; const list = data.os || []; const sel = idxs.map(i=>list[i]).filter(Boolean);
          if (!sel.length) { MessageToast.show('Sele+Âº+Ãºo vazia.'); return; }
          const nowIso = new Date().toISOString(); const nowYmd = nowIso.substring(0,10);
          const fb = await (function(){ MessageToast.show("Indispon+Â¡vel em modo local."); })();
          const updates = sel.map(async (o)=>{ if(!o._id) return {ok:false}; const dref = fb.doc(fb.db,'ordensServico', o._id); try { await fb.updateDoc(dref, { DataFechamento: nowYmd }); o.fim = _toYmd(nowYmd); const A = o._abertura ? new Date(o._abertura).toISOString() : null; const dt = (A ? ((new Date(nowIso).getTime() - new Date(A).getTime())/36e5) : 0); o.downtime = dt; o.downtimeFmt = _formatDowntime(dt); o.parada = (dt>0); const pr = _calcProgress(dt); o.progressPct = pr.pct; o.progressText = pr.text; o.progressState = pr.state; return {ok:true}; } catch(e){ return {ok:false, reason:e && (e.code||e.message)} } });
          const results = await Promise.all(updates);
          const ok = results.filter(r=>r.ok).length;
          dlgModel.refresh(true);
          _refreshTotalsFromModel(dlgModel);
          MessageToast.show(ok + ' OS conclu\u00edda(s).');
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
          try { const data = dlgModel.getData()||{}; const list = data.os||[]; const sel = idxs.map(i=>list[i]).filter(Boolean); const fb = await (function(){ MessageToast.show("Indispon+Â¡vel em modo local."); })(); const updates = sel.map(async (o)=>{ if(!o._id) return {ok:false}; const dref = fb.doc(fb.db,'ordensServico', o._id); try { await fb.updateDoc(dref, { TipoManual: val }); o.tipoManual = val; return {ok:true}; } catch(e){ return {ok:false, reason:e && (e.code||e.message)} } }); const res = await Promise.all(updates); const ok = res.filter(r=>r.ok).length; dlgModel.refresh(true); MessageToast.show(ok + ' OS atualizada(s).'); } catch(e){ console.error('[OSDialog.onSetTypeSelectedOS]', e); MessageBox.error('Falha ao atualizar tipo.'); } finally { dlg.close(); }
        }}));
        dlg.attachAfterClose(()=> dlg.destroy()); view.addDependent(dlg); dlg.open();
      }
    };

    const state = { dlgModel, fragController, get dialogRef(){ return dialogRef; }, set dialogRef(v){ dialogRef = v; }, view };
    _byViewId.set(vid, state);
    return state;
  }

  async function open(view, payload){
    const st = _ensure(view);
    try {
      const veh = String(payload?.equnr || payload?.veiculo || '').trim();
      const range = payload?.range || null;
      const start = Array.isArray(range) ? range[0] : (range?.from || null);
      const end   = Array.isArray(range) ? range[1] : (range?.to   || null);
      const useUnifiedReliability = _isUnifiedReliabilityEnabled(view);
      const reliabilitySettings = _getReliabilitySettings(view);
      const osFilter = _resolveOsFilter(view);
      let list = [];
      let unifiedOsMap = null;
      const providedOsMap = payload && payload.osData && payload.osData.map;
      if (useUnifiedReliability && providedOsMap instanceof Map) {
        unifiedOsMap = providedOsMap;
        if (veh) {
          list = unifiedOsMap.get(veh) || [];
        } else if (unifiedOsMap.size) {
          unifiedOsMap.forEach((arr) => {
            if (Array.isArray(arr) && arr.length) {
              list.push.apply(list, arr);
            }
          });
        }
      } else {
        try {
          if (start instanceof Date && end instanceof Date && useUnifiedReliability) {
            const ids = veh ? [veh] : [];
            unifiedOsMap = await ReliabilityService.fetchOsUnifiedByVehiclesAndRange({
              vehicles: ids,
              dateFrom: start,
              dateTo: end,
              tiposOS: osFilter.showAll ? undefined : osFilter.allowed
            });
            if (veh) {
              list = unifiedOsMap.get(veh) || [];
            } else if (unifiedOsMap && unifiedOsMap.size) {
              unifiedOsMap.forEach((arr) => {
                if (Array.isArray(arr) && arr.length) {
                  list.push.apply(list, arr);
                }
              });
            }
          } else if (start instanceof Date && end instanceof Date && !useUnifiedReliability) {
            const ids = veh ? [veh] : [];
            const legacySvc = await new Promise((resolve) => {
              sap.ui.require(["com/skysinc/frota/frota/services/AvailabilityService"], function (svc) { resolve(svc); });
            });
            if (legacySvc && legacySvc.fetchOsByVehiclesAndRange) {
              const map = await legacySvc.fetchOsByVehiclesAndRange(ids, { from: start, to: end });
              if (veh) { list = map.get(veh) || []; }
              else { map.forEach((arr)=>{ if (Array.isArray(arr)) list.push.apply(list, arr); }); }
              if (veh) { _warnLegacyReliability(veh); }
            }
          }
        } catch (err) {
          try { console.warn("[OSDialog.open] Falha ao carregar OS unificada", err); } catch (_) {}
        }
      }
      if (!Array.isArray(list) || !list.length) {
        try {
          const url = sap.ui.require.toUrl('com/skysinc/frota/frota/model/localdata/os/os.json');
          const data = await new Promise((resolve) => { jQuery.ajax({ url, dataType: 'json', cache: false, success: (d)=>resolve(d), error: ()=>resolve(null) }); });
          if (Array.isArray(data)) list = data; else if (data && Array.isArray(data.os)) list = data.os;
        } catch(_) { list = []; }
      }

      const filterBounds = _resolveFilterBounds(view, { from: start, to: end });
      const mapped = _mapToView(list, {
        filterStart: filterBounds.start,
        filterEnd: filterBounds.end
      });
      const meta = { equnr: veh, start, end };
      const payloadMetrics = payload?.metrics || {};
      let filtered = mapped;
      if (start instanceof Date && end instanceof Date) {
        const startMs = start.getTime();
        const endMs = end.getTime();
        const withinRange = function (item) {
          if (Number(item && item._overlapMinutes) > 0) {
            return true;
          }
          const beginMs = (item && item._abertura instanceof Date) ? item._abertura.getTime() : (item && item.inicio ? new Date(item.inicio + 'T00:00:00').getTime() : NaN);
          let finishMs = (item && item._fechamento instanceof Date) ? item._fechamento.getTime() : (item && item.fim ? new Date(item.fim + 'T23:59:59').getTime() : NaN);
          if (Number.isNaN(beginMs)) { return false; }
          if (Number.isNaN(finishMs) || finishMs < beginMs) { finishMs = beginMs; }
          return beginMs <= endMs && finishMs >= startMs;
        };
        filtered = filtered.filter(withinRange);
      } else if (filterBounds.start && filterBounds.end) {
        filtered = filtered.filter((item) => Number(item && item._overlapMinutes) > 0);
      }
      if (!osFilter.showAll && osFilter.allowedSet.size) {
        filtered = filtered.filter((o)=> !o.categoria || osFilter.allowedSet.has(String(o.categoria||'').toUpperCase()));
      }

      const title = payload?.titulo || ('Ordens de Servi+Âºo' + (veh ? (' - ' + veh) : ''));
      st.dlgModel.setProperty('/__meta', meta);
      st.dlgModel.setProperty('/titulo', title);
      st.dlgModel.setProperty('/os', filtered);
      st.dlgModel.setProperty('/_base', filtered.slice());
      _updateTotals(st.dlgModel, filtered);
      try {
        const mx = filtered.length ? filtered.reduce((m,o)=>Math.max(m, (Number(o._overlapMinutes)||0) / 60), 0) : 0;
        st.dlgModel.setProperty('/__stats', { max: mx });
      } catch(_) {
        st.dlgModel.setProperty('/__stats', { max: 0 });
      }

      let combinedMetrics = Object.assign({}, st.dlgModel.getProperty('/metrics') || {});
      const mergedPayload = Object.assign({}, payloadMetrics);
      let unifiedSummary = null;
      if (veh && useUnifiedReliability && unifiedOsMap) {
        try {
          const summaryMap = ReliabilityService.buildUnifiedReliabilityByVehicleFromMap(unifiedOsMap, {
            vehicles: [veh],
            dateFrom: start instanceof Date ? start : null,
            dateTo: end instanceof Date ? end : null,
            settings: reliabilitySettings
          }) || {};
          unifiedSummary = summaryMap[veh] || null;
        } catch (err) {
          try { console.warn('[OSDialog.open] Falha ao sintetizar mÃ©tricas unificadas', err); } catch (_) {}
        }
      }
      try {
        if (veh) {
          const relRange = {
            from: start instanceof Date ? start : null,
            to:   end   instanceof Date ? end   : null
          };
          const rel = await ReliabilityService.mergeDataPorVeiculo({
            vehicleId: veh,
            range: relRange,
            showAllOS: osFilter.showAll,
            allowedOsTypes: osFilter.allowed,
            osList: (useUnifiedReliability && unifiedOsMap) ? (unifiedOsMap.get(veh) || []) : null,
            settings: reliabilitySettings
          });
          if (rel && rel.metrics) {
            Object.assign(mergedPayload, rel.metrics);
          }
        }
      } catch (err) {
        try { console.warn('[OSDialog.open] Reliability metrics unavailable', err); } catch (_) {}
      }
      if (unifiedSummary) {
        Object.assign(mergedPayload, unifiedSummary);
      }
      if (mergedPayload.kmPorQuebraFmt && !mergedPayload.kmPerFailureFmt) {
        mergedPayload.kmPerFailureFmt = mergedPayload.kmPorQuebraFmt;
      }
      if (mergedPayload.hrPorQuebraFmt && !mergedPayload.hrPerFailureFmt) {
        mergedPayload.hrPerFailureFmt = mergedPayload.hrPorQuebraFmt;
      }
      if (mergedPayload.downtimeFmt && !mergedPayload.downtimeTotalFmt) {
        mergedPayload.downtimeTotalFmt = mergedPayload.downtimeFmt;
      }
      combinedMetrics = Object.assign(combinedMetrics, mergedPayload);
      st.dlgModel.setProperty('/metrics', combinedMetrics);
      st.dlgModel.refresh(true);

      const name = 'com.skysinc.frota.frota.fragments.OSDialog'; const id = view.getId();
      let loaded = st.dialogRef; if (!loaded) loaded = await Fragment.load({ name, id, controller: st.fragController });
      let dlg = Array.isArray(loaded) ? (loaded.find && loaded.find(c=>c && c.isA && c.isA('sap.m.Dialog'))) || loaded[0] : loaded;
      st.dialogRef = dlg; if (dlg && dlg.addDependent) view.addDependent(dlg); if (dlg && dlg.setModel) dlg.setModel(st.dlgModel, 'osDlg'); else throw new TypeError('OSDialog fragment did not resolve to a Dialog control');
      // aplica filtro de tipos permitido conforme settings (se existir)
      if (!osFilter.showAll && osFilter.allowedSet.size){
        const arr = st.dlgModel.getProperty('/_base') || [];
        const filteredArr = arr.filter((o)=> !o.categoria || osFilter.allowedSet.has(String(o.categoria||'').toUpperCase()));
        const baseCopy = filteredArr.slice();
        const osCopy = filteredArr.slice();
        st.dlgModel.setProperty('/_base', baseCopy);
        st.dlgModel.setProperty('/os', osCopy);
        _updateTotals(st.dlgModel, osCopy);
        try {
          const mxLive = filteredArr.length ? filteredArr.reduce((m,o)=>Math.max(m, (Number(o._overlapMinutes)||0)/60), 0) : 0;
          st.dlgModel.setProperty('/__stats', { max: mxLive });
        } catch(_) {
          st.dlgModel.setProperty('/__stats', { max: 0 });
        }
      }
      dlg.open();
      return dlg;
    } catch(e){ try{ console.error('[OSDialog.open] Falha ao abrir OS', e);}catch(_){} MessageToast.show('Falha ao abrir OS.'); }
  }
  return { open };
});




