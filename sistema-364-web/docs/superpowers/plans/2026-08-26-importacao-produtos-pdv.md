# Importação de produtos do PDV Consumer — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer o cadastro de produtos e insumos do PDV Consumer para o 364 OS a partir do backup Firebird, com os dados fiscais que já existem lá, sem liberar nenhum produto para emissão e sem sobrescrever edição humana.

**Architecture:** Uma migração acrescenta a chave de origem (`pdv_codigo_produto`) e o retrato do que foi importado (`pdv_valores`) em `produtos` e `materias_primas`. Três módulos puros — SQL, normalização e merge — fazem o trabalho testável, e um script orquestrador reusa o container Firebird efêmero que `scripts/importar-pdv-backup.mjs` já sabe subir e derrubar.

**Tech Stack:** Node 24 ESM, `node:test`, `node-firebird`, `@supabase/supabase-js`, Postgres (Supabase), Docker/colima, Firebird 5.

**Spec:** `docs/superpowers/specs/2026-08-26-importacao-produtos-pdv-design.md`

## Global Constraints

- Nada roda contra a produção neste plano. A migração é exercitada num Postgres local descartável; a carga é sempre `--dry-run` até o usuário autorizar.
- Todo comentário, mensagem de erro, nome de variável e texto de commit em **português**, como o resto do repositório.
- Commits seguem `tipo(escopo): descrição` — `feat`, `fix`, `docs`, `test`.
- `npm test` roda `node --test tests/*.test.mjs` e precisa ficar verde em toda tarefa. Hoje são 664 testes.
- A migração é **idempotente**: rodar duas vezes seguidas não pode falhar nem duplicar objeto.
- Toda migração termina com bloco de rollback comentado, no formato que `tests/migracao-45/verificar.sh` sabe descomentar (`-- begin;` … `-- commit;`).
- Números de migração: esta é a **46**. O branch `feat/cadastro-produtos-ux` precisa renumerar seu `atualizacao_38_cabecalho_produto.sql` para **47**.
- Produto importado nasce com `ativo_fiscal = false` e `sugerido_automaticamente = true`. Nenhuma tarefa pode ligar `ativo_fiscal`.
- CFOP e CSOSN do Consumer **não** viram linhas em `regras_tributarias`. Viram `grupos_tributarios`.
- O container Firebird de teste já existe nesta máquina: `fb364`, senha `spike364`, banco `/var/lib/firebird/data/consumer.fdb`. É leitura apenas.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `supabase/atualizacao_46_produtos_pdv.sql` | colunas de rastro e `unique` parcial nas duas tabelas |
| `tests/migracao-46/{fixture,cenarios}.sql`, `verificar.sh` | prova a migração num Postgres descartável |
| `lib/pdvBackup/consultasProdutos.js` | só o SQL contra o Firebird |
| `lib/pdvBackup/normalizaProdutos.js` | linhas do Firebird → objetos prontos para gravar, roteados por tabela |
| `lib/pdvBackup/mergeProdutos.js` | a regra de "atualiza ou não atualiza", isolada |
| `scripts/importar-produtos-pdv.mjs` | orquestra: baixa, restaura, lê, normaliza, mescla, grava, derruba |
| `tests/produtos-pdv-normaliza.test.mjs` | testes da normalização |
| `tests/produtos-pdv-merge.test.mjs` | testes da regra de merge |
| `tests/fixtures/pdv-backup/produtos.json` | amostra real extraída do backup |

---

### Task 1: Migração 46 — chave de origem e retrato

**Files:**
- Create: `supabase/atualizacao_46_produtos_pdv.sql`
- Create: `tests/migracao-46/fixture.sql`
- Create: `tests/migracao-46/cenarios.sql`
- Create: `tests/migracao-46/verificar.sh`

**Interfaces:**
- Consumes: nada.
- Produces: as colunas `pdv_codigo_produto int`, `pdv_valores jsonb`, `pdv_importado_em timestamptz` em `public.produtos` e `public.materias_primas`, mais o índice único parcial `produtos_pdv_codigo_key` e `materias_primas_pdv_codigo_key` sobre `(empresa_id, pdv_codigo_produto) where pdv_codigo_produto is not null`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/atualizacao_46_produtos_pdv.sql`:

```sql
-- =========================================================
-- Atualização 46 — Cadastro de produtos vindo do PDV Consumer
--
-- O cadastro do 364 OS tem 11 produtos e 7 matérias-primas digitados à mão,
-- enquanto o PDV Consumer tem 699 produtos em uso desde 2022, com preço,
-- custo, categoria e — o que não se esperava — NCM, CEST e origem.
-- Esta migração abre o caminho para a carga: uma chave de casamento e um
-- retrato do que a importação gravou.
--
-- `pdv_codigo_produto` guarda PRODUTOS.CODIGO do Consumer. Não se usa
-- `produtos.codigo` para isso: aquele é humano (0364-001, STK-001) e vira o
-- cProd da NF-e.
--
-- `pdv_valores` é o árbitro de "alguém mexeu aqui?". A importação seguinte só
-- atualiza um campo se o valor atual ainda for igual ao que ela mesma gravou
-- da última vez. Sem isso, a carga desfaria correção feita à mão.
--
-- O unique é parcial porque as 18 linhas de hoje foram digitadas à mão e
-- ficam com a coluna nula. De quebra, é a primeira constraint unique que
-- materias_primas ganha — é por não ter nenhuma que "Costela Suina" e
-- "Costela Suína" convivem lá.
--
-- Rode depois de atualizacao_45_contas_bancarias_grupo.sql. Idempotente.
--
-- ATENÇÃO à numeração: o branch feat/cadastro-produtos-ux carrega um
-- atualizacao_38_cabecalho_produto.sql que colide com o
-- atualizacao_38_cliente_nome_fantasia.sql já em main. Aquele deve ser
-- renumerado para 47 no merge, não este para 47.
-- =========================================================
begin;

alter table public.produtos
  add column if not exists pdv_codigo_produto int,
  add column if not exists pdv_valores jsonb,
  add column if not exists pdv_importado_em timestamptz;

alter table public.materias_primas
  add column if not exists pdv_codigo_produto int,
  add column if not exists pdv_valores jsonb,
  add column if not exists pdv_importado_em timestamptz;

comment on column public.produtos.pdv_codigo_produto is
  'PRODUTOS.CODIGO do PDV Consumer. Chave de casamento da importação e o que liga pdv_vendas_itens_dia.codigo_produto a este produto. Nulo em cadastro feito à mão.';
comment on column public.produtos.pdv_valores is
  'Retrato do que a última importação gravou, campo a campo. Um campo só é atualizado na rodada seguinte se o valor atual ainda for igual ao daqui — é assim que edição humana não é sobrescrita.';
comment on column public.materias_primas.pdv_codigo_produto is
  'PRODUTOS.CODIGO do PDV Consumer, para insumos (PRODUTOTIPO 2). Nulo em cadastro feito à mão.';
comment on column public.materias_primas.pdv_valores is
  'Mesmo papel de produtos.pdv_valores: retrato do que a última importação gravou.';

create unique index if not exists produtos_pdv_codigo_key
  on public.produtos(empresa_id, pdv_codigo_produto)
  where pdv_codigo_produto is not null;

