-- =========================================================
-- 364 — ATUALIZAÇÃO 12: AUDITORIA (audit_logs)
-- Etapa 1 do plano de Suprimentos. Ledger append-only de ações críticas
-- do módulo (criação, aprovação, rejeição, conferência, envio,
-- recebimento, consumo, divergência, cancelamento, estorno, ajuste).
-- A aplicação grava um registro aqui a cada ação crítica; não existe
-- policy de UPDATE nem DELETE — nem admin pode alterar/apagar pela API,
-- só via acesso direto ao banco (fora do RLS), o que é intencional.
--
-- Rode depois de atualizacao_11_fundacao_suprimentos.sql.
-- =========================================================

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  unidade_id uuid references unidades(id),
  usuario_id uuid references auth.users(id),
  acao text not null,          -- ex: 'criado', 'aprovado', 'rejeitado', 'conferido', 'enviado',
                                -- 'recebido', 'consumido', 'divergencia', 'cancelado', 'estornado', 'ajustado'
  recurso text not null,       -- nome da tabela/entidade, ex: 'goods_receipts', 'stock_transfers'
  recurso_id uuid,
  valores_anteriores jsonb,
  valores_novos jsonb,
  justificativa text,
  request_id text,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_recurso on audit_logs(recurso, recurso_id);
create index if not exists idx_audit_logs_empresa on audit_logs(empresa_id, created_at desc);

alter table audit_logs enable row level security;

-- Qualquer usuário autenticado pode INSERIR um log para uma empresa à qual
-- tem acesso (a aplicação grava em nome do usuário logado) — nunca em nome
-- de outro usuário nem para outra empresa.
drop policy if exists "audit_logs_insert" on audit_logs;
create policy "audit_logs_insert" on audit_logs
  for insert
  with check (
    auth.role() = 'authenticated'
    and empresa_id in (select public.empresas_permitidas())
    and usuario_id = auth.uid()
  );

-- Leitura do log é sensível (mostra "quem fez o quê") — só administradores
-- por enquanto; abrir para outros papéis fica para quando existir uma tela
-- dedicada de auditoria com sua própria permissão.
drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select" on audit_logs
  for select
  using (auth.role() = 'authenticated' and public.is_admin());
