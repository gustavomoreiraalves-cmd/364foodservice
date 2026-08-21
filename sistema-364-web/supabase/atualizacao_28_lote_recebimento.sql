-- Fase 1 do controle de lote: o volume recebido ganha etiqueta impressa.
--
-- O lote nasce em `recebimento_itens.lote` (LT-AAMMDD-###) e, até aqui, morria
-- ali. Esta migração dá ao item o número de volumes que chegaram — que define
-- quantas etiquetas imprimir — e ensina a auditoria de impressão, criada na
-- atualização 17, a registrar etiqueta de recebimento.
--
-- Também entram os dois campos que a etiqueta de despacho vai imprimir na Fase
-- 4 e que são cadastro, não processo: o dizer de conservação por produto e o
-- registro no Serviço de Inspeção Municipal por empresa. Ficam aqui porque são
-- `alter table` de uma linha e porque quem cadastra produto já vai preenchê-los.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `create or replace` em tudo. Não altera dado existente: `volumes` nasce nulo
-- nos itens já recebidos, e nulo significa "não sei quantos volumes eram".
--
-- Antes de aplicar, confira que a atualização 17 está aplicada (ela cria
-- `etiqueta_impressoes` e `registrar_impressao`, que esta migração altera):
--   select count(*) from information_schema.tables where table_name = 'etiqueta_impressoes';
-- Precisa dar 1.

begin;

-- ---------- RECEBIMENTO: quantos volumes chegaram ----------

alter table public.recebimento_itens
  add column if not exists volumes int;

alter table public.recebimento_itens drop constraint if exists recebimento_itens_volumes_positivo;
alter table public.recebimento_itens add constraint recebimento_itens_volumes_positivo
  check (volumes is null or volumes > 0);

comment on column public.recebimento_itens.volumes is
  'Quantas caixas/volumes deste lote chegaram. Define quantas etiquetas imprimir. Nulo = item anterior à atualização 28.';

-- ---------- CADASTRO: dizeres do rótulo ----------

alter table public.produtos
  add column if not exists conservacao_texto text;
comment on column public.produtos.conservacao_texto is
  'Dizer de conservação impresso na etiqueta de despacho, igual ao rótulo da gráfica. Ex.: MANTER CONGELADO A -12 °C.';

alter table public.empresas
  add column if not exists sim_numero text,
  add column if not exists sim_municipio text;
comment on column public.empresas.sim_numero is
  'Número do registro no Serviço de Inspeção Municipal, impresso no selo da etiqueta de despacho.';

-- ---------- AUDITORIA DE IMPRESSÃO: novos tipos de origem ----------
-- `embalagem_item` e `expedicao_caixa` entram junto porque o check é um só e
-- ampliá-lo agora poupa uma migração em cada fase seguinte. Nada os usa ainda.

alter table public.etiqueta_impressoes drop constraint if exists etiqueta_impressoes_source_type_check;
alter table public.etiqueta_impressoes add constraint etiqueta_impressoes_source_type_check
  check (source_type in ('producao', 'producao_interna', 'recebimento_item', 'embalagem_item', 'expedicao_caixa'));

create or replace function public.registrar_impressao(
  p_source_type text, p_source_id uuid, p_tipo text, p_quantidade int,
  p_modelo text default 'validade-cozinha', p_impressora text default null, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_status text;
  v_codigo text;
  v_modulo text;
begin
  if p_source_type = 'producao_interna' then
    v_modulo := 'producoes';
    select empresa_id, status, codigo into v_empresa, v_status, v_codigo
      from producoes_internas where id = p_source_id;
    if not found then raise exception 'Produção interna não encontrada.'; end if;
    if v_status <> 'finalizada' then
      raise exception 'Etiquetas só podem ser impressas para produção finalizada (% está "%").', v_codigo, v_status;
    end if;
  elsif p_source_type = 'producao' then
    v_modulo := 'producoes';
    select empresa_id into v_empresa from producoes where id = p_source_id;
    if not found then raise exception 'Produção não encontrada.'; end if;
  elsif p_source_type = 'recebimento_item' then
    -- Fase 1 do controle de lote: a etiqueta identifica o volume recebido.
    v_modulo := 'recebimentos';
    select empresa_id, lote into v_empresa, v_codigo
      from recebimento_itens where id = p_source_id;
    if not found then raise exception 'Item de recebimento não encontrado.'; end if;
  else
    raise exception 'source_type inválido: %', p_source_type;
  end if;

  if v_empresa not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta impressão.';
  end if;
  if not public.tem_permissao(v_modulo) then
    raise exception 'Sem permissão para imprimir etiquetas de %.', v_modulo;
  end if;
  if p_tipo = 'reimpressao' and (p_motivo is null or btrim(p_motivo) = '') then
    raise exception 'Informe o motivo da reimpressão.';
  end if;

  insert into etiqueta_impressoes (empresa_id, source_type, source_id, tipo, quantidade, modelo, impressora, motivo, usuario_id, usuario_nome)
  values (v_empresa, p_source_type, p_source_id, p_tipo, p_quantidade, p_modelo, p_impressora, p_motivo, auth.uid(), public.fn_nome_usuario());

  perform public.fn_registrar_auditoria('etiqueta_impressoes', p_source_id,
                                        case when p_tipo = 'reimpressao' then 'REIMPRESSAO' else 'IMPRESSAO' end,
                                        v_empresa, null,
                                        jsonb_build_object('source_type', p_source_type, 'quantidade', p_quantidade,
                                                           'modelo', p_modelo, 'impressora', p_impressora),
                                        p_motivo);
end $$;

commit;

-- ---------- ROLLBACK ----------
-- Devolve o check ao estado da atualização 17 e derruba as colunas novas.
-- A RPC volta ao original reaplicando `atualizacao_17_producao_interna.sql`,
-- que é idempotente — não vale duplicar cem linhas de SQL aqui.
--
-- begin;
--
-- delete from etiqueta_impressoes where source_type in ('recebimento_item','embalagem_item','expedicao_caixa');
--
-- alter table public.etiqueta_impressoes drop constraint if exists etiqueta_impressoes_source_type_check;
-- alter table public.etiqueta_impressoes add constraint etiqueta_impressoes_source_type_check
--   check (source_type in ('producao', 'producao_interna'));
--
-- alter table public.recebimento_itens drop constraint if exists recebimento_itens_volumes_positivo;
-- alter table public.recebimento_itens drop column if exists volumes;
-- alter table public.produtos drop column if exists conservacao_texto;
-- alter table public.empresas drop column if exists sim_numero;
-- alter table public.empresas drop column if exists sim_municipio;
--
-- commit;
