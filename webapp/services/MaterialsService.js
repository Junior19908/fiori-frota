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

  async function openDialog(oView, oVehicleObj, range) {
    const comp = oView.getController().getOwnerComponent();
    const [start, end] = range || [];
    const equnr = oVehicleObj.id || oVehicleObj.veiculo;

    const materiais = await ODataMaterials.loadMaterials(comp, {
      equnr,
      startDate: start || new Date(),
      endDate: end   || new Date()
    });

    return MaterialsCtl.open(oView, {
      titulo: `Materiais — ${oVehicleObj.veiculo || ""} — ${oVehicleObj.descricao || ""}`,
      veiculo: oVehicleObj.veiculo || "",
      descricaoVeiculo: oVehicleObj.descricao || "",
      materiais
    });
  }

  function exportCsv(dlgModel, oDateRangeSelection) {
    if (!dlgModel) { MessageToast.show("Abra o diálogo de materiais primeiro."); return; }
    const data = dlgModel.getData() || {};
    const rows = (data.materiais || []).map((m) => {
      const qtde  = Number(m.qtde || 0);
      const custo = Number(m.custoUnit || 0);
      const total = qtde * custo;
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
        Id_Evento: m.idEvento || "",
        Recebedor: m.recebedor || "",
        Unid: m.unid || "",
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
