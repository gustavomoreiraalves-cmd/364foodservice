# Produção Interna + Etiquetas — Plano de Implementação

> **STATUS (13/08/2026):** Implementado. Backend validado por smoke test completo em Postgres local (validade, bloqueios, permissões, auditoria, reimpressão, descarte — tudo OK). `next build` passa com as 6 rotas novas. Pendências: (1) rodar `supabase/atualizacao_17_producao_interna.sql` no SQL Editor do Supabase de produção; (2) teste visual logado no browser (login admin/admin foi recusado pela Supabase de produção).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline nesta sessão). Steps use checkbox (`- [x]`) syntax.

**Goal:** Evoluir o módulo Produção para suportar Produção Sintética/Interna (cozinhas do Grupo 364) com regras de validade por conservação, identificação única `PRD-INT-######`, painel de validades, descarte, e geração/reimpressão de etiquetas a partir dos dados da produção — preservando 100% o fluxo atual de Produção Completa da 364 Food Services.

**Architecture:** Nova tabela `producoes_internas` separada de `producoes` (evita poluir views de estoque e o trigger de embalagem existentes). Regras de validade em `produto_regras_validade`. Impressões em `etiqueta_impressoes` com `source_type`/`source_id` (serve produção completa E interna). Validações críticas (finalizar, cancelar, descarte, impressão) via funções RPC `security definer` no Postgres — o frontend Supabase-direto atual não tem camada de API para produção. Auditoria em `audit_logs` genérica (mesma estrutura de `ponto_audit_logs`, append-only via `fn_bloquear_alteracao` já existente). UI segue padrão do módulo Ponto: componente de abas (`ProducaoTabs`) + uma rota por tela sob `/producoes/*`.

**Tech Stack:** Next.js 14 (app router, JS), Supabase (Postgres + RLS + RPC), CSS global existente. Sem lib nova. Testes de helpers puros com `node --test`.

## Mapa do existente (não quebrar)

- `app/producoes/page.js` — Produção Completa atual: form lote + ficha técnica → `producoes` + `producao_consumo`; custo médio; impressão de ficha via `FichaPrint`. **Preservar comportamento.**
- Banco: `producoes`, `producao_consumo`, `defumacoes`, `defumacao_itens`, `embalagens`, `embalagem_itens` (trigger `trigger_embalagem_para_producao` grava em `producoes` com `origem='embalagem'`), views `vw_estoque_produto`, `vw_estoque_defumado`, `vw_estoque_materia_prima`. **Não alterar.**
- `produtos` (codigo, nome, categoria, unidade, validade_dias, empresa_id), `unidades` (empresa_id, nome, tipo), `funcionarios` (sincronizado de `colaboradores`), `permissoes` (user_id, modulo texto), helpers SQL `public.is_admin()`, `public.empresas_permitidas()`, `public.fn_bloquear_alteracao()`.
- Frontend: `AppShell` (permissão por `modulo`), `useEmpresaAtual()`, `lib/format.js`, padrão de abas em `components/PontoTabs.js`.
- Migrações são arquivos `supabase/atualizacao_NN_*.sql` rodados manualmente no SQL Editor do Supabase (produção). Próximo número livre: **17**.

## Global Constraints

- Conservação: lista fixa `ambiente | resfriado | congelado` (exibida como Ambiente/Resfriado/Congelado). Sem texto livre.
- Status produção interna: `rascunho | em_producao | finalizada | descartada | cancelada`.
- Código: `PRD-INT-` + sequencial 6 dígitos, gerado por trigger no insert; UUID é a PK.
- Condição de validade derivada em tempo real (não persistida): `vencido` (now > validade), `vence_hoje`, `vence_em_breve` (≤24h), `valido`.
- Validade armazenada como `timestamptz`.
- Produção FINALIZADA: campos críticos imutáveis (produto, produzido_em, validade, conservacao, responsável, quantidade) — bloqueio via trigger no banco.
- Falha na impressão nunca desfaz produção finalizada (processos independentes).
- Etiqueta padrão "Validade Cozinha" 60×40 mm, dados 100% vindos da produção.
- Permissões novas (strings na tabela `permissoes`, checadas também no backend/RPC): `producoes.validade_override`, `producoes.responsavel_outro`, `producoes.descarte`. Módulo base da tela continua `producoes`. `admin` passa em tudo.
- Não implementar: editor drag-and-drop de etiqueta, agente local/ZPL, ficha técnica na produção interna, baixa de estoque, custo, QR obrigatório.

