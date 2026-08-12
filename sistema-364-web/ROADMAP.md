# Roadmap — 364 Foodservices / Grupo 364

## Concluído (jul/2026)

- [x] **Autenticação** — login por usuário e senha; usuário de teste `admin`/`admin`
      (criado por `supabase/usuarios_permissoes.sql`)
- [x] **Usuários e permissões** (`/usuarios`, só administradores) — cadastro completo
      (nome, usuário, e-mail, telefone, CPF), edição, troca de senha, permissão de
      acesso por aba (tabela `permissoes`) e por empresa (tabela `usuario_empresas`)
- [x] **Layout do protótipo** — sidebar com navegação filtrada por permissão
      (`components/AppShell.js` + `app/globals.css`)
- [x] **ERP multiempresa (Grupo 364)** — camada `grupos → empresas → unidades` por
      cima do schema original; as 4 marcas (364 Steakhouse, 364 Food Service, 364
      Burguer, 364 Foodtruck/Afya) compartilham o mesmo sistema com dados isolados
      por `empresa_id` + RLS (`empresas_permitidas()`), seletor de empresa na sidebar
      (`lib/empresa.js`). Todos os dados reais existentes foram preservados sob
      "364 Food Service"; as demais marcas nascem vazias, prontas para uso.
- [x] **Dashboard** (`/`) — KPIs, últimos recebimentos e pedidos
- [x] **Fornecedores** (`/fornecedores`)
- [x] **Produtos** (`/produtos`) — matérias-primas + catálogo com código automático
      por empresa (`0364-XXX` no Food Service, `STK-XXX`, `BURG-XXX`, `AFYA-XXX` nas
      demais) + ficha técnica
- [x] **Recebimento** (`/recebimentos`) — lote automático `LT-AAMMDD-###` por empresa
      + **ficha impressa**
- [x] **Produção** (`/producoes`) — consumo calculado pela ficha técnica, custo pelo
      custo médio da matéria-prima, validade automática + **ficha impressa**
- [x] **Estoque** (`/estoque`) — somente leitura, via views `vw_estoque_*`
- [x] **Clientes** (`/clientes`)
- [x] **Pedidos de venda** (`/pedidos`) — itens, status, baixa de estoque via view
      + **pedido impresso**
- [x] **Funcionários** (`/funcionarios`) — cadastro por empresa, ativar/inativar,
      usado como "Responsável" em recebimento, produção, pedidos e despesas
- [x] **Despesas** (`/despesas`)
- [x] **Relatórios** (`/relatorios`) — DRE simplificado, fluxo de caixa, produção e
      compras por fornecedor
- [x] **Fichas impressas** — `components/FichaPrint.js`: modelo em preto e branco com
      cabeçalho, campos, itens, observações e assinaturas (botão "Imprimir ficha")
- [x] **Controle de qualidade no Recebimento** — lote do fornecedor, temperatura,
      condição da embalagem, peso conferido vs. peso na nota fiscal (com aviso de
      divergência), status Aceito/Aceito com ressalva/Rejeitado (só os dois primeiros
      contam no saldo de estoque e no custo médio), local de armazenamento, aprovação
      por responsável de qualidade (segundo campo, distinto de quem recebeu), anexo de
      nota fiscal e foto do produto (Supabase Storage, bucket privado `recebimentos`,
      acesso via signed URL sob demanda). Matérias-primas ganharam `categoria` e
      `preco_alvo_kg`, usado para avisar quando o custo do lote vem acima do esperado.
- [x] **Recebimento por nota com múltiplas matérias-primas** — reestruturado para o
      padrão cabeçalho + itens (igual Pedidos). Uma primeira versão simples desse
      formato foi implementada de forma independente por duas sessões em paralelo;
      a versão que ficou valendo é a mais completa, descrita nas seções "Recebimento
      — cabeçalho + itens" e "Módulo central de Suprimentos" logo abaixo (formulário
      dinâmico por matéria-prima, depósito real, inspeção de qualidade separada,
      estoque como ledger).

