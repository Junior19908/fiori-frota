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

  async function openDialog(oView, oVehicleObj, range) {
    console.group("[MaterialsService.openDialog]");
    try {
      const comp = oView.getController().getOwnerComponent();
      const [start, end] = range || [];
      const rawEqunr = oVehicleObj.equnr || oVehicleObj.veiculo || oVehicleObj.id;
      const equnr = padEqunr(rawEqunr);

      console.table({
        equnrSelecionado: equnr,
        origemEqunr: rawEqunr,
        desc: oVehicleObj.eqktx || oVehicleObj.descricao || "",
        start: start ? start.toISOString() : "(null)",
        end:   end   ? end.toISOString()   : "(null)"
      });

      // Chama OData com equnr 18 chars + intervalo
      const materiais = await ODataMaterials.loadMaterials(comp, {
        equnr,
        startDate: start || new Date(),
        endDate: end || start || new Date()
      });

      const totalItens = materiais.length;
      const totalValor = materiais.reduce((acc, m) => acc + (Number(m.qtde||0) * Number(m.custoUnit||0)), 0);

      const dlg = await MaterialsCtl.open(oView, {
        titulo: `Materiais — ${equnr}${oVehicleObj.eqktx ? " • " + oVehicleObj.eqktx : (oVehicleObj.descricao ? " • " + oVehicleObj.descricao : "")}`,
        veiculo: equnr,
        descricaoVeiculo: oVehicleObj.eqktx || oVehicleObj.descricao || "",
        materiais,
        totalItens,
        totalValor
      });

      // guarda p/ export/print
      const dlgModel = dlg.getModel("dlg");
      oView.getController()._dlgModel = dlgModel;

      console.groupEnd();
      return dlg;
    } catch (err) {
      console.error("[MaterialsService.openDialog][ERR]", err);
      MessageToast.show("Falha ao abrir materiais.");
      console.groupEnd();
    }
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
