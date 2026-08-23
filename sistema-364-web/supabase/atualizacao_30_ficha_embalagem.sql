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
--   • `embalagem_itens.validade` — a validade GRAVADA no item, calculada pela
--     TELA a partir da data da ficha e da regra de conservação do produto
--     (`lib/embalagem.js`, `validadeDoItem`). Congelada ali para que mudar a
--     regra depois não altere validade já impressa em etiqueta. Esta migração
--     não calcula validade nenhuma: ela só copia para `producoes` a que já
--     está no item. Consequência que é CONTRATO para a Task 3: como a
--     imutabilidade abaixo impede corrigir item de ficha finalizada, a tela
--     precisa gravar a validade AINDA EM RASCUNHO, junto com o peso — depois
--     de finalizar não há mais como preenchê-la.
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
-- ---------- O CUSTO VEM DO LOTE DE ORIGEM ----------
--
-- Decisão do dono do sistema. O custo de cada item não sai de média nenhuma:
-- sai do LOTE que aquele item consumiu, com o RENDIMENTO REAL da defumação
-- daquele lote. É para isso que a cadeia de rastreabilidade existe — lote que
-- veio caro ou que rendeu mal precisa aparecer no custo do produto.
--
--   matéria-prima consumida = peso embalado ÷ rendimento do lote
--   custo do item           = consumida × custo por quilo daquele lote
--
-- O rendimento é agregado: soma dos pesos finais ÷ soma dos pesos brutos de
-- TODAS as fichas de defumação FINALIZADAS daquele lote (um lote pode ir ao
-- defumador em mais de uma fornada; pegar só a primeira daria outro número).
--
-- Média ponderada por produto — o que o trigger antigo fazia, somando todos os
-- recebimentos aprovados de todas as matérias-primas da ficha técnica — sumiu
-- de vez, e com ela três defeitos: era cega ao lote, cega ao tempo (recebimento
-- de seis meses atrás pesava igual) e misturava insumos diferentes (costela e
-- tempero na mesma média, dominada por quem chegou em maior quantidade).
-- `ficha_tecnica` deixou de ser consultada no custo: quem diz o que foi
-- consumido é o lote declarado no item, não a receita teórica. Produto com mais
-- de uma matéria-prima na ficha técnica tem, portanto, comportamento definido —
-- esta migração custeia só o insumo rastreado que veio em `recebimento_item_id`;
-- insumos secundários (tempero, embalagem) não entram neste custo e continuam
-- fora dele até que ganhem lançamento próprio.
--
-- Nada de custo zero silencioso: quando falta o dado para custear (item sem
-- lote, item sem peso, lote reprovado na inspeção, lote sem defumação
-- finalizada), a FINALIZAÇÃO É RECUSADA com mensagem em português. Custo errado
-- no estoque não avisa ninguém; recusa avisa.
--
-- ---------- E CONSERTA A FICHA DE DEFUMAÇÃO, QUE ESTÁ QUEBRADA ----------
--
-- Achado ao conferir o catálogo de produção para escrever o custo desta fase, e
-- consertado aqui porque a Fase 3 depende do conserto: `defumacao_itens` tem
-- `perda_limpeza_kg`, `sobra_kg` e `peso_final_kg` como NOT NULL, e a tela da
-- Fase 2 — que já está no ar — manda `null` nos três quando o campo fica em
-- branco (app/producoes/defumacao/[id]/page.js:415-417). Resultado: lançar item
-- de defumação sem informar perda, sobra ou peso defumado é recusado pelo banco
-- com 23502 cru, em inglês. E deixar esses campos em branco é o caso COMUM: o
-- fluxo normal é pesar o bruto quando a carne entra no defumador e o defumado só
-- horas depois.
--
-- O `not null` é que está fora de sincronia com o resto do sistema, e em três
-- lugares independentes:
--   • o check `defumacao_itens_pesos_coerentes` da atualização 29 é escrito com
--     `peso_final_kg is null or ...` — foi desenhado para aceitar nulo;
--   • `rendimentoDaFicha` (lib/defumacao.js) filtra item sem peso final, com
--     comentário explicando que item não pesado é "ainda sem dado";
--   • a própria tela oferece finalizar ficha com item não pesado, com aviso e
--     caixa de confirmação ("Estou ciente e quero finalizar mesmo assim").
--
-- As colunas são anteriores às migrações versionadas (a tabela foi criada
-- direto no banco), e o `not null` veio de lá. Esta migração o remove dos TRÊS
-- campos opcionais. `peso_bruto_kg` continua obrigatório: `pesosValidos` exige
-- bruto maior que zero, e sem ele não há o que custear.
--
-- Isso também é o que torna o filtro de `fn_rendimento_defumacao` (lá embaixo)
-- load-bearing em vez de decorativo: item finalizado sem peso defumado passa a
-- ser possível de verdade, e é exatamente o caso que inflaria o custo se o peso
-- bruto dele entrasse no denominador do rendimento sozinho.
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
--
-- E confira, no banco real, o NOME do trigger que esta migração derruba — é a
-- única coisa aqui que nenhum teste local consegue provar, porque o fixture usa
-- o nome que este arquivo escreve. Se o nome divergir, o `drop trigger` não
-- derruba nada e a mina continua armada, em silêncio:
--   select tgname from pg_trigger
--    where tgrelid = 'public.embalagem_itens'::regclass and not tgisinternal;
-- Em 2026-08-22 respondeu `trg_embalagem_items_to_producao`, que é o nome usado
-- lá embaixo. Se responder outro, ajuste o `drop trigger` antes de aplicar.

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
  'Validade do produto embalado, calculada pela tela a partir da data da ficha e da regra de conservação do produto, e gravada AINDA EM RASCUNHO: depois de finalizar, a imutabilidade impede corrigir o item. Congelada aqui para que mudar a regra depois não altere validade já impressa.';

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
  -- `is distinct from`, e não `<>`, pelo mesmo motivo do resto do arquivo: se
  -- `status` chegar nulo por qualquer caminho (coluna recriada sem default num
  -- rollback parcial, por exemplo), `null <> 'rascunho'` é nulo e a trava
  -- deixaria passar em silêncio. Com `is distinct from`, nulo é bloqueado.
  if old.status is distinct from 'rascunho' then
    raise exception 'A ficha de embalagem está % — não pode ser apagada. Cancele com motivo em vez de apagar.', old.status
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists trg_embalagens_bloquear_delete on public.embalagens;
create trigger trg_embalagens_bloquear_delete
  before delete on public.embalagens
  for each row execute function public.fn_embalagens_bloquear_delete();

