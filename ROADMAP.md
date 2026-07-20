# Roadmap — 364 Foodservices

## Concluído (jul/2026)

- [x] **Autenticação** — login por usuário e senha; usuário de teste `admin`/`admin`
      (criado por `supabase/usuarios_permissoes.sql`)
- [x] **Usuários e permissões** (`/usuarios`, só administradores) — cadastro completo
      (nome, usuário, e-mail, telefone, CPF), edição, troca de senha e permissão de
      acesso por aba (tabela `permissoes` + API `/api/usuarios` com service role key)
- [x] **Layout do protótipo** — sidebar com navegação filtrada por permissão
      (`components/AppShell.js` + `app/globals.css`)
- [x] **Dashboard** (`/`) — KPIs, últimos recebimentos e pedidos
- [x] **Fornecedores** (`/fornecedores`)
- [x] **Produtos** (`/produtos`) — matérias-primas + catálogo com código automático
      `0364-XXX` + ficha técnica
- [x] **Recebimento** (`/recebimentos`) — lote automático `LT-DD/MM/AA-XXX` + **ficha impressa**
- [x] **Produção** (`/producoes`) — consumo calculado pela ficha técnica, custo pelo
      custo médio da matéria-prima, validade automática + **ficha impressa**
- [x] **Estoque** (`/estoque`) — somente leitura, via views `vw_estoque_*`
- [x] **Clientes** (`/clientes`)
- [x] **Pedidos de venda** (`/pedidos`) — itens, status, baixa de estoque via view
      + **pedido impresso**
- [x] **Funcionários** (`/funcionarios`) — cadastro, ativar/inativar, usado como
      "Responsável" em recebimento, produção, pedidos e despesas
- [x] **Despesas** (`/despesas`)
- [x] **Relatórios** (`/relatorios`) — DRE simplificado, fluxo de caixa, produção e
      compras por fornecedor
- [x] **Fichas impressas** — `components/FichaPrint.js`: modelo em preto e branco com
      cabeçalho, campos, itens, observações e assinaturas (botão "Imprimir ficha")

- [x] **Política da costela** (jul/2026, Conselho 364) — rendimento real por lote na
      Produção (peso cru × peso finalizado, alerta < 40%), comparação do custo de
      recebimento com o custo médio histórico e **preço-alvo de compra** por
      matéria-prima (gatilho "bom momento para estocar" na tela de Recebimento)
- [x] **Assinaturas** (`/assinaturas`, jul/2026 — Sprint 2) — boxes Bronze/Prata/Ouro,
      KPIs (ativos por plano + receita recorrente), geração de entregas do mês e
      marcação Entregue/Pulada por competência
- [x] **Tabela de preços B2B** (jul/2026 — Sprint 2) — preço de atacado por cliente
      (botão "Preços B2B" na aba Clientes); os Pedidos aplicam automaticamente
      preço digitado > tabela do cliente > varejo, com dica na tela

### SQL a rodar no Supabase (ordem)

1. `supabase/schema.sql`
2. `supabase/usuarios_permissoes.sql`
3. `supabase/atualizacao_02_cadastro.sql` ✅ rodado em 19/07/2026
4. `supabase/atualizacao_03_costela_rendimento.sql` ✅ rodado em 19/07/2026
5. `supabase/atualizacao_04_catalogo_foodservices.sql` ✅ rodado em 19/07/2026 (10 SKUs no catálogo)
6. `supabase/atualizacao_05_assinaturas_b2b.sql` ✅ rodado em 19/07/2026 (tabelas criadas
   com RLS via botão "Run and enable RLS" + políticas; auditoria confirmou 3 policies)
7. `supabase/atualizacao_06_defumacao_embalagem.sql` ✅ rodado em 19/07/2026 — produção
   em 2 etapas: **Defumação** (`/producoes`: horários, temperatura, perda de limpeza,
   sobra e peso defumado por MP, multi-item) → **Embalagem** (`/embalagem`: produtos,
   quantidades, peso real, sobras, multi-item) + estoque intermediário de defumado
   (`vw_estoque_defumado`) e views de estoque recriadas.
   ⚠️ A ficha técnica dos produtos passa a significar **kg de defumado por unidade**
   (ex.: Costela Defumada 500g = 0.500 de Costela Suína) — revisar na aba Produtos.

> Todos os scripts aplicados no projeto Supabase `364foodservices` (ambiente de teste).
> Para subir um projeto NOVO de produção no futuro, seguir `supabase/INSTALACAO.md`.

## Próximos passos

- [ ] **Vincular login a funcionário automaticamente** — usar o funcionário do usuário
      logado como "Responsável" padrão nos formulários
- [ ] **Permissões no banco (RLS por módulo)** — hoje o controle por aba é feito na
      interface; o RLS libera qualquer usuário autenticado em todas as tabelas
- [ ] **Filtros por período nos relatórios** (mês/ano)
- [ ] **Trocar admin/admin** e revogar a chave secreta usada no desenvolvimento antes
      de ir a produção

## Referência

O protótipo funcional completo (HTML único, lógica de negócio validada) está em
`referencia/sistema-364-prototipo.html` — os módulos acima seguem esse comportamento,
com os dados no Supabase em vez de memória.
