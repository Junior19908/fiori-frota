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
    /* eslint-disable no-console */
    console.group("[MaterialsService.openDialog]");
    try {
      const comp = oView.getController().getOwnerComponent();
      const [start, end] = range || [];
      const equnr = oVehicleObj.id || oVehicleObj.veiculo;

      console.info("Parâmetros recebidos:");
      console.table({
        equnr,
        veiculo: oVehicleObj.veiculo,
        descricao: oVehicleObj.descricao,
        start: start ? start.toISOString() : "(null)",
        end:   end   ? end.toISOString()   : "(null)"
      });

      // Chamada ao OData
      console.time("ODataMaterials.loadMaterials");
      const materiais = await ODataMaterials.loadMaterials(comp, {
        equnr,
        startDate: start || new Date(),
        endDate: end   || new Date()
      });
      console.timeEnd("ODataMaterials.loadMaterials");

      // === LOG de retorno ===
      const qtd = Array.isArray(materiais) ? materiais.length : 0;
      console.info("Retorno do OData (materiais):", qtd, "item(ns)");
      if (qtd) {
        console.table(materiais.slice(0, 5)); // preview
        console.debug("JSON completo dos materiais:", JSON.stringify(materiais, null, 2));
      } else {
        console.warn("Nenhum item retornado pelo OData para os filtros informados.");
      }

      // Calcula totais para o rodapé
      const totalItens = qtd;
      const totalValor = materiais.reduce((acc, m) => {
        const qtde = Number(m.qtde || 0);
        const custo = Number(m.custoUnit || 0);
        return acc + (qtde * custo);
      }, 0);

      // Abre o diálogo com o payload pronto
      const dlg = await MaterialsCtl.open(oView, {
        titulo: `Materiais — ${oVehicleObj.veiculo || ""} — ${oVehicleObj.descricao || ""}`,
        veiculo: oVehicleObj.veiculo || "",
        descricaoVeiculo: oVehicleObj.descricao || "",
        materiais,
        totalItens,
        totalValor
      });

      // Guarda referência do model do diálogo (útil para export/print no Main.controller)
      const dlgModel = dlg.getModel("dlg");
      if (oView.getController()) {
        oView.getController()._dlgModel = dlgModel;
      }

      return dlg;
    } catch (err) {
      console.error("[MaterialsService.openDialog][ERR]", err);
      MessageToast.show("Falha ao abrir materiais.");
    } finally {
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
