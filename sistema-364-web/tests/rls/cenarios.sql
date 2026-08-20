-- Cenários de RLS multiempresa. Cada bloco levanta exceção quando o
-- comportamento errado acontece, então o psql sai com código != 0 e o runner
-- falha. Ler a saída não é necessário: silêncio é aprovação.
--
-- ana  = módulo ponto na Food Service (dona da escala e da foto)
-- bruno = módulo ponto no Steakhouse (outra marca do mesmo grupo)
-- Nenhum dos dois é admin.

\set ON_ERROR_STOP on
set role authenticated;
set req.role = 'authenticated';

\echo '# bruno não escreve em dados da Food Service'
set req.uid = 'b0000000-0000-0000-0000-00000000000b';

do $$
declare n int;
begin
  -- A 19 tornou as escalas compartilhadas para leitura. Isso tem que continuar.
  select count(*) into n from escalas;
  if n <> 1 then raise exception 'bruno deveria LER a escala compartilhada, viu % ', n; end if;

  select count(*) into n from escala_dias;
  if n <> 1 then raise exception 'bruno deveria LER os dias da escala compartilhada, viu %', n; end if;

  delete from escala_dias where escala_id = '50000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'bruno APAGOU % dia(s) de escala de outra empresa', n; end if;

  update escalas set nome = 'invadido';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'bruno ALTEROU % escala(s) de outra empresa', n; end if;

  select count(*) into n from storage.objects;
  if n <> 0 then raise exception 'bruno VIU % foto(s) de colaborador de outra empresa', n; end if;
end $$;

do $$
begin
  insert into escalas values ('50000000-0000-0000-0000-0000000000ff', '77566548-b211-42a6-ba31-c9411751290c', 'falsa');
  raise exception 'bruno CRIOU escala se passando pela Food Service';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  insert into storage.objects values ('f0000000-0000-0000-0000-0000000000ff', 'colaboradores', '77566548-b211-42a6-ba31-c9411751290c/c9/invadido.jpg');
  raise exception 'bruno GRAVOU arquivo na pasta da Food Service';
exception when insufficient_privilege then null;
end $$;

\echo '# ana continua dona dos próprios dados'
set req.uid = 'a0000000-0000-0000-0000-00000000000a';

do $$
declare n int;
begin
  update escalas set nome = 'Salao 6x1 revisado' where empresa_id = '77566548-b211-42a6-ba31-c9411751290c';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ana não conseguiu editar a própria escala (% linhas)', n; end if;

  insert into escala_dias values ('d0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 2);

  select count(*) into n from storage.objects;
  if n <> 1 then raise exception 'ana deveria ver a própria foto, viu %', n; end if;

  insert into storage.objects values ('f0000000-0000-0000-0000-000000000002', 'colaboradores', '77566548-b211-42a6-ba31-c9411751290c/c2/foto-2.jpg');

  select count(*) into n from storage.objects;
  if n <> 2 then raise exception 'ana deveria ver 2 fotas próprias, viu %', n; end if;
end $$;

\echo '# bruno escreve e lê na própria pasta, e só nela'
set req.uid = 'b0000000-0000-0000-0000-00000000000b';

do $$
declare n int;
begin
  insert into storage.objects values ('f0000000-0000-0000-0000-000000000003', 'colaboradores', '0dda3c8e-228b-4d05-b50a-2e2f301d75a3/c3/foto-3.jpg');
  select count(*) into n from storage.objects;
  if n <> 1 then raise exception 'bruno deveria ver só a própria foto, viu %', n; end if;

  -- Empregador e grupo são do mesmo grupo, então seguem visíveis.
  select count(*) into n from empregadores;
  if n <> 1 then raise exception 'bruno deveria ver o empregador do próprio grupo, viu %', n; end if;

  select count(*) into n from grupos;
  if n <> 1 then raise exception 'bruno deveria ver o próprio grupo, viu %', n; end if;
end $$;

\echo 'OK: todos os cenários de RLS passaram'