### Produção avançada (descoberta já existente no banco, não construída pelo frontend ainda)

Durante a migração multiempresa foi encontrado, já em uso no banco de dados, um fluxo
de produção mais detalhado que o do frontend atual — recebimento → **defumação**
(`defumacoes`/`defumacao_itens`, com rendimento: peso bruto, perda de limpeza, sobra,
peso final) → **embalagem** (`embalagens`/`embalagem_itens`, que via trigger
`trg_embalagem_items_to_producao` gera automaticamente o registro em `producoes`) →
pedido. Também existem, ainda sem tela: `assinaturas`/`assinatura_entregas`
(entregas recorrentes por cliente) e `cliente_precos` (preço negociado por cliente).
Todas essas tabelas já receberam `empresa_id` + RLS multiempresa
(`atualizacao_04`/`06`), e o trigger foi corrigido para propagar a empresa
(`atualizacao_08_producao_avancada.sql`) — mas **não têm telas no frontend ainda**.
Isso é trabalho de outra sessão/pessoa; vale sincronizar antes de construir as telas
para não duplicar esforço.

### Recebimento — cabeçalho + itens (descoberta já existente no banco, jul/2026)

Durante o diagnóstico para o módulo central de Suprimentos, foi encontrado que a
tabela `recebimentos` já havia sido dividida manualmente, direto no Supabase, em
`recebimentos` (cabeçalho: data, fornecedor, nota fiscal, responsável, temperatura,
anexo da nota) + `recebimento_itens` (linhas: matéria-prima, lote, validade, custo,
status sanitário, condição da embalagem, local de armazenamento, foto, aprovador) —
sem que essa alteração fosse commitada no repositório nem refletida no frontend. Isso
deixou o formulário de novo recebimento, a tela de Estoque e o relatório de compras
por fornecedor gravando/lendo colunas que não existiam mais na tabela `recebimentos`.
Corrigido: `app/recebimentos/page.js`, `app/estoque/page.js`, `app/relatorios/page.js`
e `lib/format.js` (`proximoLote`) agora leem/gravam corretamente em
`recebimentos` + `recebimento_itens`; `supabase/atualizacao_10_catchup_recebimento_itens.sql`
documenta o schema real (idempotente — não faz nada se já aplicado).

### SQL a rodar no Supabase (ordem)

1. `supabase/schema.sql`
2. `supabase/usuarios_permissoes.sql`
3. `supabase/atualizacao_02_cadastro.sql`
4. `supabase/atualizacao_03_grupos_empresas.sql`
5. `supabase/atualizacao_04_empresa_id_backfill.sql`
6. `supabase/atualizacao_05_usuario_empresas.sql`
7. `supabase/atualizacao_06_rls_multiempresa.sql`
8. `supabase/atualizacao_07_views_empresa.sql` (requer Postgres 15+; confirmar com `select version();`)
9. `supabase/atualizacao_08_producao_avancada.sql`
10. `supabase/atualizacao_09_recebimento_qualidade.sql`
11. `supabase/atualizacao_10_catchup_recebimento_itens.sql`
12. `supabase/atualizacao_11_fundacao_suprimentos.sql`
13. `supabase/atualizacao_12_audit_log.sql`
14. `supabase/atualizacao_13_rls_permissao_modulo.sql`
15. `supabase/atualizacao_14_recebimento_multiitem.sql`
16. `supabase/atualizacao_15_inspecoes_qualidade.sql`
17. `supabase/atualizacao_16_estoque_ledger.sql`
18. `supabase/atualizacao_17_ponto_cadastros.sql` (módulo Ponto — requer bucket privado `colaboradores` no Storage)
19. `supabase/atualizacao_18_ponto_marcacoes.sql` (módulo Ponto — dispositivos, biometria, marcações NSR+hash)
20. `supabase/atualizacao_19_ponto_storage.sql` (módulo Ponto — policies do bucket `colaboradores`)
21. `supabase/atualizacao_20_colaborador_acesso.sql` (colaborador como cadastro-mestre de acesso — `colaboradores.user_id`)
22. `supabase/atualizacao_21_unificar_colaboradores.sql` (backfill: cria colaborador para cada funcionário ativo com CPF que ainda não tinha um, casando por CPF; migra permissão `funcionarios` → `ponto`)