create unique index if not exists materias_primas_pdv_codigo_key
  on public.materias_primas(empresa_id, pdv_codigo_produto)
  where pdv_codigo_produto is not null;

-- Serve o join com as vendas: pdv_vendas_itens_dia.codigo_produto -> produto.
create index if not exists produtos_pdv_codigo_idx
  on public.produtos(pdv_codigo_produto)
  where pdv_codigo_produto is not null;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- drop index if exists public.produtos_pdv_codigo_idx;
-- drop index if exists public.materias_primas_pdv_codigo_key;
-- drop index if exists public.produtos_pdv_codigo_key;
-- alter table public.materias_primas
--   drop column if exists pdv_importado_em,
--   drop column if exists pdv_valores,
--   drop column if exists pdv_codigo_produto;
-- alter table public.produtos
--   drop column if exists pdv_importado_em,
--   drop column if exists pdv_valores,
--   drop column if exists pdv_codigo_produto;
-- commit;
```

- [ ] **Step 2: Escrever a fixture**

Criar `tests/migracao-46/fixture.sql`. É o recorte mínimo de `empresas`, `produtos` e `materias_primas` para as constraints da 46 rodarem — não é espelho da produção:

```sql
-- Base mínima para exercitar a atualização 46 num Postgres local.
create extension if not exists pgcrypto;

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  prefixo_codigo text
);

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  codigo text not null,
  nome text not null,
  unidade text not null,
  categoria text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table if not exists public.materias_primas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nome text not null,
  unidade text not null,
  categoria text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.empresas (id, nome, prefixo_codigo)
  values ('11111111-1111-1111-1111-111111111111', 'Steakhouse Teste', 'STK')
  on conflict (id) do nothing;
insert into public.empresas (id, nome, prefixo_codigo)
  values ('22222222-2222-2222-2222-222222222222', 'Outra Empresa', 'OUT')
  on conflict (id) do nothing;

-- Cadastro feito à mão: fica com pdv_codigo_produto nulo depois da migração.
insert into public.produtos (id, empresa_id, codigo, nome, unidade)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'STK-001', 'Molho Barbecue', 'kg');
insert into public.materias_primas (id, empresa_id, nome, unidade)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Costela Suína', 'kg');
insert into public.materias_primas (id, empresa_id, nome, unidade)
  values ('bbbbbbbb-0000-0000-0000-000000000002',
          '11111111-1111-1111-1111-111111111111', 'Costela Suina', 'kg');
```

- [ ] **Step 3: Escrever os cenários**

Criar `tests/migracao-46/cenarios.sql`:

```sql
-- Cenários da atualização 46: chave de origem e retrato da importação.
\set ON_ERROR_STOP on
\set empresa '11111111-1111-1111-1111-111111111111'
\set outra '22222222-2222-2222-2222-222222222222'

-- Cenário 1: o unique é parcial — as duas linhas manuais convivem com nulo.
-- É o que impede a migração de quebrar num cadastro que já existe. As duas
-- matérias-primas da fixture são a duplicata por acento que existe hoje.
do $$
declare n int;
begin
  select count(*) into n from public.materias_primas where pdv_codigo_produto is null;
  if n <> 2 then raise exception 'FALHA 1: esperava 2 matérias-primas com nulo, achei %', n; end if;
  raise notice 'OK 1: unique parcial convive com cadastro manual';
end $$;

-- Cenário 2: mesmo pdv_codigo_produto na mesma empresa é rejeitado.
insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
  values (:'empresa', 'STK-P339', 'Costela Bovina', 'kg', 339);
do $$
begin
  begin
    insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
      values ('11111111-1111-1111-1111-111111111111', 'STK-P339-BIS', 'Costela Bovina de novo', 'kg', 339);
    raise exception 'FALHA 2: código do PDV repetido na mesma empresa foi aceito';
  exception when unique_violation then
    raise notice 'OK 2: unique barra o mesmo produto do PDV duas vezes na empresa';
  end;
end $$;

-- Cenário 3: o mesmo número em outra empresa passa — são dois PDVs distintos,
-- e o código 339 de um não é o 339 do outro.
insert into public.produtos (empresa_id, codigo, nome, unidade, pdv_codigo_produto)
  values (:'outra', 'OUT-P339', 'Outro produto 339', 'un', 339);
do $$
begin
  raise notice 'OK 3: o mesmo código do PDV convive entre empresas';
end $$;

-- Cenário 4: pdv_valores guarda e devolve o retrato como jsonb.
update public.produtos
   set pdv_valores = '{"nome":"Costela Bovina","preco_venda":"49.90"}'::jsonb,
       pdv_importado_em = now()
 where empresa_id = :'empresa' and pdv_codigo_produto = 339;
do $$
declare v text;
begin
  select pdv_valores->>'preco_venda' into v from public.produtos
   where empresa_id = '11111111-1111-1111-1111-111111111111' and pdv_codigo_produto = 339;
  if v is distinct from '49.90' then raise exception 'FALHA 4: retrato voltou %', v; end if;
  raise notice 'OK 4: pdv_valores guarda o retrato campo a campo';
end $$;

-- Cenário 5: matérias-primas ganham a mesma trava.
insert into public.materias_primas (empresa_id, nome, unidade, pdv_codigo_produto)
  values (:'empresa', 'Salsa', 'kg', 16);
do $$
begin
  begin
    insert into public.materias_primas (empresa_id, nome, unidade, pdv_codigo_produto)
      values ('11111111-1111-1111-1111-111111111111', 'Salsa duplicada', 'kg', 16);
    raise exception 'FALHA 5: insumo do PDV repetido foi aceito';
  exception when unique_violation then
    raise notice 'OK 5: unique vale também para materias_primas';
  end;
end $$;
```

- [ ] **Step 4: Escrever o verificador**

Criar `tests/migracao-46/verificar.sh` (e `chmod +x`):

```bash
#!/usr/bin/env bash
# Exercita a atualização 46 (cadastro de produtos vindo do PDV) num Postgres
# local descartável. Não toca em produção. Requer psql no PATH e um servidor
# local. Uso: tests/migracao-46/verificar.sh
set -euo pipefail
export PGOPTIONS='-c client_min_messages=notice'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_PRODUTOS_PDV:-produtos_pdv_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_46_produtos_pdv.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT
limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Duas vezes seguidas: prova idempotência.
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

sed -n '/^-- begin;/,/^-- commit;/p' "$MIGRACAO" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

colunas=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where table_schema='public' and table_name in ('produtos','materias_primas')
    and column_name in ('pdv_codigo_produto','pdv_valores','pdv_importado_em');")
[ "$colunas" = "0" ] || { echo "rollback deixou $colunas coluna(s) da 46"; exit 1; }

sobreviveu=$(psql -tAq -d "$BANCO" -c "select count(*) from public.produtos;")
[ "$sobreviveu" != "0" ] || { echo "rollback apagou linhas de produtos"; exit 1; }

