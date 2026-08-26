-- =========================================================
-- Atualização 44 — fuso horário só aceita identificador IANA
--
-- As colunas `fuso` de empregadores e unidades são texto livre e alimentam
-- `at time zone` no Postgres e `Intl.DateTimeFormat` no Node. Os dois rejeitam
-- qualquer coisa que não seja um identificador IANA: gravar o nome da cidade
-- ("MANAUS", "Manaus") não erra na hora do cadastro, erra na hora de usar —
-- `ERROR: time zone "Manaus" not recognized` e `RangeError: Invalid time zone`.
-- Foi o que aconteceu com os dois CNPJs do grupo, preenchidos à mão.
--
-- O CHECK abaixo é a rede embaixo do formulário: a lista fixa dos fusos
-- brasileiros. Não dá para checar contra `pg_timezone_names` porque a view não
-- é IMMUTABLE e o Postgres recusa em CHECK; a lista fixa muda tão raramente
-- quanto o mapa de fusos do país, então o custo de mantê-la é o certo.
--
-- Antes de criar a restrição, normaliza as grafias por cidade já conhecidas.
-- Se sobrar qualquer outro valor fora da lista, o bloco DO aborta dizendo qual
-- é e em que linha — melhor que a mensagem genérica de violação de CHECK.
--
-- Só depende da atualizacao_11 (que criou as duas colunas): o número 44 é
-- ordem de fila, não pré-requisito — pode rodar antes da 43. Idempotente.
-- Rollback comentado no fim.
-- =========================================================

begin;

-- ---------- normalização das grafias por cidade ----------
-- Mesmo offset (UTC-4) nos dois casos; a diferença é só o identificador válido.
update public.empregadores
   set fuso = 'America/Manaus'
 where lower(btrim(fuso)) in ('manaus', 'america/manaus') and fuso <> 'America/Manaus';

update public.empregadores
   set fuso = 'America/Porto_Velho'
 where lower(btrim(fuso)) in ('porto velho', 'porto_velho', 'america/porto_velho')
   and fuso <> 'America/Porto_Velho';

update public.unidades
   set fuso = 'America/Manaus'
 where lower(btrim(fuso)) in ('manaus', 'america/manaus') and fuso <> 'America/Manaus';

update public.unidades
   set fuso = 'America/Porto_Velho'
 where lower(btrim(fuso)) in ('porto velho', 'porto_velho', 'america/porto_velho')
   and fuso <> 'America/Porto_Velho';

-- ---------- o que sobrou fora da lista aborta com o valor à vista ----------
do $$
declare
  v_restos text;
begin
  select string_agg(format('%s(%s) = %L', tabela, id, fuso), ', ')
    into v_restos
    from (
      select 'empregadores' as tabela, id::text as id, fuso from public.empregadores
      union all
      select 'unidades', id::text, fuso from public.unidades
    ) t
   where fuso not in (
     'America/Sao_Paulo', 'America/Porto_Velho', 'America/Manaus',
     'America/Cuiaba', 'America/Campo_Grande', 'America/Belem',
     'America/Santarem', 'America/Araguaina', 'America/Fortaleza',
     'America/Recife', 'America/Maceio', 'America/Bahia',
     'America/Rio_Branco', 'America/Eirunepe', 'America/Boa_Vista',
     'America/Noronha'
   );

  if v_restos is not null then
    raise exception
      'Fuso fora da lista IANA brasileira, corrija antes de aplicar a restrição: %', v_restos;
  end if;
end $$;

-- ---------- a restrição ----------
alter table public.empregadores drop constraint if exists empregadores_fuso_iana;
alter table public.empregadores add constraint empregadores_fuso_iana check (fuso in (
  'America/Sao_Paulo', 'America/Porto_Velho', 'America/Manaus',
  'America/Cuiaba', 'America/Campo_Grande', 'America/Belem',
  'America/Santarem', 'America/Araguaina', 'America/Fortaleza',
  'America/Recife', 'America/Maceio', 'America/Bahia',
  'America/Rio_Branco', 'America/Eirunepe', 'America/Boa_Vista',
  'America/Noronha'
));

alter table public.unidades drop constraint if exists unidades_fuso_iana;
alter table public.unidades add constraint unidades_fuso_iana check (fuso in (
  'America/Sao_Paulo', 'America/Porto_Velho', 'America/Manaus',
  'America/Cuiaba', 'America/Campo_Grande', 'America/Belem',
  'America/Santarem', 'America/Araguaina', 'America/Fortaleza',
  'America/Recife', 'America/Maceio', 'America/Bahia',
  'America/Rio_Branco', 'America/Eirunepe', 'America/Boa_Vista',
  'America/Noronha'
));

commit;

-- ---------- rollback ----------
-- Só derruba a restrição; os valores normalizados ficam, porque voltar a
-- gravar o nome da cidade é reintroduzir o defeito.
-- begin;
-- alter table public.empregadores drop constraint if exists empregadores_fuso_iana;
-- alter table public.unidades drop constraint if exists unidades_fuso_iana;
-- commit;
