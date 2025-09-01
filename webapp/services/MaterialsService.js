sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "com/skysinc/frota/frota/util/formatter",
  "com/skysinc/frota/frota/util/CsvUtil",
  "com/skysinc/frota/frota/util/FilterUtil",
  "com/skysinc/frota/frota/controller/Materials",
  "com/skysinc/frota/frota/services/ODataMaterials"
], function (JSONModel, MessageToast, formatter, CsvUtil, FilterUtil, MaterialsCtl, ODataMaterials) {
  "use strict";

  function padEqunr(e) {
    const digits = String(e || "").replace(/\D/g, "");
    return digits.padStart(18, "0");
  }

  function getDesc(vehicle) {
    return String(
      vehicle?.descricaoVeiculo ??
      vehicle?.eqktx ??
      vehicle?.descricao ??
      vehicle?.desc ??
      ""
    );
  }

  function normalizeRangeLocal(range) {
    const s = Array.isArray(range) ? range[0] : range?.from;
    const e = Array.isArray(range) ? range[1] : range?.to;
    const start = s instanceof Date
      ? new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0)
      : new Date();
    const end = e instanceof Date
      ? new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999)
      : new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
    return [start, end];
  }

  function toABAPLocal(d, endOfDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const t = endOfDay ? "23:59:59" : "00:00:00";
    return `${y}-${m}-${day}T${t}`;
  }

  function pad2(n){ return String(n).padStart(2,"0"); }

  function ymdFromAny(input) {
    if (!input) return "";
    if (input instanceof Date) {
      const y = input.getUTCFullYear();
      const m = pad2(input.getUTCMonth() + 1);
      const d = pad2(input.getUTCDate());
      return `${y}-${m}-${d}`;
    }
    const s = String(input);
    if (/Z$|[+\-]\d{2}:\d{2}$/.test(s)) {
      const d = new Date(s);
      if (isNaN(d)) return "";
      const y = d.getUTCFullYear();
      const m = pad2(d.getUTCMonth() + 1);
      const day = pad2(d.getUTCDate());
      return `${y}-${m}-${day}`;
    }
    const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
    return "";
  }

  function brFromYmd(ymd) {
    if (!ymd) return "";
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return ymd;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  async function openDialog(oView, oVehicleObj, range) {
    try {
      const comp = oView.getController().getOwnerComponent();
      const rawEqunr = oVehicleObj.equnr || oVehicleObj.veiculo || oVehicleObj.id;
      const equnr = padEqunr(rawEqunr);
      const desc = getDesc(oVehicleObj);
      const [start, end] = normalizeRangeLocal(range);

      const materiais = await ODataMaterials.loadMaterials(comp, {
        equnr,
        startDate: start,
        endDate: end,
        abapStart: toABAPLocal(start, false),
        abapEnd:   toABAPLocal(end, true)
      });

      const totalItens = materiais.length;
      const totalValor = materiais.reduce((acc, m) => acc + (Number(m.qtde||0) * Number(m.custoUnit||0)), 0);
      const titulo = `Materiais — ${equnr}${desc ? " — " + desc : ""}`;

      const dlg = await MaterialsCtl.open(oView, {
        titulo,
        veiculo: equnr,
        descricaoVeiculo: desc,
        materiais,
        totalItens,
        totalValor
      });

      const dlgModel = dlg.getModel("dlg");
      oView.getController()._dlgModel = dlgModel;
      return dlg;
    } catch (err) {
      MessageToast.show("Falha ao abrir materiais.");
    }
  }

  function exportCsv(dlgModel, oDateRangeSelection) {
    if (!dlgModel) { MessageToast.show("Abra o diálogo de materiais primeiro."); return; }
    const data = dlgModel.getData() || {};
    const rows = (data.materiais || []).map((m) => {
      const qtde  = Number(m.qtde || 0);
      const custo = Number(m.custoUnit || 0);
      const total = qtde * custo;

      const ymd = ymdFromAny(m.data || m.budat_mkpf || m.DATA || "");
      const dataBr = brFromYmd(ymd);

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
        Hora: formatter.fmtHora(m.horaEntrada || m.hora || ""),
        Data: dataBr || formatter.fmtDate(m.data || m.budat_mkpf || ""),
        N_Ordem: m.nOrdem || m.nrOrdem || "",
        N_Reserva: m.nReserva || m.nrReserva || "",
        Id_Evento: m.idEvento || "",
        Recebedor: m.recebedor || "",
        Unid: m.unid || m.meins || "",
        Usuario: m.usuario || "",
        Status: (formatter.isDevolucao && formatter.isDevolucao(m.qtde)) ? "DEVOLUÇÃO" : ""
      };
    });

    if (!rows.length) { MessageToast.show("Sem materiais no período selecionado."); return; }

    const d1 = oDateRangeSelection?.getDateValue();
    const d2 = oDateRangeSelection?.getSecondDateValue();
    const name = `materiais_${data.veiculo || "veiculo"}_${d1 ? FilterUtil.ymd(d1) : "inicio"}_${d2 ? FilterUtil.ymd(d2) : "fim"}.csv`;

    const csv = CsvUtil.buildCsv(rows);
    CsvUtil.downloadCsv(csv, name);
  }

  return { openDialog, exportCsv };
});
