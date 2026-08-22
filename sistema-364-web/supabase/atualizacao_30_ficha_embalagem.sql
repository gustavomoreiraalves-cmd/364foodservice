-- Fase 3 do controle de lote: a ficha de embalagem sai do papel, e o peso
-- defumado vira produto acabado com lote e validade.
--
-- As tabelas `embalagens` e `embalagem_itens` existem desde a atualização 08 e
-- nunca ganharam tela. O que falta é o que as torna confiáveis e rastreáveis:
--   • `embalagens.status` — a ficha nasce em rascunho, é finalizada pelo
--     responsável e depois disso não muda mais (exceto para cancelada, com
--     motivo), no mesmo desenho da ficha de defumação (atualização 29).
--   • `embalagem_itens.recebimento_item_id` — o lote de matéria-prima que
--     originou aquele produto. É o elo que fecha recebimento → defumação →
--     embalagem.
--   • `embalagem_itens.validade` — calculada na finalização e GRAVADA, para
--     que mudar a regra de conservação do produto depois não altere validade
--     já impressa em etiqueta.
--   • `producoes.embalagem_id` — sem ele, desfazer o estoque de uma ficha
--     cancelada dependeria de heurística por data e produto.
--   • `produtos.rastreado` — marcação explícita de quem só pode entrar no
--     estoque pela ficha de embalagem.
--
-- `embalagens.lote` é o NÚMERO DA FICHA (EMB-AAMMDD-###), não o lote
-- rastreável de matéria-prima: uma ficha pode consumir vários lotes, um por
-- item. O lote rastreável mora em `embalagem_itens.recebimento_item_id`.
--
-- ---------- A MINA QUE ESTA MIGRAÇÃO DESARMA ----------
--
-- O banco tem o trigger `trg_embalagem_items_to_producao` em `embalagem_itens`,
-- apontando para `trigger_embalagem_para_producao` (atualização 10). O corpo
-- dele lê `recebimento_itens.status_recebimento` — coluna que NÃO EXISTE MAIS:
-- o status sanitário migrou para `inspecoes_qualidade` na atualização 09 (o
-- catálogo de produção, conferido em 2026-08-22, responde 42703 para ela).
--
-- Como a tela de embalagem nunca existiu, esse trigger nunca chegou a rodar e o
-- erro ficou adormecido. O PRIMEIRO item salvo pela tela nova quebraria. Esta
-- migração o reescreve, em vez de contorná-lo.
--
-- ---------- O ESTOQUE PASSA A ENTRAR NA FINALIZAÇÃO ----------
--
-- O trigger antigo disparava `after insert on embalagem_itens`: cada item
-- lançado criava estoque de produto acabado direto de um RASCUNHO — e rascunho
-- pode ser cancelado. O novo dispara quando `embalagens.status` vira
-- `finalizada`, gerando as linhas de `producoes` de todos os itens da ficha de
-- uma vez, uma por produto. Cancelar a ficha desfaz exatamente aquelas linhas.
--
-- Idempotente: `add column if not exists`, `drop constraint if exists` e
-- `create or replace`. Fichas já lançadas nascem em `rascunho`, com
-- `recebimento_item_id` e `validade` nulos — nulo significa "ficha anterior à
-- rastreabilidade".
--
-- Antes de aplicar, confira que não há número de ficha repetido na mesma
-- empresa, senão a constraint de unicidade falha:
--   select empresa_id, lote, count(*) from embalagens group by 1,2 having count(*) > 1;
-- E que nenhum item já lançado viola os checks novos:
--   select id, quantidade, peso_total_kg from embalagem_itens
--    where quantidade <= 0 or quantidade <> floor(quantidade) or peso_total_kg <= 0;
-- Ambas as consultas precisam devolver zero linhas.

begin;

-- ---------- CABEÇALHO DA FICHA ----------

alter table public.embalagens
  add column if not exists status text not null default 'rascunho',
  add column if not exists cancelada_motivo text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por_id uuid references public.funcionarios(id),
  add column if not exists updated_at timestamptz not null default now();

alter table public.embalagens drop constraint if exists embalagens_status_valido;
alter table public.embalagens add constraint embalagens_status_valido
  check (status in ('rascunho', 'finalizada', 'cancelada'));

alter table public.embalagens drop constraint if exists embalagens_cancelamento_motivo;
alter table public.embalagens add constraint embalagens_cancelamento_motivo
  check (status <> 'cancelada' or (cancelada_motivo is not null and btrim(cancelada_motivo) <> ''));

-- O número da ficha é único dentro da empresa. Sem isso, duas fichas do mesmo
-- dia recebem o mesmo número, e como o número da ficha vira o `lote` das linhas
-- de `producoes`, o rastro do produto acabado fica ambíguo.
alter table public.embalagens drop constraint if exists embalagens_lote_unico_por_empresa;
alter table public.embalagens add constraint embalagens_lote_unico_por_empresa
  unique (empresa_id, lote);

comment on column public.embalagens.lote is
  'Número da ficha de embalagem (EMB-AAMMDD-###), copiado para producoes.lote na finalização. O lote de matéria-prima fica em embalagem_itens.recebimento_item_id.';

-- ---------- ITENS: o lote que entrou e a validade que sai ----------

alter table public.embalagem_itens
  add column if not exists recebimento_item_id uuid references public.recebimento_itens(id),
  add column if not exists validade date;

create index if not exists embalagem_itens_recebimento_item_idx
  on public.embalagem_itens (recebimento_item_id);

comment on column public.embalagem_itens.recebimento_item_id is
  'Lote de matéria-prima que originou este produto embalado. Nulo = ficha anterior à atualização 30.';
comment on column public.embalagem_itens.validade is
  'Validade calculada na finalização a partir da data da ficha e da regra de conservação do produto, e congelada aqui: mudar a regra depois não altera validade já impressa.';

-- Quantidade embalada é contagem de UNIDADES: fração de embalagem não existe
-- na etiqueta nem na prateleira. `peso_total_kg` aceita nulo (a coluna já era
-- nula em produção), mas quando vier, vem positivo.
alter table public.embalagem_itens drop constraint if exists embalagem_itens_quantidade_valida;
alter table public.embalagem_itens add constraint embalagem_itens_quantidade_valida
  check (quantidade is null or (quantidade > 0 and quantidade = floor(quantidade)));

alter table public.embalagem_itens drop constraint if exists embalagem_itens_peso_valido;
alter table public.embalagem_itens add constraint embalagem_itens_peso_valido
  check (peso_total_kg is null or peso_total_kg > 0);

-- ---------- CADASTRO: produto rastreado ----------

alter table public.produtos
  add column if not exists rastreado boolean not null default false;

comment on column public.produtos.rastreado is
  'Produto que só entra no estoque pela ficha de embalagem (Fase 3 do controle de lote). A Produção Completa recusa lançá-lo: sem isso o mesmo produto entraria no estoque por dois caminhos e o erro só apareceria ao comparar o saldo com a câmara fria.';

-- ---------- ESTOQUE: de qual ficha esta produção nasceu ----------

alter table public.producoes
  add column if not exists embalagem_id uuid references public.embalagens(id);

create index if not exists producoes_embalagem_idx on public.producoes (embalagem_id);

comment on column public.producoes.embalagem_id is
  'Ficha de embalagem que gerou esta linha de estoque. Nulo = produção lançada por outro caminho (Produção Completa) ou anterior à atualização 30.';

-- ---------- IMUTABILIDADE ----------
-- Mesmo desenho da atualização 29 (defumação), que por sua vez repete o da 27
-- (pedidos): ficha finalizada não muda mais; correção exige cancelar com motivo
-- e refazer. Aqui a trava pesa ainda mais, porque é a finalização que cria
-- estoque de produto acabado.

-- `security definer` não é conforto: como `invoker`, o `select status from
-- embalagens` abaixo roda sujeito à policy `empresa_scoped_access` (atualização
-- 06). Um usuário de outra empresa não enxerga a ficha pai, o `not found` dá
-- verdadeiro, o trigger acha que é cascata de delete e libera a escrita — e a
-- FK `embalagem_id` não restringe por empresa. Como definer, a leitura enxerga
-- a ficha de verdade e a trava vale para todo mundo. A detecção de cascata
-- continua correta: naquele caso a linha sumiu mesmo.
--
-- A comparação usa `is distinct from` (não `<>`) de propósito: em SQL, `null <>
-- 'rascunho'` é `null`, não `true`, então um `<>` já deixaria a cascata passar
-- sozinho, sem depender do `if not found`. Com `is distinct from`, o `if not
-- found` deixa de ser redundante — é ele quem garante que a cascata passa; sem
-- ele, `v_status` ficaria nulo e a exceção dispararia.
create or replace function public.fn_embalagem_bloquear_edicao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ficha uuid;
  v_status text;
  v_ficha_empresa uuid;
  v_lote_empresa uuid;
begin
  v_ficha := coalesce(new.embalagem_id, old.embalagem_id);
  select status, empresa_id into v_status, v_ficha_empresa from public.embalagens where id = v_ficha;
  -- Ficha já apagada: é a cascata do `on delete cascade`, deixa passar.
  if not found then
    return coalesce(new, old);
  end if;
  if v_status is distinct from 'rascunho' then
    raise exception 'A ficha de embalagem está % — os itens não podem ser alterados. Cancele com motivo e refaça.', v_status
      using errcode = 'check_violation';
  end if;

  -- Isolamento multiempresa dos itens, pelo mesmo motivo da 29: nada amarrava
  -- `embalagem_itens.empresa_id` ao da ficha pai, nem exigia que
  -- `recebimento_item_id` apontasse para lote da mesma empresa. Um item
  -- gravado com empresa errada fica invisível para a tela da empresa dona (o
  -- filtro `.eq('empresa_id', eid)` nunca alcança ele) e não desconta do saldo
  -- defumado — o mesmo peso podia ser embalado duas vezes, uma por empresa.
  -- Só entra no `insert`/`update`: no `delete`, `new` não existe.
  if tg_op in ('INSERT', 'UPDATE') then
    if new.empresa_id is distinct from v_ficha_empresa then
      raise exception 'O item de embalagem precisa ser da mesma empresa da ficha.'
        using errcode = 'check_violation';
    end if;

    if new.recebimento_item_id is not null then
      select empresa_id into v_lote_empresa from public.recebimento_itens where id = new.recebimento_item_id;
      if v_lote_empresa is distinct from new.empresa_id then
        raise exception 'O lote de matéria-prima informado é de outra empresa.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_embalagem_itens_bloquear_edicao on public.embalagem_itens;
create trigger trg_embalagem_itens_bloquear_edicao
  before insert or update or delete on public.embalagem_itens
  for each row execute function public.fn_embalagem_bloquear_edicao();

-- `security definer` pelo mesmo motivo: a checagem de "ficha sem item" lê
-- `embalagem_itens`, e como invoker a policy da tabela podia esconder as linhas
-- de quem escreve e deixar a trava passar.
--
-- Roda em `before insert or update` (não só `update`): sem cobrir o insert, um
-- `insert into embalagens (..., status) values (..., 'finalizada')` nasceria
-- finalizado sem passar pela regra "ficha sem produto não finaliza" — por isso
-- essa checagem e o carimbo de `cancelada_em` ficam FORA do bloco exclusivo de
-- update, valendo nos dois casos.
create or replace function public.fn_embalagem_cabecalho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := clock_timestamp();

    if old.status = 'cancelada' and new.status is distinct from 'cancelada' then
      raise exception 'Ficha de embalagem cancelada não volta para %.', new.status
        using errcode = 'check_violation';
    end if;

    -- De finalizada só se sai para cancelada (com motivo, via constraint
    -- `embalagens_cancelamento_motivo`). Sem esta trava, `update embalagens set
    -- status = 'rascunho'` reabriria ficha e itens por baixo da imutabilidade
    -- inteira — e deixaria o estoque já gerado pendurado sem ficha finalizada
    -- que o justifique.
    if old.status = 'finalizada'
       and new.status is distinct from 'finalizada'
       and new.status <> 'cancelada' then
      raise exception 'A ficha de embalagem está finalizada — só pode virar cancelada, com motivo.'
        using errcode = 'check_violation';
    end if;

    -- `lote` é o número da ficha impressa e vira o lote das linhas de
    -- `producoes`: mudá-lo depois de finalizada desalinharia o estoque do
    -- registro. `empresa_id` entra na mesma lista para que ninguém mova a ficha
    -- de empresa pelo banco depois de finalizada ou cancelada.
    if old.status <> 'rascunho'
       and (new.lote is distinct from old.lote
            or new.obs is distinct from old.obs
            or new.data is distinct from old.data
            or new.sobra_kg is distinct from old.sobra_kg
            or new.responsavel_id is distinct from old.responsavel_id
            or new.empresa_id is distinct from old.empresa_id) then
      raise exception 'A ficha de embalagem está % — o cabeçalho não pode ser alterado.', old.status
        using errcode = 'check_violation';
    end if;

    -- Motivo, data e quem cancelou só podem ser GRAVADOS na transição para
    -- `cancelada` (por isso este bloco não entra na lista acima, que dispararia
    -- e impediria a própria transição). Uma vez cancelada, porém, são tão parte
    -- do registro sanitário quanto o resto do cabeçalho.
    if old.status = 'cancelada'
       and (new.cancelada_motivo is distinct from old.cancelada_motivo
            or new.cancelada_em is distinct from old.cancelada_em
            or new.cancelada_por_id is distinct from old.cancelada_por_id) then
      raise exception 'A ficha de embalagem já está cancelada — motivo e data do cancelamento não podem ser alterados.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A data do cancelamento vem do relógio do banco, não do navegador: o cliente
  -- mandaria `new Date().toISOString()`, que é o relógio da máquina do operador
  -- e pode estar em qualquer hora.
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status is distinct from 'cancelada') then
    new.cancelada_em := clock_timestamp();
  end if;

  if new.status = 'finalizada'
     and not exists (select 1 from public.embalagem_itens where embalagem_id = new.id) then
    raise exception 'Ficha de embalagem sem nenhum produto lançado não pode ser finalizada.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_embalagens_cabecalho on public.embalagens;
