-- =========================================================
-- Atualização 37 — Afya passa a ler o PDV pelo backup do Drive
--
-- Quando a atualização 33 rodou, o backup da Afya (Jardim dos Migrantes)
-- ainda não subia para o Drive por limitação de rede na loja, então ela ficou
-- com origem='painel' e ativo=false. O upload agora acontece: a pasta
-- "Consumer Backup-60.361.009/0001-50" tem os mesmos sete arquivos por dia da
-- semana (`<dia>.fbconsumer`, ids estáveis, sobrescritos a cada upload), no
-- mesmo formato gbak da Steakhouse.
--
-- Esta migração só reconfigura a loja: origem='backup', ativo=true e o mapa
-- dia-da-semana → file id. Nenhuma tabela muda de forma.
--
-- Rode depois de atualizacao_33_pdv_backup.sql. Idempotente.
-- =========================================================
begin;

-- Guard `drive_arquivos is null` pelo mesmo motivo da 33: se alguém trocar o
-- mapa à mão (arquivo recriado, id renovado), rodar isto de novo não pisa em
-- cima da configuração corrente.
update public.pdv_lojas
set origem = 'backup',
    ativo = true,
    drive_arquivos = jsonb_build_object(
      'domingo',       '1u1qbJJ7fT6_XMHxE5Z4z2FozXrbs4LIo',
      'segunda-feira', '1KVASHI-2lO2Jk2Xv_dorVVaCtwhEFsIa',
      'terça-feira',   '1AaSpXPdcVh9bI74Jl1lbgnU2EgRxqxvc',
      'quarta-feira',  '1memiCP4DOCpOuS9NT-gxpDvh_iWOjqxH',
      'quinta-feira',  '1Bx7Fi0ARzZqQIKgFfB7eHEMFvCH6IfAv',
      'sexta-feira',   '1nbChvlldewd-qk-VLrS9IEOHtgRuyUq6',
      'sábado',        '1sETmMnMc9yZvLME1gNNn8xzvdi6tzeXe'
    )
where id_connect = -2147458165
  and drive_arquivos is null;

commit;

-- ---------- ROLLBACK ----------
-- begin;
-- update public.pdv_lojas
-- set origem = 'painel', ativo = false, drive_arquivos = null
-- where id_connect = -2147458165;
-- commit;
