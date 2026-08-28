-- Fila de pedidos manuais de importação do PDV (botão "Atualizar agora" em
-- /vendas/importacao). O checador local (scripts/checar-importacao-pdv.mjs,
-- cron a cada 15 min) lê os pendentes e dispara a importação de verdade;
-- também dispara sozinho quando o backup do Drive fica mais novo que o
-- último importado, então o pedido manual é só um atalho pra não esperar.
create table if not exists public.pdv_importacao_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  solicitado_em timestamptz not null default now(),
  solicitado_por uuid references auth.users(id),
  atendido_em timestamptz
);
create index if not exists pdv_importacao_solicitacoes_pendente_idx
  on public.pdv_importacao_solicitacoes (solicitado_em) where atendido_em is null;

-- Igual pdv_importacoes: só leitura pro client (mostrar "pedido pendente" na
-- tela); a escrita é sempre pela service role — o insert vem da rota
-- app/api/pdv/solicitar-importacao (que já valida permissão do módulo
-- 'pedidos'), o update de atendido_em vem do checador local.
alter table public.pdv_importacao_solicitacoes enable row level security;
drop policy if exists "authenticated_read" on public.pdv_importacao_solicitacoes;
create policy "authenticated_read" on public.pdv_importacao_solicitacoes for select using (auth.role() = 'authenticated');
