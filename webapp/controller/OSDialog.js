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

  function _ensure(view) {
    const vid = view.getId();
    if (_byViewId.has(vid)) return _byViewId.get(vid);

    const dlgModel = new JSONModel({
      titulo: "OS",
      os: [],
      _base: [],
      total: 0,
      page: { index: 1, size: 200, hasPrev: false, hasNext: false, pageText: "Pǭgina 1" }
    });
    let dialogRef = null;
    // Estado de pagina��ǜo
    let pageIndex = 0; // 0-based
    let limit = 200;
    let cursors = [ null ]; // cada item: { date, id } usado como startAfter
    let lastCursor = null;  // cursor retornado da pǭgina atual

    function toLoc(val){ try { return val ? new Date(val).toLocaleString() : ""; } catch(_) { return String(val||""); } }
    function hoursBetween(a,b){ try { const A = a ? new Date(a).getTime() : 0; const B = b ? new Date(b).getTime() : 0; return (A && B && B>A) ? (B-A)/36e5 : 0; } catch(_) { return 0; } }

    const fragController = {
      formatter: formatter,

      onCloseOS: function () { dialogRef && dialogRef.close(); },

      onLiveSearch: function (ev) {
        const q = (ev?.getParameter?.("newValue") || ev?.getParameter?.("query") || "").toString().toLowerCase();
        const data = dlgModel.getData() || {};
        const base = Array.isArray(data._base) ? data._base : (data.os || []);
        if (!q) { dlgModel.setProperty("/os", base); dlgModel.setProperty("/total", base.length); return; }
        const filtered = base.filter((it) => {
          const s1 = (it.veiculo||"").toString().toLowerCase();
          const s2 = (it.ordem||"").toString().toLowerCase();
          const s3 = (it.titulo||"").toString().toLowerCase();
          return s1.includes(q) || s2.includes(q) || s3.includes(q);
        });
        dlgModel.setProperty("/os", filtered);
        dlgModel.setProperty("/total", filtered.length);
      },

      onExportOS: function () {
        const data = dlgModel.getData() || {};
        const rows = (data.os || []).map((o) => ({
          Veiculo: o.veiculo || "",
          Ordem: o.ordem || "",
          Titulo: o.titulo || "",
          Inicio: o.inicio || "",
          Fim: o.fim || "",
          Parada: o.parada ? "Sim" : "Nǜo",
          Inatividade_h: String(o.downtimeFmt || ""),
          TipoManual: o.tipoManual || ""
        }));
        if (!rows.length) { MessageToast.show("Sem OS no filtro atual."); return; }

        const headers = Object.keys(rows[0]);
        const esc = (v) => {
          if (v == null) return "";
          if (typeof v === "number") return v.toString();
          let s = String(v);
          if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
          return s;
        };
        const lines = [headers.join(";")];
        rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(";")));
        const csv = "\uFEFF" + lines.join("\n");

        const nome = "os_lista.csv";
        try {
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = nome;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          MessageToast.show("CSV gerado com sucesso.");
        } catch (e) {
          console.error("[OSDialog.onExportOS] Falha ao gerar CSV", e);
          MessageBox.error("Nǜo foi poss��vel gerar o CSV.");
        }
      },

      onCloseSelectedOS: async function () {
        try {
          const tbl = view.byId("tblOSGrid");
          const idxs = tbl?.getSelectedIndices?.() || [];
          if (!idxs.length) { MessageToast.show("Selecione ao menos uma OS."); return; }

          const data = dlgModel.getData() || {};
          const list = data.os || [];
          const sel = idxs.map(i => list[i]).filter(Boolean);
          if (!sel.length) { MessageToast.show("Sele��ǜo vazia."); return; }

          const nowIso = new Date().toISOString();
          const fb = await FirebaseFS.getFirebase();

          const updates = sel.map(async (o) => {
            if (!o._id) return { ok: false, reason: "no-id" };
            const dref = fb.doc(fb.db, "ordensServico", o._id);
            try {
              await fb.updateDoc(dref, { DataFechamento: nowIso });
              o.fim = toLoc(nowIso);
              o.downtime = hoursBetween(o._abertura, nowIso);
              o.downtimeFmt = (o.downtime || 0).toFixed(2);
              o.parada = (o.downtime || 0) > 0;
              return { ok: true };
            } catch (e) {
              return { ok: false, reason: e && (e.code || e.message) };
            }
          });
          const results = await Promise.all(updates);
          const ok = results.filter(r => r.ok).length;
          dlgModel.refresh(true);
          MessageToast.show(ok + " OS conclu��da(s).");
        } catch (e) {
          console.error("[OSDialog.onCloseSelectedOS] Erro ao concluir OS selecionadas", e);
          MessageBox.error("Falha ao concluir OS selecionadas.");
        }
      },

      onSetTypeSelectedOS: function () {
        const tbl = view.byId("tblOSGrid");
        const idxs = tbl?.getSelectedIndices?.() || [];
        if (!idxs.length) { MessageToast.show("Selecione ao menos uma OS."); return; }

        const dlg = new sap.m.Dialog({ title: "Definir tipo (manual)", contentWidth: "20rem" });
        const inp = new sap.m.Input({ placeholder: "Ex.: Preventiva/Corretiva/Outro" });
        dlg.addContent(inp);
        dlg.addButton(new sap.m.Button({ text: "Cancelar", press: () => dlg.close() }));
        dlg.addButton(new sap.m.Button({ text: "Aplicar", type: "Emphasized", press: async () => {
          const val = (inp.getValue() || "").trim();
          if (!val) { MessageToast.show("Informe um tipo."); return; }
          try {
            const data = dlgModel.getData() || {};
            const list = data.os || [];
            const sel = idxs.map(i => list[i]).filter(Boolean);
            const fb = await FirebaseFS.getFirebase();
            const updates = sel.map(async (o) => {
              if (!o._id) return { ok:false };
              const dref = fb.doc(fb.db, "ordensServico", o._id);
              try {
                await fb.updateDoc(dref, { TipoManual: val });
                o.tipoManual = val;
                return { ok:true };
              } catch (e) { return { ok:false, reason: e && (e.code || e.message) }; }
            });
            const res = await Promise.all(updates);
            const ok = res.filter(r=>r.ok).length;
            dlgModel.refresh(true);
            MessageToast.show(ok + " OS atualizada(s).");
          } catch (e) {
            console.error("[OSDialog.onSetTypeSelectedOS] Erro ao atualizar tipo manual", e);
            MessageBox.error("Falha ao atualizar tipo.");
          } finally {
            dlg.close();
          }
        }}));
        dlg.attachAfterClose(() => dlg.destroy());
        view.addDependent(dlg);
        dlg.open();
      },

      onNextPage: async function () {
        const data = dlgModel.getData() || {};
        const meta = data.__meta || {};
        let veh = meta.equnr;
        let start = meta.start;
        let end = meta.end;
        if (!veh) { veh = (data.os && data.os.length) ? String(data.os[0].veiculo || "") : ""; }
        if (!(start instanceof Date)) { end = new Date(); start = new Date(); start.setDate(end.getDate()-60); }
        dlgModel.setProperty('/__meta', { equnr: veh, start, end });
        if (!veh || !lastCursor) return;
        try {
          pageIndex += 1;
          cursors[pageIndex] = lastCursor;
          await _loadPage(veh, start, end, cursors[pageIndex]);
        } catch (e) { 
          console.error("[OSDialog.onNextPage] Falha ao paginar (next)", { error: e, veh, start, end, pageIndex, lastCursor });
          MessageToast.show("Falha ao paginar."); 
        }
      },

      onPrevPage: async function () {
        const data = dlgModel.getData() || {};
        const meta = data.__meta || {};
        let veh = meta.equnr;
        let start = meta.start;
        let end = meta.end;
        if (!veh) { veh = (data.os && data.os.length) ? String(data.os[0].veiculo || "") : ""; }
        if (!(start instanceof Date)) { end = new Date(); start = new Date(); start.setDate(end.getDate()-60); }
        dlgModel.setProperty('/__meta', { equnr: veh, start, end });
        if (!veh || pageIndex === 0) return;
        try {
          pageIndex -= 1;
          const cursor = cursors[pageIndex] || null;
          await _loadPage(veh, start, end, cursor);
        } catch (e) { 
          console.error("[OSDialog.onPrevPage] Falha ao paginar (prev)", { error: e, veh, start, end, pageIndex });
          MessageToast.show("Falha ao paginar."); 
        }
      }
    };

    const state = { dlgModel, fragController, get dialogRef() { return dialogRef; }, set dialogRef(v) { dialogRef = v; }, view };
    _byViewId.set(vid, state);
    return state;
  }

  function _applyFilter(base, payload) {
    const arr = Array.isArray(base) ? base.slice() : [];
    if (!payload) return arr;

    const veh = (payload.equnr || payload.veiculo || payload.vehicle || "").toString();
    const range = payload.range || payload.periodo || null;
    let d1 = null, d2 = null;
    if (Array.isArray(range)) { d1 = range[0]; d2 = range[1]; }
    else if (range && (range.from || range.to)) { d1 = range.from; d2 = range.to || range.from; }

    return arr.filter((o) => {
      const byVeh = veh ? String(o.Equipamento || o.veiculo || "") === veh : true;
      if (!byVeh) return false;
      if (d1 instanceof Date) {
        const S = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 0, 0, 0, 0).getTime();
        const E = (d2 instanceof Date ? new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23, 59, 59, 999) : new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 23,59,59,999)).getTime();
        const openTs = o.DataAbertura ? new Date(o.DataAbertura).getTime() : 0;
        const closeTs = o.DataFechamento ? new Date(o.DataFechamento).getTime() : 0;
        const anyTs = openTs || closeTs;
        if (!anyTs) return false;
        return anyTs >= S && anyTs <= E;
      }
      return true;
    });
  }

  function _mapToView(list) {
    return (list || []).map(function (o) {
      const downtime = hoursBetween(o.DataAbertura, o.DataFechamento);
      return {
        _id: String(o._id || ""),
        ordem: String(o.NumeroOS || ""),
        veiculo: String(o.Equipamento || ""),
        titulo: String(o.Descricao || ""),
        inicio: toLoc(o.DataAbertura),
        fim: toLoc(o.DataFechamento),
        _abertura: o.DataAbertura || null,
        _fechamento: o.DataFechamento || null,
        parada: downtime > 0,
        downtime: downtime,
        downtimeFmt: (Number(downtime) || 0).toFixed(2),
        tipoManual: String(o.TipoManual || "")
      };
    }).sort(function(a,b){
      if (a.veiculo === b.veiculo) {
        return String(a.ordem).localeCompare(String(b.ordem));
      }
      return String(a.veiculo).localeCompare(String(b.veiculo));
    });
  }

  async function open(view, payload) {
    const st = _ensure(view);
    try {
      const veh = String(payload?.equnr || payload?.veiculo || "").trim();
      const range = payload?.range || null;
      const start = Array.isArray(range) ? range[0] : (range?.from || null);
      const end   = Array.isArray(range) ? range[1] : (range?.to   || null);

      if (!veh) { MessageToast.show("Selecione um ve��culo para listar as OS."); return; }

      const list = await FirebaseFS.listOrdersByVehicleAndRange({ equnr: veh, start, end, limit: 200 });
      const mapped = _mapToView(list);
      st.dlgModel.setData({
        titulo: payload?.titulo || ("Ordens de Servi��o" + (veh ? (" - " + veh) : "")),
        os: mapped,
        _base: mapped.slice(),
        total: mapped.length
      });

      const name = "com.skysinc.frota.frota.fragments.OSDialog";
      const id   = view.getId();
      const load = st.dialogRef
        ? Promise.resolve(st.dialogRef)
        : Fragment.load({ name, id, controller: st.fragController }).then(function (dlg) {
            st.dialogRef = dlg;
            view.addDependent(dlg);
            dlg.setModel(st.dlgModel, "osDlg");
            return dlg;
          });

      const dlg = await load;
      dlg.setModel(st.dlgModel, "osDlg");
      dlg.open();
      return dlg;
    } catch (e) {
      try {
        const vehDbg = String((payload && (payload.equnr || payload.veiculo)) || "").trim();
        const rangeDbg = payload && (payload.range || null);
        const startDbg = Array.isArray(rangeDbg) ? rangeDbg[0] : (rangeDbg && rangeDbg.from || null);
        const endDbg   = Array.isArray(rangeDbg) ? rangeDbg[1] : (rangeDbg && rangeDbg.to   || null);
        console.error("[OSDialog.open] Falha ao abrir OS", { error: e, veh: vehDbg, start: startDbg, end: endDbg, payload });
      } catch (logErr) {
        console.error("[OSDialog.open] Falha ao abrir OS (log)", e);
      }
      MessageToast.show("Falha ao abrir OS.");
    }
  }

  async function _loadPage(veh, start, end, after) {
    try {
      const res = await FirebaseFS.listOrdersByVehicleAndRangePage({ equnr: veh, start, end, limit, after });
      const mapped = _mapToView(res.items);
      lastCursor = res.last || null;
      const hasNext = !!(lastCursor && mapped.length >= limit);
      const hasPrev = pageIndex > 0;
      const pageText = "Pǭgina " + String(pageIndex + 1);
      dlgModel.setProperty("/os", mapped);
      dlgModel.setProperty("/_base", mapped.slice());
      dlgModel.setProperty("/total", mapped.length);
      dlgModel.setProperty("/page", { index: pageIndex + 1, size: limit, hasPrev, hasNext, pageText });
    } catch (e) {
      console.error("[OSDialog._loadPage] Erro ao carregar página", { error: e, veh, start, end, after, pageIndex, limit });
      throw e;
    }
  }

  return { open };
});