create trigger trg_embalagens_cabecalho
  before insert or update on public.embalagens
  for each row execute function public.fn_embalagem_cabecalho();

-- A imutabilidade acima cobre update de cabeçalho e de itens, mas nada cobriria
-- o DELETE do próprio cabeçalho: apagar uma ficha finalizada passaria direto,
-- levaria os itens em cascata e deixaria as linhas de `producoes` órfãs (a FK
-- `embalagem_id` é `no action`, então o delete nem sequer completaria — falharia
-- com erro de integridade em vez de com a mensagem certa). Ficha em rascunho
-- continua apagável.
create or replace function public.fn_embalagens_bloquear_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'rascunho' then
    raise exception 'A ficha de embalagem está % — não pode ser apagada. Cancele com motivo em vez de apagar.', old.status
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists trg_embalagens_bloquear_delete on public.embalagens;
create trigger trg_embalagens_bloquear_delete
  before delete on public.embalagens
  for each row execute function public.fn_embalagens_bloquear_delete();

-- ---------- O TRIGGER REESCRITO ----------
-- Reescrito. A versão anterior disparava `after insert on embalagem_itens` e
-- lia `recebimento_itens.status_recebimento`, coluna que deixou de existir na
-- atualização 09 (o status migrou para `inspecoes_qualidade`). Como a tela de
-- embalagem nunca existiu, o trigger nunca chegou a rodar e o erro ficou
-- adormecido — o primeiro item salvo pela tela nova quebraria.
--
-- Agora dispara na FINALIZAÇÃO da ficha, não a cada item: rascunho pode ser
-- cancelado, e estoque de produto acabado não pode nascer de rascunho.
--
-- Outras três diferenças em relação ao antigo, todas deliberadas:
--
-- 1. Uma linha por PRODUTO DESTA FICHA, com `embalagem_id` preenchido. O antigo
--    procurava uma produção qualquer do mesmo produto e data com
--    `origem = 'embalagem'` e SOMAVA nela — o que misturava fichas diferentes
--    numa linha só e tornava impossível desfazer o estoque de uma delas.
-- 2. O lote da produção é o número da ficha, não `EMBALAGEM-DD/MM/AA-<3 hex
--    aleatórios>`. Aquele sufixo aleatório não levava a lugar nenhum; o número
--    da ficha leva ao registro que gerou o produto.
-- 3. O custo multiplica o PESO embalado (kg) pelo custo médio por kg da
--    matéria-prima. O antigo multiplicava a CONTAGEM DE UNIDADES pelo custo por
--    kg — dimensionalmente errado (50 caixas × R$/kg). Como o trigger nunca
--    rodou, não há histórico a preservar: não existe linha de `producoes` com
--    o cálculo antigo para ficar inconsistente.
--
-- `security definer` pelo mesmo motivo das funções acima, e aqui com peso
-- extra: a leitura de `recebimento_itens`/`inspecoes_qualidade` para o custo
-- médio e a escrita em `producoes` acontecem sob a policy por empresa. Como
-- invoker, um custo médio parcial (só os lotes visíveis) entraria em produção
-- silenciosamente.
create or replace function public.fn_embalagem_gerar_producao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_custo_mp numeric(12,2);
begin
  if new.status = 'finalizada' and old.status is distinct from 'finalizada' then
    for r in
      select i.produto_id,
             sum(i.quantidade) as quantidade,
             sum(coalesce(i.peso_total_kg, 0)) as peso_kg,
             -- A validade da linha de estoque é a MAIS CURTA entre os itens
             -- daquele produto na ficha: o lote de produção não pode prometer
             -- mais prazo do que a unidade mais velha que ele contém.
             min(i.validade) as validade
        from public.embalagem_itens i
       where i.embalagem_id = new.id
       group by i.produto_id
    loop
      -- Custo médio por kg da matéria-prima do produto, lendo o status
      -- sanitário em `inspecoes_qualidade` — mesmo critério de
      -- `STATUS_QUALIDADE_APROVADO` em lib/qualidade.js. `join` (e não `left
      -- join`) de propósito: item sem inspeção não gerou movimento de estoque,
      -- logo não é matéria-prima disponível.
      select coalesce(sum(ri.quantidade * ri.custo_unitario) / nullif(sum(ri.quantidade), 0), 0)
        into v_custo_mp
        from public.recebimento_itens ri
        join public.ficha_tecnica ft
          on ft.materia_prima_id = ri.materia_prima_id and ft.empresa_id = ri.empresa_id
        join public.inspecoes_qualidade iq on iq.recebimento_item_id = ri.id
       where ft.produto_id = r.produto_id
         and ri.empresa_id = new.empresa_id
         and iq.status in ('aprovado', 'aprovado_com_ressalva');

      insert into public.producoes (lote, data, produto_id, quantidade, custo_total, validade,
                                    responsavel_id, peso_final_kg, origem, embalagem_id, empresa_id)
      values (new.lote, new.data, r.produto_id, r.quantidade,
              round(r.peso_kg * v_custo_mp, 2), r.validade,
              new.responsavel_id, r.peso_kg, 'embalagem', new.id, new.empresa_id);
    end loop;
  end if;

  -- Cancelar a ficha desfaz o estoque que ela criou — exatamente as linhas
  -- daquela `embalagem_id`, nunca por heurística de data e produto. Linhas
  -- antigas com `origem = 'embalagem'` e `embalagem_id` nulo não são tocadas.
  if new.status = 'cancelada' and old.status is distinct from 'cancelada' then
    delete from public.producoes where embalagem_id = new.id;
  end if;

  return null;