echo "OK: rollback limpo (só as colunas da 46 somem)"
echo "MIGRAÇÃO 46 OK"
```

- [ ] **Step 5: Rodar o verificador e ver os cinco cenários passarem**

Run: `tests/migracao-46/verificar.sh`
Expected: as linhas `OK 1` a `OK 5`, depois `OK: rollback limpo` e `MIGRAÇÃO 46 OK`.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: 664 testes passando, nenhum a menos (a migração não tem teste em `node:test`; o objetivo aqui é provar que nada regrediu).

- [ ] **Step 7: Commit**

```bash
git add supabase/atualizacao_46_produtos_pdv.sql tests/migracao-46/
git commit -m "feat(produtos): chave de origem e retrato da importação do PDV"
```

---

### Task 2: SQL do Firebird e fixture real

**Files:**
- Create: `lib/pdvBackup/consultasProdutos.js`
- Create: `tests/fixtures/pdv-backup/produtos.json`

**Interfaces:**
- Consumes: nada.
- Produces: `SQL_PRODUTOS` (string) exportada de `lib/pdvBackup/consultasProdutos.js`. A consulta não recebe parâmetro. Cada linha devolvida por `node-firebird` tem as chaves, em maiúsculas: `CODIGO`, `NOME`, `DESCONTINUADO`, `CODIGOPRODUTOTIPO`, `NCM`, `CEST`, `ALIQUOTATRANSPARENCIA`, `UNIDADE`, `CATEGORIA`, `CFOP`, `SITUACAOTRIBUTARIA`, `ORIGEMMERCADORIA`, `PRECOVENDA`, `PRECOCUSTO`.

- [ ] **Step 1: Escrever o SQL**

Criar `lib/pdvBackup/consultasProdutos.js`:

```js
// SQL da extração de cadastro do backup Firebird do PDV Consumer.
//
// Diferente de consultas.js, que extrai movimento numa janela de datas, aqui
// é cadastro: sem parâmetro, lê tudo de uma vez.
//
// A tributação NÃO vem das colunas de PRODUTOS — só 12 das 699 linhas têm
// CFOP lá. Ela vive em CONFIGICMS, uma linha por produto (conferido: nenhum
// produto tem duas). ORIGEMMERCADORIA é o caso mais gritante: nula em 687
// linhas de PRODUTOS e preenchida em 526 de 527 de CONFIGICMS.
//
// PRODUTOTIPO 1 é "Produto" e 2 é "Insumo" — a divisão que separa `produtos`
// de `materias_primas` no 364 OS. Complemento (3), Combo (4), Produto por
// Tamanho (5) e Serviço (6) ficam de fora: não são item de estoque nem de
// ficha técnica.
//
// Preço e custo vêm de PRODUTODETALHE por subconsulta, e não por join, porque
// um produto tem N detalhes (tamanhos) e o join multiplicaria a linha do
// produto por eles.
export const SQL_PRODUTOS = `
  select p.codigo, p.nome, p.descontinuado, p.codigoprodutotipo,
         p.ncm, p.cest, p.aliquotatransparencia,
         u.sigla as unidade,
         e.descricao as categoria,
         c.cfop, c.situacaotributaria, c.origemmercadoria,
         (select min(d.precovenda) from produtodetalhe d
           where d.codigoproduto = p.codigo and d.datadelete is null) as precovenda,
         (select min(d.precocusto) from produtodetalhe d
           where d.codigoproduto = p.codigo and d.datadelete is null) as precocusto
    from produtos p
    left join unidadecomercializacao u on u.codigo = p.codigounidadecomercial
    left join etiquetas e on e.codigo = p.codigoetiqueta
    left join configicms c on c.codigoproduto = p.codigo
   where p.codigoprodutotipo in (1, 2)
   order by p.codigo`;
```

- [ ] **Step 2: Rodar o SQL no container e conferir as colunas**

Run:

```bash
docker exec -i fb364 isql -user SYSDBA -password spike364 -q \
  /var/lib/firebird/data/consumer.fdb -ch UTF8 <<'EOF'
select count(*) from produtos where codigoprodutotipo in (1,2);
EOF
```

Expected: `540` (364 do tipo Produto + 176 do tipo Insumo).

- [ ] **Step 3: Extrair a fixture**

A fixture é uma amostra real, escolhida para cobrir os casos que a normalização precisa distinguir. Rodar:

```bash
docker exec -i fb364 isql -user SYSDBA -password spike364 -q \
  /var/lib/firebird/data/consumer.fdb -ch UTF8 <<'EOF' > /tmp/amostra.txt
set list on;
select p.codigo, p.nome, p.descontinuado, p.codigoprodutotipo, p.ncm, p.cest,
       p.aliquotatransparencia, u.sigla as unidade, e.descricao as categoria,
       c.cfop, c.situacaotributaria, c.origemmercadoria,
       (select min(d.precovenda) from produtodetalhe d
         where d.codigoproduto = p.codigo and d.datadelete is null) as precovenda,
       (select min(d.precocusto) from produtodetalhe d
         where d.codigoproduto = p.codigo and d.datadelete is null) as precocusto
  from produtos p
  left join unidadecomercializacao u on u.codigo = p.codigounidadecomercial
  left join etiquetas e on e.codigo = p.codigoetiqueta
  left join configicms c on c.codigoproduto = p.codigo
 where p.codigo in (16, 339, 431, 3, 17)
 order by p.codigo;
