# Instalação completa do banco — 364 Foodservices

Guia para subir o banco **completo, de uma vez**, num projeto Supabase novo (ou no atual).
Rode os arquivos no SQL Editor, **nesta ordem exata** — todos são idempotentes ou seguros de repetir:

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `schema.sql` | Todas as tabelas base, views de estoque e RLS |
| 2 | `usuarios_permissoes.sql` | Tabela de permissões por módulo + usuário admin/admin |
| 3 | `atualizacao_02_cadastro.sql` | E-mail, telefone e CPF em usuários/funcionários |
| 4 | `atualizacao_03_costela_rendimento.sql` | Rendimento por lote (peso cru/finalizado) + preço-alvo de compra |
| 5 | `atualizacao_04_catalogo_foodservices.sql` | Catálogo dos 10 SKUs com preços de varejo (opcional em teste) |
| 6 | `atualizacao_05_assinaturas_b2b.sql` | Assinaturas (boxes Bronze/Prata/Ouro) + tabela de preços B2B por cliente |
| 7 | `atualizacao_06_defumacao_embalagem.sql` | Produção em 2 etapas (Defumação → Embalagem), estoque de defumado e views recriadas |

## Depois de rodar

1. Trocar a senha do `admin/admin` e conceder permissões aos usuários reais (aba Usuários).
2. Aba Produtos: cadastrar matérias-primas (costela com **preço-alvo R$ 20,00/kg**) e a ficha técnica de cada SKU.
3. Aba Clientes: cadastrar clientes B2B e definir a tabela de preços de atacado de cada um (botão "Preços B2B") — referência: 001 R$ 45 · 002 R$ 50 · 003 R$ 45 · 004 R$ 50 · 005 R$ 35 · 006–008 R$ 40.
4. Aba Assinaturas: criar as assinaturas dos fundadores (Bronze R$ 169 · Prata R$ 379 · Ouro R$ 559) e usar "Gerar entregas do mês" na virada de cada mês.

## Permissões dos módulos novos

O módulo **assinaturas** aparece automaticamente para administradores. Para usuários comuns,
conceda a permissão `assinaturas` na aba Usuários (mesmo fluxo dos demais módulos).
