#!/usr/bin/env bash
# Exercita a atualização 30 (ficha de embalagem: estoque na finalização e o
# trigger antigo consertado) num Postgres local descartável. Não toca em
# produção. Requer psql no PATH e um servidor local.
#
# Uso: tests/migracao-30/verificar.sh
set -euo pipefail

export PGOPTIONS='-c client_min_messages=warning'

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
BANCO="${BANCO_TESTE_EMBALAGEM:-embalagem_test_364}"
MIGRACAO="$RAIZ/supabase/atualizacao_30_ficha_embalagem.sql"

command -v psql >/dev/null || { echo "psql não encontrado no PATH"; exit 1; }
pg_isready -q || { echo "nenhum Postgres local aceitando conexões"; exit 1; }

limpar() { dropdb --if-exists "$BANCO" >/dev/null 2>&1 || true; }
trap limpar EXIT

limpar
createdb "$BANCO"

psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# Antes de tudo: prova que a mina existe mesmo no fixture. Com o trigger da
# atualização 10 de pé, salvar o primeiro item de uma ficha estoura 42703
# (undefined_column, `recebimento_itens.status_recebimento`). Se este insert
# passar, o fixture parou de reproduzir produção e o cenário 2 não prova nada.
mina=$(psql -tAq -d "$BANCO" <<'SQL' 2>&1 || true
do $$
declare v_ficha uuid;
begin
  insert into embalagens (lote, empresa_id)
    values ('EMB-MINA-001', '11111111-1111-1111-1111-111111111111') returning id into v_ficha;
  insert into embalagem_itens (embalagem_id, produto_id, quantidade, peso_total_kg, empresa_id)
    values (v_ficha, '44444444-4444-4444-4444-444444444444', 1, 1, '11111111-1111-1111-1111-111111111111');
end $$;
SQL
)
case "$mina" in
  *42703*|*status_recebimento*) echo "OK: a mina está armada no fixture (trigger antigo estoura 42703)" ;;
  *) echo "o fixture deveria reproduzir o trigger antigo quebrado; psql respondeu: $mina"; exit 1 ;;
esac

# Recria o banco do zero. O `do` acima estoura como statement único, então o
# `insert into embalagens` dele já volta atrás sozinho — refazer é cinto e
# suspensório, para os cenários nunca herdarem sujeira da checagem da mina.
limpar
createdb "$BANCO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/fixture.sql"

# A migração sob teste é o arquivo real que vai para produção. Aplicada duas
# vezes seguidas: prova idempotência de verdade (rodar o runner várias vezes só
# prova que ele é estável, não que a própria migração pode ser reaplicada sobre
# um banco onde já rodou uma vez, que é o caso real de produção).
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$MIGRACAO"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/cenarios.sql"

# O trigger antigo precisa ter saído de `embalagem_itens`, e a função que lia a
# coluna morta precisa ter sido removida junto — deixá-la de pé seria uma
# armadilha para quem for ler o schema depois.
antigo=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_trigger where tgname = 'trg_embalagem_items_to_producao';")
[ "$antigo" = "0" ] || { echo "o trigger antigo continua instalado em embalagem_itens"; exit 1; }
antiga_fn=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_proc where proname = 'trigger_embalagem_para_producao';")
[ "$antiga_fn" = "0" ] || { echo "a função antiga trigger_embalagem_para_producao continua no banco"; exit 1; }
echo "OK: trigger e função antigos removidos"

# Os cenários rodam como dono do banco, onde RLS não se aplica, então eles não
# conseguem provar que as travas resistem a um usuário `authenticated`. O que dá
# para conferir aqui é que as cinco funções continuam `security definer`: como
# `invoker`, a policy de `embalagens`/`embalagem_itens` (atualização 06) podia
# esconder a ficha pai de quem escreve e fazer o trigger liberar a escrita — e a
# de `defumacoes` podia esconder fornadas e devolver um rendimento parcial, que
# não dá erro nenhum, só um custo errado.
definer=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_proc where proname in ('fn_embalagem_bloquear_edicao','fn_embalagem_cabecalho','fn_embalagens_bloquear_delete','fn_embalagem_gerar_producao','fn_rendimento_defumacao') and prosecdef;")
[ "$definer" = "5" ] || { echo "as cinco funções da migração precisam ser security definer (achou $definer)"; exit 1; }
echo "OK: funções em security definer"

# O rollback vive comentado no fim da migração; extrai e aplica para provar que
# é SQL válido e que desfaz o que a migração criou.
sed -n '/^-- begin;/,/^-- commit;/p' "$MIGRACAO" | sed 's/^-- \{0,1\}//' > "$AQUI/.rollback.sql"
psql -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$AQUI/.rollback.sql"
rm -f "$AQUI/.rollback.sql"

sobraram=$(psql -tAq -d "$BANCO" -c "select count(*) from information_schema.columns
  where (table_name = 'embalagens' and column_name in ('status','cancelada_motivo','cancelada_em','cancelada_por_id','updated_at'))
     or (table_name = 'embalagem_itens' and column_name in ('recebimento_item_id','validade'))
     or (table_name = 'produtos' and column_name = 'rastreado')
     or (table_name = 'producoes' and column_name = 'embalagem_id');")
[ "$sobraram" = "0" ] || { echo "rollback não removeu todas as colunas novas (achou $sobraram)"; exit 1; }

constraints=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_constraint where conname in
  ('embalagens_status_valido','embalagens_cancelamento_motivo','embalagens_lote_unico_por_empresa',
   'embalagem_itens_quantidade_valida','embalagem_itens_peso_valido');")
[ "$constraints" = "0" ] || { echo "rollback não removeu as constraints novas (achou $constraints)"; exit 1; }

triggers=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_trigger where tgname in
  ('trg_embalagem_itens_bloquear_edicao','trg_embalagens_cabecalho','trg_embalagens_bloquear_delete','trg_embalagens_gerar_producao');")
[ "$triggers" = "0" ] || { echo "rollback não removeu os triggers (achou $triggers)"; exit 1; }

funcoes=$(psql -tAq -d "$BANCO" -c "select count(*) from pg_proc where proname in
  ('fn_embalagem_bloquear_edicao','fn_embalagem_cabecalho','fn_embalagens_bloquear_delete','fn_embalagem_gerar_producao','fn_rendimento_defumacao');")
[ "$funcoes" = "0" ] || { echo "rollback não removeu as funções (achou $funcoes)"; exit 1; }

# A RPC não é conferida aqui: o rollback dela é reaplicar a atualização 28, que
# é idempotente — está dito em comentário no fim da migração.
echo "OK: rollback desfaz a migração"
