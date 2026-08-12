# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Duas populações, ambas internas ao Grupo 364:

- **Administração central** — dono do negócio e gestão, acesso amplo (módulo `admin`), decide estrutura de dados, permissões e prioridades de evolução do sistema.
- **Equipe operacional das unidades** — funcionários de cada marca que operam módulos específicos conforme a permissão liberada para eles: quem recebe mercadoria (Recebimento), quem produz (Produção), quem bate ponto (quiosque facial), etc. Cada pessoa vê só as abas que sua permissão cobre.

Não há acesso externo (clientes/revendas não logam no sistema hoje).

## Product Purpose

Sistema de gestão (ERP/CRM) interno do Grupo 364 (grupo de foodservice), cobrindo o ciclo completo de uma operação de alimentos: cadastro de fornecedores e matéria-prima, recebimento com controle de qualidade, produção por lote (incluindo defumação e embalagem), estoque, financeiro (contas a pagar), vendas para clientes/revendas, e gestão de pessoas (colaboradores e ponto com reconhecimento facial).

Sucesso é definido por dois eixos confirmados:

- **Unificar as 4 marcas num só sistema** — hoje operações vivem espalhadas (planilhas, papel, sistemas soltos); o ganho é ter 364 Steakhouse, 364 Food Service, 364 Burguer e 364 Foodtruck/Afya operando na mesma base, com dados isolados por empresa.
- **Reduzir erro manual e retrabalho** — eliminar lançamento duplicado, planilha desatualizada e cálculo de custo/estoque feito manualmente.

## Positioning

ERP multiempresa que uma marca isolada não conseguiria copiar de verdade: as 4 marcas do grupo compartilham o mesmo sistema, cadastros e lógica de negócio, mas com dados totalmente isolados por empresa (`empresa_id` + RLS) — cada marca opera como se tivesse seu próprio sistema, sem duplicar manutenção.

## Operating Context

- Aplicação web (Next.js) acessada por navegador — não é app nativo.
- **Uso misto por tela**: telas administrativas e financeiras (cadastros, relatórios, contas a pagar) são operadas em ambiente de escritório/desktop. Telas operacionais — Recebimento, Produção, e principalmente o quiosque de ponto (`/quiosque`) — rodam em tablet no ambiente de produção/câmara fria, incluindo captura de foto para reconhecimento facial direto no chão de fábrica.
- Fluxo de rastreabilidade por lote: matéria-prima entra por Recebimento (lote `LT-AAMMDD-###`) → é consumida em Produção (defumação/embalagem) → vira produto acabado → é expedida via Pedido de Venda para cliente/revenda.
- Multiempresa: usuário pode ter acesso a uma ou mais das 4 empresas do grupo; um seletor de empresa na sidebar troca o contexto ativo.
- Módulo de Ponto segue exigências legais de controle de jornada (REP-P / Portaria MTP 671) e LGPD (avisos de privacidade e consentimento para biometria).

## Capabilities and Constraints

- Stack existente: Next.js 14 (App Router) + React 18 + Supabase (Postgres, Auth, Storage), sem framework de UI/CSS adicional — CSS próprio em `app/globals.css`.
- Reconhecimento facial roda 100% local no navegador (`@vladmandic/face-api`, modelos em `public/models`), sem serviço externo — restrição deliberada por custo/privacidade.
- Multiempresa via Row Level Security no Postgres; qualquer tela/consulta nova precisa respeitar o isolamento por `empresa_id`.
- Anexos (nota fiscal, foto de produto, comprovantes) vão para buckets privados do Supabase Storage, acessados por signed URL sob demanda — não há upload público.
- Sistema está em evolução módulo a módulo: features novas costumam chegar uma de cada vez, priorizadas pelo dono do negócio.

## Brand Commitments

Grupo 364 — grupo de foodservice com 4 marcas operando no mesmo sistema: **364 Steakhouse**, **364 Food Service**, **364 Burguer**, **364 Foodtruck/Afya**. Identidade visual própria de cada marca ainda não foi definida/confirmada — nenhuma paleta, tipografia ou logo foi estabelecida como vinculante até este momento.

## Evidence on Hand

- `ROADMAP.md` — histórico funcional detalhado de tudo que já foi construído, decisões de modelagem e pendências conhecidas; principal fonte de verdade do produto.
- `referencia/sistema-364-prototipo.html` — protótipo funcional único (HTML), com a lógica de negócio original validada; os módulos atuais seguem esse comportamento, agora com dados no Supabase em vez de memória local.
- `supabase/schema.sql` + `supabase/atualizacao_*.sql` — schema real do banco em produção, evidência primária de todas as entidades e regras já implementadas.

## Product Principles

- Um sistema, quatro marcas: nenhuma decisão de modelagem deve assumir uma única empresa — isolamento por `empresa_id` é regra, não exceção.
- Rastreabilidade de lote é inegociável: toda entidade de estoque/produção carrega lote e origem, do recebimento até a expedição.
- Evolução incremental, módulo a módulo, guiada pelo dono do negócio — não construir módulos inteiros por antecipação sem prioridade confirmada.
- Sem serviço externo onde dá para rodar local (reconhecimento facial local é o exemplo já estabelecido) — custo e privacidade pesam nas decisões técnicas.
- Interface precisa funcionar tanto em desktop de escritório quanto em tablet de chão de fábrica/câmara fria, dependendo da tela.
