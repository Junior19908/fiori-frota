
# frota â€” GestÃ£o de Frota (SAP Fiori)

AplicaÃ§Ã£o SAP Fiori / UI5 para gerenciamento de frota desenvolvida com o generator do SAP Fiori (template Basic). O projeto contÃ©m uma UI5 app que consome um serviÃ§o OData (configurado no `manifest.json`) e tambÃ©m inclui dados locais de exemplo em `model/localdata` para desenvolvimento e testes offline.

## SumÃ¡rio

- VisÃ£o geral
- PrÃ©-requisitos
- InstalaÃ§Ã£o
- ExecuÃ§Ã£o local (com e sem proxy)
- Scripts Ãºteis (npm)
- Estrutura do projeto
- Dados locais (mock)
- Testes
- Build e deploy
- Notas e melhorias sugeridas

## VisÃ£o geral

- Nome do app: frota
- Namespace: com.skysinc.frota.frota
- TÃ­tulo (i18n): GestÃ£o de Frota
- UI5 versÃ£o mÃ­nima: 1.139.0
- Tema padrÃ£o: sap_horizon

O projeto foi gerado com o SAP Fiori tools (generator) e usa as ferramentas de desenvolvimento UI5 (`@ui5/cli` / `@sap/ux-ui5-tooling`).

## PrÃ©-requisitos

- Node.js (LTS recomendado) e npm
- npm global (opcional): `@ui5/cli` pode ser usado localmente atravÃ©s dos scripts jÃ¡ configurados
- Para usar o proxy para backend SAP: acesso de rede/credenciais apropriadas e cuidado com certificados autoassinados

## InstalaÃ§Ã£o

Abra um terminal (PowerShell no Windows) na pasta do projeto e execute:

```powershell
npm install
```

Isso instalarÃ¡ as dependÃªncias de desenvolvimento declaradas em `package.json` (ex.: `@sap/ux-ui5-tooling`, `@ui5/cli`, `ui5-middleware-simpleproxy`, etc.).

## ExecuÃ§Ã£o local

O `package.json` jÃ¡ possui scripts Ãºteis. Comandos principais:

- Executar app (preview com FLP):

```powershell
npm start
```

- Executar usando a configuraÃ§Ã£o local (`ui5-local.yaml`), Ãºtil para develop com live-reload e proxy local:

```powershell
npm run start-local
```

- Abrir diretamente a root (sem FLP):

```powershell
npm run start-noflp
```

Notas sobre proxy/backend

- O arquivo `ui5-local.yaml` contÃ©m configuraÃ§Ã£o de proxy (fiori-tools-proxy) usada pelo comando `start-local`. No repositório atual a configuraÃ§Ã£o aponta para `https://fiori.usga.com.br:8001` (veja `ui5-local.yaml`).
- Se o backend usa certificado autoassinado, vocÃª pode ajustar `ignoreCertError` ou `strictSSL`, mas tenha atenÃ§Ã£o a riscos de seguranÃ§a â€” preferencialmente instale o certificado raiz localmente.

## Scripts (resumo do `package.json`)

- `start` â€” inicia preview/FLP (abertura automÃ¡tica em navegador)
- `start-local` â€” usa `ui5-local.yaml` (proxy/local config)
- `start-noflp` â€” abre `index.html` direto
- `build` â€” `ui5 build` para gerar `dist` (produÃ§Ã£o)
- `deploy` / `deploy-config` â€” scripts auxiliares fornecidos pelo Fiori tools
- `unit-test` â€” executa testes unitÃ¡rios QUnit
- `int-test` â€” executa testes de integraÃ§Ã£o (OPA)

Exemplo (PowerShell):

```powershell
# start com preview FLP
npm start

# start usando configuraÃ§Ã£o local (proxy)
npm run start-local

# build para produÃ§Ã£o
npm run build
```

## Estrutura do projeto (resumo)

