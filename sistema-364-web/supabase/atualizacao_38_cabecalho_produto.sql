-- =========================================================
-- 38 — CABEÇALHO DO PRODUTO: rastro de última alteração
-- produtos não tinha updated_at (só tem revisado_em/revisado_por_id, que são
-- específicos da liberação fiscal). O cabeçalho persistente do cadastro
-- precisa saber quando e quem alterou qualquer campo do produto.
-- =========================================================

alter table public.produtos add column if not exists updated_at timestamptz not null default now();
alter table public.produtos add column if not exists atualizado_por_id uuid references auth.users(id);
comment on column public.produtos.atualizado_por_id is
  'Quem fez o último UPDATE em produtos — igual ao padrão de revisado_por_id, mas para qualquer alteração, não só liberação fiscal. Preenchido pela aplicação a cada salvarProduto, não por trigger (o trigger não tem acesso ao usuário autenticado de forma simples aqui).';

drop trigger if exists trg_produtos_updated_at on public.produtos;
create trigger trg_produtos_updated_at before update on public.produtos
  for each row execute function public.fn_set_updated_at();