EOF
cat /tmp/amostra.txt
```

Com o resultado à mão, escrever `tests/fixtures/pdv-backup/produtos.json` como um array de objetos com as chaves em MAIÚSCULAS (é assim que `node-firebird` devolve), preservando os valores reais lidos. Os cinco códigos foram escolhidos porque cobrem, respectivamente: insumo vivo com custo (16, Salsa), produto vivo com config (339, Costela Bovina), produto vivo com CSOSN e NCM (431, Costela Defumada), produto descontinuado com config (3), e produto descontinuado **sem** config (17).

Acrescentar ao array, à mão, mais duas linhas sintéticas para os casos de recusa — a fixture documenta que elas são inventadas:

```json
{
  "CODIGO": 9001, "NOME": "NCM curto de propósito", "DESCONTINUADO": "N",
  "CODIGOPRODUTOTIPO": 1, "NCM": "02", "CEST": null,
  "ALIQUOTATRANSPARENCIA": 0, "UNIDADE": "un", "CATEGORIA": "Teste",
  "CFOP": 5102, "SITUACAOTRIBUTARIA": "102", "ORIGEMMERCADORIA": 0,
  "PRECOVENDA": 10, "PRECOCUSTO": 4
},
{
  "CODIGO": 9002, "NOME": "CEST torto de propósito", "DESCONTINUADO": "N",
  "CODIGOPRODUTOTIPO": 1, "NCM": "02102000", "CEST": "17083",
  "ALIQUOTATRANSPARENCIA": 0, "UNIDADE": "un", "CATEGORIA": "Teste",
  "CFOP": 5405, "SITUACAOTRIBUTARIA": "500", "ORIGEMMERCADORIA": 0,
  "PRECOVENDA": 20, "PRECOCUSTO": 8
}
```

- [ ] **Step 4: Conferir que a fixture é JSON válido**

Run: `node -e "const a=require('./tests/fixtures/pdv-backup/produtos.json'); console.log(a.length, a.map(l=>l.CODIGO).join(','))"`
Expected: `7 3,16,17,339,431,9001,9002` (ordem pode variar; o que importa é serem 7 e o parse não falhar).

- [ ] **Step 5: Registrar a fixture no README**

Acrescentar a `tests/fixtures/pdv-backup/README.md` um parágrafo dizendo de onde `produtos.json` veio (backup do Steakhouse restaurado no container `fb364`, 26/08/2026), quais códigos são reais e que 9001 e 9002 são sintéticos, para os casos de recusa.

- [ ] **Step 6: Commit**

```bash
git add lib/pdvBackup/consultasProdutos.js tests/fixtures/pdv-backup/produtos.json tests/fixtures/pdv-backup/README.md
git commit -m "feat(produtos): SQL de cadastro do backup Firebird e fixture real"
```

---

### Task 3: Normalização

**Files:**
- Create: `lib/pdvBackup/normalizaProdutos.js`
- Create: `tests/produtos-pdv-normaliza.test.mjs`

**Interfaces:**
- Consumes: as linhas descritas em Task 2 e a fixture `tests/fixtures/pdv-backup/produtos.json`.
- Produces, todas exportadas de `lib/pdvBackup/normalizaProdutos.js`:
  - `codigoDoProduto(prefixo: string, codigoPdv: number) -> string`
  - `unidadeDoPdv(sigla: string|null) -> string`
  - `chaveDoGrupo(linha) -> string|null`
  - `gruposDoLote(linhas) -> Array<{ codigo: string, descricao: string }>`
  - `normalizaProdutosFb({ linhas, empresaId, prefixo, codigosVendidos = new Set() }) -> { produtos: Array<object>, materiasPrimas: Array<object>, recusados: Array<{ codigo: number, campo: string, valor: any, motivo: string }> }`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/produtos-pdv-normaliza.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  codigoDoProduto, unidadeDoPdv, chaveDoGrupo, gruposDoLote, normalizaProdutosFb,
} from '../lib/pdvBackup/normalizaProdutos.js';

const LINHAS = JSON.parse(
  readFileSync(new URL('./fixtures/pdv-backup/produtos.json', import.meta.url), 'utf8'),
);
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';
const linha = codigo => LINHAS.find(l => l.CODIGO === codigo);

const normaliza = (extra = {}) => normalizaProdutosFb({
  linhas: LINHAS, empresaId: EMPRESA, prefixo: 'STK', ...extra,
});

// ------------------------------------------------------------- código

test('codigoDoProduto junta o prefixo da empresa ao número do PDV', () => {
  assert.equal(codigoDoProduto('STK', 339), 'STK-P339');
  assert.equal(codigoDoProduto('0364', 7), '0364-P7');
});

// ------------------------------------------------------------ unidade

test('unidadeDoPdv devolve a sigla em minúsculo e cai em "un" sem sigla', () => {
  assert.equal(unidadeDoPdv('kg'), 'kg');
  assert.equal(unidadeDoPdv('KG'), 'kg');
  assert.equal(unidadeDoPdv(null), 'un');
  assert.equal(unidadeDoPdv('  '), 'un');
});

// ------------------------------------------------------------- grupos

test('chaveDoGrupo nomeia a combinação CFOP/CSOSN e ignora linha sem config', () => {
  assert.equal(chaveDoGrupo({ CFOP: 5405, SITUACAOTRIBUTARIA: '500' }), 'PDV 5405/500');
  assert.equal(chaveDoGrupo({ CFOP: null, SITUACAOTRIBUTARIA: null }), null);
  assert.equal(chaveDoGrupo({ CFOP: 5102, SITUACAOTRIBUTARIA: null }), null);
});

test('gruposDoLote devolve uma entrada por combinação, sem repetir', () => {
  const grupos = gruposDoLote(LINHAS);
  const codigos = grupos.map(g => g.codigo).sort();
  assert.deepEqual(codigos, [...new Set(codigos)].sort(), 'não pode repetir combinação');
  assert.ok(grupos.every(g => g.descricao.includes('CFOP')), 'descrição diz de onde veio');
});

// --------------------------------------------------------- roteamento

test('tipo 1 vai para produtos e tipo 2 vai para matérias-primas', () => {
  const { produtos, materiasPrimas } = normaliza();
  assert.ok(produtos.every(p => p.pdv_codigo_produto !== 16), 'Salsa é insumo, não produto');
  assert.ok(materiasPrimas.some(m => m.pdv_codigo_produto === 16), 'Salsa tem que estar nos insumos');
});

test('insumo não leva campo fiscal nenhum', () => {
  const { materiasPrimas } = normaliza();
  const salsa = materiasPrimas.find(m => m.pdv_codigo_produto === 16);
  assert.equal(salsa.ncm, undefined);
  assert.equal(salsa.grupo_tributario_codigo, undefined);
  assert.equal(salsa.unidade, 'kg');
});

// ------------------------------------------------------------- origem

test('origem vem de CONFIGICMS, não de PRODUTOS', () => {
  // Em PRODUTOS a coluna é nula em 687 das 699 linhas; em CONFIGICMS está
  // preenchida em 526 de 527. Ler do lugar errado zera a origem de todo mundo.
  const { produtos } = normaliza();
  const comConfig = produtos.find(p => p.pdv_codigo_produto === 339);
  assert.equal(comConfig.origem_mercadoria, 0);
});

// ----------------------------------------------------------------- ST

test('sujeito_st só é verdadeiro no CSOSN 500', () => {
  const { produtos } = normaliza();
  const st = produtos.find(p => p.pdv_codigo_produto === 9002);
  const semSt = produtos.find(p => p.pdv_codigo_produto === 9001);
  assert.equal(st.sujeito_st, true);
  assert.equal(semSt.sujeito_st, false);
});

// -------------------------------------------------------------- trava

test('produto importado nunca nasce liberado para emissão', () => {
  const { produtos } = normaliza();
  assert.ok(produtos.every(p => p.ativo_fiscal === false));
  assert.ok(produtos.every(p => p.sugerido_automaticamente === true));
});

// ------------------------------------------------------------ recusas

test('NCM fora de 8 dígitos é recusado e não vira null silencioso', () => {
  const { produtos, recusados } = normaliza();
  assert.equal(produtos.find(p => p.pdv_codigo_produto === 9001), undefined);
  const r = recusados.find(x => x.codigo === 9001);
  assert.equal(r.campo, 'ncm');
  assert.equal(r.valor, '02');
});

test('CEST fora de 7 dígitos é recusado', () => {
  const { produtos, recusados } = normaliza();
  assert.equal(produtos.find(p => p.pdv_codigo_produto === 9002), undefined);
  assert.equal(recusados.find(x => x.codigo === 9002).campo, 'cest');
});

// ----------------------------------------------------- descontinuados

test('descontinuado só entra se tiver venda, e entra inativo', () => {
  const semVenda = normaliza();
  assert.equal(semVenda.produtos.find(p => p.pdv_codigo_produto === 3), undefined);

  const comVenda = normaliza({ codigosVendidos: new Set([3]) });
  const p = comVenda.produtos.find(x => x.pdv_codigo_produto === 3);
  assert.equal(p.ativo, false);
});

test('descontinuado sem CONFIGICMS entra sem grupo e sem origem', () => {
  const { materiasPrimas } = normaliza({ codigosVendidos: new Set([17]) });
  const p = materiasPrimas.find(x => x.pdv_codigo_produto === 17);
  assert.equal(p.ativo, false);
});

// ------------------------------------------------------------- zeros

test('preço, custo e alíquota de transparência zerados viram null', () => {
  // 0.0000 no Consumer é "não informado", não um preço de zero real. Gravar 0
  // faria a margem do relatório sair 100%.
  const { materiasPrimas } = normaliza();
  const salsa = materiasPrimas.find(m => m.pdv_codigo_produto === 16);
  assert.equal(salsa.preco_venda, null);
  assert.equal(salsa.custo_unitario, 17.5);
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/produtos-pdv-normaliza.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pdvBackup/normalizaProdutos.js'`.

