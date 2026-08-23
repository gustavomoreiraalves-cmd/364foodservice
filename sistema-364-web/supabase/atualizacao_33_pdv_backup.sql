-- =========================================================
-- Atualização 33 — origem do PDV (painel/backup) e arquivos do Drive
--
-- pdv_lojas ganha duas colunas para o importador v2 (backup Firebird):
-- `origem` diz se a loja é lida do backup .fbconsumer que sobe pro Drive ou
-- ainda do painel Consumer Connect (scraping, plano B); `drive_arquivos`
-- guarda o mapa dia-da-semana → file id do Drive (ids estáveis, um arquivo
-- por dia da semana, sobrescrito no mesmo id a cada upload).
--
-- Seed: Steakhouse vira origem='backup' com os 7 ids do Drive (pasta
-- pública "Backup Consumer"). Afya fica com origem='painel' (default) mas
-- ativo=false: o backup dela ainda não sobe para o Drive (limitação de rede
-- na loja) e o scraping do painel está pausado até existir uma fonte ativa.
--
-- Rode depois de atualizacao_32_pdv_consumer.sql. Idempotente.
-- Spec: docs/superpowers/specs/2026-08-23-importacao-pdv-backup-design.md
-- =========================================================
begin;

alter table public.pdv_lojas
  add column if not exists origem text not null default 'painel'
    check (origem in ('painel', 'backup')),
  add column if not exists drive_arquivos jsonb;

-- Steakhouse: origem backup + mapa dos 7 ids do Drive. O guard
-- `where drive_arquivos is null` faz o seed rodar só uma vez de fato — se
-- alguém editar o mapa manualmente (arquivo trocado, id renovado), uma
-- rodada futura desta migração não pisa em cima.
update public.pdv_lojas
set origem = 'backup',
    drive_arquivos = jsonb_build_object(
      'domingo',       '1OpuFkwZd8LHj4qwbR57YmihqMi7YmitW',
      'segunda-feira', '1RDBeg9ELcO8c2Y3_OsbO9_XZ2sb2lSYL',
      'terça-feira',   '1XbM9SK2ygMUKvv5UpBMcKwchl3m7WGRM',
      'quarta-feira',  '1TlRgSmWgw7iBQ4LSAZYa5WtjMYqtJC_3',
      'quinta-feira',  '1eNDPG26a8-nf60SG3bGOvS2zNfj3bq9o',
      'sexta-feira',   '1D_tYZb-Us36udA1sryHIcZdU6jyvURmE',
      'sábado',        '1faajFRdCrqDgKFDJMLASeFRSIgc58sok'
    )
where id_connect = -2147478159
  and drive_arquivos is null;

-- Afya: mesmo PDV, mesmo backup possível, mas o arquivo ainda não sobe para
-- o Drive dela (limitação de rede na loja). Sem fonte ativa, a loja fica
-- desativada aqui — o scraping do painel (origem='painel', o default) segue
-- documentado como plano B, mas sem cron enquanto isso.
update public.pdv_lojas
set ativo = false
where id_connect = -2147458165;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- alter table public.pdv_lojas drop column if exists drive_arquivos;
-- alter table public.pdv_lojas drop column if exists origem;
-- commit;