- `webapp/` â€” cÃ³digo fonte da aplicaÃ§Ã£o UI5
    - `index.html` â€” entrypoint
    - `Component.js` / `manifest.json` â€” configuraÃ§Ã£o e bootstrap da app
    - `controller/` â€” controllers (App, Main, Config, HistoricalPage, etc.)
    - `view/` â€” views XML (App.view.xml, Main.view.xml, ...)
    - `fragments/` â€” fragments XML reutilizÃ¡veis (diÃ¡logos)
    - `i18n/` â€” arquivos de internacionalizaÃ§Ã£o (`i18n.properties`)
    - `css/` â€” estilos (style.css)
    - `model/` â€” models e dados locais (`models.js`, `localdata/`)
    - `services/` â€” serviÃ§os JS que encapsulam chamadas a OData/local (FuelService, VehiclesService, MaterialsService, etc.)
    - `util/` â€” utilitÃ¡rios (CsvUtil, FilterUtil, formatters)
    - `test/` â€” testes unitÃ¡rios e de integraÃ§Ã£o

Arquivos de configuraÃ§Ã£o na raiz:

- `package.json` â€” scripts e dependÃªncias de dev
- `ui5.yaml` / `ui5-local.yaml` â€” configuraÃ§Ã£o do UI5 tooling / servidor local e proxy

## Dados locais (mock)

O projeto contÃ©m uma pasta de dados locais em `webapp/model/localdata/` organizada por ano/mÃªs com arquivos `abastecimentos.json`. Esses arquivos servem como dados de exemplo para testes offline e desenvolvimento. VocÃª pode inspecionar e usar esses JSONs diretamente em services que leem arquivos locais.

Estrutura exemplo:

```
webapp/model/localdata/2024/01/abastecimentos.json
webapp/model/localdata/2024/02/abastecimentos.json
...
```

## ServiÃ§os e integraÃ§Ã£o

- O `manifest.json` define um datasource `mainService` apontando para `/sap/opu/odata/sap/ZC_EQ_MOVTO_CDS/` (OData v2). ServiÃ§os em `webapp/services/` encapsulam o consumo desse OData ou leitura de mocks locais.
- Arquivos relevantes: `FuelService.js`, `VehiclesService.js`, `MaterialsService.js`, `ODataMovtos.js`, `ODataVehicles.js`.

## Testes

- Testes unitÃ¡rios: `test/unit/*` â€” execute com:

```powershell
npm run unit-test
```

- Testes de integraÃ§Ã£o (OPA): `test/integration/*` â€” execute com:

```powershell
npm run int-test
```

Os testes usam QUnit e OPA (conforme estrutura gerada pelo template do Fiori tools).

## Build e deploy

- Para gerar a build otimizada (pasta `dist`):

```powershell
npm run build
```

- O deploy depende das suas ferramentas/infra (ex.: Cloud Foundry, ABAP repo). O projeto inclui scripts `deploy`/`deploy-config` do fiori tools que ajudam a configurar o deploy.

## ConfiguraÃ§Ãµes Ãºteis

- `ui5-local.yaml`: configura o servidor de desenvolvimento local (fiori-tools) e pode conter proxy para backend SAP. Ajuste `backend`/`url` e opÃ§Ãµes de certificado se necessÃ¡rio.
- `ui5.yaml`: configura o framework e bibliotecas usadas (minUI5Version, libs, routing).

## Problemas conhecidos / Dicas

- Se houver problemas com certificado (ambiente SAP com certificados internos), ajuste `ignoreCertError` em `ui5-local.yaml` com cuidado, ou instale o certificado no Windows.
- Verifique a compatibilidade da versÃ£o UI5 usada no backend se for necessÃ¡rio integrar com sistemas SAP reais.

## Contribuindo

- Abra issues descrevendo o problema e proponha PRs com mudanÃ§as pequenas e bem documentadas.
- Siga a convenÃ§Ã£o de cÃ³digo jÃ¡ existente (JavaScript, UI5 XML views).

## LicenÃ§a

Nenhum arquivo de licenÃ§a (`LICENSE`) foi encontrado neste repositório. Se vocÃª pretende tornar o projeto pÃºblico, adicione um arquivo de licenÃ§a (por exemplo, MIT, Apache-2.0) conforme necessÃ¡rio.

## Contato / Suporte

- Autor / repositório: Junior19908 (ver repositório local)
- Para dÃºvidas especÃ­ficas sobre este projeto, inclua informaÃ§Ãµes do ambiente e passos para reproduzir problemas em uma issue.

## PrÃ³ximos passos sugeridos