> Nota: duas sessões distintas trabalharam em paralelo em jul/2026 — uma no módulo
> Ponto (reconhecimento facial), outra no módulo central de Suprimentos — cada uma
> sem visibilidade do commit da outra. Ambas as sequências de SQL já foram executadas
> integralmente no projeto Supabase em uso (`yvouevyfhtmbtankoofx`); os arquivos aqui
> foram renumerados sequencialmente (17-21, antes 11-15) só para eliminar a colisão de
> número no repositório — o conteúdo é idêntico ao que já rodou. Motivo de terem sido
> descobertas juntas: ao reconciliar as duas branches percebemos que a divisão de
> `recebimentos` em cabeçalho + `recebimento_itens` (que a sequência de Suprimentos
> documenta em `atualizacao_10_catchup_recebimento_itens.sql`) e o módulo Ponto foram
> ambos aplicados manualmente no banco por sessões diferentes, sem que uma soubesse da
> outra — daí a colisão de numeração ao juntar as branches.
>
> Nota: em 30/jul/2026 as atualizações 17, 18 e 19 (Ponto) foram executadas no projeto
> `yvouevyfhtmbtankoofx` e o bucket privado `colaboradores` foi criado no Storage.
> A tabela de auditoria do módulo chama-se `ponto_audit_logs` porque já existia
> uma `audit_logs` (fundação Release 0, estrutura diferente) no banco — as duas
> coexistem sem conflito.
>
> Nota: os dados (fornecedores, produtos, usuários, permissões, empresas) continuam no
> banco mesmo depois de uma restauração do código local — só rode o SQL de novo do
> zero se estiver apontando para um projeto Supabase novo/vazio.

## Módulo de Ponto com Reconhecimento Facial (jul/2026 — Fase 1 + início da Fase 2)

Implementado conforme a especificação de requisitos do controle de jornada (REP-P /
Portaria MTP 671, LGPD). Módulo `ponto` novo na sidebar (permissão própria).

- **Cadastros** (`atualizacao_17`): `empregadores` (CNPJ real, nível grupo — as
  marcas continuam sendo a dimensão de isolamento por `empresa_id`), `unidades`
  estendida (endereço, lat/long, fuso, empregador), `centros_custo`,
  `colaboradores` (canônico, 1 por CPF, dados trabalhistas completos),
  `colaborador_unidades` (vigência), `escalas`/`escala_dias`/`colaborador_escalas`
  (histórico com exclusion constraint contra vigências sobrepostas), `ponto_audit_logs`
  imutável + trigger genérica `fn_audit()` em todas as tabelas do módulo.
- **Marcações** (`atualizacao_18`): `ponto_dispositivos` (tablets, token com hash),
  `ponto_pins` (PIN de contingência, só servidor), `ponto_biometrias` (descritores
  128-d cifrados AES-256-GCM — nunca foto bruta), LGPD (`ponto_avisos_privacidade` +
  `ponto_consentimentos`), `ponto_marcacoes` **imutável** com **NSR sequencial por
  empregador** (lock transacional, sem furos) e **hash encadeado** (sha256 +
  previous_hash), `ponto_tentativas`, funções `registrar_marcacao()` (só service
  role, hora oficial = `now()` do Postgres, idempotência p/ retry) e
  `verificar_cadeia_marcacoes()` (admin).