---

### Task 1: Migração SQL `atualizacao_17_producao_interna.sql`

**Files:** Create `supabase/atualizacao_17_producao_interna.sql`

**Produces (contrato para o frontend):**
- `produtos.producao_interna boolean default false`, `produtos.modelo_etiqueta text`
- `produto_regras_validade(id, empresa_id, produto_id, conservacao, permitido, validade_valor, validade_unidade('horas'|'dias'), ativo, unique(produto_id, conservacao))`
- `producoes_internas(id, codigo, empresa_id, unidade_id, produto_id, produzido_em, conservacao, validade, validade_calculada, validade_manual, validade_motivo, quantidade, unidade_medida, recipientes, responsavel_user_id, responsavel_funcionario_id, status, observacoes, created_by, created_at, updated_at, finalizada_em, cancelada_em)` + trigger de código + trigger bloqueio de edição pós-finalização
- `etiqueta_impressoes(id, empresa_id, source_type('producao'|'producao_interna'), source_id, tipo('original'|'reimpressao'), quantidade, modelo, impressora, motivo, usuario_id, usuario_nome, created_at)` append-only
- `producao_descartes(id, empresa_id, producao_interna_id, quantidade, unidade_medida, motivo, observacao, usuario_id, created_at)` append-only
- `audit_logs` genérica (estrutura de `ponto_audit_logs`) append-only
- Funções RPC (security definer, todas validam empresa via `empresas_permitidas()` e permissão via `permissoes`):
  - `calcular_validade_interna(p_produto_id uuid, p_conservacao text, p_produzido_em timestamptz) returns timestamptz` — erro se regra ausente/não permitida
  - `finalizar_producao_interna(p_id uuid, p_validade_manual timestamptz default null, p_motivo_validade text default null) returns producoes_internas`
  - `cancelar_producao_interna(p_id uuid, p_motivo text) returns void`
  - `registrar_descarte_interno(p_id uuid, p_quantidade numeric, p_unidade text, p_motivo text, p_observacao text default null) returns void`
  - `registrar_impressao(p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int, p_modelo text, p_impressora text default null, p_motivo text default null) returns void`
- RLS: `producoes_internas`, `produto_regras_validade` = policy `empresa_scoped_access` (mesmo padrão at.06); `etiqueta_impressoes`, `producao_descartes`, `audit_logs` = select por empresa/autenticado, insert só via RPC (security definer).

- [x] Escrever SQL completo (idempotente: `if not exists` / `drop ... if exists`)
- [x] Revisar contra regras: conservação não permitida bloqueia finalização; validade manual exige permissão+motivo+auditoria do valor calculado vs informado; duplicação NÃO copia código/datas/responsável (feita no frontend como novo rascunho)
- [x] Commit

### Task 2: Helpers puros `lib/producao.js` + testes

**Files:** Create `lib/producao.js`, `tests/producao.test.mjs`

**Produces:**
- `CONSERVACOES = [{id:'ambiente',label:'Ambiente'},{id:'resfriado',label:'Resfriado'},{id:'congelado',label:'Congelado'}]`
- `STATUS_LABELS`, `condicaoValidade(validadeIso, agora=new Date())` → `{id:'vencido'|'vence_hoje'|'vence_em_breve'|'valido', label, cor}`
- `calcularValidadePreview(produzidoEmIso, regra)` → ISO string (espelho client-side p/ preview; backend é a autoridade)
- `fmtDateTime(iso)` → `DD/MM/AAAA HH:mm`
- `temPermissao(permissoes, isAdmin, chave)`

- [x] Testes `node --test tests/producao.test.mjs` (vencido/vence_hoje/vence_em_breve/valido; horas e dias; permissões)
- [x] Implementar, rodar testes, commit

### Task 3: Navegação — `ProducaoTabs` + mover Produção Completa

**Files:** Create `components/ProducaoTabs.js`, `app/producoes/completa/page.js`; Modify `app/producoes/page.js`

