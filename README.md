# 🚫 AVISO IMPORTANTE — USO RESTRITO

> ⚠️ **Atenção:** Esta aplicação é de uso **estritamente restrito**.  
> A utilização, cópia, distribuição ou modificação deste projeto **sem autorização expressa do autor** é **proibida e sujeita a penalidades civis e criminais**, conforme a Lei nº 9.610/98 (Direitos Autorais) e o Código Penal Brasileiro.  
>
> 🔒 O sistema possui **monitoramento ativo de IPs, acessos e modificações**.  
> Qualquer tentativa de uso indevido, engenharia reversa ou redistribuição não autorizada será rastreada e poderá resultar em **ações legais imediatas**.  
>
> 📅 Este repositório permanecerá **público apenas por 2 horas**, exclusivamente para fins de **visualização técnica**. Após esse período, será **tornado privado automaticamente**.  
>
> 💬 Para acesso legítimo, entre em contato com o autor para autorização formal.

---

# frota — Gestão de Frota (SAP Fiori)

Aplicação SAP Fiori / UI5 para gerenciamento de frota desenvolvida com o generator do SAP Fiori (template Basic).  
O projeto contém uma UI5 app que consome um serviço OData (configurado no `manifest.json`) e também inclui dados locais de exemplo em `webapp/model/localdata` para desenvolvimento e testes offline.

---

## 📘 Sumário

- Visão geral  
- Pré-requisitos  
- Instalação  
- Execução local (com e sem proxy)  
- Scripts úteis (npm)  
- Estrutura do projeto  
- Dados locais (mock)  
- Testes  
- Build e deploy  
- Notas e melhorias sugeridas  

---

## 🔍 Visão geral

- **Nome do app:** frota  
- **Namespace:** com.skysinc.frota.frota  
- **Título (i18n):** Gestão de Frota  
- **UI5 versão mínima:** 1.139.0  
- **Tema padrão:** sap_horizon  

O projeto foi gerado com o SAP Fiori tools (generator) e usa as ferramentas de desenvolvimento UI5 (`@ui5/cli` / `@sap/ux-ui5-tooling`).

---

## ⚙️ Pré-requisitos

- Node.js (LTS recomendado) e npm  
- Não é necessário instalar o `@ui5/cli` globalmente.  
- Para uso de proxy/backend SAP: acesso de rede e certificados válidos.

---

## 🧩 Instalação

```bash
npm install
```

Isso instalará as dependências de desenvolvimento declaradas em `package.json`.

---

## 🚀 Execução local

### Comandos principais

- **Executar app (preview com Fiori Launchpad):**
  ```bash
  npm start
  ```
- **Executar usando configuração local (`ui5-local.yaml`):**
  ```bash
  npm run start-local
  ```
- **Abrir diretamente a aplicação (sem FLP):**
  ```bash
  npm run start-noflp
  ```

### Sobre proxy/backend

- O arquivo `ui5-local.yaml` contém a configuração de proxy (`fiori-tools-proxy`) usada por `start-local`.  
- A configuração padrão aponta para `https://fiori.usga.com.br:8001`.  
- Se o backend usa certificado autoassinado, ajuste `ignoreCertError` com cautela ou instale o certificado raiz.

---

## 📜 Scripts (`package.json`)

| Script | Descrição |
|--------|------------|
| `start` | Inicia preview com Fiori Launchpad |
| `start-local` | Usa proxy/configuração local |
| `start-noflp` | Executa a app diretamente |
| `build` | Gera versão de produção (`dist/`) |
| `deploy` | Configura deploy via Fiori tools |
| `int-test` | Executa testes de integração (OPA) |

---

## 🧱 Estrutura do projeto

```
webapp/
 ├── controller/
 ├── view/
 ├── fragments/
 ├── model/
 │   ├── localdata/
 │   └── models.js
 ├── services/
 ├── util/
 ├── css/
 ├── i18n/
 └── test/
```

Arquivos principais:
- `manifest.json`, `Component.js` — configuração e bootstrap  
- `ui5.yaml`, `ui5-local.yaml` — configurações do UI5 Tooling  
- `middleware/` — middlewares customizados  

---

## 🧪 Dados locais (mock)

Em `webapp/model/localdata/`:
- `config/` — configurações e ranges  
- `iw38/` — preview de dados IW38  
- `downtime.json` — exemplos de downtime  

---

## 🔗 Serviços e integração

- `mainService` definido em `manifest.json` → `/sap/opu/odata/sap/ZC_EQ_MOVTO_CDS/`  
- Serviços JavaScript em `webapp/services/` encapsulam chamadas OData e leitura de mocks.  
  Ex.: `FuelService.js`, `VehiclesService.js`, `MaterialsService.js`.

---

## 🧩 Testes

- **Unitários:** `test/unit/*`  
- **Integração (OPA):** `test/integration/*`  
  ```bash
  npm run int-test
  ```

---

## 🏗️ Build e deploy

```bash
npm run build
```
Gera a pasta `dist` otimizada.  
O deploy pode ser configurado via Fiori Tools, Cloud Foundry ou repositório ABAP.

---

## ⚡ Configurações úteis

- `ui5-local.yaml` → servidor local e proxy  
- `ui5.yaml` → bibliotecas, minUI5Version e routing  

---

## 🧭 Próximos passos

- Adicionar script `unit-test` no `package.json`.  
- Documentar exemplos de uso dos serviços.  
- Incluir instruções de deploy SAP.  
- Ampliar cobertura de testes automatizados.  
- Adicionar arquivo de licença (se desejado).

---

## ✉️ Contato / Suporte

- **Autor:** Carlos Júnior  
- **Repositório:** privado (SkySinc / USGA)  
- **Uso restrito:** permitido somente com autorização prévia.  

---

## 🔏 Assinatura Digital

```
© 2025 SkySinc Technologies — Sistema "Gestão de Frota"
Desenvolvido por Carlos Júnior — Todos os direitos reservados.
Identificador digital: SKYSINC-FROTA-SECURE-25
Monitoramento ativo de IP e integridade de arquivos.
```