end $$;

-- Só `after update`: uma ficha não pode nascer finalizada com item, porque o
-- item precisa da ficha para existir — e `fn_embalagem_cabecalho` recusa
-- finalizar ficha sem item, no insert inclusive. Então não há caminho de
-- insert que devesse gerar estoque.
drop trigger if exists trg_embalagens_gerar_producao on public.embalagens;
create trigger trg_embalagens_gerar_producao
  after update on public.embalagens
  for each row execute function public.fn_embalagem_gerar_producao();

-- A versão antiga sai de cena: primeiro o trigger, depois a função. A função é
-- REMOVIDA, não deixada inerte — um corpo que lê uma coluna inexistente, parado
-- no banco sem nenhum trigger apontando para ele, é armadilha para quem for ler
-- o schema depois e achar que ainda vale. Se for preciso voltar atrás, o
-- rollback no fim deste arquivo diz como (reaplicar a atualização 10).
drop trigger if exists trg_embalagem_items_to_producao on public.embalagem_itens;
drop function if exists public.trigger_embalagem_para_producao();

-- ---------- AUDITORIA DE IMPRESSÃO: a etiqueta da unidade embalada ----------
-- O check de `source_type` já aceita `embalagem_item` desde a atualização 28;
-- o que falta é o ramo na RPC. Mesmo formato do ramo `recebimento_item`: lê a
-- empresa do item, exige o módulo e valida acesso.

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
  v_modulo_label text;
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
    -- Só `empresa_id` é lido — o item não tem código próprio nas mensagens
    -- desta RPC (o lote aparece na tela, não na auditoria de impressão).
    v_modulo := 'recebimentos';
    select empresa_id into v_empresa
      from recebimento_itens where id = p_source_id;
    if not found then raise exception 'Item de recebimento não encontrado.'; end if;
  elsif p_source_type = 'embalagem_item' then
    -- Fase 3 do controle de lote: a etiqueta identifica a unidade embalada.
    -- Módulo `producoes` porque a ficha de embalagem mora dentro de Produção,
    -- junto com a defumação — é a mesma permissão que abre a tela.
    v_modulo := 'producoes';
    select empresa_id into v_empresa
      from embalagem_itens where id = p_source_id;
    if not found then raise exception 'Item de embalagem não encontrado.'; end if;
  else
    raise exception 'source_type inválido: %', p_source_type;
  end if;

  if v_empresa not in (select public.empresas_permitidas()) then
    raise exception 'Sem acesso à empresa desta impressão.';
  end if;
  if not public.tem_permissao(v_modulo) then
    -- v_modulo é o slug técnico do módulo (ex.: "producoes"); o operador não
    -- deve ver isso na mensagem de erro — mapeia para o rótulo em português
    -- que aparece no menu (lib/menu.js).
    v_modulo_label := case v_modulo
      when 'producoes' then 'Produção'
      when 'recebimentos' then 'Recebimento'
      else v_modulo
    end;
    raise exception 'Sem permissão para imprimir etiquetas de %.', v_modulo_label;
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
-- Derruba o que a migração criou. Nenhum dado de processo é perdido: as colunas
-- de peso, quantidade e produto são anteriores a esta migração.
--
-- Duas perdas reais, e assumidas: `embalagem_itens.validade` e
-- `producoes.embalagem_id` somem junto com as colunas. A validade volta a ser
-- calculável a partir da regra do produto (com o risco que a Fase 3 evita: a
-- regra pode ter mudado); o vínculo do estoque com a ficha, não — depois do
-- rollback, cancelar ficha deixa de desfazer estoque.
--
-- A versão anterior do trigger (`trigger_embalagem_para_producao` e
-- `trg_embalagem_items_to_producao` em `embalagem_itens`) NÃO é recriada aqui:
-- ela lê `recebimento_itens.status_recebimento`, coluna que não existe, e
-- recriá-la é ressuscitar a mina. Se for mesmo necessário, reaplique
-- `supabase/atualizacao_10_recebimento_itens.sql` — mas ele traz a função, não o
-- trigger, que em produção foi criado fora das migrações versionadas.
--
-- A RPC `registrar_impressao` volta ao formato da Fase 1 reaplicando
-- `supabase/atualizacao_28_lote_recebimento.sql`, que é idempotente — não vale
-- duplicar cem linhas de SQL aqui.
--
-- begin;
--
-- drop trigger if exists trg_embalagem_itens_bloquear_edicao on public.embalagem_itens;
-- drop trigger if exists trg_embalagens_cabecalho on public.embalagens;
-- drop trigger if exists trg_embalagens_bloquear_delete on public.embalagens;
-- drop trigger if exists trg_embalagens_gerar_producao on public.embalagens;
-- drop function if exists public.fn_embalagem_bloquear_edicao();
-- drop function if exists public.fn_embalagem_cabecalho();
-- drop function if exists public.fn_embalagens_bloquear_delete();
-- drop function if exists public.fn_embalagem_gerar_producao();
--
-- drop index if exists public.producoes_embalagem_idx;
-- alter table public.producoes drop column if exists embalagem_id;
--
-- alter table public.produtos drop column if exists rastreado;
--
-- alter table public.embalagem_itens drop constraint if exists embalagem_itens_quantidade_valida;
-- alter table public.embalagem_itens drop constraint if exists embalagem_itens_peso_valido;
-- drop index if exists public.embalagem_itens_recebimento_item_idx;
-- alter table public.embalagem_itens
--   drop column if exists recebimento_item_id,
--   drop column if exists validade;
--
-- alter table public.embalagens drop constraint if exists embalagens_lote_unico_por_empresa;
-- alter table public.embalagens drop constraint if exists embalagens_cancelamento_motivo;
-- alter table public.embalagens drop constraint if exists embalagens_status_valido;
--
-- -- `lote` é coluna anterior a esta migração; só o comentário que ela ganhou
-- -- volta a nulo, a coluna em si fica.
-- comment on column public.embalagens.lote is null;
--
-- alter table public.embalagens
--   drop column if exists status,
--   drop column if exists cancelada_motivo,
--   drop column if exists cancelada_em,
--   drop column if exists cancelada_por_id,
--   drop column if exists updated_at;
--
-- commit;
