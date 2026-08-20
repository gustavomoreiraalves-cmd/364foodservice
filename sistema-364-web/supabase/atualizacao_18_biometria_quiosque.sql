-- Permite que o próprio colaborador cadastre a biometria facial no quiosque
-- (via identificação por matrícula + PIN), sem precisar de um RH logado.
-- cadastrado_por/coletado_por deixam de ser obrigatórios: quando a captura
-- acontece no tablet, a auditoria fica pelo dispositivo (coluna já existente
-- em ponto_biometrias; nova coluna equivalente criada aqui em ponto_consentimentos).

alter table public.ponto_biometrias alter column cadastrado_por drop not null;
alter table public.ponto_consentimentos alter column coletado_por drop not null;

alter table public.ponto_consentimentos
  add column if not exists dispositivo_id uuid references ponto_dispositivos(id);
