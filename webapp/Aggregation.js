sap.ui.define([
  "com/skysinc/frota/frota/util/FilterUtil"
], function (FilterUtil) {
  "use strict";

  const MS_PER_DAY  = 24 * 60 * 60 * 1000;
  const MS_PER_HOUR = 60 * 60 * 1000;
  const HORA_REGEX  = /^\d{2}:\d{2}:\d{2}$/;

  // Penalidade por evento (em horas) — opcional, para priorizar muitos eventos curtos.
  const EVENT_PENALTY_HOURS = 1;
  const EVENT_PENALTY_MS    = EVENT_PENALTY_HOURS * MS_PER_HOUR;

  // -------------------- Utils básicas --------------------

  function eod(d) {
    if (!(d instanceof Date)) return null;
    const x = new Date(d.getTime());
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function normalizeDay(dateObj) {
    if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj)) return null;
    const normalized = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
    return normalized.getTime();
  }

  function _toRangeObj(range) {
    if (!range) return null;
    if (Array.isArray(range)) {
      const a = range[0] instanceof Date ? range[0] : null;
      const b = range[1] instanceof Date ? range[1] : (a || null);
      return (a && b) ? { from: a, to: b } : null;
    }
    if (range.from instanceof Date && range.to instanceof Date) return { from: range.from, to: range.to };
    return null;
  }

  function _parseISOZ(s) {
    if (!s) return null;
    try {
      const d = new Date(String(s));
      return isNaN(d) ? null : d;
    } catch (e) { return null; }
  }

  // Sobreposição em milissegundos entre [rangeStartMs..rangeEndMs] e [start..end]
  function overlapMs(rangeStartMs, rangeEndMs, start, end) {
    const s = start.getTime();
    const e = end.getTime();
    if (!isFinite(s) || !isFinite(e) || e <= s) return 0;

    let effStart = s;
    let effEnd   = e;

    if (isFinite(rangeStartMs)) {
      if (effEnd <= rangeStartMs) return 0;
      if (effStart < rangeStartMs) effStart = rangeStartMs;
    }

    if (isFinite(rangeEndMs)) {
      if (effStart >= rangeEndMs) return 0;
      if (effEnd > rangeEndMs) effEnd = rangeEndMs;
    }

    const delta = effEnd - effStart;
    return delta > 0 ? delta : 0;
  }

  // -------------------- Parsers de data/hora (materiais/abastec) --------------------

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
    if (!dateObj) return;
    if (timeValue && HORA_REGEX.test(String(timeValue))) {
      const parts = String(timeValue).split(":").map(Number);
      dateObj.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
    } else if (defaultHour === 23) {
      dateObj.setHours(23, 59, 59, 999);
    } else {
      dateObj.setHours(0, 0, 0, 0);
    }
  }

  function parseDowntimeRange(entry) {
    if (!entry) return null;

    const startDateRaw = entry.aberturaData || entry.dataAbertura || entry.inicioData || entry.dataInicio || entry.startDate || entry.data;
    const endDateRaw   = entry.fechamentoData || entry.dataFechamento || entry.fimData || entry.dataFim || entry.endDate || entry.dataEncerramento || startDateRaw;

    const startDate = FilterUtil.parseAnyDate(startDateRaw);
    const endDate   = FilterUtil.parseAnyDate(endDateRaw) || startDate;
    if (!startDate) return null;

    const start = new Date(startDate.getTime());
    const end   = endDate ? new Date(endDate.getTime()) : new Date(startDate.getTime());

    const startTimeRaw = entry.aberturaHora || entry.horaAbertura || entry.inicioHora || entry.horaInicio || entry.startTime;
    const endTimeRaw   = entry.fechamentoHora || entry.horaFechamento || entry.fimHora || entry.horaFim || entry.endTime;

    setTimeOrDefault(start, startTimeRaw, 0);
    setTimeOrDefault(end,   endTimeRaw,   23);

    // Garante pelo menos 1h
    if (end.getTime() <= start.getTime()) {
      end.setTime(start.getTime() + MS_PER_HOUR);
    }
    return { start, end };
  }

  // -------------------- Abastecimentos: somatório de deltas --------------------

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

  // -------------------- Disponibilidade por OS (regra nova) --------------------

  /**
   * Calcula disponibilidade no período usando lista de OS do veículo.
   * Regras:
   *  - Considera OS ABERTA (sem fechamento) como indo até 'min(agora, to)'.
   *  - Só entra se DataAbertura >= 'from' (quando 'from' existir).
   *  - Usa interseção real entre [abertura..(fechamento||agora)] e [from..to(23:59:59.999)].
   *  - Se a OS já vier com __overlapStart/__overlapEnd (do AvailabilityService), usa diretamente.
   *  - Sem OS no período => 100% disponível.
   */
  function calcDisponibilidade(osList, range, now = new Date()) {
    const r = _toRangeObj(range);
    if (!r) return { tempoTotalH: 0.0167, indispH: 0, pctDisp: 100.0, pctIndisp: 0.0, countOs: 0 };

    const from = new Date(r.from.getTime());
    const to   = eod(r.to) || r.to;
    let tempoTotalH = Math.max(0, (to.getTime() - from.getTime()) / MS_PER_HOUR);
    if (tempoTotalH <= 0) tempoTotalH = 0.0167;

    const list = Array.isArray(osList) ? osList : [];
    if (!list.length) return { tempoTotalH, indispH: 0, pctDisp: 100.0, pctIndisp: 0.0, countOs: 0 };

    // Constrói intervalos efetivos no range
    const intervals = [];
    let osCountInRange = 0;
    for (let i = 0; i < list.length; i++) {
      const os = list[i] || {};
      const status = String(os.Status || os.status || "").toUpperCase();
      if (status === "CANCELADA") continue;

      // Preferir overlap pré-calculado
      let overlapStart = os.__overlapStart instanceof Date ? os.__overlapStart : null;
      let overlapEnd   = os.__overlapEnd   instanceof Date ? os.__overlapEnd   : null;

      if (!(overlapStart && overlapEnd)) {
        // Fallback: calcular a partir dos campos brutos
        const ab = _parseISOZ(os.DataAbertura || os.dataAbertura || os.Abertura || os.AberturaData);
        let fe   = _parseISOZ(os.DataFechamento || os.dataFechamento || os.Fechamento || os.FechamentoData);

        if (!ab) continue;

        // Regra do cliente: só entra se abertura >= início do período
        if (ab.getTime() < from.getTime()) continue;

        // Aberta -> vai até agora ou fim do período, o que vier primeiro
        if (!fe) fe = new Date(Math.min(now.getTime(), to.getTime()));

        const ini = new Date(Math.max(ab.getTime(), from.getTime()));
        const fim = new Date(Math.min(fe.getTime(), to.getTime()));

        if (fim.getTime() <= ini.getTime()) continue;

        overlapStart = ini;
        overlapEnd   = fim;
      }

      // Sanidade
      if (!(overlapStart instanceof Date) || !(overlapEnd instanceof Date)) continue;
      if (overlapEnd.getTime() <= overlapStart.getTime()) continue;

      osCountInRange += 1;
      intervals.push({ ini: overlapStart, fim: overlapEnd });
    }

    if (!intervals.length) return { tempoTotalH, indispH: 0, pctDisp: 100.0, pctIndisp: 0.0, countOs: 0 };

    // Merge de intervalos sobrepostos
    intervals.sort((a, b) => a.ini.getTime() - b.ini.getTime());
    const merged = [];
    for (let j = 0; j < intervals.length; j++) {
      const cur = intervals[j];
      if (!merged.length) {
        merged.push({ ini: cur.ini, fim: cur.fim });
        continue;
      }
      const last = merged[merged.length - 1];
      if (cur.ini.getTime() <= last.fim.getTime()) {
        if (cur.fim.getTime() > last.fim.getTime()) last.fim = cur.fim;
      } else {
        merged.push({ ini: cur.ini, fim: cur.fim });
      }
    }

    // Soma indisponibilidade
    let indispMs = 0;
    for (let k = 0; k < merged.length; k++) {
      indispMs += Math.max(0, merged[k].fim.getTime() - merged[k].ini.getTime());
    }
    const indispH = indispMs / MS_PER_HOUR;

    let pctDisp   = Math.max(0, Math.min(100, ((tempoTotalH - indispH) / tempoTotalH) * 100));
    let pctIndisp = Math.max(0, Math.min(100, 100 - pctDisp));
    pctDisp   = Number(pctDisp.toFixed(1));
    pctIndisp = Number(pctIndisp.toFixed(1));

    return { tempoTotalH, indispH, pctDisp, pctIndisp, countOs: osCountInRange };
  }

  // -------------------- Recalcular agregados da página --------------------

  async function recalcAggByRange(oView, range) {
    const vm        = oView.getModel("vm");
    const matModel  = oView.getModel("materiais");
    const abModel   = oView.getModel("abast");
    const downModel = oView.getModel("downtime");
    if (!vm) return;

    const rObj   = _toRangeObj(range);
    const start  = rObj ? rObj.from : null;
    const endRaw = rObj ? rObj.to   : null;
    const end    = endRaw ? eod(endRaw) : null;

    const hasRange       = !!(start && end);
    const totalDaysRange = hasRange ? Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1) : null;
    const rangeStartMs   = hasRange ? start.getTime() : NaN;
    const rangeEndMs     = hasRange ? end.getTime()   : NaN;

    const vlist = vm.getProperty("/veiculos") || [];

    // Evita “fantasma” de cálculo anterior
    vlist.forEach(v => { v.pctDisp = 0; v.pctIndisp = 0; });

    // Busca OS por veículo no Firestore
    let __osMap = new Map();
    try {
      if (vlist.length && hasRange) {
        const service = await new Promise(function (resolve) {
          sap.ui.require(["com/skysinc/frota/frota/services/AvailabilityService"], function (svc) { resolve(svc); });
        });
        const ids = vlist.map(v => v.id || v.veiculo || v.equnr || v.Equipamento || "").filter(Boolean);
        if (ids.length && service && service.fetchOsByVehiclesAndRange) {
          __osMap = await service.fetchOsByVehiclesAndRange(ids, { from: start, to: end });
        }
      }
    } catch (e) {
      try { console.warn("[Aggregation] fetchOsByVehiclesAndRange falhou", e && (e.code || e.message || e)); } catch (_){}
      __osMap = new Map();
    }

    vlist.forEach((v) => {
      const key = v.id || v.veiculo || v.equnr || v.Equipamento;

      const materiais = (matModel && matModel.getProperty("/materiaisPorVeiculo/" + key)) || v.materiais || [];
      const abastec   = (abModel  && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || v.abastecimentos || [];
      const downtimeEvents = (downModel && downModel.getProperty("/eventosPorVeiculo/" + key)) || [];

      // Filtra por período
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

      // Custos e combustíveis
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

      // Ajuste: se existe abastecimento anterior ao início, ignora o 1º do range
      if (hasRange && Array.isArray(abastec) && abInRange.length > 0) {
        const hasPrevBeforeStart = abastec.some(function (a) {
          const d = parseAbastecimentoDateTime(a);
          return d && d.getTime() < start.getTime();
        });
        if (hasPrevBeforeStart) {
          const ordered = abInRange.slice().sort(function (a, b) {
            const da = parseAbastecimentoDateTime(a);
            const db = parseAbastecimentoDateTime(b);
            const ta = da ? da.getTime() : 0;
            const tb = db ? db.getTime() : 0;
            return ta - tb;
          });
          const first = ordered[0];
          const firstLt = FilterUtil.numBR(first && first.litros);
          if (firstLt > 0) litrosAgg = Math.max(0, litrosAgg - firstLt);
        }
      }

      const deltas = sumDeltasFromAbastecimentos(abInRange);

      // Data de referência (última atividade no período)
      const maxTs = Math.max(
        ...matsInRange.map((m) => { const d = parseMaterialDateTime(m); return d ? d.getTime() : -Infinity; }),
        ...abInRange.map((a) => { const d = parseAbastecimentoDateTime(a); return d ? d.getTime() : -Infinity; })
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
      v.custoTotalAgg          = (v.custoMaterialAgg || 0) + (v.combustivelValorAgg || 0);
      v.funcaokmcomb           = (v.combustivelLitrosAgg ? (v.kmRodadosAgg / v.combustivelLitrosAgg) : 0);
      v.funcaohrRodados        = (v.hrRodadosAgg ? (v.combustivelLitrosAgg / v.hrRodadosAgg) : 0);

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

      // Downtime manual (eventos) — mantém sua lógica atual com penalidade por evento
      let downtimeMs = 0;
      let downtimeCount = 0;
      if (Array.isArray(downtimeEvents) && downtimeEvents.length) {
        downtimeEvents.forEach(function (evt) {
          const parsed = parseDowntimeRange(evt);
          if (!parsed) return;
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

      const downtimeHoursRaw = downtimeMs > 0 ? downtimeMs / MS_PER_HOUR : 0;
      const effectiveDowntimeMs = downtimeMs + (downtimeCount * EVENT_PENALTY_MS);
      const downtimeClamped     = windowMs ? Math.min(effectiveDowntimeMs, windowMs) : effectiveDowntimeMs;
      const downtimeHours       = downtimeClamped / MS_PER_HOUR;
      const uptimeHours         = windowMs ? Math.max(0, (windowMs - downtimeClamped) / MS_PER_HOUR) : 0;

      let disponibilidadePerc;
      let indisponibilidadePerc;

      if (windowMs && windowMs > 0) {
        disponibilidadePerc   = ((windowMs - downtimeClamped) / windowMs) * 100;
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

      v.disponibilidadePerc   = Number(Math.max(0, Math.min(100, disponibilidadePerc || 0)).toFixed(2));
      v.indisponibilidadePerc = Number(Math.max(0, Math.min(100, indisponibilidadePerc || 0)).toFixed(2));
      v.downtimeHorasRangeRaw = Number(downtimeHoursRaw.toFixed(2));
      v.downtimeHorasRange    = Number(downtimeHours.toFixed(2));
      v.uptimeHorasRange      = windowMs ? Number(Math.max(0, uptimeHours).toFixed(2)) : 0;
      v.downtimeEventosRange  = downtimeCount;

      // Disponibilidade baseada em OS (com regra nova)
      try {
        const keyOs  = key;
        const osList = (keyOs && __osMap && __osMap.get && __osMap.get(String(keyOs))) || [];
        const resultDisp = calcDisponibilidade(osList, { from: start, to: end });
        const tempoTotalH = resultDisp.tempoTotalH;
        const indispH = resultDisp.indispH;
        const pctDisp = resultDisp.pctDisp;
        const pctIndisp = resultDisp.pctIndisp;
        const countOs = Number(resultDisp.countOs || 0);
        const totalHoras = Number(Math.max(0, tempoTotalH).toFixed(2));
        const horasIndisp = Number(Math.max(0, indispH).toFixed(2));
        const horasDisp = Number(Math.max(0, tempoTotalH - indispH).toFixed(2));

        v.pctDisp                = pctDisp;
        v.pctIndisp              = pctIndisp;
        v.totalHorasPeriodo      = totalHoras;
        v.totalHorasIndisponiveis = horasIndisp;
        v.totalHorasDisponiveis  = horasDisp;
        v.osCountRange           = countOs;
      } catch (e) {
        v.pctDisp = 100.0;
        v.pctIndisp = 0.0;
        v.totalHorasPeriodo = 0;
        v.totalHorasIndisponiveis = 0;
        v.totalHorasDisponiveis = 0;
        v.osCountRange = 0;
      }
    });

    vm.setProperty("/veiculos", vlist);
  }

  // -------------------- API pública do módulo --------------------

  return {
    sumDeltasFromAbastecimentos,
    recalcAggByRange,
    calcDisponibilidade,
    overlapMs
  };
});
