sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "com/skysinc/frota/frota/util/formatter",
  "com/skysinc/frota/frota/services/ODataMaterials"
], function (Controller, JSONModel, formatter, ODataMaterials) {
  "use strict";

  // ===== helpers numÃ©ricos / formataÃ§Ã£o =====
  const toNum  = (v) => Number(v || 0);
  const fmtBrl = (v) => {
    try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(toNum(v)); }
    catch { return v; }
  };
  const fmtNum = (v) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MONTH_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const sum = (arr, pick) => (arr||[]).reduce((s,x)=> s + toNum(pick(x)), 0);

  // ===== datas (LOCAL para UI / filtros) =====
  const startOfDay = (d)=>{ const x=new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay   = (d)=>{ const x=new Date(d); x.setHours(23,59,59,999); return x; };

  // Parser LOCAL robusto: aceita 'YYYY-MM-DD' e 'YYYY-MM-DDTHH:mm(:ss)'
  function parseLocalDateTime(s) {
    if (!s) return null;
    const str = String(s);

    // YYYY-MM-DD
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);

    // YYYY-MM-DDTHH:mm(:ss)
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0), 0);

    // Date jÃ¡ vÃ¡lido
    if (s instanceof Date) return new Date(s.getTime());
    return null;
  }

  // Converte Date -> 'YYYY-MM-DD' preservando o "dia" em UTC (para datas OData)
  function toYMD_UTC(d) {
    if (!(d instanceof Date)) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Converte Date -> 'YYYY-MM-DD' em horÃ¡rio LOCAL (para strings locais)
  function toYMD(d) {
    if (!(d instanceof Date)) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // ===== helpers de datas extras =====
  function addDays(d, n) {
    if (!(d instanceof Date)) return null;
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }
  function addDaysYMD(ymd, n) {
    if (!ymd) return ymd;
    const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return ymd;
    const d = new Date(+m[1], +m[2]-1, +m[3], 0, 0, 0, 0);
    return toYMD(addDays(d, n));
  }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function toABAPDateOnly(d){
    const x = new Date(d);
    return x.getFullYear() + pad2(x.getMonth()+1) + pad2(x.getDate()); // YYYYMMDD
  }

  // ===== outras helpers =====
  function padEqunr(e) {
    const digits = String(e || "").replace(/\D/g, "");
    return digits.padStart(18, "0");
  }

  function pickDescMaterial(r){
    return r?.nome
        || r?.material
        || r?.MAKTX
        || r?.maktx
        || r?.descricao
        || r?.textoBreve
        || r?.TXT_BREVE
        || "Item";
  }

  return Controller.extend("com.skysinc.frota.frota.controller.HistoricalPage", {
    formatter: formatter,

    /* ======================== LIFECYCLE ======================== */
    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("RouteHistorico")
        .attachPatternMatched(this._onRouteMatched, this);

      // Filtros default: de 1 ano atrÃ¡s atÃ© hoje (apenas no Historical)
      const now = new Date();
      const d2 = now;
      const d1 = new Date(now); d1.setFullYear(now.getFullYear() - 1);
      this.getView().setModel(new JSONModel({ tipo:"__ALL__", q:"", d1, d2 }), "hfilter");

      // Detail/KPIs + status manutenÃ§Ã£o de hoje
      this.getView().setModel(new JSONModel({
        veiculo:"", descricao:"", categoria:"",
        historico: [],
        historicoComb: [], historicoMateriais: [], historicoServicos: [],
        countComb:0, countMateriais:0, countServicos:0,
        totalCombustivel:0, totalMateriais:0, totalServicos:0, totalGeral:0,
        precoMedio:0,
        totalCombustivelFmt:"R$ 0,00", totalMateriaisFmt:"R$ 0,00",
        totalServicosFmt:"R$ 0,00", totalGeralFmt:"R$ 0,00",
        precoMedioFmt:"0,00",
        manutencaoHoje:false,
        manutencaoTexto:"Operacional",
        manutencaoState:"Success",
        _src:{ base:[] }
      }), "detail");

      // Chart principal + lateral
      this._historyModel = new JSONModel({ chartType:"column", points:[], subtitle:"" });
      this.getView().setModel(this._historyModel, "history");
      this._sideChartModel = new JSONModel({ header:"", rows:[] });
      this.getView().setModel(this._sideChartModel, "chart");

      this._applyVizProps();
    },

    onAfterRendering: function () {
      this._applyVizProps();
      this._connectPopover();
    },

    _applyVizProps: function () {
      const common = {
        legend: { visible:true },
        title: { visible:false },
        plotArea: { dataLabel:{ visible:true } },
        valueAxis: { title:{ visible:false } },
        categoryAxis: { title:{ visible:false } },
        interaction: { selectability:{ mode:"SINGLE" } }
      };
      const vf = this.byId("vf"); if (vf) vf.setVizProperties(common);
      const bar = this.byId("barCompare"); if (bar) bar.setVizProperties(common);
    },

    _connectPopover: function () {
      const oVf = this.byId("vf");
      const oPop = this.byId("vfPopover");
      if (oVf && oPop && typeof oPop.connect === "function") {
        try { oPop.connect(oVf.getVizUid()); } catch(e) { /* noop */ }
      }
    },

    /* ======================== ROUTE ======================== */
    _onRouteMatched: function (oEvent) {
      const argId = (oEvent.getParameter("arguments")||{}).id || "";
      this._equnrRaw = String(argId);
      this._equnr = padEqunr(this._equnrRaw);

      // Busca veÃ­culo no vm (se houver) ou no modelo global do Component
      const vmVeic = this.getView().getModel("vm")?.getProperty("/veiculos") || [];
      const comp   = this.getOwnerComponent();
      const baseVeic = comp.getModel()?.getProperty("/veiculos") || [];
      const allVeic = vmVeic.length ? vmVeic : baseVeic;

      const found = allVeic.find(v => {
        const e = String(v.equnr || v.veiculo || v.id || "");
        return e === this._equnrRaw || padEqunr(e) === this._equnr;
      }) || null;

      const detail = this.getView().getModel("detail");
      detail.setProperty("/veiculo", this._equnrRaw);
      detail.setProperty("/descricao",
        found?.eqktx || found?.descricao || found?.DESCRICAO || found?.txt || "");
      detail.setProperty("/categoria",
        found?.CATEGORIA || found?.categoria || found?.Categoria || "");

      // Carregar e montar histÃ³rico
      this.onRefresh();
    },

    /* ======================== DATA LOAD ======================== */
    onRefresh: function () {
      const hf = this.getView().getModel("hfilter").getData();
      const from = startOfDay(hf.d1 || new Date());
      const to   = endOfDay(hf.d2 || hf.d1 || new Date());

      // LOG: seleÃ§Ã£o e datas ABAP "date-only"
      const abapStart = toABAPDateOnly(from);
      const abapEnd   = toABAPDateOnly(to);

      Promise.all([
        this._loadMateriaisServicosOData(from, to, { abapStart, abapEnd }),
        this._loadAbastecimentosLocal(from, to)
      ]).then(([matServ, abast]) => {
        const base = [];

        // Materiais / ServiÃ§os (OData) â€” normaliza e soma +1 dia
        (matServ || []).forEach((r) => {
          const tipoU = String(r.tipo || r.TIPO || "").toUpperCase();
          const isSrv = (tipoU === "SERVICO" || tipoU === "SERVIÃ‡O" || r.isServico === true);

          const desc = pickDescMaterial(r);
          const qt   = toNum(r.qtde || r.QTDE || r.menge || r.MENGE || 1);
          const pUni = toNum(r.custoUnit || r.CUSTO_UNIT || r.preco || r.PRECO || r.precoUnit || 0);
          const val  = toNum(r.valor || r.VALOR || r.dmbtr || r.DMBTR || (qt * pUni));

          const rawDate = r.data || r.DATA || r.budat_mkpf || r.cpudt || null;
          let dataYMD = null;
          if (rawDate instanceof Date) {
            const ymdUtc = toYMD_UTC(rawDate);
            dataYMD = addDaysYMD(ymdUtc, 1);
          } else {
            const dLocal = parseLocalDateTime(rawDate);
            dataYMD = dLocal ? toYMD(addDays(dLocal, 1)) : null;
          }

          base.push({
            data: dataYMD,           // YYYY-MM-DD (corrigido +1 dia)
            tipo: isSrv ? "ServiÃ§o" : "Material",
            descricao: desc,
            qtde: qt,
            custoUnit: pUni,
            valor: val
          });
        });

        // Abastecimentos (local) â€” aplica +1 dia para alinhar com listas e filtros
        (abast || []).forEach((a) => {
          const litros = toNum(a.litros || 0);
          const precoLinha = toNum(a.precoLitro ?? a.preco ?? a.precoUnit);
          const dAbast = parseLocalDateTime(a.data || null);

          base.push({
            data: dAbast ? toYMD(addDays(dAbast, 1)) : null,  // YYYY-MM-DD (+1 dia)
            tipo: "CombustÃ­vel",
            descricao: a.descricao || "Abastecimento",
            qtde: litros,
            custoUnit: precoLinha || 0,
            valor: (precoLinha || 0) * litros
          });
        });

        // Ordena por data desc (sempre via parser LOCAL)
        base.sort((x,y)=>{
          const dx = x.data ? parseLocalDateTime(x.data).getTime() : -Infinity;
          const dy = y.data ? parseLocalDateTime(y.data).getTime() : -Infinity;
          return dy - dx;
        });

        const historicoComb      = base.filter(h=>h.tipo==="CombustÃ­vel");
        const historicoMateriais = base.filter(h=>h.tipo==="Material");
        const historicoServicos  = base.filter(h=>h.tipo==="ServiÃ§o");

        const detail = this.getView().getModel("detail");
        detail.setProperty("/historico", base);
        detail.setProperty("/historicoComb", historicoComb);
        detail.setProperty("/historicoMateriais", historicoMateriais);
        detail.setProperty("/historicoServicos", historicoServicos);
        detail.setProperty("/_src/base", base);

        // Atualiza â€œem manutenÃ§Ã£o hojeâ€
        this._updateMaintenanceFlag(base);

        // KPIs e grÃ¡fico
        this._applyFiltersAndKpis();
        this._buildYearComparison();
        this._connectPopover();
      });
    },

    _updateMaintenanceFlag: function(base){
      const todayFrom = startOfDay(new Date());
      const todayTo   = endOfDay(new Date());

      const hasToday = (base || []).some((r)=>{
        if (!(r && (r.tipo === "Material" || r.tipo === "ServiÃ§o"))) return false;
        const d = r.data ? parseLocalDateTime(r.data) : null;
        return d && d >= todayFrom && d <= todayTo;
      });

      const detail = this.getView().getModel("detail");
      detail.setProperty("/manutencaoHoje", hasToday);
      detail.setProperty("/manutencaoTexto", hasToday ? "Em manutenÃ§Ã£o hoje" : "Operacional");
      detail.setProperty("/manutencaoState", hasToday ? "Error" : "Success");
    },

    _loadMateriaisServicosOData: function (from, to, extra) {
      

      return ODataMaterials.loadMaterials(this.getOwnerComponent(), {
        equnr: this._equnr,
        startDate: from,
        endDate: to,
        abapStart: extra?.abapStart,
        abapEnd:   extra?.abapEnd
      }).then(res => {
        return res || [];
      }).catch((e) => {
        return[];
      });
    },

    _loadAbastecimentosLocal: function (from, to) {
      const comp = this.getOwnerComponent();
      const abModel = comp.getModel("abast");
      const key = this._equnrRaw;

      const list = (abModel && abModel.getProperty("/abastecimentosPorVeiculo/" + key)) || [];
      return Promise.resolve(
        list.filter(a => {
          const d = a && a.data ? parseLocalDateTime(a.data) : null;
          return d && d >= from && d <= to;
        })
      );
    },

    /* ======================== FILTER + KPIs ======================== */
    onFilterChangeHist: function () {
      const hf = this.getView().getModel("hfilter").getData();
      console.log("[Hist] Data selecionada:",
        "De:", hf.d1 && hf.d1.toString(),
        "| AtÃ©:", hf.d2 && hf.d2.toString()
      );
      this._applyFiltersAndKpis();
      this._buildYearComparison();
      this._connectPopover();
    },

    onClearHistFilters: function(){
      const now = new Date();
      const d2 = now;
      const d1 = new Date(now); d1.setFullYear(now.getFullYear() - 1);
      this.getView().getModel("hfilter").setData({ tipo:"__ALL__", q:"", d1, d2 }, true);
      this.onFilterChangeHist();
    },

    _applyFiltersAndKpis: function () {
      const detail = this.getView().getModel("detail");
      const hf = this.getView().getModel("hfilter").getData();

      const from = startOfDay(hf.d1 || new Date());
      const to   = endOfDay(hf.d2 || hf.d1 || new Date());
      const q    = String(hf.q || "").toLowerCase();
      const tipo = hf.tipo || "__ALL__";

      const base = detail.getProperty("/_src/base") || [];
      const filt = base.filter((row)=>{
        const d = row.data ? parseLocalDateTime(row.data) : null;
        if (!d || d < from || d > to) return false;
        if (tipo !== "__ALL__" && row.tipo !== tipo) return false;
        if (q && !String(row.descricao||"").toLowerCase().includes(q)) return false;
        return true;
      });

      const historicoComb      = filt.filter(h=>h.tipo==="CombustÃ­vel");
      const historicoMateriais = filt.filter(h=>h.tipo==="Material");
      const historicoServicos  = filt.filter(h=>h.tipo==="ServiÃ§o");

      const totalComb = sum(historicoComb,      h=>h.valor);
      const totalMat  = sum(historicoMateriais, h=>h.valor);
      const totalServ = sum(historicoServicos,  h=>h.valor);
      const totalGeral = totalComb + totalMat + totalServ;

      const totLitros = sum(historicoComb, h=>h.qtde);
      const precoMedio = totLitros ? (totalComb / totLitros) : 0;

      detail.setProperty("/historico", filt);
      detail.setProperty("/historicoComb", historicoComb);
      detail.setProperty("/historicoMateriais", historicoMateriais);
      detail.setProperty("/historicoServicos", historicoServicos);

      detail.setProperty("/countComb", historicoComb.length);
      detail.setProperty("/countMateriais", historicoMateriais.length);
      detail.setProperty("/countServicos", historicoServicos.length);

      detail.setProperty("/totalCombustivel", totalComb);
      detail.setProperty("/totalMateriais", totalMat);
      detail.setProperty("/totalServicos", totalServ);
      detail.setProperty("/totalGeral", totalGeral);
      detail.setProperty("/precoMedio", precoMedio);

      detail.setProperty("/totalCombustivelFmt", fmtBrl(totalComb));
      detail.setProperty("/totalMateriaisFmt",   fmtBrl(totalMat));
      detail.setProperty("/totalServicosFmt",    fmtBrl(totalServ));
      detail.setProperty("/totalGeralFmt",       fmtBrl(totalGeral));
      detail.setProperty("/precoMedioFmt",       fmtNum(precoMedio));
    },

    /* ======================== CHART ======================== */
    onChartTypeChange: function (oEvent) {
      const key = oEvent.getParameter("item").getKey();
      this._historyModel.setProperty("/chartType", key);
      this._applyVizProps();
      this._connectPopover();
    },

    _buildYearComparison: function () {
      const detail = this.getView().getModel("detail");
      const hf = this.getView().getModel("hfilter").getData();

      const dRef = hf.d2 || new Date();
      const yearCur  = (dRef instanceof Date ? dRef : new Date(dRef)).getFullYear();
      const yearPrev = yearCur - 1;

      const all = detail.getProperty("/historico") || [];
      const sumCur  = new Array(12).fill(0);
      const sumPrev = new Array(12).fill(0);

      all.forEach((r)=>{
        const d = r.data ? parseLocalDateTime(r.data) : null;
        if (!d) return;
        const y = d.getFullYear();
        const m = d.getMonth(); // 0..11
        const v = toNum(r.valor || 0);
        if (y === yearCur)  sumCur[m]  += v;
        if (y === yearPrev) sumPrev[m] += v;
      });

      const points = MONTH_LABELS.map((label, i)=>({ label, current: sumCur[i], previous: sumPrev[i] }));
      const totalCur = sumCur.reduce((a,b)=>a+b,0);
      const totalPrev = sumPrev.reduce((a,b)=>a+b,0);

      this._historyModel.setProperty("/points", points);
      this._historyModel.setProperty("/subtitle", `Ano Atual: ${fmtBrl(totalCur)} | Ano Anterior: ${fmtBrl(totalPrev)}`);
    }
  });
});
