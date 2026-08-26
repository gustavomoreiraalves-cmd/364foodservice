# Painel de tela secundária — design (RASCUNHO, pausado)

**Status:** brainstorming interrompido em 2026-08-24, a pedido do usuário.
Seções 1 e 2 aprovadas. Seção 3 apresentada e não respondida. Seções 4
(layout e interação) e 5 (erros, segurança, testes) ainda não escritas.

## Objetivo

Painel que fica aberto em tela secundária o dia todo, mostrando a operação do
grupo 364: vendas e despesas com período selecionável (dia, semana, mês),
agenda de compromissos, saldo das contas correntes, meta do mês e consumo
estimado do plano Claude.

## Decisões tomadas

**Onde mora.** Rota nova `/painel` dentro de `sistema-364-web`, publicada no
Vercel junto com o resto do app. Reaproveita login, RLS multi-empresa, cliente
Supabase e os componentes de gráfico existentes (`SerieMensal`,
`SerieDiariaPdv`, `BarraParticipacao`).

**Abordagem escolhida: ponte local (opção A).** Agenda do Apple Calendar e
logs do Claude existem apenas na máquina do usuário, mas o painel roda no
Vercel. Um script local empurra esses dois dados para o Supabase; o painel lê
somente Supabase. Isso mantém um caminho de dados único e permite abrir o
painel de qualquer dispositivo.

Descartada a alternativa de servidor local consultado pela página (mixed
content: página HTTPS não pode chamar `http://localhost`).

**Escopo por empresa.** O grupo tem várias unidades. O painel mostra tanto o
consolidado quanto a quebra por empresa.

**Atualização.** Auto-refresh por intervalo. Sem Supabase Realtime, sem
alertas visuais nesta versão.

**Consumo do Claude.** O percentual oficial do limite da assinatura não é
exposto por API nem gravado em disco — `~/.claude` guarda apenas logs de
sessão. O tile mostra estimativa calculada a partir desses logs, rotulada
como estimativa.

**Saldo bancário.** Premissa inicial corrigida durante a entrevista:
`contas_bancarias` (migração 35) guarda só cadastro, sem coluna de saldo. O
saldo confiável é o `LEDGERBAL` do OFX, que `lib/extratos/parseOfx.js:113` já
extrai mas hoje descarta após a conferência.

**Pedidos e PDV não se sobrepõem.** Confirmado pelo usuário: `pedidos` é B2B
do food services, `pdv_pedidos` é o restaurante, empresas distintas. Somar as
duas fontes não duplica receita.

## Modelo de dados (seção 2, aprovada)

Migração nova `atualizacao_38_painel.sql`, no padrão das anteriores:
transação, `security_invoker`, RLS.

### 1. `metas`

```sql
create table public.metas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  mes text not null,                    -- 'YYYY-MM'
  receita_meta numeric(14,2) not null check (receita_meta >= 0),
  created_at timestamptz not null default now(),
  unique (empresa_id, mes)
);
```

A meta do grupo é a soma das metas das empresas. Não há campo separado para
meta do grupo: dois números independentes podem divergir e viram duas
respostas diferentes para a mesma pergunta.

### 2. Saldo bancário

```sql
alter table public.extrato_importacoes
  add column if not exists saldo_final numeric(14,2),
  add column if not exists saldo_data date;
```

O saldo de uma conta é o `saldo_final` da importação mais recente dela. O tile
exibe o valor junto com a data ("R$ 82.450 — em 21/08"), deixando visível
quando o extrato está velho.

### 3. `agenda_eventos`

```sql
create table public.agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  uid_externo text not null,           -- UID do evento no Calendar
  calendario text,
  titulo text not null,
  inicio timestamptz not null,
  fim timestamptz,
  dia_inteiro boolean not null default false,
  local text,
  atualizado_em timestamptz not null default now(),
  unique (user_id, uid_externo)
);
```

### 4. `claude_uso`

```sql
create table public.claude_uso (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  medido_em timestamptz not null,
  janela text not null check (janela in ('5h','semana')),
  tokens bigint not null,
  teto_tokens bigint,                  -- calibrado contra o /usage
  unique (user_id, medido_em, janela)
);
```

Guarda histórico, não apenas a última medição, para permitir a curva de
consumo do dia.