-- ---------- CONSERTO DA FASE 2: OS CAMPOS OPCIONAIS DA DEFUMAÇÃO ----------
-- Ver o cabeçalho. A tela da Fase 2 grava `null` nesses três campos quando o
-- operador deixa em branco, e o `not null` da tabela original recusa o insert
-- com 23502. `drop not null` é idempotente e não toca em nenhum dado: linha que
-- já tem valor continua igual.
--
-- `peso_bruto_kg` fica de fora de propósito — continua obrigatório.

alter table public.defumacao_itens alter column peso_final_kg drop not null;
alter table public.defumacao_itens alter column perda_limpeza_kg drop not null;
alter table public.defumacao_itens alter column sobra_kg drop not null;

comment on column public.defumacao_itens.peso_final_kg is
  'Peso defumado do item. NULO = ainda não pesado (o fluxo normal pesa o bruto na entrada e o defumado horas depois). Item sem este peso fica fora dos dois lados do cálculo de rendimento — ver fn_rendimento_defumacao e rendimentoDaFicha em lib/defumacao.js.';

-- ---------- RENDIMENTO DA DEFUMAÇÃO ----------
-- Quanto sobra de um quilo daquele lote depois de defumado: soma dos pesos
-- finais ÷ soma dos pesos brutos, de TODAS as fichas de defumação FINALIZADAS
-- daquele lote naquela empresa.
--
-- Agregado, e não a primeira ficha que aparecer: um lote pode ir ao defumador
-- em mais de uma fornada, com rendimentos diferentes, e o que custeia o produto
-- é o rendimento do lote inteiro. Só ficha FINALIZADA entra — rascunho ainda
-- pode ter o peso corrigido, e um peso provisório viraria custo definitivo.
--
-- Só entram na conta os itens que têm OS DOIS pesos. É a mesma regra de
-- `rendimentoDaFicha` em lib/defumacao.js — as duas precisam continuar iguais,
-- porque o número que a tela da Fase 2 mostra ao operador é o mesmo que custeia
-- o produto aqui.
--
-- O motivo: `defumacao_itens.peso_final_kg` é NULÁVEL, e a atualização 29
-- permite finalizar ficha com item ainda não pesado de propósito (a tela avisa e
-- pede confirmação). Somar o bruto desse item sem o final correspondente infla o
-- denominador sem contrapartida no numerador: o rendimento sai menor do que o
-- real, a recusa (4) lá embaixo não dispara porque o número é positivo, e o
-- custo entra inflado, em silêncio. Com uma fornada de 100/50 e outra de 80 kg
-- brutos sem peso final, o rendimento cairia de 0,50 para 0,2778 e o custo do
-- produto subiria 62% sem erro nenhum.
--
-- Item não pesado não é "rendimento zero", é "ainda sem dado": fica fora dos
-- dois lados da fração. O que sobra é a melhor estimativa disponível, e não
-- deixa produto que existe fisicamente sem poder ser embalado.
--
-- Devolve NULO quando não há nenhuma fornada finalizada E pesada (o `nullif`
-- também cobre soma de peso bruto zero). Quem chama trata nulo e zero da mesma
-- forma: recusa a finalização. Nunca devolve zero disfarçado de custo.
--
-- É uma função à parte, e não a mesma subconsulta escrita duas vezes, porque a
-- checagem que RECUSA e a conta que CUSTEIA precisam usar exatamente o mesmo
-- número — se divergissem, a ficha passaria na checagem e estouraria divisão
-- por zero na hora de gravar.
--
-- `security definer` pelo mesmo motivo do resto: como invoker, a policy por
-- empresa de `defumacoes`/`defumacao_itens` podia esconder fornadas de quem
-- está finalizando e devolver um rendimento parcial — que não dá erro nenhum,
-- só um custo errado.
create or replace function public.fn_rendimento_defumacao(p_recebimento_item_id uuid, p_empresa_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select sum(di.peso_final_kg) / nullif(sum(di.peso_bruto_kg), 0)
    from public.defumacao_itens di
    join public.defumacoes d on d.id = di.defumacao_id
   where di.recebimento_item_id = p_recebimento_item_id
     and di.empresa_id = p_empresa_id
     and d.status = 'finalizada'
     -- Os dois pesos, ou nenhum dos dois lados da fração. Ver o comentário
     -- acima e `rendimentoDaFicha` em lib/defumacao.js.
     and di.peso_final_kg is not null
     and di.peso_bruto_kg is not null
$$;

comment on function public.fn_rendimento_defumacao(uuid, uuid) is
  'Rendimento agregado da defumação de um lote (peso final ÷ peso bruto, só fichas finalizadas e só itens com os dois pesos, igual a rendimentoDaFicha em lib/defumacao.js). Nulo quando não há fornada finalizada e pesada. Base do custo do produto embalado na atualização 30.';

-- Diferente das quatro funções de trigger, esta é chamável direto por qualquer
-- um que saiba dois UUIDs — e, como `security definer`, ela ignora a policy por
-- empresa de `defumacoes`/`defumacao_itens`, que é justamente o que ela precisa
-- fazer para o trigger funcionar. Sem o `revoke`, isso vira um vazamento: o
-- rendimento (e portanto a produtividade) de qualquer empresa do grupo sai por
-- um `select`. Mesmo padrão de `registrar_marcacao` na atualização 12. O
-- trigger continua chamando normalmente: ele roda como definer, dono da função.
revoke execute on function public.fn_rendimento_defumacao(uuid, uuid) from public, anon, authenticated;

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
-- 3. O custo vem do LOTE de cada item, com o RENDIMENTO real da defumação
--    daquele lote (ver o cabeçalho deste arquivo). O antigo multiplicava a
--    contagem de unidades por um custo médio por quilo — dimensionalmente
--    errado (50 caixas × R$/kg); multiplicar o peso embalado pelo custo por
--    quilo já seria melhor, mas ainda assumiria que 1 kg embalado consumiu 1 kg
--    de matéria-prima, e a defumação perde peso: 180 kg brutos que rendem 81 kg
--    defumados fazem cada quilo embalado custar mais que o dobro do quilo
--    comprado. Como o trigger nunca rodou, não há histórico a preservar.
--
-- `security definer` pelo mesmo motivo das funções acima, e aqui com peso
-- extra: a leitura de `recebimento_itens`, `inspecoes_qualidade` e
-- `defumacao_itens` para o custo e a escrita em `producoes` acontecem sob a
-- policy por empresa. Como invoker, um rendimento parcial (só as fichas de
-- defumação visíveis) entraria em produção silenciosamente.
create or replace function public.fn_embalagem_gerar_producao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_produto text;
  v_lote text;
begin
  if new.status = 'finalizada' and old.status is distinct from 'finalizada' then
    -- ---- As quatro recusas ----
    -- Cada uma existe porque a alternativa era gravar custo errado no estoque.
    -- Todas usam `check_violation`, como o resto do arquivo, e todas nomeiam o
    -- produto ou o lote — a mensagem precisa dizer ao embalador o que corrigir.

    -- (1) Item sem lote de origem. É o caminho definido para item lançado sem
    -- lote e para a ficha legada, anterior a esta migração: ela continua
    -- existindo, continua editável em rascunho, mas não finaliza enquanto o
    -- lote não for informado. Sem o lote não há de onde tirar custo nem
    -- rendimento — e inventar um (média da matéria-prima, custo do cadastro)
    -- seria exatamente o custo silenciosamente errado que esta decisão veio
    -- eliminar.
    select p.nome into v_produto
      from public.embalagem_itens i
      join public.produtos p on p.id = i.produto_id
     where i.embalagem_id = new.id and i.recebimento_item_id is null
     limit 1;
    if found then
      raise exception 'O item de "%" está sem o lote de origem — informe de qual lote defumado ele saiu antes de finalizar a ficha.', v_produto
        using errcode = 'check_violation';
    end if;

    -- (2) Item sem peso embalado. `peso_total_kg` é nulável em produção (coluna
    -- anterior a esta migração), e é dele que sai a conta inteira: sem peso o
    -- custo daria zero.
    select p.nome into v_produto
      from public.embalagem_itens i
      join public.produtos p on p.id = i.produto_id
     where i.embalagem_id = new.id and coalesce(i.peso_total_kg, 0) <= 0
     limit 1;
    if found then
      raise exception 'O item de "%" está sem peso embalado — pese e lance o peso antes de finalizar a ficha.', v_produto
        using errcode = 'check_violation';
    end if;

    -- (3) Lote que não passou na inspeção não vira produto acabado. Mesmo
    -- critério de `STATUS_QUALIDADE_APROVADO` em lib/qualidade.js. Item sem
    -- nenhuma inspeção cai aqui também, de propósito: sem inspeção não houve
    -- movimento de estoque, logo aquele lote não estava disponível.
    select ri.lote into v_lote
      from public.embalagem_itens i
      join public.recebimento_itens ri on ri.id = i.recebimento_item_id
     where i.embalagem_id = new.id
       and not exists (
             select 1 from public.inspecoes_qualidade iq
              where iq.recebimento_item_id = ri.id
                and iq.status in ('aprovado', 'aprovado_com_ressalva'))
     limit 1;
    if found then
      raise exception 'O lote % não foi aprovado na inspeção de qualidade — ele não pode virar produto acabado.', v_lote
        using errcode = 'check_violation';
    end if;

    -- (4) Lote sem rendimento de defumação FINALIZADA. Cobre os três buracos de
    -- uma vez — sem ficha de defumação, ficha só em rascunho, e peso final zero
    -- —, e é o que impede a divisão por zero logo abaixo.
    select ri.lote into v_lote
      from public.embalagem_itens i
      join public.recebimento_itens ri on ri.id = i.recebimento_item_id
     where i.embalagem_id = new.id
       and coalesce(public.fn_rendimento_defumacao(i.recebimento_item_id, i.empresa_id), 0) <= 0
     limit 1;
    if found then
      raise exception 'O lote % não tem ficha de defumação finalizada com rendimento — sem o rendimento o custo do produto sairia errado. Finalize a defumação antes de finalizar a embalagem.', v_lote
        using errcode = 'check_violation';
    end if;

    -- ---- O estoque ----
    -- Uma linha por produto; o custo é somado ITEM A ITEM, cada um pelo seu
    -- próprio lote (custo por quilo e rendimento daquele lote), e só então
    -- arredondado. Ficha que consome dois lotes de custos diferentes produz o
    -- custo dos dois, não a média deles.
    insert into public.producoes (lote, data, produto_id, quantidade, custo_total, validade,
                                  responsavel_id, peso_final_kg, origem, embalagem_id, empresa_id)
    select new.lote, new.data, x.produto_id, x.quantidade, x.custo_total, x.validade,
           new.responsavel_id, x.peso_kg, 'embalagem', new.id, new.empresa_id
      from (
        select i.produto_id,
               sum(i.quantidade) as quantidade,
               sum(i.peso_total_kg) as peso_kg,
               round(sum(i.peso_total_kg
                         / public.fn_rendimento_defumacao(i.recebimento_item_id, i.empresa_id)
                         * ri.custo_unitario), 2) as custo_total,
               -- A validade da linha de estoque é a MAIS CURTA entre os itens
               -- daquele produto — mas só quando TODOS têm validade. Se um item
               -- entrou sem validade, `min` o ignoraria e a linha prometeria
               -- prazo para unidades que não têm nenhum; nesse caso a linha
               -- nasce sem validade, e quem olhar vai atrás do item que falta.
               case when count(*) filter (where i.validade is null) > 0
                    then null else min(i.validade) end as validade
          from public.embalagem_itens i
          join public.recebimento_itens ri on ri.id = i.recebimento_item_id
         where i.embalagem_id = new.id
         group by i.produto_id
      ) x;
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
-- Três perdas reais, e assumidas:
--   • `embalagem_itens.validade` — volta a ser calculável a partir da regra do
--     produto, com o risco que a Fase 3 evita: a regra pode ter mudado desde a
--     impressão.
--   • `producoes.embalagem_id` — não volta de jeito nenhum. Depois do rollback,
--     cancelar ficha deixa de desfazer estoque.
--   • `produtos.rastreado` — some junto com a marcação de QUAIS produtos
--     estavam marcados. Reaplicar a migração devolve a coluna com todo mundo em
--     `false`, e alguém vai ter que remarcar produto por produto. Se o rollback
--     for planejado, salve a lista antes:
--       select id, codigo, nome from produtos where rastreado;
--
-- A versão anterior do trigger (`trigger_embalagem_para_producao` e
-- `trg_embalagem_items_to_producao` em `embalagem_itens`) NÃO é recriada aqui:
-- ela lê `recebimento_itens.status_recebimento`, coluna que não existe, e
-- recriá-la é ressuscitar a mina. Se for mesmo necessário, reaplique
-- `supabase/atualizacao_10_recebimento_itens.sql` — mas ele traz a função, não o
-- trigger, que em produção foi criado fora das migrações versionadas.
--
-- O `not null` de `defumacao_itens.peso_final_kg`, `perda_limpeza_kg` e
-- `sobra_kg` NÃO é restaurado, de propósito — mesmo raciocínio do check de
-- `source_type` no rollback da atualização 28. Depois que a tela da Fase 2 voltar
-- a funcionar, vão existir linhas com esses campos nulos, e `set not null`
-- falharia no meio do rollback; pior, "consertar" isso apagando ou preenchendo
-- essas linhas com zero seria inventar peso de processo sanitário para caber num
-- rollback de schema. Rollback desfaz schema, não histórico. Se for mesmo
-- necessário reapertar, primeiro decida o que fazer com as linhas nulas:
--   select id, defumacao_id from defumacao_itens
--    where peso_final_kg is null or perda_limpeza_kg is null or sobra_kg is null;
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
-- drop function if exists public.fn_rendimento_defumacao(uuid, uuid);
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
-- comment on column public.defumacao_itens.peso_final_kg is null;
--
-- alter table public.embalagens
--   drop column if exists status,
--   drop column if exists cancelada_motivo,
--   drop column if exists cancelada_em,
--   drop column if exists cancelada_por_id,
--   drop column if exists updated_at;
--
-- commit;