- **Telas**: `/ponto/colaboradores` (+ foto no bucket `colaboradores`, vínculos de
  unidade, PIN, cadastro biométrico em `/ponto/colaboradores/[id]/facial` com aviso
  de privacidade e 3 amostras), `/ponto/escalas`, `/ponto/marcacoes` (consulta,
  manual com motivo, verificação de integridade), `/ponto/unidades` (empregadores +
  unidades + centros de custo), `/ponto/dispositivos` (código de ativação 15 min).
- **Quiosque** (`/quiosque`, fullscreen, sem login): ativação por código → token de
  device (localStorage; banco só guarda hash) → sync de descritores + relógio do
  servidor a cada 60 s → captura → prova de vida (piscada via EAR) → matching
  euclidiano no cliente (limiar 0.45 + margem) → confirmação com tipo sugerido →
  gravação via API service-role → comprovante com NSR e hash.
- **Reconhecimento facial**: `@vladmandic/face-api`, modelos locais em
  `public/models` (~7 MB, sem serviço externo). Limiar em `lib/facial.js`.
- **Env nova**: `PONTO_BIOMETRIA_CHAVE` (32 bytes base64) — perder = recadastrar
  biometrias. APIs service-role em `app/api/ponto/*`.

Fora desta entrega (ganchos prontos): AFD/AEJ, espelho de ponto, apuração de
jornada/banco de horas, ajustes de marcação (`ponto_ajustes` futura referenciando
NSR), offline robusto no quiosque, assinatura ICP-Brasil, geofencing.

### Colaborador como cadastro-mestre de acesso (30/jul/2026)

O cadastro de colaborador passou a gerenciar também o **acesso ao sistema**
(painel "Acesso", admin-only, em `/ponto/colaboradores`): cria login novo ou
vincula um login existente (`colaboradores.user_id`, atualizacao_20), define
permissões por aba (`permissoes`) e empresas (`usuario_empresas`), troca senha e
revoga acesso. Ao salvar, a tabela `funcionarios` é sincronizada (1 linha por
empresa concedida, com `colaborador_id`, nome/email/telefone/cpf/cargo do
colaborador) — os dropdowns de "Responsável" das telas operacionais continuam
funcionando sem alteração. **Desligar um colaborador revoga o acesso
automaticamente**: login banido, permissões/empresas removidas, funcionários
inativados, tudo em `ponto_audit_logs`. API: `app/api/ponto/colaboradores/acesso`.

A antiga tela **/usuarios foi aposentada** (redireciona para colaboradores; link
removido da sidebar). `app/api/usuarios/route.js` foi mantida sem UI como válvula
de escape de admin — pode ser removida no futuro. Pendência: quando a edição de
dados do colaborador for construída, re-sincronizar `funcionarios` na edição
(hoje a sincronização roda ao salvar o acesso e no desligamento).

### Cadastro único: /funcionarios também foi unificado (30/jul/2026)

A antiga tela **/funcionarios foi aposentada** (redireciona para
`/ponto/colaboradores`; módulo `funcionarios` removido de `MODULOS` em
`lib/auth.js`). A tabela `funcionarios` **continua existindo** por baixo — é
a origem dos dropdowns de "Responsável" em Recebimento, Produção, Pedidos e
Despesas (FKs `responsavel_id`/`aprovado_por_id`) — mas deixou de ter tela
própria: agora ela é só uma projeção do colaborador, sincronizada
automaticamente (ver seção anterior).

`atualizacao_21_unificar_colaboradores.sql` fez o backfill único: criou um
colaborador para cada funcionário ativo com CPF que ainda não tinha
`colaborador_id`, casando por CPF quando um colaborador com o mesmo CPF já
existia (evita duplicar pessoa — foi o caso do próprio Gustavo, cadastrado
como funcionário em duas marcas com o mesmo CPF). Usuários que só tinham o
módulo `funcionarios` ganharam o módulo `ponto` para não perder acesso.
Funcionários **sem CPF cadastrado** ficam de fora do backfill (não dá pra
unificar com segurança) — se existirem, seguem como "legados" sem
colaborador; verificar com `select * from funcionarios where colaborador_id
is null and ativo` se for preciso tratá-los manualmente.

