sap.ui.define([
  "com/skysinc/frota/frota/util/FilterUtil"
], function (FilterUtil) {
  "use strict";

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const MS_PER_HOUR = 60 * 60 * 1000;
  const HORA_REGEX = /^\d{2}:\d{2}:\d{2}$/;
  // Penalidade por evento (em horas). Cada evento de downtime acrescentará esta quantidade
  // ao tempo de indisponibilidade ao calcular a disponibilidade. Ajuste conforme necessidade.
  const EVENT_PENALTY_HOURS = 1; // 1 hora por evento (padrão)
  const EVENT_PENALTY_MS = EVENT_PENALTY_HOURS * MS_PER_HOUR;

  function sumDeltasFromAbastecimentos(abastecList) {
    if (!Array.isArray(abastecList) || abastecList.length < 2) return { km: 0, hr: 0 };

    const toTime = (ev) => {
      const d = FilterUtil.parseAnyDate(ev.data) || new Date(0, 0, 1);
      if (ev.hora && HORA_REGEX.test(String(ev.hora))) {
        const [H, M, S] = ev.hora.split(":").map(Number);
        d.setHours(H || 0, M || 0, S || 0, 0);
      } else {
        d.setHours(0, 0, 0, 0);
      }
      return d.getTime();
    };

    const list = abastecList.slice().sort((a, b) => toTime(a) - toTime(b));

    const toNum = (v) => {
      if (v == null) return NaN;
      if (typeof v === "number") return v;
      const s = String(v).replace(/\s|Km/gi, "").replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return isNaN(n) ? NaN : n;
    };

    let totalKm = 0, totalHr = 0;
    for (let i = 1; i < list.length; i++) {
      const ant = list[i - 1], cur = list[i];
      const kmAnt = toNum(ant.km), kmCur = toNum(cur.km);
      const hrAnt = toNum(ant.hr), hrCur = toNum(cur.hr);

      const dKm = (isFinite(kmCur) && isFinite(kmAnt)) ? (kmCur - kmAnt) : 0;
      const dHr = (isFinite(hrCur) && isFinite(hrAnt)) ? (hrCur - hrAnt) : 0;

      if (dKm > 0) totalKm += dKm;
      if (dHr > 0) totalHr += dHr;
    }
    return { km: totalKm, hr: totalHr };
  }

  function normalizeDay(dateObj) {
    if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj)) return null;
    const normalized = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
    return normalized.getTime();
  }

  function parseMaterialDateTime(material) {
    const d = FilterUtil.parseAnyDate(material?.data);
    if (!d) return null;
    if (material.horaEntrada && HORA_REGEX.test(String(material.horaEntrada))) {
      const p = material.horaEntrada.split(":").map(Number);
      d.setHours(p[0] || 0, p[1] || 0, p[2] || 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d;
  }

  function parseAbastecimentoDateTime(evento) {
    const d = FilterUtil.parseAnyDate(evento?.data);
    if (!d) return null;
    if (evento.hora && HORA_REGEX.test(String(evento.hora))) {
      const [H, M, S] = evento.hora.split(":").map(Number);
      d.setHours(H || 0, M || 0, S || 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d;
  }

  function setTimeOrDefault(dateObj, timeValue, defaultHour) {
    if (!dateObj) { return; }
    if (timeValue && HORA_REGEX.test(String(timeValue))) {
      const parts = String(timeValue).split(":").map(Number);
      const h = parts[0] || 0;
      const m = parts[1] || 0;
      const s = parts[2] || 0;
      dateObj.setHours(h, m, s, 0);
    } else if (defaultHour === 23) {
      dateObj.setHours(23, 59, 59, 999);
    } else {
      dateObj.setHours(0, 0, 0, 0);
    }
  }

  function parseDowntimeRange(entry) {
    if (!entry) { return null; }

    const startDateRaw = entry.aberturaData || entry.dataAbertura || entry.inicioData || entry.dataInicio || entry.startDate || entry.data;
    const endDateRaw = entry.fechamentoData || entry.dataFechamento || entry.fimData || entry.dataFim || entry.endDate || entry.dataEncerramento || startDateRaw;

    const startDate = FilterUtil.parseAnyDate(startDateRaw);
    const endDate = FilterUtil.parseAnyDate(endDateRaw) || startDate;
    if (!startDate) { return null; }

    const start = new Date(startDate.getTime());
    const end = endDate ? new Date(endDate.getTime()) : new Date(startDate.getTime());

    const startTimeRaw = entry.aberturaHora || entry.horaAbertura || entry.inicioHora || entry.horaInicio || entry.startTime;
    const endTimeRaw = entry.fechamentoHora || entry.horaFechamento || entry.fimHora || entry.horaFim || entry.endTime;

    setTimeOrDefault(start, startTimeRaw, 0);
    setTimeOrDefault(end, endTimeRaw, 23);

    if (end.getTime() <= start.getTime()) {
      end.setTime(start.getTime() + MS_PER_HOUR);
    }

    return { start, end };
  }

  function overlapMs(rangeStartMs, rangeEndMs, start, end) {
    const s = start.getTime();
    const e = end.getTime();
    if (!isFinite(s) || !isFinite(e) || e <= s) { return 0; }

    let effStart = s;
    let effEnd = e;

    if (isFinite(rangeStartMs)) {
      if (effEnd <= rangeStartMs) { return 0; }
      if (effStart < rangeStartMs) { effStart = rangeStartMs; }
    }

    if (isFinite(rangeEndMs)) {
      if (effStart >= rangeEndMs) { return 0; }
      if (effEnd > rangeEndMs) { effEnd = rangeEndMs; }
    }

    const delta = effEnd - effStart;
    return delta > 0 ? delta : 0;
  }

  function recalcAggByRange(oView, range) {
    const vm       = oView.getModel("vm");
    const matModel = oView.getModel("materiais");
    const abModel  = oView.getModel("abast");
    const downModel = oView.getModel("downtime");
    if (!vm) return;

    const start = Array.isArray(range) && range[0] instanceof Date ? range[0] : null;
    const end   = Array.isArray(range) && range[1] instanceof Date ? range[1] : null;
    const hasRange = !!(start && end);
    const totalDaysRange = hasRange ? Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1) : null;
    const rangeStartMs = hasRange ? start.getTime() : NaN;
    const rangeEndMs = hasRange ? end.getTime() : NaN;

    const vlist = vm.getProperty("/veiculos") || [];

    vlist.forEach((v) => {
      const key = v.id || v.veiculo || v.equnr;

      const materiais = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || v.materiais || [];
      const abastec   = (abModel  && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || v.abastecimentos || [];
      const downtimeEvents = (downModel && downModel.getProperty("/eventosPorVeiculo/" + key)) || [];

      let matsInRange = materiais;
      let abInRange   = abastec;

      if (hasRange) {
        matsInRange = materiais.filter((m) => {
          const dt = parseMaterialDateTime(m);
          return dt && dt >= start && dt <= end;
        });

        abInRange = abastec.filter((a) => {
          const dt = parseAbastecimentoDateTime(a);
          return dt && dt >= start && dt <= end;
        });
      }

      const custoMatAgg = matsInRange.reduce((soma, m) => soma + (Number(m.qtde || 0) * Number(m.custoUnit || 0)), 0);

      let litrosAgg = 0, valorAgg = 0;
      abInRange.forEach((ev) => {
        const litros = FilterUtil.numBR(ev.litros);
        litrosAgg += litros;

        const valorTotal = FilterUtil.numBR(ev.valor);
        if (valorTotal > 0) {
          valorAgg += valorTotal;
        } else {
          const preco = FilterUtil.numBR(
            ev.preco ?? ev.precoLitro ?? ev.preco_litro ?? ev.precoUnit ?? ev.preco_unit ?? ev.precoUnitario
          );
          valorAgg += preco * litros;
        }
      });

      const deltas = sumDeltasFromAbastecimentos(abInRange);

      const maxTs = Math.max(
        ...matsInRange.map((m) => {
          const d = parseMaterialDateTime(m);
          return d ? d.getTime() : -Infinity;
        }),
        ...abInRange.map((a) => {
          const d = parseAbastecimentoDateTime(a);
          return d ? d.getTime() : -Infinity;
        })
      );

      let dataRef = null;
      if (isFinite(maxTs) && maxTs > -Infinity) {
        const dref = new Date(maxTs);
        const mm = String(dref.getMonth() + 1).padStart(2, "0");
        const dd = String(dref.getDate()).padStart(2, "0");
        dataRef = `${dref.getFullYear()}-${mm}-${dd}`;
      }

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

      const activeDays = new Set();
      matsInRange.forEach((m) => {
        const dt = parseMaterialDateTime(m);
        const keyDay = normalizeDay(dt);
        if (keyDay != null) activeDays.add(keyDay);
      });
      abInRange.forEach((a) => {
        const dt = parseAbastecimentoDateTime(a);
        const keyDay = normalizeDay(dt);
        if (keyDay != null) activeDays.add(keyDay);
      });

  let downtimeMs = 0;
  let downtimeCount = 0;
      if (Array.isArray(downtimeEvents) && downtimeEvents.length) {
        downtimeEvents.forEach(function (evt) {
          const parsed = parseDowntimeRange(evt);
          if (!parsed) { return; }
          const overlap = hasRange
            ? overlapMs(rangeStartMs, rangeEndMs, parsed.start, parsed.end)
            : parsed.end.getTime() - parsed.start.getTime();
          if (overlap > 0) {
            downtimeMs += overlap;
            downtimeCount += 1;
          }
        });
      }

      let windowMs = null;
      if (totalDaysRange) {
        windowMs = totalDaysRange * MS_PER_DAY;
      } else if (downtimeMs > 0) {
        windowMs = Math.max(downtimeMs, MS_PER_DAY);
      }

  // Converte para horas (raw)
  const downtimeHoursRaw = downtimeMs > 0 ? downtimeMs / MS_PER_HOUR : 0;

  // Ajusta downtime somando uma penalidade por evento para priorizar veículos com
  // muitos eventos mesmo que de curta duração. O valor é limitado ao windowMs
  // (janela de análise) para evitar porcentagens negativas.
  const effectiveDowntimeMs = downtimeMs + (downtimeCount * EVENT_PENALTY_MS);
  const downtimeClamped = windowMs ? Math.min(effectiveDowntimeMs, windowMs) : effectiveDowntimeMs;
  const downtimeHours = downtimeClamped / MS_PER_HOUR;
  const uptimeHours = windowMs ? Math.max(0, (windowMs - downtimeClamped) / MS_PER_HOUR) : 0;

      let disponibilidadePerc;
      let indisponibilidadePerc;

      if (windowMs && windowMs > 0) {
        disponibilidadePerc = ((windowMs - downtimeClamped) / windowMs) * 100;
        indisponibilidadePerc = (downtimeClamped / windowMs) * 100;
      } else if (downtimeMs > 0) {
        disponibilidadePerc = 0;
        indisponibilidadePerc = 100;
      } else {
        if (totalDaysRange) {
          disponibilidadePerc = (activeDays.size / totalDaysRange) * 100;
        } else if (activeDays.size > 0) {
          disponibilidadePerc = 100;
        } else {
          disponibilidadePerc = 0;
        }
        indisponibilidadePerc = Math.max(0, 100 - disponibilidadePerc);
      }

      disponibilidadePerc = Math.max(0, Math.min(100, disponibilidadePerc || 0));
      indisponibilidadePerc = Math.max(0, Math.min(100, indisponibilidadePerc || 0));

  v.disponibilidadePerc = Number(disponibilidadePerc.toFixed(2));
  v.indisponibilidadePerc = Number(indisponibilidadePerc.toFixed(2));
  // Expor horas raw (sem penalidade) e ajustadas (com penalidade) para debug/visualizacao
  v.downtimeHorasRangeRaw = Number(downtimeHoursRaw.toFixed(2));
  v.downtimeHorasRange = Number(downtimeHours.toFixed(2));
  v.uptimeHorasRange = windowMs ? Number(Math.max(0, uptimeHours).toFixed(2)) : 0;
  v.downtimeEventosRange = downtimeCount;
    });

    vm.setProperty("/veiculos", vlist);
  }

  return { sumDeltasFromAbastecimentos, recalcAggByRange };
});