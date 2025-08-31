sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "com/skysinc/frota/frota/util/formatter"
], function (JSONModel, Fragment, baseFormatter) {
  "use strict";

  const formatter = Object.assign({}, baseFormatter, {
    getTipoText: function (tipo) {
      const t = String(tipo || "").toUpperCase();
      if (t === "SERVICO" || t === "SERVIÇO") return "Serviço";
      if (t === "PECA" || t === "PEÇA") return "Peça";
      return t || "—";
    },
    getTipoClass: function (tipo) {
      const t = String(tipo || "").toUpperCase();
      if (t === "SERVICO" || t === "SERVIÇO") return "tipo-servico";
      if (t === "PECA" || t === "PEÇA") return "tipo-peca";
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

    const fragController = {
      formatter: formatter,

      onCloseMateriais: function () {
        dialogRef && dialogRef.close();
      },

      onExportMateriais: function () {
        const data = dlgModel.getData() || {};
        const mats = Array.isArray(data.materiais) ? data.materiais.slice() : [];

        // (opcional) ordena por data e idEvento para saída consistente
        mats.sort((a,b) => {
          const da = new Date(a.data || 0).getTime();
          const db = new Date(b.data || 0).getTime();
          if (da !== db) return da - db;
          return String(a.idEvento||"").localeCompare(String(b.idEvento||""));
        });

        const rows = mats.map(function (m) {
          const qtde  = Number(m.qtde || 0);
          const custo = Number(m.custoUnit || 0);
          const total = qtde * custo;
          return {
            // ===== Id primeiro para destacar no Excel =====
            //Id_Evento: m.idEvento || "",

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
            Status: (formatter.isDevolucao && formatter.isDevolucao(m.qtde)) ? "DEVOLUÇÃO" : ""
          };
        });

        if (!rows.length) {
          sap.m.MessageToast.show("Sem materiais no período selecionado.");
          return;
        }

        const esc = (v) => {
          if (v == null) return "";
          if (typeof v === "number") {
            return v.toLocaleString("pt-BR",{ minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
          let s = String(v);
          if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g,'""') + '"';
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
          sap.m.MessageBox.error("Não foi possível gerar o CSV. Verifique permissões do navegador.");
        }
      },

      onPrintMateriais: function () {
        if (!dialogRef) { sap.m.MessageToast.show("Abra o diálogo primeiro."); return; }
        const win = window.open("", "_blank", "noopener,noreferrer");
        if (!win) { sap.m.MessageBox.warning("Bloqueador de pop-up? Permita para imprimir."); return; }

        const title = (dlgModel.getProperty("/titulo")) || "Materiais";
        const contentDom = dialogRef.getAggregation("content")[0]?.getDomRef()?.cloneNode(true);

        win.document.write("<html><head><meta charset='utf-8'><title>"+ title +"</title>");
        win.document.write("<style>body{font-family:Arial,Helvetica,sans-serif;padding:16px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px;font-size:12px} th{background:#f5f5f5} h1{font-size:18px;margin:0 0 12px}</style>");
        win.document.write("</head><body><h1>"+ title +"</h1>");
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

    const state = { dlgModel, fragController, get dialogRef(){return dialogRef;}, set dialogRef(v){dialogRef=v;}, view };
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

      const mats = Array.isArray(payload.materiais) ? payload.materiais : [];
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
