
# frota — Gestão de Frota (SAP Fiori)

Aplicação SAP Fiori / UI5 para gerenciamento de frota desenvolvida com o generator do SAP Fiori (template Basic). O projeto contém uma UI5 app que consome um serviço OData (configurado no `manifest.json`) e também inclui dados locais de exemplo em `model/localdata` para desenvolvimento e testes offline.

## Sumário

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

## Visão geral

- Nome do app: frota
- Namespace: com.skysinc.frota.frota
- Título (i18n): Gestão de Frota
- UI5 versão mínima: 1.139.0
- Tema padrão: sap_horizon

O projeto foi gerado com o SAP Fiori tools (generator) e usa as ferramentas de desenvolvimento UI5 (`@ui5/cli` / `@sap/ux-ui5-tooling`).

## Pré-requisitos

- Node.js (LTS recomendado) e npm
- npm global (opcional): `@ui5/cli` pode ser usado localmente através dos scripts já configurados
- Para usar o proxy para backend SAP: acesso de rede/credenciais apropriadas e cuidado com certificados autoassinados

## Instalação

Abra um terminal (PowerShell no Windows) na pasta do projeto e execute:

```powershell
npm install
```

Isso instalará as dependências de desenvolvimento declaradas em `package.json` (ex.: `@sap/ux-ui5-tooling`, `@ui5/cli`, `ui5-middleware-simpleproxy`, etc.).

## Execução local

O `package.json` já possui scripts úteis. Comandos principais:

- Executar app (preview com FLP):

```powershell
npm start
```

- Executar usando a configuração local (`ui5-local.yaml`), útil para develop com live-reload e proxy local:

```powershell
npm run start-local
```

- Abrir diretamente a root (sem FLP):

```powershell
npm run start-noflp
```

Notas sobre proxy/backend

- O arquivo `ui5-local.yaml` contém configuração de proxy (fiori-tools-proxy) usada pelo comando `start-local`. No repositório atual a configuração aponta para `https://fiori.usga.com.br:8001` (veja `ui5-local.yaml`).
- Se o backend usa certificado autoassinado, você pode ajustar `ignoreCertError` ou `strictSSL`, mas tenha atenção a riscos de segurança — preferencialmente instale o certificado raiz localmente.

## Scripts (resumo do `package.json`)

- `start` — inicia preview/FLP (abertura automática em navegador)
- `start-local` — usa `ui5-local.yaml` (proxy/local config)
- `start-noflp` — abre `index.html` direto
- `build` — `ui5 build` para gerar `dist` (produção)
- `deploy` / `deploy-config` — scripts auxiliares fornecidos pelo Fiori tools
- `unit-test` — executa testes unitários QUnit
- `int-test` — executa testes de integração (OPA)

Exemplo (PowerShell):

```powershell
# start com preview FLP
npm start

# start usando configuração local (proxy)
npm run start-local

# build para produção
npm run build
```

## Estrutura do projeto (resumo)

- `webapp/` — código fonte da aplicação UI5
    - `index.html` — entrypoint
    - `Component.js` / `manifest.json` — configuração e bootstrap da app
    - `controller/` — controllers (App, Main, Config, HistoricalPage, etc.)
    - `view/` — views XML (App.view.xml, Main.view.xml, ...)
    - `fragments/` — fragments XML reutilizáveis (diálogos)
    - `i18n/` — arquivos de internacionalização (`i18n.properties`)
    - `css/` — estilos (style.css)
    - `model/` — models e dados locais (`models.js`, `localdata/`)
    - `services/` — serviços JS que encapsulam chamadas a OData/local (FuelService, VehiclesService, MaterialsService, etc.)
    - `util/` — utilitários (CsvUtil, FilterUtil, formatters)
    - `test/` — testes unitários e de integração

Arquivos de configuração na raiz:

- `package.json` — scripts e dependências de dev
- `ui5.yaml` / `ui5-local.yaml` — configuração do UI5 tooling / servidor local e proxy

## Dados locais (mock)

O projeto contém uma pasta de dados locais em `webapp/model/localdata/` organizada por ano/mês com arquivos `abastecimentos.json`. Esses arquivos servem como dados de exemplo para testes offline e desenvolvimento. Você pode inspecionar e usar esses JSONs diretamente em services que leem arquivos locais.

Estrutura exemplo:

```
webapp/model/localdata/2024/01/abastecimentos.json
webapp/model/localdata/2024/02/abastecimentos.json
...
```

## Serviços e integração

- O `manifest.json` define um datasource `mainService` apontando para `/sap/opu/odata/sap/ZC_EQ_MOVTO_CDS/` (OData v2). Serviços em `webapp/services/` encapsulam o consumo desse OData ou leitura de mocks locais.
- Arquivos relevantes: `FuelService.js`, `VehiclesService.js`, `MaterialsService.js`, `ODataMovtos.js`, `ODataVehicles.js`.

## Testes

- Testes unitários: `test/unit/*` — execute com:

```powershell
npm run unit-test
```

- Testes de integração (OPA): `test/integration/*` — execute com:

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

## Configurações úteis

- `ui5-local.yaml`: configura o servidor de desenvolvimento local (fiori-tools) e pode conter proxy para backend SAP. Ajuste `backend`/`url` e opções de certificado se necessário.
- `ui5.yaml`: configura o framework e bibliotecas usadas (minUI5Version, libs, routing).

## Problemas conhecidos / Dicas

- Se houver problemas com certificado (ambiente SAP com certificados internos), ajuste `ignoreCertError` em `ui5-local.yaml` com cuidado, ou instale o certificado no Windows.
- Verifique a compatibilidade da versão UI5 usada no backend se for necessário integrar com sistemas SAP reais.

## Contribuindo

- Abra issues descrevendo o problema e proponha PRs com mudanças pequenas e bem documentadas.
- Siga a convenção de código já existente (JavaScript, UI5 XML views).

## Licença

Nenhum arquivo de licença (`LICENSE`) foi encontrado neste repositório. Se você pretende tornar o projeto público, adicione um arquivo de licença (por exemplo, MIT, Apache-2.0) conforme necessário.

## Contato / Suporte

- Autor / repositório: Junior19908 (ver repositório local)
- Para dúvidas específicas sobre este projeto, inclua informações do ambiente e passos para reproduzir problemas em uma issue.

## Próximos passos sugeridos


---