## Próximos passos

O dono do negócio está passando melhorias módulo a módulo (começou por Recebimento,
concluído acima) — próximos módulos vêm em mensagens separadas, mesma dinâmica.

### Módulo central de Suprimentos (em andamento, jul/2026)

Plano em 7 etapas para transformar Recebimento num motor único, configurável por item,
que atende todas as empresas/unidades do Grupo 364 (recebimento com controle dinâmico
por item, estoque como ledger, requisições internas, transferências, consumo direto,
centros de custo, indicadores). Etapas:

- [x] **Etapa 1 — Fundação**: `depositos`, `centros_custo`, regra de recebimento por
      item em `materias_primas` (`controle_recebimento`: simples/validade/lote +
      exigências de temperatura/inspeção/foto/documento sanitário), seed real de
      `unidades` (Matriz por empresa + CD do Grupo 364), `audit_logs` (append-only),
      reforço de RLS por permissão de módulo nas tabelas novas (`atualizacao_11/12/13`).
      Telas novas: `/depositos`, `/centros-custo`; `/produtos` ganhou os campos de
      regra de recebimento no formulário de matéria-prima.
- [x] **Etapa 2.1 — Recebimento multi-item + depósito real**: `/recebimentos` deixou
      de gravar 1 item por envio e passou a aceitar N itens numa mesma nota fiscal
      (cabeçalho preenchido uma vez, itens adicionados a uma lista antes de
      "Registrar recebimento"), com o formulário do item mudando dinamicamente
      conforme `controle_recebimento` da matéria-prima selecionada (Simples esconde
      validade/lote/qualidade; Validade controlada mostra validade+condição+status;
      Lote completo mostra tudo, incluindo lote do fornecedor). `deposito_id` liga o
      item a um depósito real (Etapa 1), com `local_armazenamento` mantido como
      complemento (endereço específico dentro do depósito). `temperatura_c` migrou do
      cabeçalho para o item (a exigência é por item, não por nota) — a coluna antiga
      em `recebimentos` fica órfã até a Etapa 2.2. Lotes sequenciais de uma mesma
      submissão são gerados em lote via `proximosLotes()` (evita 1 consulta por item
      e corrida entre itens). Testado ponta a ponta em produção (nota com 2 itens de
      regras diferentes, exclusão limpa depois). `supabase/atualizacao_14_recebimento_multiitem.sql`.
- [x] **Etapa 2.2 — Inspeção de qualidade como entidade separada**: `inspecoes_qualidade`
      com o status sanitário completo (pendente/aprovado/aprovado_com_ressalva/
      quarentena/rejeitado/devolvido — antes só 3 valores soltos em
      `status_recebimento`), incluindo motivo de rejeição/quarentena, documento
      sanitário e foto próprios (antes só a foto vivia em `recebimento_itens`). Os
      dados existentes foram migrados (status antigo → novo, mapeamento 1:1) e as
      colunas antigas (`status_recebimento`, `condicao_embalagem`, `temperatura_c`,
      `aprovado_por_id`, `foto_produto_url` em `recebimento_itens`; `temperatura_c`
      órfã em `recebimentos`) foram removidas — não há mais duplicidade de dados de
      qualidade. `vw_estoque_materia_prima` e o trigger de embalagem→produção passam a
      considerar `inspecoes_qualidade.status`: só aprovado/aprovado_com_ressalva contam
      no saldo — quarentena e rejeitado ficam registrados mas fora do estoque
      disponível (não podem ser "usados"). Durante o levantamento também foram achados
      e corrigidos 2 bugs preexistentes (não desta etapa, remanescentes da divisão
      cabeçalho+itens original): o Dashboard (`app/page.js`) e a Produção
      (`app/producoes/page.js`, que consequentemente sempre calculava custo pelo valor
      cadastrado em vez do custo médio real) ainda liam a tabela `recebimentos` no
      formato antigo. Testado ponta a ponta em produção (item em quarentena com
      motivo e temperatura, exclusão limpa depois). `supabase/atualizacao_15_inspecoes_qualidade.sql`.
