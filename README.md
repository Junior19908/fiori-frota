
# frota — Gestão de Frota (SAP Fiori)

Aplicação SAP Fiori / UI5 para gerenciamento de frota desenvolvida com o generator do SAP Fiori (template Basic). O projeto contém uma UI5 app que consome um serviço OData (configurado no `manifest.json`) e também inclui dados locais de exemplo em `webapp/model/localdata` para desenvolvimento e testes offline.

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
- Não é necessário instalar o `@ui5/cli` globalmente, pois já está como dependência de desenvolvimento.
- Para uso de proxy/backend SAP: acesso de rede/credenciais apropriadas e atenção a certificados autoassinados.

## Instalação

Abra um terminal na pasta do projeto e execute:

```bash
npm install
```

Isso instalará as dependências de desenvolvimento declaradas em `package.json` (ex.: `@sap/ux-ui5-tooling`, `@ui5/cli`, `ui5-middleware-simpleproxy`, etc.).

## Execução local

O `package.json` já possui scripts úteis. Comandos principais:


- Executar app (preview com Fiori Launchpad):

```bash
npm start
```

- Executar usando a configuração local (`ui5-local.yaml`), útil para desenvolvimento com live-reload e proxy local:

```bash
npm run start-local
```

- Abrir diretamente a aplicação (sem FLP):

```bash
npm run start-noflp
```


### Notas sobre proxy/backend

- O arquivo `ui5-local.yaml` contém configuração de proxy (fiori-tools-proxy) usada pelo comando `start-local`. No repositório atual a configuração aponta para `https://fiori.usga.com.br:8001` (veja `ui5-local.yaml`).
- Se o backend usa certificado autoassinado, você pode ajustar `ignoreCertError` ou `strictSSL`, mas tenha atenção a riscos de segurança — preferencialmente instale o certificado raiz localmente.

## Scripts principais (`package.json`)

- `start` — inicia preview com Fiori Launchpad (FLP)
- `start-local` — usa `ui5-local.yaml` (proxy/local config)
- `start-noflp` — abre `index.html` direto
- `build` — `ui5 build` para gerar `dist` (produção)
- `deploy` / `deploy-config` — scripts auxiliares fornecidos pelo Fiori tools
- `int-test` — executa testes de integração (OPA)

Exemplo:

```bash
# start com preview FLP
npm start

# start usando configuração local (proxy)
npm run start-local

# build para produção
npm run build
```

## Estrutura do projeto

- `webapp/` — código fonte da aplicação UI5
    - `index.html` — entrypoint
    - `Component.js` / `manifest.json` — configuração e bootstrap da app
    - `controller/` — controllers (App, Main, HistoricalPage, IW38Preview, Settings, etc.)
    - `view/` — views XML (App.view.xml, Main.view.xml, ...)
    - `fragments/` — fragments XML reutilizáveis (diálogos)
    - `i18n/` — arquivos de internacionalização (`i18n.properties`)
    - `css/` — estilos (style.css)
    - `model/` — models e dados locais (`models.js`, `localdata/`)
        - `localdata/` — dados mockados para desenvolvimento offline
    - `services/` — serviços JS que encapsulam chamadas a OData/local (FuelService, VehiclesService, MaterialsService, etc.)
    - `util/` — utilitários (CsvUtil, FilterUtil, formatter.js)
    - `test/` — testes unitários e de integração (QUnit, OPA)


Arquivos de configuração na raiz:

- `package.json` — scripts e dependências de dev
- `ui5.yaml` / `ui5-local.yaml` — configuração do UI5 tooling / servidor local e proxy
- `middleware/` — middlewares customizados para salvar configurações e ranges locais

## Dados locais (mock)

O projeto contém uma pasta de dados locais em `webapp/model/localdata/` organizada por contexto:

- `config/` — configurações e ranges (ex: `ranges_config.json`, `settings.json`)
- `iw38/` — preview de dados IW38 (ex: `preview.json`)
- `downtime.json` — exemplo de dados de downtime

Esses arquivos servem como dados de exemplo para testes offline e desenvolvimento. Você pode inspecionar e usar esses JSONs diretamente nos services.

## Serviços e integração

- O `manifest.json` define um datasource `mainService` apontando para `/sap/opu/odata/sap/ZC_EQ_MOVTO_CDS/` (OData v2). Serviços em `webapp/services/` encapsulam o consumo desse OData ou leitura de mocks locais.
- Arquivos relevantes: `FuelService.js`, `VehiclesService.js`, `MaterialsService.js`, `ODataMovtos.js`, `ODataVehicles.js`.

## Testes

- Testes unitários: `test/unit/*` — execute com:

```bash
# (Atenção: script unit-test não está presente no package.json, utilize QUnit manualmente ou configure conforme necessário)
```

- Testes de integração (OPA): `test/integration/*` — execute com:

```bash
npm run int-test
```

Os testes usam QUnit e OPA (conforme estrutura gerada pelo template do Fiori tools).

## Build e deploy

- Para gerar a build otimizada (pasta `dist`):

```bash
npm run build
```

- O deploy depende das suas ferramentas/infra (ex.: Cloud Foundry, ABAP repo). O projeto inclui scripts `deploy`/`deploy-config` do fiori tools que ajudam a configurar o deploy.

## Configurações úteis

- `ui5-local.yaml`: configura o servidor de desenvolvimento local (fiori-tools) e pode conter proxy para backend SAP. Ajuste `backend`/`url` e opções de certificado se necessário.
- `ui5.yaml`: configura o framework e bibliotecas usadas (minUI5Version, libs, routing).

## Problemas conhecidos / Dicas

- Se houver problemas com certificado (ambiente SAP com certificados internos), ajuste `ignoreCertError` em `ui5-local.yaml` com cuidado, ou instale o certificado no seu sistema operacional.
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

- Adicionar script de teste unitário (`unit-test`) no `package.json` para facilitar execução via npm.
- Documentar exemplos de uso dos serviços em `/webapp/services`.
- Adicionar instruções de deploy para ambientes SAP (Cloud Foundry, ABAP, etc).
- Melhorar cobertura de testes automatizados.
- Adicionar arquivo de licença.


## Teste de conexão MySQL/MariaDB (dev)

Um middleware simples (`middleware/mysqlPing.js`) permite testar uma futura migração do Firestore para MySQL/MariaDB:

- Copie `.env.example` para `.env` e ajuste `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.
- Instale dependências (inclui `mysql2`):

```bash
npm install
```

- Inicie o app (`npm start` ou `npm run start-local`).
- Abra a tela de Configurações, seção “Integração MySQL”, e clique em “Testar conexão (criar tabela ping)”.
- O endpoint `/local/mysql-ping` irá criar o banco (se não existir), a tabela `ping_test` e inserir um registro com `pong`.
- Você verá um toast com o resultado e poderá conferir a tabela no phpMyAdmin.