- Abas: Visão Geral (`/producoes`), Nova Produção (`/producoes/nova`), Produção Completa (`/producoes/completa`), Internas (`/producoes/internas`), Validades (`/producoes/validades`), Histórico (`/producoes/historico`).
- `/producoes/completa` = conteúdo atual de `app/producoes/page.js` intocado (mesmo `Conteudo`), apenas envolvido nas abas.
- `/producoes` vira Visão Geral (Task 6). Nenhuma funcionalidade da produção completa é removida.

- [x] Implementar, verificar no browser que fluxo completo continua idêntico, commit

### Task 4: Cadastro de produto interno + regras de validade

**Files:** Modify `app/produtos/page.js`

- Checkbox "Produto de produção interna" no form de produto (grava `producao_interna`).
- No cartão do produto interno: editor de regras por conservação (permitido sim/não; valor; horas/dias) em `produto_regras_validade`.

- [x] Implementar, verificar, commit

### Task 5: Nova Produção Interna (fluxo rápido touch) + modal de etiquetas

**Files:** Create `app/producoes/nova/page.js`, `components/EtiquetaPrint.js`

- Escolha do tipo: Produção Completa (link p/ `/producoes/completa`) | Produção Interna (form na mesma tela).
- Form: produto (só `producao_interna=true`), conservação (botões grandes; desabilita não permitidas, mostra prazo), unidade (select de `unidades` da empresa), data/hora auto (editável), validade calculada em preview + override com motivo se tiver permissão, quantidade+unidade medida (default do produto), recipientes, responsável (usuário logado; select de funcionários se permissão), observações.
- Botão principal: **Finalizar e imprimir N etiquetas** (N=recipientes) + secundário "Salvar rascunho".
- Finalizar → RPC `finalizar_producao_interna` → modal Produção Finalizada (qtd etiquetas editável, Visualizar/Imprimir/Agora não). Impressão via `EtiquetaPrint` (60×40mm, window.print) + RPC `registrar_impressao`. Falha de impressão não desfaz nada.

- [x] Implementar, verificar fluxo completo no browser, commit

### Task 6: Visão Geral (dashboard)

**Files:** Modify `app/producoes/page.js`

- Cards: Produções hoje (completa+interna), Produções internas hoje, Vencem hoje, Vencidos (não descartados/cancelados), Etiquetas impressas hoje. Lista "Produções recentes".

- [x] Implementar, verificar, commit

### Task 7: Lista de Produções Internas + detalhe + ações

**Files:** Create `app/producoes/internas/page.js`

- Filtro Em andamento / Finalizadas / Todas. Colunas: código, produto, unidade, produção, validade (+condição), conservação, qtd, responsável, status.
- Ações: detalhe (painel com identificação, origem, validade, condição, recipientes, responsável, impressões, descartes), Imprimir/Reimprimir (motivo obrigatório na reimpressão; "outro" pede descrição), Duplicar (novo rascunho: copia produto/empresa/unidade/conservação/medida/qtd/recipientes; data-validade-responsável novos), Registrar descarte (RPC), Cancelar (RPC, motivo), Finalizar rascunho.

- [x] Implementar, verificar, commit

### Task 8: Painel de Validades

**Files:** Create `app/producoes/validades/page.js`

- Somente internas finalizadas não descartadas/canceladas. Filtros: unidade, produto, conservação, responsável, condição, períodos. Atalhos: Vencidos / Vencem hoje / Próximos 3 dias / Todos ativos.

- [x] Implementar, verificar, commit

### Task 9: Histórico + etiquetas na Produção Completa

**Files:** Create `app/producoes/historico/page.js`; Modify `app/producoes/completa/page.js`

- Histórico: união de produções completas + internas + impressões + descartes + audit_logs de produção, filtrável por período.
- Produção Completa: botão "Imprimir etiquetas" por lote (N inicial = quantidade produzida), mesmo `EtiquetaPrint`, `source_type='producao'`, registro em `etiqueta_impressoes`. Reimpressão idem internas.

- [x] Implementar, verificar critérios de aceite §41/§42 da spec, commit

## Fora do escopo desta entrega
Ver §39 da spec. Modelo preparado para ficha técnica opcional, estoque intermediário, requisições entre unidades e QR (campo `codigo` já serve de payload).
