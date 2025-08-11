sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/util/File"
], function (Controller, JSONModel, File) {
  "use strict";

  return Controller.extend("com.skysinc.frota.frota.controller.Converter", {

    onInit: function () {
      // modelo para previews e arquivos processados
      this._pv = new JSONModel({
        veiculos: [],
        materiaisPreview: [],
        abastecPreview: []
      });
      this.getView().setModel(this._pv, "pv");

      this._files = { veic: null, mat: null, abast: null };
      this._out = { veiculos: null, materiais: null, abastec: null };
    },

    // ===== Uploads =====
    onFileChange: function (oEvent) {
      const sId = oEvent.getSource().getId();
      const oFile = oEvent.getParameter("files")?.[0];
      if (!oFile) return;

      if (sId.includes("fuVeic"))  this._files.veic  = oFile;
      if (sId.includes("fuMat"))   this._files.mat   = oFile;
      if (sId.includes("fuAbast")) this._files.abast = oFile;
    },

    onProcess: async function () {
      try {
        // Lê cada planilha (se enviada)
        const [vRows, mRows, aRows] = await Promise.all([
          this._files.veic  ? this._readExcel(this._files.veic)  : Promise.resolve([]),
          this._files.mat   ? this._readExcel(this._files.mat)   : Promise.resolve([]),
          this._files.abast ? this._readExcel(this._files.abast) : Promise.resolve([])
        ]);

        // Converte para os JSONs no formato da sua app
        const veiculos = this._mapVeiculos(vRows);
        const materiais = this._mapMateriais(mRows);
        const abastec = this._mapAbastec(aRows);

        this._out.veiculos  = { veiculos: veiculos };
        this._out.materiais = { materiaisPorVeiculo: materiais };
        this._out.abastec   = { abastecimentosPorVeiculo: abastec };

        // Previews
        this._pv.setProperty("/veiculos", veiculos.slice(0, 100));
        // materiais preview = flatten (primeiros 200)
        const matPrev = [];
        Object.keys(materiais).forEach(k => materiais[k].forEach(x => matPrev.push({ veiculoId: k, ...x })));
        this._pv.setProperty("/materiaisPreview", matPrev.slice(0, 200));
        const abPrev = [];
        Object.keys(abastec).forEach(k => abastec[k].forEach(x => abPrev.push({ veiculoId: k, ...x })));
        this._pv.setProperty("/abastecPreview", abPrev.slice(0, 200));

        // Habilita downloads
        this.byId("btnDownVeic").setEnabled(!!veiculos.length);
        this.byId("btnDownMat").setEnabled(Object.keys(materiais).length > 0);
        this.byId("btnDownAbast").setEnabled(Object.keys(abastec).length > 0);

        sap.m.MessageToast.show("Planilhas processadas com sucesso!");
      } catch (e) {
        console.error(e);
        sap.m.MessageBox.error("Falha ao processar arquivos. Verifique os formatos/colunas.");
      }
    },

    // ===== Downloads =====
    onDownloadVeiculos: function () {
      if (!this._out.veiculos) return;
      File.save(JSON.stringify(this._out.veiculos, null, 2), "veiculos", "json", "application/json;charset=utf-8");
    },
    onDownloadMateriais: function () {
      if (!this._out.materiais) return;
      File.save(JSON.stringify(this._out.materiais, null, 2), "materiais", "json", "application/json;charset=utf-8");
    },
    onDownloadAbastec: function () {
      if (!this._out.abastec) return;
      File.save(JSON.stringify(this._out.abastec, null, 2), "abastecimentos", "json", "application/json;charset=utf-8");
    },

    // ===== Helpers: leitura Excel =====
    _readExcel(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(r.result), { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
            resolve(rows);
          } catch (e) { reject(e); }
        };
        r.onerror = reject;
        r.readAsArrayBuffer(file);
      });
    },

    // ===== Helpers: normalização =====
    _toNum(v) {
      if (v == null || v === "") return 0;
      if (typeof v === "number") return v;
      const s = String(v).trim().replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return isFinite(n) ? n : 0;
    },
    _toISO(v) {
      if (!v) return null;
      // tenta dd.MM.yyyy / dd/MM/yyyy / ISO
      const s = String(v).trim();
      const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
      if (m) {
        const d = m[1].padStart(2, "0"), mo = m[2].padStart(2, "0");
        const y = m[3].length === 2 ? ("20" + m[3]) : m[3];
        return `${y}-${mo}-${d}`;
      }
      // fallback
      const d = new Date(s);
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    },
    _toHHMM(v) {
      if (!v) return null;
      const s = String(v).trim();
      const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (m) return `${m[1].padStart(2,"0")}:${m[2]}`;
      return s;
    },
    __asStatus: function (v) {
      return new sap.m.ObjectStatus({ text: "Veículo: " + (v || "") });
    },
    _fmtBrl: function (v) {
      try { return new sap.m.ObjectStatus({ text: new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0)) }); }
      catch(e){ return new sap.m.ObjectStatus({ text: String(v) }); }
    },

    // ===== Mapeamentos =====
    _mapVeiculos(rows) {
      // tenta casar nomes de colunas prováveis
      const pick = (r, arr) => arr.find(c => r[c] != null);
      const out = [];
      rows.forEach(r => {
        const id = String(r["Equipamento"] ?? r["veiculo"] ?? r["ID"] ?? "").trim();
        if (!id) return;
        out.push({
          id: id,
          veiculo: id,
          categoria: (r["Categoria"] ?? r["categoria"] ?? "") || null,
          descricao: (r["EquipDesc"] ?? r["Descrição"] ?? r["Desc"] ?? "") || null,
          data: this._toISO(r["data"] ?? r["Data"]),
          kmRodados: this._toNum(r["km_rodado"] ?? r["Km_Rodado"] ?? r["KM"]),
          hrRodados: this._toNum(r["hr_rodado"] ?? r["Hr_Rodado"] ?? r["Horas"]),
          custoMaterial: this._toNum(r["custo_material"] ?? r["Custo_Material"]),
          combustivelLitros: this._toNum(r["combustivel_litros"] ?? r["Comb_Litros"] ?? r["Litros"]),
          combustivelValor: this._toNum(r["combustivel_valor"] ?? r["Comb_Valor"] ?? r["Valor"]),
          placa: r["placa"] ?? r["Placa"] ?? null,
          centro: r["Centro"] ?? null
        });
      });
      return out;
    },

    _mapMateriais(rows) {
      // saída: { "<veiculoId>": [ {nome,tipo,qtde,custoUnit,...} ] }
      const grouped = {};
      rows.forEach(r => {
        const veic = String(r["Equipamento"] ?? r["veiculo"] ?? r["ID"] ?? "").trim();
        if (!veic) return;
        const qtde = this._toNum(r["Qtd"] ?? r["Quant."] ?? r["Quantidade"]);
        let custoUnit = this._toNum(r["Custo Unit."] ?? r["Custo Unit"] ?? r["CustoUnit"]);
        const montante = this._toNum(r["Montante"] ?? r["Valor"] ?? r["Total"]);
        if (!custoUnit && qtde) custoUnit = montante / qtde;

        const item = {
          nome:        r["Desc.Material"] ?? r["Descrição"] ?? r["Texto breve"] ?? "",
          tipo:        r["Serv/Pc"] ?? r["Tipo"] ?? "Material",
          qtde:        qtde,
          custoUnit:   custoUnit,
          codMaterial: String(r["Material"] ?? r["Código Material"] ?? "") || null,
          deposito:    r["Depósito"] ?? r["Deposito"] ?? null,
          horaEntrada: this._toHHMM(r["HoraEntrada"] ?? r["Hora Entrada"]),
          nOrdem:      r["N.Ordem"] ?? r["Ordem"] ?? null,
          nReserva:    r["N.Reserva"] ?? r["Reserva"] ?? null,
          nItem:       r["N.Item"] ?? r["Item"] ?? null,
          recebedor:   r["Recebedor"] ?? null,
          unid:        r["Unid"] ?? r["Unidade"] ?? null,
          usuario:     r["Usuário"] ?? r["Usuario"] ?? null
        };
        (grouped[veic] ||= []).push(item);
      });
      return grouped;
    },

    _mapAbastec(rows) {
      // saída: { "<veiculoId>": [ {data,hora,km,litros,hr?} ] }
      const grouped = {};
      rows.forEach(r => {
        const veic = String(r["veiculo"] ?? r["Equipamento"] ?? r["ID"] ?? "").trim();
        if (!veic) return;
        const item = {
          data:   this._toISO(r["data"] ?? r["Data"]),
          hora:   this._toHHMM(r["hora"] ?? r["Hora"]),
          km:     this._toNum(r["hodometro"] ?? r["KM"] ?? r["Quilometragem"]),
          litros: this._toNum(r["abastec"] ?? r["Abastec"] ?? r["Litros"])
        };
        const hr = this._toNum(r["horimetro"] ?? r["Horas"]);
        if (hr) item.hr = hr;
        (grouped[veic] ||= []).push(item);
      });
      return grouped;
    }

  });
});