- [ ] **Step 3: Escrever a implementação**

Criar `lib/pdvBackup/normalizaProdutos.js`:

```js
// Linhas de cadastro do Firebird → objetos prontos para gravar no 364 OS.
//
// Puro: não fala com banco nenhum, dos dois lados. É onde vivem o roteamento
// por tipo, o de-para de unidade, a geração de código e a recusa de formato.
//
// A postura em cima de dado torto é a de lib/nfe/resolverNota.js: falhar alto
// e nomear o campo. Nada aqui vira null silencioso — NCM de 2 dígitos sai na
// lista de recusados com o valor que veio, para alguém arrumar no PDV.

const TIPO_PRODUTO = 1;
const TIPO_INSUMO = 2;

const texto = v => {
  const s = String(v ?? '').trim();
  return s || null;
};

// 0.0000 no Consumer quer dizer "não informado", não um valor de zero real.
// Gravar 0 em preço faria a margem do relatório sair 100%.
const numeroPositivo = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function codigoDoProduto(prefixo, codigoPdv) {
  return `${prefixo}-P${codigoPdv}`;
}

export function unidadeDoPdv(sigla) {
  return texto(sigla)?.toLowerCase() || 'un';
}

// Sem CFOP ou sem CSOSN não há grupo: a combinação é o que dá nome a ele, e
// meia combinação não identifica tributação nenhuma.
export function chaveDoGrupo(linha) {
  const cfop = texto(linha.CFOP);
  const csosn = texto(linha.SITUACAOTRIBUTARIA);
  if (!cfop || !csosn) return null;
  return `PDV ${cfop}/${csosn}`;
}

export function gruposDoLote(linhas) {
  const vistos = new Map();
  for (const l of linhas) {
    const codigo = chaveDoGrupo(l);
    if (!codigo || vistos.has(codigo)) continue;
    const origem = l.ORIGEMMERCADORIA ?? '?';
    vistos.set(codigo, {
      codigo,
      descricao: `Importado do PDV — CFOP ${l.CFOP}, CSOSN ${l.SITUACAOTRIBUTARIA}, origem ${origem}`,
    });
  }
  return [...vistos.values()];
}

function validarFiscal(linha, recusados) {
  const ncm = texto(linha.NCM);
  if (ncm && !/^\d{8}$/.test(ncm)) {
    recusados.push({ codigo: linha.CODIGO, campo: 'ncm', valor: ncm, motivo: 'NCM não tem 8 dígitos' });
    return null;
  }
  const cest = texto(linha.CEST);
  if (cest && !/^\d{7}$/.test(cest)) {
    recusados.push({ codigo: linha.CODIGO, campo: 'cest', valor: cest, motivo: 'CEST não tem 7 dígitos' });
    return null;
  }
  const origemBruta = linha.ORIGEMMERCADORIA;
  let origem = null;
  if (origemBruta !== null && origemBruta !== undefined && origemBruta !== '') {
    origem = Number(origemBruta);
    if (!Number.isInteger(origem) || origem < 0 || origem > 8) {
      recusados.push({
        codigo: linha.CODIGO, campo: 'origem_mercadoria', valor: origemBruta,
        motivo: 'origem fora do intervalo 0–8',
      });
      return null;
    }
  }
  return { ncm, cest, origem };
}

export function normalizaProdutosFb({ linhas, empresaId, prefixo, codigosVendidos = new Set() }) {
  const produtos = [];
  const materiasPrimas = [];
  const recusados = [];

  for (const l of linhas) {
    const vivo = texto(l.DESCONTINUADO) !== 'S';
    // Descontinuado sem venda no histórico não tem por que existir aqui. Com
    // venda, entra inativo — senão o join com pdv_vendas_itens_dia fica furado
    // justamente nos anos antigos.
    if (!vivo && !codigosVendidos.has(l.CODIGO)) continue;

    const comum = {
      empresa_id: empresaId,
      pdv_codigo_produto: l.CODIGO,
      nome: texto(l.NOME) || `Produto ${l.CODIGO} do PDV`,
      unidade: unidadeDoPdv(l.UNIDADE),
      categoria: texto(l.CATEGORIA),
      custo_unitario: numeroPositivo(l.PRECOCUSTO),
      ativo: vivo,
    };

    if (l.CODIGOPRODUTOTIPO === TIPO_INSUMO) {
      materiasPrimas.push(comum);
      continue;
    }
    if (l.CODIGOPRODUTOTIPO !== TIPO_PRODUTO) continue;

    const fiscal = validarFiscal(l, recusados);
    if (!fiscal) continue;

    const unidade = comum.unidade;
    produtos.push({
      ...comum,
      codigo: codigoDoProduto(prefixo, l.CODIGO),
      preco_venda: numeroPositivo(l.PRECOVENDA),
      ncm: fiscal.ncm,
      cest: fiscal.cest,
      origem_mercadoria: fiscal.origem,
      sujeito_st: texto(l.SITUACAOTRIBUTARIA) === '500',
      aliquota_transparencia: numeroPositivo(l.ALIQUOTATRANSPARENCIA),
      grupo_tributario_codigo: chaveDoGrupo(l),
      // Não existem no Consumer. O CHECK produtos_ativo_fiscal_completo exige
      // os dois para liberar emissão; como ativo_fiscal nasce false, ninguém
      // emite em cima do palpite sem revisar antes.
      unidade_tributavel: unidade,
      fator_conversao_tributavel: 1,
      ativo_fiscal: false,
      sugerido_automaticamente: true,
    });
  }

  return { produtos, materiasPrimas, recusados };
}
```

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/produtos-pdv-normaliza.test.mjs`
Expected: PASS em todos.

Se `preco_venda`/`custo_unitario` da Salsa não baterem, conferir os valores reais que foram para a fixture no Step 3 da Task 2 e corrigir a asserção — a fixture é a fonte, não o número que este plano chutou.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: 664 + os novos, nenhuma falha.

- [ ] **Step 6: Commit**

```bash
git add lib/pdvBackup/normalizaProdutos.js tests/produtos-pdv-normaliza.test.mjs
git commit -m "feat(produtos): normalização do cadastro vindo do PDV Consumer"
```

---

### Task 4: Regra de merge

**Files:**
- Create: `lib/pdvBackup/mergeProdutos.js`
- Create: `tests/produtos-pdv-merge.test.mjs`

**Interfaces:**
- Consumes: os objetos que `normalizaProdutosFb` devolve (Task 3).
- Produces, exportadas de `lib/pdvBackup/mergeProdutos.js`:
  - `CAMPOS_FISCAIS: string[]`
  - `mesmoValor(a: any, b: any) -> boolean`
  - `mesclar({ novo, atual, retrato, revisado }) -> { valores: object, conflitos: Array<{campo, atual, novo}>, congelados: string[] }`

  `atual` é `null` para linha nova (aí `valores` é `novo` inteiro). `retrato` é o conteúdo de `pdv_valores` da linha, ou `null`. `revisado` é booleano — `revisado_em != null` na linha.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/produtos-pdv-merge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPOS_FISCAIS, mesmoValor, mesclar } from '../lib/pdvBackup/mergeProdutos.js';

const NOVO = { nome: 'Costela Bovina', preco_venda: 59.9, ncm: '02102000', ativo: true };

test('mesmoValor não confunde o texto do Postgres com o número do Firebird', () => {
  // numeric volta do supabase-js como string; o Firebird devolve número. Sem
  // isto, todo preço viraria conflito falso já na segunda rodada.
  assert.equal(mesmoValor('49.90', 49.9), true);
  assert.equal(mesmoValor(49.9, 49.9), true);
  assert.equal(mesmoValor('49.90', 59.9), false);
  assert.equal(mesmoValor(null, null), true);
  assert.equal(mesmoValor(null, 0), false);
  assert.equal(mesmoValor(' Costela ', 'Costela'), true);
});

test('linha nova grava tudo', () => {
  const r = mesclar({ novo: NOVO, atual: null, retrato: null, revisado: false });
  assert.deepEqual(r.valores, NOVO);
  assert.deepEqual(r.conflitos, []);
  assert.deepEqual(r.congelados, []);
});

test('campo intocado desde a última importação é atualizado', () => {
  const r = mesclar({
    novo: { ...NOVO, preco_venda: 59.9 },
    atual: { ...NOVO, preco_venda: '49.90' },
    retrato: { ...NOVO, preco_venda: 49.9 },
    revisado: false,
  });
  assert.equal(r.valores.preco_venda, 59.9);
  assert.deepEqual(r.conflitos, []);
});

test('campo que alguém editou à mão não é tocado e vira conflito', () => {
  const r = mesclar({
    novo: { ...NOVO, nome: 'Costela Bovina PROMO' },
    atual: { ...NOVO, nome: 'Costela bovina (nome arrumado)' },
    retrato: { ...NOVO, nome: 'Costela Bovina' },
    revisado: false,
  });
  assert.equal(r.valores.nome, undefined, 'não pode entrar no update');
  assert.deepEqual(r.conflitos, [{
    campo: 'nome',
    atual: 'Costela bovina (nome arrumado)',
    novo: 'Costela Bovina PROMO',
  }]);
});

test('sem retrato, campo existente é tratado como editado à mão', () => {
  // Linha que já existia antes de a importação nascer: não há retrato para
  // comparar, e o certo é não presumir que o PDV pode mandar nela.
  const r = mesclar({
    novo: NOVO,
    atual: { ...NOVO, nome: 'Digitado à mão' },
    retrato: null,
    revisado: false,
  });
  assert.equal(r.valores.nome, undefined);
  assert.equal(r.conflitos.length, 1);
});

test('campo fiscal de linha revisada é congelado mesmo batendo com o retrato', () => {
  const r = mesclar({
    novo: { ...NOVO, ncm: '16025000', preco_venda: 59.9 },
    atual: { ...NOVO, ncm: '02102000', preco_venda: 49.9 },
    retrato: { ...NOVO, ncm: '02102000', preco_venda: 49.9 },
    revisado: true,
  });
  assert.equal(r.valores.ncm, undefined, 'NCM conferido por gente não se mexe');
  assert.ok(r.congelados.includes('ncm'));
  assert.equal(r.valores.preco_venda, 59.9, 'preço não é campo fiscal e continua espelhado');
});

test('CAMPOS_FISCAIS é a lista que a spec fixou', () => {
  assert.deepEqual([...CAMPOS_FISCAIS].sort(), [
    'aliquota_transparencia', 'cest', 'fator_conversao_tributavel', 'grupo_tributario_id',
    'ncm', 'origem_mercadoria', 'sujeito_st', 'unidade_tributavel',
  ]);
});

test('campo sem mudança nenhuma não entra no update', () => {
  const r = mesclar({ novo: NOVO, atual: { ...NOVO }, retrato: { ...NOVO }, revisado: false });
  assert.deepEqual(r.valores, {});
  assert.deepEqual(r.conflitos, []);
});
```

