Plano de Execucao — Etapas nomeadas (2025-10-22)

Resumo
- Total de etapas: 6 (E1 a E6)
- Objetivo: finalizar o OSDialog por periodo, corrigir encoding, garantir paginacao/filtragem e testes.

E1 — Revisao do OSDialog (range, _base, paginacao)
- Escopo: webapp/controller/OSDialog.js
- Acoes: reaplicar/refinar montagem de osDlg>/_base via AvailabilityService.fetchOsByVehiclesAndRange, calcular __stats, chamar _paginate() para preencher osDlg>/os; garantir que o filtro por tipos atue sobre /_base e repagine.
- Entregaveis: lista paginada consistente com o range e com os filtros de tipos.
- Criterios de conclusao: abrir o dialogo com um range (ex.: 10/2025) exibe a pagina 1 correta; navegar paginas atualiza hasPrev/hasNext e total.

E2 — Sincronizacao Main.controller e FilterUtil (range inclusivo)
- Escopo: webapp/controller/Main.controller.js, webapp/util/FilterUtil.js
- Acoes: assegurar que onOpenOSDialog envie { equnr, range } com Date validos; ajustar currentRange para fim inclusivo (D+1 00:00) e formato padronizado.
- Entregaveis: range consistente entre tela principal e dialogo, cobrindo o ultimo dia.
- Criterios de conclusao: OS do ultimo dia do periodo aparecem no dialogo sem off-by-one.

E3 — Ajustes de bindings no OSDialog.fragment
- Escopo: webapp/fragments/OSDialog.fragment.xml
- Acoes: revisar bindings para osDlg> (titulos, colunas, tooltips); garantir noDataText quando osDlg>/os estiver vazio apos filtragem.
- Entregaveis: fragment apresentavel com dados corretos e mensagens adequadas.
- Criterios de conclusao: UI exibe dados e noDataText conforme estado do modelo.

E4 — Normalizacao de encoding UTF-8
- Escopo: webapp/controller/*.js, webapp/fragments/*.xml, webapp/view/*.view.xml e JSONs relevantes.
- Acoes: converter para UTF-8 sem BOM, corrigindo mojibake (ex.: "Servico", "Proxima pagina"); ajustar textos onde necessario.
- Entregaveis: arquivos sem caracteres corrompidos.
- Criterios de conclusao: inspecao visual + linter/IDE sem avisos de encoding.

E5 — Execucao de testes (browser e headless)
- Escopo: webapp/test/testsuite.qunit.html, runner em scripts/*
- Acoes: rodar suite no navegador; reexecutar node scripts/run-qunit-headless.js apos correcoes; ajustar se houver timeout de QUnit.
- Entregaveis: testes unitarios do OSDialog passando; headless reportando conclusao.
- Criterios de conclusao: status verde no browser e headless sem timeout.

E6 — Documentacao e encerramento
- Escopo: este log e notas de entrega.
- Acoes: registrar resultado, decisoes e checklist final; opcionalmente apontar PR.
- Entregaveis: secao final do log com resultado e proximos passos (se houver).
- Criterios de conclusao: log atualizado e aceite do responsavel.

