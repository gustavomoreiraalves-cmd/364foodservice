-- supabase/atualizacao_52_etiqueta_expedicao_caixa.sql
--
-- Estende registrar_impressao (atualização 30) com o ramo `expedicao_caixa`
-- — o check de source_type na tabela etiqueta_impressoes já aceita esse
-- valor desde a atualização 28, mas a função nunca ganhou o ramo
-- correspondente. Achado ao implementar a etiqueta de despacho (Task 21).
--
-- create or replace: todos os ramos existentes ficam idênticos ao corpo
-- atual (atualizacao_30_ficha_embalagem.sql:669-757), só o ramo
-- `expedicao_caixa` e a entrada nova em v_modulo_label são acréscimo.
begin;

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
    --
    -- Confere o status da FICHA-MÃE (join com `embalagens`), não só o item —
    -- achado da revisão final (Menor, junto do Important 2): o ramo
    -- `producao_interna` acima recusa produção não finalizada, mas este ramo
    -- não conferia nada. A tela só oferece o botão de imprimir com
    -- `ficha.status === 'finalizada'`, então na prática isso nunca dispara por
    -- ali — mas a RPC é `security definer` e chamável direto por qualquer um
    -- que tenha permissão de `producoes` e saiba o uuid do item, sem passar
    -- pela tela: defesa em profundidade, mesmo padrão do ramo irmão.
    v_modulo := 'producoes';
    select ei.empresa_id, e.status into v_empresa, v_status
      from embalagem_itens ei
      join embalagens e on e.id = ei.embalagem_id
     where ei.id = p_source_id;
    if not found then raise exception 'Item de embalagem não encontrado.'; end if;
    if v_status <> 'finalizada' then
      raise exception 'Etiquetas só podem ser impressas para ficha de embalagem finalizada (está "%").', v_status;
    end if;
  elsif p_source_type = 'expedicao_caixa' then
    -- Etiqueta de despacho (Task 21): identifica a caixa de um romaneio.
    -- Módulo `expedicao` (atualização 50) é a permissão que abre a tela de
    -- expedição — mesma lógica de módulo-por-tela dos ramos irmãos. Confere
    -- o status da FICHA-MÃE (join com expedicoes), mesmo padrão de defesa em
    -- profundidade do ramo embalagem_item: a tela só oferece o botão com
    -- romaneio finalizado, mas a RPC é security definer e chamável direto.
    v_modulo := 'expedicao';
    select ec.empresa_id, ex.status into v_empresa, v_status
      from expedicao_caixas ec
      join expedicoes ex on ex.id = ec.expedicao_id
     where ec.id = p_source_id;
    if not found then raise exception 'Caixa de expedição não encontrada.'; end if;
    if v_status <> 'finalizado' then
      raise exception 'Etiquetas só podem ser impressas para romaneio finalizado (está "%").', v_status;
    end if;
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
      when 'expedicao' then 'Expedição'
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
-- Não há como voltar ao corpo exato de antes desta migração sem colar de
-- volta o texto de atualizacao_30_ficha_embalagem.sql:669-757 (a função é
-- sempre create or replace, não versionada por linha) — copie aquele bloco
-- aqui antes de rodar este rollback em produção, se precisar reverter.