- [ ] **Step 2: Rodar os testes e ver falharem**

Run: `node --test tests/produtos-pdv-merge.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pdvBackup/mergeProdutos.js'`.

- [ ] **Step 3: Escrever a implementação**

Criar `lib/pdvBackup/mergeProdutos.js`:

```js
// A regra de "atualiza ou não atualiza", isolada num arquivo só.
//
// Existe separada porque é a única parte da importação que pode destruir
// trabalho humano, e porque a decisão é por campo, não por linha. Fica pura
// para poder ser testada sem simular Postgres nenhum.
//
// A pergunta que ela responde: o valor que está no 364 OS ainda é o que a
// importação passada gravou? Se sim, o PDV pode mandar nele. Se não, alguém
// mexeu, e a importação passa longe.

export const CAMPOS_FISCAIS = [
  'ncm', 'cest', 'origem_mercadoria', 'sujeito_st', 'aliquota_transparencia',
  'grupo_tributario_id', 'unidade_tributavel', 'fator_conversao_tributavel',
];

// numeric volta do supabase-js como string ('49.90') e do Firebird como número
// (49.9). Comparar cru faria todo preço virar conflito na segunda rodada, e a
// importação pararia de atualizar exatamente o que mais muda.
export function mesmoValor(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb;
  }
  return String(a).trim() === String(b).trim();
}

export function mesclar({ novo, atual, retrato, revisado }) {
  if (!atual) return { valores: { ...novo }, conflitos: [], congelados: [] };

  const valores = {};
  const conflitos = [];
  const congelados = [];

  for (const [campo, valorNovo] of Object.entries(novo)) {
    if (revisado && CAMPOS_FISCAIS.includes(campo)) {
      congelados.push(campo);
      continue;
    }
    const valorAtual = atual[campo];
    // Sem retrato não há como saber se o valor atual é da importação ou de
    // uma pessoa. O desempate é a favor da pessoa.
    const daImportacao = retrato ? mesmoValor(valorAtual, retrato[campo]) : false;
    if (!daImportacao) {
      if (!mesmoValor(valorAtual, valorNovo)) {
        conflitos.push({ campo, atual: valorAtual, novo: valorNovo });
      }
      continue;
    }
    if (!mesmoValor(valorAtual, valorNovo)) valores[campo] = valorNovo;
  }

  return { valores, conflitos, congelados };
}
```

- [ ] **Step 4: Rodar os testes e ver passarem**

