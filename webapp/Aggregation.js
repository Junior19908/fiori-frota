sap.ui.define([
  "com/skysinc/frota/frota/util/FilterUtil"
], function (FilterUtil) {
  "use strict";

  function sumDeltasFromAbastecimentos(abastecList) {
    if (!Array.isArray(abastecList) || abastecList.length < 2) return { km: 0, hr: 0 };
    const toTime = (ev) => {
      const d = FilterUtil.parseAnyDate(ev.data) || new Date(0,0,1);
      if (ev.hora && /^\d{2}:\d{2}:\d{2}$/.test(String(ev.hora))) {
        const [H,M,S] = ev.hora.split(":").map(Number);
        d.setHours(H||0, M||0, S||0, 0);
      }
      return d.getTime();
    };
    const list = abastecList.slice().sort((a,b) => toTime(a)-toTime(b));

    const toNum = (v) => {
      if (v == null) return NaN;
      if (typeof v === "number") return v;
      const s = String(v).replace(/\s|Km/gi, "").replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return isNaN(n) ? NaN : n;
    };

    let totalKm = 0, totalHr = 0;
    for (let i = 1; i < list.length; i++) {
      const ant = list[i-1], cur = list[i];
      const kmAnt = toNum(ant.km), kmCur = toNum(cur.km);
      const hrAnt = toNum(ant.hr), hrCur = toNum(cur.hr);

      const dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : 0;
      const dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : 0;

      if (dKm > 0) totalKm += dKm;
      if (dHr > 0) totalHr += dHr;
    }
    return { km: totalKm, hr: totalHr };
  }

  // >>> ALTERAÇÃO PRINCIPAL: trabalhar sobre o MODEL "vm"
  function recalcAggByRange(oView, range) {
    const vm       = oView.getModel("vm");           // <— vm
    const matModel = oView.getModel("materiais");
    const abModel  = oView.getModel("abast");
    if (!vm) return;

    const vlist = vm.getProperty("/veiculos") || [];

    vlist.forEach((v) => {
      const key = v.id || v.veiculo || v.equnr;      // garantir a chave

      const materiais = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || v.materiais || [];
      const abastec   = (abModel  && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || v.abastecimentos || [];

      let matsInRange = materiais;
      let abInRange   = abastec;

      if (range) {
        const [start, end] = range;
        const parseDateTime = (obj) => {
          const d = FilterUtil.parseAnyDate(obj.data);
          if (!d) return null;
          if (obj.horaEntrada && /^\d{2}:\d{2}:\d{2}$/.test(String(obj.horaEntrada))) {
            const p = obj.horaEntrada.split(":").map(Number);
            d.setHours(p[0] || 0, p[1] || 0, p[2] || 0, 0);
          } else {
            d.setHours(23, 59, 59, 999);
          }
          return d;
        };

        matsInRange = materiais.filter((m) => {
          const dt = parseDateTime(m);
          return dt && dt >= start && dt <= end;
        });

        abInRange = abastec.filter((a) => {
          const d = FilterUtil.parseAnyDate(a.data);
          return d && d >= start && d <= end;
        });
      }

      const custoMatAgg = matsInRange.reduce((s, m) =>
        s + (Number(m.qtde || 0) * Number(m.custoUnit || 0)), 0);

      let litrosAgg = 0, valorAgg = 0;
      abInRange.forEach((ev) => {
        const litros = FilterUtil.numBR(ev.litros);
        litrosAgg += litros;

        const valorTotal = FilterUtil.numBR(ev.valor);
        if (valorTotal > 0) valorAgg += valorTotal;
        else {
          const preco = FilterUtil.numBR(ev.preco ?? ev.precoLitro ?? ev.preco_litro ?? ev.precoUnit ?? ev.preco_unit ?? ev.precoUnitario);
          valorAgg += preco * litros;
        }
      });

      const deltas = sumDeltasFromAbastecimentos(abInRange);

      const maxTs = Math.max(
        ...matsInRange.map((m) => (FilterUtil.parseAnyDate(m && m.data) || {getTime:()=>-Infinity}).getTime()),
        ...abInRange.map((a) => (FilterUtil.parseAnyDate(a && a.data) || {getTime:()=>-Infinity}).getTime())
      );

      let dataRef = null;
      if (isFinite(maxTs) && maxTs > -Infinity) {
        const dref = new Date(maxTs);
        const mm = String(dref.getMonth()+1).padStart(2, "0");
        const dd = String(dref.getDate()).padStart(2, "0");
        dataRef = `${dref.getFullYear()}-${mm}-${dd}`;
      }

      // grava diretamente nas linhas do VM
      v.custoMaterialAgg       = custoMatAgg || 0;
      v.combustivelLitrosAgg   = litrosAgg   || 0;
      v.combustivelValorAgg    = valorAgg    || 0;
      v.kmRodadosAgg           = deltas.km   || 0;
      v.hrRodadosAgg           = deltas.hr   || 0;
      v.dataRef                = dataRef;
      v.rangeHasMateriais      = matsInRange.length > 0;
      v.rangeHasAbastec        = abInRange.length > 0;
      v.rangeHasActivity       = v.rangeHasMateriais || v.rangeHasAbastec;

      v.custoTotalAgg   = (v.custoMaterialAgg || 0) + (v.combustivelValorAgg || 0);
      v.funcaokmcomb    = (v.combustivelLitrosAgg ? (v.kmRodadosAgg / v.combustivelLitrosAgg) : 0);
      v.funcaohrRodados = (v.hrRodadosAgg ? (v.combustivelLitrosAgg / v.hrRodadosAgg) : 0);
    });

    vm.setProperty("/veiculos", vlist);              // <— escrever de volta no VM
  }

  return { sumDeltasFromAbastecimentos, recalcAggByRange };
});
