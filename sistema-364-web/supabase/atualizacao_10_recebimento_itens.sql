-- Atualização 10: uma nota de recebimento passa a suportar múltiplas
-- matérias-primas (cabeçalho + itens), igual ao padrão já usado em
-- pedidos/pedido_itens. `recebimentos` vira o cabeçalho da nota (data,
-- fornecedor, nota fiscal, anexo, responsável, temperatura); os campos
-- por matéria-prima migram para a nova tabela `recebimento_itens`.

create table recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references recebimentos(id) on delete cascade,
  materia_prima_id uuid not null references materias_primas(id),
  lote text not null,
  numero_lote_fornecedor text,
  quantidade numeric(12,4) not null,
  peso_nota_kg numeric(12,4),
  custo_unitario numeric(12,2) not null,
  condicao_embalagem text,
  status_recebimento text not null default 'Aceito'
    check (status_recebimento in ('Aceito', 'Aceito com ressalva', 'Rejeitado')),
  local_armazenamento text,
  validade date,
  foto_produto_url text,
  aprovado_por_id uuid references funcionarios(id),
  empresa_id uuid not null references empresas(id),
  created_at timestamptz not null default now()
);
create index recebimento_itens_empresa_id_idx on recebimento_itens (empresa_id);
create index recebimento_itens_recebimento_id_idx on recebimento_itens (recebimento_id);

alter table recebimento_itens enable row level security;
create policy "empresa_scoped_access" on recebimento_itens for all
  using (empresa_id in (select public.empresas_permitidas()))
  with check (empresa_id in (select public.empresas_permitidas()));

-- Backfill: cada recebimento existente vira uma nota com exatamente 1 item
insert into recebimento_itens (recebimento_id, materia_prima_id, lote, numero_lote_fornecedor,
  quantidade, peso_nota_kg, custo_unitario, condicao_embalagem, status_recebimento,
  local_armazenamento, validade, foto_produto_url, aprovado_por_id, empresa_id, created_at)
select id, materia_prima_id, lote, numero_lote_fornecedor, quantidade, peso_nota_kg,
  custo_unitario, condicao_embalagem, status_recebimento, local_armazenamento, validade,
  foto_produto_url, aprovado_por_id, empresa_id, created_at
from recebimentos;

-- a view antiga referencia colunas de recebimentos que vamos remover: precisa
-- sumir antes do drop column (é recriada mais abaixo, já apontando pros itens)
drop view if exists vw_estoque_materia_prima;

-- recebimentos vira só cabeçalho (o drop column remove a check constraint junto)
alter table recebimentos drop column materia_prima_id;
alter table recebimentos drop column lote;
alter table recebimentos drop column numero_lote_fornecedor;
alter table recebimentos drop column quantidade;
alter table recebimentos drop column peso_nota_kg;
alter table recebimentos drop column custo_unitario;
alter table recebimentos drop column condicao_embalagem;
alter table recebimentos drop column status_recebimento;
alter table recebimentos drop column local_armazenamento;
alter table recebimentos drop column validade;
alter table recebimentos drop column foto_produto_url;
alter table recebimentos drop column aprovado_por_id;

-- View de estoque passa a somar pelos itens
drop view if exists vw_estoque_materia_prima;
create view vw_estoque_materia_prima
with (security_invoker = true) as
select
  mp.empresa_id, mp.id as materia_prima_id, mp.nome, mp.unidade,
  coalesce(sum(r.quantidade) filter (where r.status_recebimento in ('Aceito', 'Aceito com ressalva')), 0) as total_recebido,
  coalesce((select sum(pc.quantidade) from producao_consumo pc where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as total_consumido,
  coalesce(sum(r.quantidade) filter (where r.status_recebimento in ('Aceito', 'Aceito com ressalva')), 0)
  - coalesce((select sum(pc.quantidade) from producao_consumo pc where pc.materia_prima_id = mp.id and pc.empresa_id = mp.empresa_id), 0) as saldo
from materias_primas mp
left join recebimento_itens r on r.materia_prima_id = mp.id and r.empresa_id = mp.empresa_id
group by mp.empresa_id, mp.id, mp.nome, mp.unidade;

-- Trigger de embalagem->produção passa a calcular custo médio pelos itens
create or replace function public.trigger_embalagem_para_producao()
returns trigger language plpgsql as $function$
declare
  v_producao_id uuid;
  v_produto_id uuid := new.produto_id;
  v_quantidade numeric(12,3) := new.quantidade;
  v_embalagem_id uuid := new.embalagem_id;
  v_data date;
  v_empresa_id uuid;
  v_custo_total numeric(12,2);
  v_custo_mp numeric(12,2);
begin
  select data, empresa_id into v_data, v_empresa_id from embalagens where id = v_embalagem_id;

  select coalesce(sum(r.quantidade * r.custo_unitario) / nullif(sum(r.quantidade), 0), 0) into v_custo_mp
    from recebimento_itens r
    join ficha_tecnica ft on ft.materia_prima_id = r.materia_prima_id
    where ft.produto_id = v_produto_id and r.empresa_id = v_empresa_id
      and r.status_recebimento in ('Aceito', 'Aceito com ressalva');

  v_custo_total := v_quantidade * v_custo_mp;

  select id into v_producao_id from producoes
    where produto_id = v_produto_id and data = v_data and origem = 'embalagem' and empresa_id = v_empresa_id
    limit 1;

  if v_producao_id is not null then
    update producoes set quantidade = quantidade + v_quantidade, custo_total = custo_total + v_custo_total
      where id = v_producao_id;
  else
    insert into producoes (lote, data, produto_id, quantidade, custo_total, origem, empresa_id)
    values ('EMBALAGEM-' || to_char(v_data, 'DD/MM/YY') || '-' || substring(gen_random_uuid()::text, 1, 3),
      v_data, v_produto_id, v_quantidade, v_custo_total, 'embalagem', v_empresa_id);
  end if;

  return new;
end;
$function$;