Run: `node --test tests/produtos-pdv-merge.test.mjs`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add lib/pdvBackup/mergeProdutos.js tests/produtos-pdv-merge.test.mjs
git commit -m "feat(produtos): regra de merge que não sobrescreve edição humana"
```

---

### Task 5: Script orquestrador

**Files:**
- Create: `scripts/importar-produtos-pdv.mjs`
- Modify: `scripts/importar-pdv-backup.mjs` — exportar `baixarBackup` e `garantirDocker`
- Modify: `package.json` — script `importar-produtos-pdv`
- Modify: `scripts/IMPORTACAO-PDV.md` — seção sobre a carga de cadastro

**Interfaces:**
- Consumes: `SQL_PRODUTOS` (Task 2), `normalizaProdutosFb`/`gruposDoLote` (Task 3), `mesclar`/`mesmoValor` (Task 4), e de `scripts/importar-pdv-backup.mjs`: `baixarBackup({ loja, diretorio, agora, log }) -> { caminho, dia, data }`, `garantirDocker(log)`, `restaurarNoContainer({ nome, porta, senha, arquivo, log })`, `derrubarContainer(nome)`.
- Produces: o executável. Nenhum outro módulo consome este arquivo.

- [ ] **Step 1: Exportar o que o script novo precisa**

Em `scripts/importar-pdv-backup.mjs`, trocar `function baixarBackup(` por `export function baixarBackup(` e `function garantirDocker(` por `export function garantirDocker(`. Nada mais muda nesse arquivo.

- [ ] **Step 2: Confirmar que o importador de vendas continua íntegro**

Run: `npm test`
Expected: tudo verde — `tests/pdv-backup-*.test.mjs` importam desse arquivo e provam que o `export` não quebrou nada.

- [ ] **Step 3: Escrever o script**

Criar `scripts/importar-produtos-pdv.mjs`:

```js
// =========================================================
// 364 OS — importação do CADASTRO de produtos do PDV Consumer.
//
// Irmão de importar-pdv-backup.mjs, que traz o movimento. Aqui é cadastro:
// não há janela de datas, roda inteiro, e é sob demanda — cadastro não muda
// todo dia e a primeira carga precisa de olho humano no relatório.
//
// Tipo Produto vira `produtos`, tipo Insumo vira `materias_primas`. Os dados
// fiscais que o Consumer tem (NCM, CEST, origem) vêm junto, mas nenhum
// produto nasce liberado para emissão: ativo_fiscal é sempre false.
//
// Rodar de novo nunca desfaz edição humana — ver lib/pdvBackup/mergeProdutos.js.
//
// Uso:
//   node scripts/importar-produtos-pdv.mjs --dry-run    # obrigatório na 1ª vez
//   node scripts/importar-produtos-pdv.mjs
//   node scripts/importar-produtos-pdv.mjs --loja -2147478159
// =========================================================
import { createClient } from '@supabase/supabase-js';
import Firebird from 'node-firebird';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  baixarBackup, garantirDocker, restaurarNoContainer, derrubarContainer,
} from './importar-pdv-backup.mjs';
import { SQL_PRODUTOS } from '../lib/pdvBackup/consultasProdutos.js';
import { normalizaProdutosFb, gruposDoLote } from '../lib/pdvBackup/normalizaProdutos.js';
import { mesclar } from '../lib/pdvBackup/mergeProdutos.js';

const CAMINHO_FDB = '/var/lib/firebird/data/consumer.fdb';

function carregarEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const linhaBruta of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const linha = linhaBruta.replace(/\r$/, '');
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith('#')) continue;
    let v = m[2].trimEnd();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

function consultar(db, sql) {
  return new Promise((ok, falhou) => {
    db.query(sql, [], (erro, linhas) => (erro ? falhou(erro) : ok(linhas || [])));
  });
}

function abrirFirebird(opcoes) {
  return new Promise((ok, falhou) => {
    Firebird.attach(opcoes, (erro, db) => (erro ? falhou(erro) : ok(db)));
  });
}

// Cria os grupos tributários que faltam e devolve o mapa código -> id. São
// quatro combinações para 458 produtos: a pessoa cria a regra tributária uma
// vez por grupo, não uma por produto. O CFOP/CSOSN do PDV NÃO vira
// regras_tributarias — regra se resolve por natureza de operação e UF, que o
// Consumer não tem, e inventar uma seria fabricar informação fiscal.
async function garantirGrupos({ sb, empresaId, grupos, dryRun, log }) {
  const { data: existentes, error } = await sb.from('grupos_tributarios')
    .select('id, codigo').eq('empresa_id', empresaId);
  if (error) throw new Error('não consegui ler os grupos tributários: ' + error.message);

  const mapa = new Map((existentes || []).map(g => [g.codigo, g.id]));
  const faltando = grupos.filter(g => !mapa.has(g.codigo));
  if (!faltando.length) return mapa;

  log(`  ${faltando.length} grupo(s) tributário(s) a criar: ${faltando.map(g => g.codigo).join(', ')}`);
  if (dryRun) return mapa;

  const { data: criados, error: erroCriar } = await sb.from('grupos_tributarios')
    .insert(faltando.map(g => ({ empresa_id: empresaId, codigo: g.codigo, descricao: g.descricao })))
    .select('id, codigo');
  if (erroCriar) throw new Error('não consegui criar os grupos tributários: ' + erroCriar.message);
  for (const g of criados) mapa.set(g.codigo, g.id);
  return mapa;
}

// Grava um lote numa tabela, linha a linha pela regra de merge. Linha a linha
// de propósito: o upsert em bloco não sabe congelar campo, e são 458 linhas
// uma vez por carga — não vale trocar clareza por microssegundos.
async function gravarLote({ sb, tabela, linhas, dryRun, log }) {
  const resumo = { novos: 0, atualizados: 0, semMudanca: 0, conflitos: [], congelados: 0 };
  if (!linhas.length) return resumo;

  const empresaId = linhas[0].empresa_id;
  // As duas tabelas têm revisado_em — é a coluna que a atualização 36 criou
  // para marcar "uma pessoa conferiu os campos fiscais desta linha".
  const { data: existentes, error } = await sb.from(tabela).select('*')
    .eq('empresa_id', empresaId).not('pdv_codigo_produto', 'is', null);
  if (error) throw new Error(`não consegui ler ${tabela}: ${error.message}`);

  const porCodigo = new Map((existentes || []).map(l => [l.pdv_codigo_produto, l]));

  for (const novo of linhas) {
    const atual = porCodigo.get(novo.pdv_codigo_produto) || null;
    const retrato = atual?.pdv_valores || null;
    const { valores, conflitos, congelados } = mesclar({
      novo,
      atual,
      retrato,
      revisado: Boolean(atual?.revisado_em),
    });
    resumo.conflitos.push(...conflitos.map(c => ({ ...c, codigo: novo.pdv_codigo_produto })));
    resumo.congelados += congelados.length;

    if (!atual) {
      resumo.novos += 1;
      if (dryRun) continue;
      const { error: erroInsert } = await sb.from(tabela)
        .insert([{ ...valores, pdv_valores: valores, pdv_importado_em: new Date().toISOString() }]);
      if (erroInsert) throw new Error(`não consegui inserir ${novo.pdv_codigo_produto} em ${tabela}: ${erroInsert.message}`);
      continue;
    }

    if (!Object.keys(valores).length) { resumo.semMudanca += 1; continue; }
    resumo.atualizados += 1;
    if (dryRun) continue;
    // O retrato tem que dizer o que ficou NA LINHA, não o que o PDV mandou.
    // Gravar `novo` inteiro faria o retrato afirmar que a importação gravou um
    // NCM congelado que ela não gravou — e a rodada seguinte compararia contra
    // uma mentira.
    const { error: erroUpdate } = await sb.from(tabela)
      .update({
        ...valores,
        pdv_valores: { ...(retrato || {}), ...valores },
        pdv_importado_em: new Date().toISOString(),
      })
      .eq('id', atual.id);
    if (erroUpdate) throw new Error(`não consegui atualizar ${novo.pdv_codigo_produto} em ${tabela}: ${erroUpdate.message}`);
  }

  log(`  ${tabela}: ${resumo.novos} novo(s), ${resumo.atualizados} atualizado(s), `
    + `${resumo.semMudanca} sem mudança, ${resumo.conflitos.length} conflito(s), `
    + `${resumo.congelados} campo(s) congelado(s) por revisão`);
  return resumo;
}

async function main() {
  carregarEnv(path.resolve(process.cwd(), '.env.local'));
  const dryRun = process.argv.includes('--dry-run');
  const somenteLoja = arg('--loja', null);
  const log = msg => console.log(msg);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.');
    process.exit(1);
  }
  const sb = createClient(url, chave, { auth: { persistSession: false } });

  const { data: lojas, error } = await sb.from('pdv_lojas')
    .select('id_connect, empresa_id, nome_connect, drive_arquivos, empresas(prefixo_codigo)')
    .eq('ativo', true).eq('origem', 'backup');
  if (error) { console.error('ERRO ao ler pdv_lojas: ' + error.message); process.exit(1); }

  const alvo = somenteLoja
    ? lojas.filter(l => String(l.id_connect) === String(somenteLoja))
    : lojas;
  if (!alvo.length) { console.error('Nenhuma loja ativa com origem=backup.'); process.exit(1); }

  console.log(`Importação de cadastro do PDV${dryRun ? ' (dry-run — nada será gravado)' : ''}`);
  garantirDocker(log);
  const porta = Number(process.env.PDV_FB_PORTA || 3050);

  for (const loja of alvo) {
    console.log(`\n${loja.nome_connect}`);
    const prefixo = loja.empresas?.prefixo_codigo;
    if (!prefixo) throw new Error(`a empresa da loja ${loja.nome_connect} está sem prefixo_codigo`);

    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-cadastro-'));
    const nomeContainer = `pdv-cadastro-${randomBytes(4).toString('hex')}`;
    const senha = randomBytes(12).toString('hex');
    let db = null;

    try {
      const { caminho } = baixarBackup({ loja, diretorio, agora: new Date(), log });
      await restaurarNoContainer({ nome: nomeContainer, porta, senha, arquivo: caminho, log });
      db = await abrirFirebird({
        host: '127.0.0.1', port: porta, database: CAMINHO_FDB,
        user: 'SYSDBA', password: senha, lowercase_keys: false,
      });

      const linhas = await consultar(db, SQL_PRODUTOS);
      log(`  ${linhas.length} linha(s) de cadastro lidas`);

      const { data: vendidos, error: erroVendidos } = await sb.from('pdv_vendas_itens_dia')
        .select('codigo_produto').eq('empresa_id', loja.empresa_id).not('codigo_produto', 'is', null);
      if (erroVendidos) throw new Error('não consegui ler os produtos vendidos: ' + erroVendidos.message);
      const codigosVendidos = new Set((vendidos || []).map(v => v.codigo_produto));

      const grupos = gruposDoLote(linhas);
      const mapaGrupos = await garantirGrupos({ sb, empresaId: loja.empresa_id, grupos, dryRun, log });

      const { produtos, materiasPrimas, recusados } = normalizaProdutosFb({
        linhas, empresaId: loja.empresa_id, prefixo, codigosVendidos,
      });

      // O código do grupo só vira id aqui: a normalização é pura e não fala
      // com banco. Em dry-run os grupos ainda não existem, então o id sai
      // nulo — é esperado, e o relatório já disse quais seriam criados.
      for (const p of produtos) {
        p.grupo_tributario_id = mapaGrupos.get(p.grupo_tributario_codigo) || null;
        delete p.grupo_tributario_codigo;
      }

      const rp = await gravarLote({ sb, tabela: 'produtos', linhas: produtos, dryRun, log });
      const rm = await gravarLote({ sb, tabela: 'materias_primas', linhas: materiasPrimas, dryRun, log });

      if (recusados.length) {
        console.log(`\n  ${recusados.length} linha(s) recusada(s) por formato:`);
        for (const r of recusados) console.log(`    produto ${r.codigo}: ${r.motivo} (${r.campo} = "${r.valor}")`);
      }
      const conflitos = [...rp.conflitos, ...rm.conflitos];
      if (conflitos.length) {
        console.log(`\n  ${conflitos.length} campo(s) não atualizados porque alguém editou à mão:`);
        for (const c of conflitos) {
          console.log(`    produto ${c.codigo} · ${c.campo}: aqui "${c.atual}", no PDV "${c.novo}"`);
        }
      }
    } finally {
      if (db) { try { db.detach(); } catch { /* já caiu */ } }
      derrubarContainer(nomeContainer);
      fs.rmSync(diretorio, { recursive: true, force: true });
    }
  }

  console.log(`\n${dryRun ? 'Dry-run concluído — nada foi gravado.' : 'Importação concluída.'}`);
}

main().catch(e => { console.error('\nERRO: ' + e.message); process.exit(1); });
```

- [ ] **Step 4: Registrar no package.json**

Acrescentar em `scripts`, depois de `"importar-pdv-backup"`:

```json
"importar-produtos-pdv": "node scripts/importar-produtos-pdv.mjs",
```

- [ ] **Step 5: Conferir que o script carrega sem erro de sintaxe ou import**

Run: `node --check scripts/importar-produtos-pdv.mjs && node -e "import('./scripts/importar-produtos-pdv.mjs').catch(e => { console.error(e.message); process.exit(1); })"`
Expected: sai sem erro de módulo. Vai reclamar de credencial ou de loja, e isso é esperado — o que se prova aqui é que todos os `import` resolvem.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: tudo verde.

- [ ] **Step 7: Documentar**

Acrescentar a `scripts/IMPORTACAO-PDV.md` uma seção "Cadastro de produtos" explicando: que a carga é sob demanda e não entra no cron; que `--dry-run` é obrigatório na primeira vez; como ler o relatório (novos, atualizados, sem mudança, conflitos, congelados); que conflito significa "alguém editou aqui e a importação passou longe", não erro; e que produto importado nasce com `ativo_fiscal = false` e precisa de revisão humana antes de emitir.

- [ ] **Step 8: Commit**

```bash
git add scripts/importar-produtos-pdv.mjs scripts/importar-pdv-backup.mjs package.json scripts/IMPORTACAO-PDV.md
git commit -m "feat(produtos): script de importação do cadastro do PDV Consumer"
```

---

## Entrega

Depois da Task 5, **parar e falar com o usuário**. Nada roda contra a produção sem autorização explícita, e a ordem é:

1. Aplicar a migração 46 na produção — autorização do usuário, comando rodado por ele.
2. `npm run importar-produtos-pdv -- --dry-run` e ler o relatório junto.
3. Só então a carga de verdade.