`agenda_eventos` e `claude_uso` têm escopo de usuário, não de empresa: a
política de RLS é `user_id = auth.uid()`, diferente do
`empresas_permitidas()` usado no resto do app. Agenda pessoal não é dado do
grupo.

### 5. `vw_consolidado_diario`

Mesma estrutura de `vw_consolidado_mensal` (migração 21): `union all` das
fontes e soma depois, nunca join entre elas. Uma linha por (empresa, dia).

| fonte | data | entra como |
|---|---|---|
| `pedidos` + `pedido_itens` | `pedidos.data` | receita, CMV, pedidos |
| `vw_pdv_vendas_dia` | `dia` | receita PDV |
| `contas_a_pagar_parcelas` | `data_pagamento` | despesa caixa |
| `contas_a_pagar` | `created_at` em `America/Sao_Paulo` | despesa competência |

Semana e mês não ganham views próprias. O painel busca as linhas diárias do
período e agrega em JavaScript, com funções puras em `lib/painel.js`, no mesmo
padrão de `lib/pdvVendas.js`. Menos SQL para manter e troca de período
instantânea, sem nova ida ao servidor.

Fuso: Porto Velho é UTC-4 o ano todo. Reutilizar a constante já definida em
`lib/pdvVendas.js:16`.

## Ponte local (seção 3, apresentada e ainda não aprovada)

Script `scripts/ponte-painel.mjs`, disparado por `launchd` a cada 5 minutos.

Formato dos logs verificado antes do desenho: linhas com `type: "assistant"`
trazem `timestamp` ISO, `message.model`, `requestId` e `message.usage` com
`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` e
`output_tokens`.

### Coleta A — agenda

`osascript` em JXA, janela de agora até +7 dias, retornando UID, título,
início, fim, dia-inteiro, calendário e local.

- Upsert por `(user_id, uid_externo)`, para que evento editado atualize em vez
  de duplicar.
- Eventos da janela que não vieram na coleta são removidos. Sem isso um
  compromisso cancelado permanece na tela indefinidamente.

A primeira execução dispara o pedido de permissão de Automação do macOS, uma
única vez, e exige a tela desbloqueada.

### Coleta B — uso do Claude

- Varre `~/.claude/projects/**/*.jsonl`, limitando a arquivos com `mtime` dos
  últimos 8 dias.
- Leitura incremental por offset de bytes gravado em estado local, para não
  reparsear centenas de megabytes a cada cinco minutos.
- Dedupe por `requestId`: streaming e retry gravam a mesma requisição mais de
  uma vez, e somar tudo infla o total.
- `tokens = input + cache_creation + cache_read + output`.
- Duas janelas: 5 horas corridas e 7 dias corridos.

Limitações conhecidas, a manter visíveis na interface: o limite semanal do
plano reseta em horário fixo definido pela Anthropic, não em janela
deslizante, e esse horário não é exposto — por isso a janela de 7 dias
corridos e o rótulo "estimado". O peso de `cache_read` no limite real também
não é público, motivo pelo qual `teto_tokens` é calibrado comparando uma vez
com o `/usage` em vez de deduzido.

### Escrita e segurança

O script usa uma service key e escreve apenas em `agenda_eventos` e
`claude_uso`.

O repositório fica dentro do Google Drive sincronizado, então a service key
não pode morar nele. O `.env` da ponte fica em `~/.config/364-ponte/.env`,
fora do Drive, com `chmod 600`, lido por caminho absoluto.

### Falha

Uma execução que quebra não zera dados. Cada tile de origem local exibe
"atualizado há X min"; acima de 30 minutos o carimbo muda para cor de alerta.
O `launchd` só roda com o Mac ligado: com a máquina dormindo, agenda e Claude
congelam, enquanto o financeiro, que vem do Supabase, continua normal.

## Pendente ao retomar

1. Aprovar ou ajustar a seção 3 (ponte local).
2. Seção 4 — layout e interação: cinco tiles heróis (consumo do Claude, saldo
   das contas, vendas e lucro do dia, meta do mês e ritmo, próximo
   compromisso), seletor dia/semana/mês, quebra por empresa, intervalo de
   auto-refresh a definir.
3. Seção 5 — tratamento de erro, segurança e testes.
4. Escrever a versão final deste documento e seguir para a skill
   `writing-plans`.