- [x] **Etapa 3 — Estoque como ledger**: `stock_movements` (histórico append-only —
      sem UPDATE/DELETE nunca, só estorno/ajuste) + `stock_balances` (saldo
      materializado por empresa/depósito/matéria-prima/lote, mantido por trigger a
      cada movimento). Trigger em `inspecoes_qualidade`: quando um item é aprovado
      (na criação ou numa atualização futura de status), gera automaticamente a
      entrada no estoque — fecha "ao concluir o recebimento, gerar entrada
      automaticamente" sem depender do frontend lembrar de fazer isso. Backfill dos
      6 itens já aprovados. `vw_estoque_materia_prima` (mesmo formato de colunas)
      passa a somar `stock_balances` em vez de recalcular via join toda vez —
      `/estoque` não precisou mudar a query da tabela principal. Custo médio em
      `/estoque` e `/producoes` também migrou de recalcular via join com
      `inspecoes_qualidade` para ler direto do ledger (mais simples, já pré-filtrado).
      Cada movimento gera automaticamente um registro em `audit_logs` (criada na
      Etapa 1, esse foi o primeiro uso real dela). Testado ponta a ponta via API
      direta (Chrome instável no momento do teste): inspeção aprovada → movimento →
      saldo → view, tudo automático; dados de teste limpos depois.
      `supabase/atualizacao_16_estoque_ledger.sql`.
- [ ] **Etapa 4 — Requisições internas** (`/requisicoes`)
- [ ] **Etapa 5 — Transferências entre unidades/depósitos** (`/transferencias`)
- [ ] **Etapa 6 — Consumo direto com centro de custo obrigatório** (`/consumos`)
- [ ] **Etapa 7 — Indicadores** (dashboard do CD, alertas de validade/mínimo)

- [ ] **Testar upload real de anexo** (nota fiscal/foto) no Recebimento em produção —
      o fluxo foi implementado e verificado por leitura de código, mas o teste
      automatizado não exercitou um upload de arquivo de verdade
- [ ] **Telas de defumação, embalagem, assinaturas e preços por cliente** — o banco já
      suporta multiempresa nessas tabelas; falta construir as páginas
- [ ] **CRM**: Leads/Oportunidades, funil de vendas, histórico de interações, tarefas
      de follow-up, conversão lead → cliente
- [ ] **Vincular login a funcionário automaticamente** — usar o funcionário do
      usuário logado como "Responsável" padrão nos formulários
- [ ] **Permissão por aba × empresa** — hoje são dimensões independentes (uma aba
      concedida vale para todas as empresas do usuário); evoluir para matriz se
      algum papel precisar de mistura (ex: Vendas só na Steakhouse, Financeiro em todas)
- [ ] **FKs compostas cross-empresa** (`unique(id, empresa_id)` + FK composta) para
      reforçar que registros de uma empresa nunca referenciem outra
- [ ] **Tela de administração de Grupos/Empresas** — hoje as 4 empresas são fixas via
      seed SQL; CNPJ e prefixo ainda não preenchidos, ajustáveis direto no banco
- [ ] **Filtros por período nos relatórios** (mês/ano)
- [ ] **Trocar admin/admin** e revogar a chave secreta usada no desenvolvimento antes
      de ir a produção

## Referência

O protótipo funcional completo (HTML único, lógica de negócio validada) está em
`referencia/sistema-364-prototipo.html` — os módulos de negócio original seguem esse
comportamento, com os dados no Supabase em vez de memória. Não cobre defumação,
embalagem, assinaturas ou preços por cliente (ver seção acima).
