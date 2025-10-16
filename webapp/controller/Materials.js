sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "com/skysinc/frota/frota/util/formatter",
  "sap/ui/model/Sorter"
], function (JSONModel, Fragment, baseFormatter, Sorter) {
  "use strict";

  const formatter = Object.assign({}, baseFormatter, {
    getTipoText: function (tipo) {
      const t = String(tipo || "").toUpperCase();
      if (t === "SERVICO" || t === "SERVIÃ‡O") return "ServiÃ§o";
      if (t === "PECA" || t === "PEÃ‡A") return "PeÃ§a";
      return t || "â€”";
    },
    getTipoClass: function (tipo) {
      const t = String(tipo || "").toUpperCase();
      if (t === "SERVICO" || t === "SERVIÃ‡O") return "tipo-servico";
      if (t === "PECA" || t === "PEÃ‡A") return "tipo-peca";
      return "";
    },
    isDevolucao: function (qtde) {
      return Number(qtde || 0) < 0;
    }
  });

  const _byViewId = new Map();

  function _ensure(view) {
    const vid = view.getId();
    if (_byViewId.has(vid)) return _byViewId.get(vid);

    const dlgModel = new JSONModel();
    let dialogRef = null;

    // Comparadores (ainda Ãºteis se quiser acionar sort programÃ¡tico)
    const cmpNum = (a, b) => (Number(a) || 0) - (Number(b) || 0);
    const cmpStr = (a, b) => {
      const sa = (a ?? "").toString().toLowerCase();
      const sb = (b ?? "").toString().toLowerCase();
      return sa.localeCompare(sb);
    };
    const cmpHora = (a, b) => {
      const norm = (v) => String(v || "").replace(/[^0-9]/g, "");
      return (Number(norm(a)) || 0) - (Number(norm(b)) || 0);
    };
    const cmpData = (a, b) => {
      const toNumDate = (v) => {
        if (!v) return 0;
        const ts = Date.parse(v);
        if (!isNaN(ts)) return ts;
        const s = String(v).replace(/[^0-9]/g, "");
        if (s.length === 8) {
          const maybeYear = Number(s.slice(0, 4));
          if (maybeYear > 1900) return Number(s); // AAAAMMDD
          const dd = s.slice(0, 2), mm = s.slice(2, 4), yyyy = s.slice(4);
          return Number(`${yyyy}${mm}${dd}`);
        }
        return 0;
      };
      return toNumDate(a) - toNumDate(b);
    };

    const fragController = {
      formatter: formatter,

      onCloseMateriais: function () {
        dialogRef && dialogRef.close();
      },

      // (opcional) ainda pode manter ordenaÃ§Ã£o programÃ¡tica se quiser
      onOpenSortMateriais: function () {
        const vsd = view.byId("vsdMateriais");
        if (vsd) vsd.open();
      },

      onConfirmSortMateriais: function (oEvent) {
        const oTable = view.byId("tblMatGrid"); // sap.ui.table.Table
        const oBinding = oTable && oTable.getBinding("rows");
        if (!oBinding) return;

        const p = oEvent.getParameters ? oEvent.getParameters() : {};
        const sKey = p.sortItem && p.sortItem.getKey();
        const bDesc = !!p.sortDescending;

        const aSorters = [];
        if (sKey === "__total__" || sKey === "totalItem") {
          aSorters.push(new Sorter("totalItem", bDesc, false, cmpNum));
        } else if (["nOrdem","nReserva","codMaterial","qtde","custoUnit"].includes(sKey)) {
          aSorters.push(new Sorter(sKey, bDesc, false, cmpNum));
        } else if (sKey === "horaEntrada") {
          aSorters.push(new Sorter(sKey, bDesc, false, cmpHora));
        } else if (sKey === "budat_mkpf" || sKey === "data") {
          aSorters.push(new Sorter(sKey, bDesc, false, cmpData));
        } else {
          aSorters.push(new Sorter(sKey, bDesc, false, cmpStr));
        }
        oBinding.sort(aSorters);
      },

      onExportMateriais: function () {
        const data = dlgModel.getData() || {};
        const mats = Array.isArray(data.materiais) ? data.materiais.slice() : [];

        mats.sort((a, b) => {
          const da = new Date(a.data || 0).getTime();
          const db = new Date(b.data || 0).getTime();
          if (da !== db) return da - db;
          return String(a.idEvento || "").localeCompare(String(b.idEvento || ""));
        });

        const rows = mats.map(function (m) {
          const qtde  = Number(m.qtde || 0);
          const custo = Number(m.custoUnit || 0);
          const total = (m.totalItem != null) ? Number(m.totalItem) : (qtde * custo);
          return {
            Veiculo: data.veiculo || "",
            DescricaoVeiculo: data.descricaoVeiculo || "",
            Item: m.nome || m.material || m.descricao || "",
            Tipo: m.tipo || "",
            Quantidade: qtde,
            CustoUnitario: custo,
            TotalItem: total,
            CodMaterial: m.codMaterial || "",
            Deposito: m.deposito || "",
            Hora: formatter.fmtHora(m.horaEntrada || ""),
            Data: formatter.fmtDate(m.data || ""),
            N_Ordem: m.nOrdem || "",
            N_Reserva: m.nReserva || "",
            Recebedor: m.recebedor || "",
            Unid: m.unid || "",
            Usuario: m.usuario || "",
            Status: (formatter.isDevolucao && formatter.isDevolucao(m.qtde)) ? "DEVOLUÃ‡ÃƒO" : ""
          };
        });

        if (!rows.length) {
          sap.m.MessageToast.show("Sem materiais no perÃ­odo selecionado.");
          return;
        }

        const esc = (v) => {
          if (v == null) return "";
          if (typeof v === "number") {
            return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
          let s = String(v);
          if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
          return s;
        };

        const headers = Object.keys(rows[0]);
        const lines = [headers.join(";")];
        rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(";")));
        const csv = "\uFEFF" + lines.join("\n");

        const nome = "materiais_" + (data.veiculo || "veiculo") + ".csv";

        try {
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = nome;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          sap.m.MessageToast.show("CSV gerado com sucesso.");
        } catch (e) {
          sap.m.MessageBox.error("NÃ£o foi possÃ­vel gerar o CSV. Verifique permissÃµes do navegador.");
        }
      },

      onPrintMateriais: function () {
        if (!dialogRef) { sap.m.MessageToast.show("Abra o diÃ¡logo primeiro."); return; }
        const win = window.open("", "_blank", "noopener,noreferrer");
        if (!win) { sap.m.MessageBox.warning("Bloqueador de pop-up? Permita para imprimir."); return; }

        const title = (dlgModel.getProperty("/titulo")) || "Materiais";
        const contentDom = dialogRef.getAggregation("content")[0]?.getDomRef()?.cloneNode(true);

        win.document.write("<html><head><meta charset='utf-8'><title>" + title + "</title>");
        win.document.write("<style>body{font-family:Arial,Helvetica,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;font-size:12px} th{background:#f5f5f5} h1{font-size:18px;margin:0 0 12px}</style>");
        win.document.write("</head><body><h1>" + title + "</h1>");
        if (contentDom) {
          const toolbars = contentDom.querySelectorAll(".sapMTB");
          toolbars.forEach(tb => tb.parentNode && tb.parentNode.removeChild(tb));
          win.document.body.appendChild(contentDom);
        }
        win.document.write("</body></html>");
        win.document.close();
        win.focus();
        win.print();
        win.close();
      }
    };

    const state = { dlgModel, fragController, get dialogRef() { return dialogRef; }, set dialogRef(v) { dialogRef = v; }, view };
    _byViewId.set(vid, state);
    return state;
  }

  function _calcTotals(matList) {
    const totalItens = matList.length;
    const totalQtd   = matList.reduce((s, m) => s + (Number(m.qtde) || 0), 0);
    const totalValor = matList.reduce((s, m) => s + ((Number(m.qtde) || 0) * (Number(m.custoUnit) || 0)), 0);
    return { totalItens, totalQtd, totalValor };
  }

  return {
    formatter: formatter,

    open: function (view, payload) {
      const st = _ensure(view);

      // >>> AQUI: inclui propriedade calculada totalItem para suportar sortProperty da coluna "Total (R$)"
      const base = Array.isArray(payload.materiais) ? payload.materiais : [];
      const mats = base.map(m => {
        const qt = Number(m.qtde || 0);
        const cu = Number(m.custoUnit || 0);
        return Object.assign({}, m, { totalItem: qt * cu });
      });

      const { totalItens, totalQtd, totalValor } = _calcTotals(mats);

      st.dlgModel.setData({
        titulo: payload.titulo || "Materiais",
        veiculo: payload.veiculo || "",
        descricaoVeiculo: payload.descricaoVeiculo || "",
        materiais: mats,
        totalItens, totalQtd, totalValor
      });

      const name = "com.skysinc.frota.frota.fragments.MaterialsDialog";
      const id   = view.getId();

      const load = st.dialogRef
        ? Promise.resolve(st.dialogRef)
        : Fragment.load({
            name,
            id,
            controller: st.fragController
          }).then(function (dlg) {
            st.dialogRef = dlg;
            view.addDependent(dlg);
            dlg.setModel(st.dlgModel, "dlg");
            return dlg;
          });

      return load.then(function (dlg) {
        dlg.setModel(st.dlgModel, "dlg");
        dlg.open();
        return dlg;
      });
    }
  };
});
