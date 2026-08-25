# Motor de Emissão de NF-e — Núcleo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir uma NF-e modelo 55 autorizada pela SEFAZ, em homologação, a partir de um pedido de venda real do sistema.

**Architecture:** Um pipeline em camadas puras até a borda: resolver (pedido + cliente + produtos + regras tributárias → objeto neutro), serializador (objeto neutro → XML 4.00), e só então assinatura e transmissão, que já existem em `lib/sefaz/`. A numeração fiscal é reservada atomicamente no banco antes de montar o XML, e o resultado de cada etapa fica gravado numa máquina de estados que permite retomar sem queimar número.

**Tech Stack:** Next.js (App Router, `runtime = 'nodejs'`), Supabase/Postgres, `lib/sefaz/*` (assinatura XMLDSig, transporte mTLS — entregues e provados ao vivo), `node --test`.

**Spec:** [docs/superpowers/specs/2026-08-25-motor-emissao-nfe-design.md](../specs/2026-08-25-motor-emissao-nfe-design.md)

> **Correção ao spec:** ele afirma que a assinatura e o transporte "reaproveitam o que já existe do lado de entrada". Isso era falso quando foi escrito — nada existia. A fase anterior ([2026-08-25-fundacao-sefaz.md](2026-08-25-fundacao-sefaz.md)) construiu essa camada do zero, e ela agora existe de verdade e está provada contra a SVRS (`cStat 107`). Ler o spec com essa correção em mente.

## O que este plano NÃO entrega

O spec do motor coloca DANFE, cancelamento e carta de correção na mesma fase. Este plano para **antes** deles, de propósito: o objetivo aqui é a primeira nota autorizada, que é o marco que prova o motor. DANFE e eventos entram no plano seguinte.

**Consequência honesta:** ao fim deste plano o sistema emite nota válida em homologação, mas **ainda não está pronto para produção** — falta o DANFE (que acompanha a entrega) e o cancelamento (exigência regulatória, janela de 24h). Não virar a chave para produção só com este plano.

## Pré-condição de dados que não depende de código

Levantamento em produção (25/08/2026): dos 11 produtos ativos, **1** tem NCM, **1** tem grupo tributário, **zero** têm `ativo_fiscal = true`; existe **1** regra tributária (CFOP 5405, CSOSN 101). Os 2 clientes estão completos (CNPJ, IE, `ind_ie_dest`, endereço, município IBGE).

Ou seja: o motor será construído e provado com o único produto configurado. Emitir para o catálogo inteiro depende de preencher o cadastro fiscal, que por sua vez depende de duas respostas do contador já registradas em `docs/fiscal/12-desenho-cadastro-fiscal.md` — o papel da 364 na substituição tributária e a classificação dos pratos prontos. **Isso é trabalho de cadastro, não deste plano**, e não bloqueia nenhuma tarefa abaixo.

## Global Constraints

- **Homologação é o único ambiente exercitado neste plano.** Nenhuma tarefa emite em produção. A nota de homologação não tem valor fiscal, mas consome numeração da série de homologação — o que é esperado e inofensivo.
- **Número fiscal se reserva atomicamente, antes de montar o XML**, via `UPDATE ... RETURNING` numa única instrução. Ler e depois incrementar em dois passos é a corrida que faz duas notas nascerem com o mesmo número.
- **Número reservado é reaproveitado** enquanto a SEFAZ não tiver aceitado o lote; depois disso, nunca. Ver a máquina de estados.
- `nfe_saida_itens` **congela** o resultado de `fn_resolver_regra_tributaria`. Regra tributária muda com o tempo; nota emitida não muda junto.
- Toda rota usa `autorizarModulo(request, 'fiscal')` **e** `garantirEmpresa(sb, user, isAdmin, empresaId)` antes de qualquer leitura ou escrita.
- Material do certificado nunca entra em resposta, log ou mensagem de erro.
- **Emissão só parte de dado que o cadastro confirmou.** Produto sem regra tributária resolvível, sem NCM, ou com `ativo_fiscal = false` aborta a emissão **antes** de reservar número, com mensagem nomeando o produto. Nunca emitir com tributo "padrão" chutado.
- Serializador cobre o caminho **Simples Nacional (CRT 1), operação interna em RO, destinatário contribuinte** — que é a operação real da 364 Food Service. Outros caminhos (regime normal, interestadual, consumidor final) são extensões futuras e devem falhar explicitamente, não silenciosamente gerar XML errado.

---

## File Structure

- `supabase/atualizacao_43_nfe_saida.sql` — três tabelas + RPC de numeração.
- `tests/migracao-43/{fixture,cenarios}.sql` + `verificar.sh` — segue o padrão de `tests/migracao-40/`.
- `lib/nfe/chaveAcesso.js` — monta a chave de 44 dígitos e o DV. Puro.
- `lib/nfe/emitente.js` — dados do emitente para o bloco `emit`, incluindo derivação do CRT. Puro.
- `lib/nfe/resolverNota.js` — junta pedido/cliente/produtos/regras num objeto neutro. Puro (recebe linhas, não consulta banco).
- `lib/nfe/montarXml.js` — objeto neutro → XML NF-e 4.00. Puro.
- `lib/nfe/emitir.js` — o pipeline com I/O: valida, reserva número, monta, assina, transmite, persiste.
- `app/api/fiscal/emitir-nfe/route.js` — `POST`.
- `app/pedidos/[id]/page.js` (modificado) — botão e bloco de status.
- Testes: `tests/nfe-chave-acesso.test.mjs`, `tests/nfe-emitente.test.mjs`, `tests/nfe-resolver.test.mjs`, `tests/nfe-montar-xml.test.mjs`.

**Divisão puro/impuro:** tudo de `chaveAcesso` a `montarXml` é função pura e tem teste offline. `emitir.js` é a única peça com banco e rede, e não tem teste automatizado — prova-se em homologação, pela tela. Isso é deliberado: o XML, que é onde mora a complexidade, fica inteiramente testável sem tocar na SEFAZ.

---

### Task 1: Migração — tabelas de saída e reserva atômica de número

**Files:**
- Create: `supabase/atualizacao_43_nfe_saida.sql`
- Create: `tests/migracao-43/fixture.sql`, `tests/migracao-43/cenarios.sql`, `tests/migracao-43/verificar.sh`

**Interfaces:**
- Produces: tabelas `nfe_saida_documentos`, `nfe_saida_itens`, `nfe_saida_eventos`; função `reservar_numero_fiscal(p_empregador_id uuid, p_modelo text, p_ambiente text, p_serie int) returns int`.

- [ ] **Step 1: Escrever a migração**

```sql
-- =========================================================
-- Atualização 43 — NF-e de saída: documentos, itens, eventos e numeração
--
-- Três tabelas e uma função. A função é o coração: reservar_numero_fiscal
-- incrementa e devolve numa instrução só. Ler o último número e depois gravar
-- o próximo, em dois passos, é a corrida que faz duas notas nascerem com o
-- mesmo número — e número repetido é rejeição na SEFAZ com a nota já assinada.
--
-- nfe_saida_itens congela o resultado do motor de regras tributárias. A regra
-- muda (correção de alíquota, mudança de CFOP); a nota já emitida não muda
-- junto, então o que foi declarado fica gravado aqui.
--
-- Rode depois de atualizacao_42_logo_empresa.sql. Idempotente.
-- Rollback comentado no fim.
-- =========================================================
begin;

create table if not exists public.nfe_saida_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  empregador_id uuid not null references public.empregadores(id),
  pedido_id uuid not null references public.pedidos(id),
  natureza_operacao_id uuid not null references public.naturezas_operacao(id),
  modelo text not null default '55' check (modelo in ('55', '65')),
  ambiente text not null check (ambiente in ('producao', 'homologacao')),
  serie int,
  numero int,
  chave char(44),
  codigo_numerico char(8),
  status text not null default 'rascunho'
    check (status in ('rascunho','numero_reservado','assinado','enviado',
                      'autorizado','rejeitado','erro_comunicacao','contingencia','cancelado')),
  motivo_rejeicao text,
  protocolo_autorizacao text,
  recibo_lote text,
  xml_path text,
  danfe_path text,
  valor_total numeric(12,2) not null default 0,
  emitida_em timestamptz,
  cancelada_em timestamptz,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Segunda barreira contra número repetido: a primeira é a própria
-- fiscal_numeracao, esta pega o caso de alguém gravar documento à mão.
create unique index if not exists nfe_saida_documentos_numero_unico
  on public.nfe_saida_documentos(empregador_id, modelo, ambiente, serie, numero)
  where numero is not null;
create unique index if not exists nfe_saida_documentos_chave_unica
  on public.nfe_saida_documentos(chave) where chave is not null;
create index if not exists nfe_saida_documentos_pedido_idx on public.nfe_saida_documentos(pedido_id);

create table if not exists public.nfe_saida_itens (
  id uuid primary key default gen_random_uuid(),
  nfe_saida_documento_id uuid not null references public.nfe_saida_documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  pedido_item_id uuid not null references public.pedido_itens(id),
  produto_id uuid not null references public.produtos(id),
  numero_item int not null,
  codigo text not null,
  descricao text not null,
  ncm text not null,
  cest text,
  gtin text,
  cfop text not null,
  unidade text not null,
  quantidade numeric(15,4) not null,
  valor_unitario numeric(15,10) not null,
  valor_total numeric(12,2) not null,
  origem_mercadoria text,
  csosn text,
  cst_icms text,
  base_calculo_icms numeric(12,2) not null default 0,
  aliquota_icms numeric(7,4) not null default 0,
  valor_icms numeric(12,2) not null default 0,
  cst_pis text,
  aliquota_pis numeric(7,4) not null default 0,
  valor_pis numeric(12,2) not null default 0,
  cst_cofins text,
  aliquota_cofins numeric(7,4) not null default 0,
  valor_cofins numeric(12,2) not null default 0,
  regra_tributaria_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists nfe_saida_itens_numero_unico
  on public.nfe_saida_itens(nfe_saida_documento_id, numero_item);

create table if not exists public.nfe_saida_eventos (
  id uuid primary key default gen_random_uuid(),
  nfe_saida_documento_id uuid not null references public.nfe_saida_documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  tipo text not null check (tipo in ('cancelamento','carta_correcao')),
  sequencia int not null default 1,
  justificativa text not null,
  protocolo text,
  xml_path text,
  status text not null default 'enviado' check (status in ('enviado','aceito','rejeitado')),
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists nfe_saida_eventos_seq_unica
  on public.nfe_saida_eventos(nfe_saida_documento_id, tipo, sequencia);

do $$
declare t text;
begin
  foreach t in array array['nfe_saida_documentos','nfe_saida_itens','nfe_saida_eventos'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_scoped" on public.%I;', t, t);
    execute format('create policy "%s_scoped" on public.%I for select to authenticated
                    using (empresa_id in (select public.empresas_permitidas()));', t, t);
  end loop;
end $$;

drop trigger if exists trg_nfe_saida_documentos_updated_at on public.nfe_saida_documentos;
create trigger trg_nfe_saida_documentos_updated_at before update on public.nfe_saida_documentos
  for each row execute function public.fn_set_updated_at();

-- ---------- reserva atômica de número ----------
-- Uma instrução só. Duas chamadas simultâneas para a mesma chave travam uma na
-- outra no lock de linha do Postgres e cada uma recebe um número diferente;
-- nenhuma enxerga o valor intermediário da outra. Não precisa de select ... for
-- update nem de lock de aplicação.
--
-- security definer porque fiscal_numeracao tem RLS sem policy: só o service role
-- (e esta função) alcança.
create or replace function public.reservar_numero_fiscal(
  p_empregador_id uuid, p_modelo text, p_ambiente text, p_serie int
)
returns int
language sql
security definer
set search_path = public
as $$
  update fiscal_numeracao
     set ultimo_numero = ultimo_numero + 1, updated_at = now()
   where empregador_id = p_empregador_id and modelo = p_modelo
     and ambiente = p_ambiente and serie = p_serie
  returning ultimo_numero;
$$;

revoke all on function public.reservar_numero_fiscal(uuid, text, text, int) from public, anon, authenticated;

commit;

-- ---------- rollback ----------
-- begin;
-- drop function if exists public.reservar_numero_fiscal(uuid, text, text, int);
-- drop table if exists public.nfe_saida_eventos;
-- drop table if exists public.nfe_saida_itens;
-- drop table if exists public.nfe_saida_documentos;
-- commit;
```

- [ ] **Step 2: Escrever o teste da migração**

Siga o padrão de `tests/migracao-40/` (leia os três arquivos de lá antes). Cenários a cobrir em `cenarios.sql`:

1. `reservar_numero_fiscal` devolve números **estritamente crescentes** em chamadas sucessivas, e o `ultimo_numero` da linha acompanha.
2. Chave inexistente em `fiscal_numeracao` devolve **zero linhas** (não erro, não `null` silencioso) — o pipeline precisa distinguir isso e abortar antes de montar XML.
3. `nfe_saida_documentos_numero_unico` rejeita duas notas com mesmo empregador+modelo+ambiente+série+número; aceita número repetido em séries ou ambientes diferentes.
4. `nfe_saida_documentos_chave_unica` rejeita chave duplicada, e permite várias linhas com chave `null` (rascunhos ainda sem número).
5. `nfe_saida_itens_numero_unico` rejeita dois itens com o mesmo `numero_item` no mesmo documento.
6. RLS ligada nas três tabelas.

Para o cenário 1, o teste roda em transação única — o que já prova o incremento, mas **não** a concorrência real. Documente isso no `cenarios.sql`: a prova de concorrência exige duas sessões simultâneas e fica para verificação manual, ou para um teste de integração futuro.

- [ ] **Step 3: Rodar o teste**

Run: `bash tests/migracao-43/verificar.sh`
Expected: todos os cenários OK, rollback limpo.

- [ ] **Step 4: NÃO aplicar em produção**

Aplicar em banco é escrita e exige confirmação do dono — ele roda no terminal dele. Deixe o arquivo pronto e diga no relatório que está pendente de aplicação.

- [ ] **Step 5: Commit**

```bash
git add supabase/atualizacao_43_nfe_saida.sql tests/migracao-43/
git commit -m "feat(nfe): tabelas de NF-e de saída e reserva atômica de número"
```

---

### Task 2: Chave de acesso

**Files:**
- Create: `lib/nfe/chaveAcesso.js`
- Test: `tests/nfe-chave-acesso.test.mjs`

**Interfaces:**
- Produces:
  - `digitoVerificadorChave(chave43)` → dígito (número 0-9).
  - `montarChaveAcesso({ cUF, dataEmissao, cnpj, modelo, serie, numero, tipoEmissao, codigoNumerico })` → string de 44 dígitos.
  - `gerarCodigoNumerico(numero)` → string de 8 dígitos aleatórios, garantidamente diferente de `numero`.

**A chave tem 44 dígitos, nesta ordem exata:**

| campo | dígitos | conteúdo |
| --- | --- | --- |
| cUF | 2 | código da UF do emitente (RO = 11) |
| AAMM | 4 | ano (2) e mês (2) da emissão |
| CNPJ | 14 | do emitente, só dígitos |
| mod | 2 | 55 |
| serie | 3 | |
| nNF | 9 | número da nota |
| tpEmis | 1 | 1 = normal |
| cNF | 8 | código numérico aleatório |
| cDV | 1 | dígito verificador dos 43 anteriores |

O DV é módulo 11 com pesos 2 a 9 ciclando da direita para a esquerda; resto 0 ou 1 vira dígito 0.

`cNF` não pode ser igual a `nNF` — regra da SEFAZ, rejeição 539 quando viola.

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/nfe-chave-acesso.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarChaveAcesso, digitoVerificadorChave, gerarCodigoNumerico } from '../lib/nfe/chaveAcesso.js';

const BASE = {
  cUF: '11', dataEmissao: new Date('2026-08-25T10:00:00-03:00'),
  cnpj: '37541736000187', modelo: '55', serie: 1, numero: 1,
  tipoEmissao: '1', codigoNumerico: '10000001',
};

test('a chave tem exatamente 44 dígitos', () => {
  const chave = montarChaveAcesso(BASE);
  assert.equal(chave.length, 44);
  assert.match(chave, /^\d{44}$/);
});

test('cada campo ocupa a posição que a SEFAZ espera', () => {
  const chave = montarChaveAcesso(BASE);
  assert.equal(chave.slice(0, 2), '11', 'cUF');
  assert.equal(chave.slice(2, 6), '2608', 'AAMM');
  assert.equal(chave.slice(6, 20), '37541736000187', 'CNPJ');
  assert.equal(chave.slice(20, 22), '55', 'modelo');
  assert.equal(chave.slice(22, 25), '001', 'série com zeros à esquerda');
  assert.equal(chave.slice(25, 34), '000000001', 'número com zeros à esquerda');
  assert.equal(chave.slice(34, 35), '1', 'tpEmis');
  assert.equal(chave.slice(35, 43), '10000001', 'cNF');
});

test('o dígito verificador fecha a própria chave', () => {
  const chave = montarChaveAcesso(BASE);
  assert.equal(Number(chave[43]), digitoVerificadorChave(chave.slice(0, 43)));
});

test('DV: resto 0 ou 1 vira dígito 0', () => {
  // 43 zeros somam 0; resto 0 → DV 0.
  assert.equal(digitoVerificadorChave('0'.repeat(43)), 0);
});

test('DV muda quando qualquer dígito muda — é o que o torna útil', () => {
  const chave = montarChaveAcesso(BASE);
  const adulterada = chave.slice(0, 42) + (chave[42] === '9' ? '0' : String(Number(chave[42]) + 1));
  assert.notEqual(digitoVerificadorChave(adulterada), Number(chave[43]));
});

test('DV exige exatamente 43 dígitos', () => {
  assert.throws(() => digitoVerificadorChave('123'), /43/);
});

test('série e número acima do que cabe são recusados, não truncados', () => {
  assert.throws(() => montarChaveAcesso({ ...BASE, serie: 1000 }), /série/i);
  assert.throws(() => montarChaveAcesso({ ...BASE, numero: 1000000000 }), /número/i);
});

test('gerarCodigoNumerico devolve 8 dígitos e nunca repete o número da nota', () => {
  for (let i = 0; i < 200; i++) {
    const cnf = gerarCodigoNumerico(12345);
    assert.match(cnf, /^\d{8}$/);
    assert.notEqual(Number(cnf), 12345, 'cNF igual a nNF é rejeição 539 na SEFAZ');
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/nfe-chave-acesso.test.mjs`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```javascript
// lib/nfe/chaveAcesso.js
//
// Chave de acesso da NF-e: 44 dígitos que identificam a nota no país inteiro.
// A ordem e a largura dos campos são fixadas pelo leiaute 4.00 — nada aqui é
// escolha nossa, e errar uma posição gera rejeição por chave inválida.
//
// Puro: sem banco, sem rede.

function apenasDigitos(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function comZeros(valor, largura, rotulo) {
  const s = String(valor);
  if (!/^\d+$/.test(s)) throw new Error(`${rotulo} precisa ser numérico: ${valor}`);
  if (s.length > largura) {
    throw new Error(`${rotulo} não cabe em ${largura} dígitos: ${valor}`);
  }
  return s.padStart(largura, '0');
}

// Módulo 11, pesos 2..9 ciclando da direita para a esquerda. Resto 0 ou 1 → 0.
export function digitoVerificadorChave(chave43) {
  const s = apenasDigitos(chave43);
  if (s.length !== 43) throw new Error(`O dígito verificador exige 43 dígitos, recebi ${s.length}.`);
  let soma = 0;
  let peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += Number(s[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export function montarChaveAcesso({ cUF, dataEmissao, cnpj, modelo, serie, numero, tipoEmissao, codigoNumerico }) {
  const d = dataEmissao instanceof Date ? dataEmissao : new Date(dataEmissao);
  if (Number.isNaN(d.getTime())) throw new Error('Data de emissão inválida para a chave de acesso.');

  const aamm = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
  const cnpjLimpo = apenasDigitos(cnpj);
  if (cnpjLimpo.length !== 14) throw new Error(`CNPJ do emitente precisa ter 14 dígitos: ${cnpj}`);

  const sem = [
    comZeros(cUF, 2, 'cUF'),
    aamm,
    cnpjLimpo,
    comZeros(modelo, 2, 'modelo'),
    comZeros(serie, 3, 'série'),
    comZeros(numero, 9, 'número da nota'),
    comZeros(tipoEmissao, 1, 'tipo de emissão'),
    comZeros(codigoNumerico, 8, 'código numérico'),
  ].join('');

  return sem + String(digitoVerificadorChave(sem));
}

// cNF igual ao nNF é rejeição 539. O sorteio evita, e o laço garante.
export function gerarCodigoNumerico(numero) {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const cnf = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    if (Number(cnf) !== Number(numero)) return cnf;
  }
  throw new Error('Não consegui sortear um código numérico diferente do número da nota.');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/nfe-chave-acesso.test.mjs` e depois `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/chaveAcesso.js tests/nfe-chave-acesso.test.mjs
git commit -m "feat(nfe): chave de acesso de 44 dígitos com dígito verificador"
```

---

### Task 3: Dados do emitente e derivação do CRT

**Files:**
- Create: `lib/nfe/emitente.js`
- Test: `tests/nfe-emitente.test.mjs`

**Interfaces:**
- Consumes: uma linha de `empregadores` (objeto simples, sem consulta ao banco).
- Produces:
  - `crtDoRegime(regimeTributario, crtExplicito)` → `'1' | '2' | '3' | '4'`.
  - `dadosEmitente(empregador)` → `{ cnpj, xNome, xFant, IE, CRT, enderEmit: { xLgr, nro, xBairro, cMun, xMun, UF, CEP, cPais, xPais, fone } }`; lança nomeando o campo quando falta algo obrigatório.

**Sobre o CRT:** o bloco `emit` exige o Código de Regime Tributário. Em produção a coluna `empregadores.crt` está **nula** nos dois CNPJs, mas `regime_tributario` está preenchida (`'simples'` em ambos). Derive de `regime_tributario`, aceitando `crt` explícito como override — é o único jeito de expressar CRT 2 (Simples com excesso de sublimite), que não se deduz do regime.

Mapa: `simples` → `1`, `mei` → `4`, `presumido` e `real` → `3`.

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/nfe-emitente.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { crtDoRegime, dadosEmitente } from '../lib/nfe/emitente.js';

const EMPREGADOR = {
  cnpj: '37541736000187',
  razao_social: '364 STEAKHOUSE COMERCIO DE ALIMENTOS LTDA',
  nome_fantasia: '364 Food Service',
  inscricao_estadual: '00000005709288',
  regime_tributario: 'simples',
  crt: null,
  endereco: 'AV DOIS DE ABRIL', numero: '1974', bairro: '2 DE ABRIL',
  cidade: 'JI-PARANÁ', uf: 'RO', cep: '76900808',
  codigo_municipio_ibge: '1100122', telefone: '6999999999',
};

test('CRT vem do regime quando a coluna crt está nula', () => {
  assert.equal(crtDoRegime('simples', null), '1');
  assert.equal(crtDoRegime('mei', null), '4');
  assert.equal(crtDoRegime('presumido', null), '3');
  assert.equal(crtDoRegime('real', null), '3');
});

test('crt explícito ganha do regime — é como se expressa o CRT 2', () => {
  assert.equal(crtDoRegime('simples', 2), '2');
  assert.equal(crtDoRegime('simples', '2'), '2');
});

test('regime desconhecido e sem crt explícito falha, não chuta', () => {
  assert.throws(() => crtDoRegime(null, null), /regime/i);
  assert.throws(() => crtDoRegime('inventado', null), /regime/i);
});

test('monta o bloco do emitente com os campos que o leiaute exige', () => {
  const e = dadosEmitente(EMPREGADOR);
  assert.equal(e.cnpj, '37541736000187');
  assert.equal(e.CRT, '1');
  assert.equal(e.IE, '00000005709288');
  assert.equal(e.enderEmit.cMun, '1100122');
  assert.equal(e.enderEmit.UF, 'RO');
  assert.equal(e.enderEmit.CEP, '76900808');
  assert.equal(e.enderEmit.cPais, '1058');
  assert.equal(e.enderEmit.xPais, 'BRASIL');
});

test('CNPJ e CEP saem só com dígitos, como o XML exige', () => {
  const e = dadosEmitente({ ...EMPREGADOR, cnpj: '37.541.736/0001-87', cep: '76900-808' });
  assert.equal(e.cnpj, '37541736000187');
  assert.equal(e.enderEmit.CEP, '76900808');
});

test('campo obrigatório ausente falha nomeando o campo, antes de gastar número', () => {
  for (const campo of ['inscricao_estadual', 'codigo_municipio_ibge', 'uf', 'endereco', 'cep']) {
    assert.throws(
      () => dadosEmitente({ ...EMPREGADOR, [campo]: null }),
      new RegExp(campo.replace('_', '.'), 'i'),
      `faltando ${campo} deveria falhar citando o campo`,
    );
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/nfe-emitente.test.mjs`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```javascript
// lib/nfe/emitente.js
//
// Bloco emit da NF-e. Puro: recebe a linha de empregadores, devolve o objeto
// que o serializador consome.
//
// Falhar aqui é barato; falhar depois de reservar número queima numeração
// fiscal. Por isso toda ausência de campo obrigatório vira exceção nomeando o
// campo, e nenhuma vira valor padrão silencioso.

const CRT_POR_REGIME = { simples: '1', mei: '4', presumido: '3', real: '3' };

export function crtDoRegime(regimeTributario, crtExplicito) {
  // O CRT 2 (Simples com excesso de sublimite) não se deduz do regime — só
  // existe se alguém declarar. Por isso o override vem primeiro.
  if (crtExplicito !== null && crtExplicito !== undefined && String(crtExplicito).trim() !== '') {
    const c = String(crtExplicito).trim();
    if (!['1', '2', '3', '4'].includes(c)) throw new Error(`CRT inválido: ${crtExplicito}. Use 1, 2, 3 ou 4.`);
    return c;
  }
  const crt = CRT_POR_REGIME[String(regimeTributario || '').toLowerCase()];
  if (!crt) {
    throw new Error(
      `Não sei o regime tributário do emitente (recebi "${regimeTributario}"). `
      + 'Preencha o regime em /empresas, ou informe o CRT explicitamente.',
    );
  }
  return crt;
}

function exigir(valor, campo) {
  const v = typeof valor === 'string' ? valor.trim() : valor;
  if (v === null || v === undefined || v === '') {
    throw new Error(`O emitente está sem ${campo}. Complete o cadastro em /empresas antes de emitir.`);
  }
  return v;
}

const digitos = v => String(v ?? '').replace(/\D/g, '');

export function dadosEmitente(empregador) {
  return {
    cnpj: exigir(digitos(empregador.cnpj), 'CNPJ'),
    xNome: exigir(empregador.razao_social, 'razão social'),
    xFant: empregador.nome_fantasia || undefined,
    IE: exigir(digitos(empregador.inscricao_estadual), 'inscricao_estadual (inscrição estadual)'),
    CRT: crtDoRegime(empregador.regime_tributario, empregador.crt),
    enderEmit: {
      xLgr: exigir(empregador.endereco, 'endereco (logradouro)'),
      nro: exigir(empregador.numero, 'número do endereço'),
      xCpl: empregador.complemento || undefined,
      xBairro: exigir(empregador.bairro, 'bairro'),
      cMun: exigir(digitos(empregador.codigo_municipio_ibge), 'codigo_municipio_ibge'),
      xMun: exigir(empregador.cidade, 'cidade'),
      UF: exigir(empregador.uf, 'uf'),
      CEP: exigir(digitos(empregador.cep), 'cep'),
      cPais: '1058',
      xPais: 'BRASIL',
      fone: digitos(empregador.telefone) || undefined,
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/nfe-emitente.test.mjs` e depois `npm test`

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/emitente.js tests/nfe-emitente.test.mjs
git commit -m "feat(nfe): bloco do emitente e derivação do CRT a partir do regime"
```

---

### Task 4: Resolver a nota — pedido, cliente, itens e tributos

**Files:**
- Create: `lib/nfe/resolverNota.js`
- Test: `tests/nfe-resolver.test.mjs`

**Interfaces:**
- Consumes: `dadosEmitente` (Task 3).
- Produces: `resolverNota({ pedido, cliente, itens, emitente, naturezaOperacao, ambiente })` → objeto neutro `{ ide, emit, dest, itens: [...], total }`, onde cada item já traz produto + tributos resolvidos. **Recebe os dados prontos** — não consulta banco; quem consulta é `emitir.js` (Task 6).

Cada elemento de `itens` na entrada é `{ pedidoItem, produto, regra }`, onde `regra` é a linha de `regras_tributarias` que `fn_resolver_regra_tributaria` devolveu para aquele produto.

**Regras de cálculo (Simples Nacional):**
- `vProd` = quantidade × valor unitário, arredondado a 2 casas.
- Base de ICMS e valor de ICMS: para CSOSN 101/102/103/300/400 **não há destaque** — base e valor ficam zero. Para 900 e para CST de regime normal, aplica-se `reducao_base_percentual` e `aliquota_interna_destino` da regra.
- PIS/COFINS: `aliquota_pis`/`aliquota_cofins` da regra sobre `vProd`; CST vem da regra.
- Total da nota: soma dos `vProd`; `vNF` igual, já que não há frete, seguro nem desconto nesta fase.

**O que deve falhar em vez de gerar nota errada:**
- item sem regra tributária resolvida;
- produto sem NCM;
- produto com `ativo_fiscal` falso;
- quantidade ou preço zerado/negativo;
- cliente sem CNPJ/CPF, sem município IBGE ou sem UF.

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/nfe-resolver.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverNota } from '../lib/nfe/resolverNota.js';
import { dadosEmitente } from '../lib/nfe/emitente.js';

const EMITENTE = dadosEmitente({
  cnpj: '37541736000187', razao_social: '364 COMERCIO LTDA', inscricao_estadual: '00000005709288',
  regime_tributario: 'simples', endereco: 'AV DOIS DE ABRIL', numero: '1974', bairro: '2 DE ABRIL',
  cidade: 'JI-PARANÁ', uf: 'RO', cep: '76900808', codigo_municipio_ibge: '1100122',
});

const CLIENTE = {
  nome: 'SUPERMERCADO MANAR LTDA', cnpj: '09057435000147', tipo_pessoa: 'J',
  ie: '00000002303388', ind_ie_dest: 1, logradouro: 'RUA X', numero: '725',
  bairro: 'NOVA BRASILIA', municipio: 'JI-PARANA', codigo_municipio_ibge: '1100122',
  uf: 'RO', cep: '76900000', email_nfe: 'compras@manar.com.br',
};

const PEDIDO = { id: 'p1', data: '2026-08-25', observacoes: null };
const NATUREZA = { id: 'n1', descricao: 'Venda de mercadoria' };

const ITEM = {
  pedidoItem: { id: 'i1', quantidade: 10, preco_unitario: 25.5 },
  produto: {
    id: 'prod1', codigo: 'STK-001', nome: 'Costela Defumada 500g', unidade: 'UN',
    ncm: '16025000', cest: null, gtin: null, origem_mercadoria: '0', ativo_fiscal: true,
  },
  regra: {
    id: 'r1', cfop: '5101', csosn: '101', cst_icms: null,
    reducao_base_percentual: null, aliquota_interna_destino: null,
    cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0,
  },
};

const ENTRADA = { pedido: PEDIDO, cliente: CLIENTE, itens: [ITEM], emitente: EMITENTE, naturezaOperacao: NATUREZA, ambiente: 'homologacao' };

test('calcula o valor do item e o total da nota', () => {
  const nota = resolverNota(ENTRADA);
  assert.equal(nota.itens[0].vProd, 255);
  assert.equal(nota.total.vNF, 255);
  assert.equal(nota.total.vProd, 255);
});

test('CSOSN 101 não destaca ICMS', () => {
  const nota = resolverNota(ENTRADA);
  assert.equal(nota.itens[0].csosn, '101');
  assert.equal(nota.itens[0].vICMS, 0);
  assert.equal(nota.itens[0].vBC, 0);
});

test('numera os itens a partir de 1, na ordem recebida', () => {
  const nota = resolverNota({ ...ENTRADA, itens: [ITEM, { ...ITEM, pedidoItem: { ...ITEM.pedidoItem, id: 'i2' } }] });
  assert.deepEqual(nota.itens.map(i => i.numeroItem), [1, 2]);
});

test('em homologação a razão social do destinatário é a exigida pela SEFAZ', () => {
  const nota = resolverNota(ENTRADA);
  assert.match(nota.dest.xNome, /HOMOLOGACAO/i,
    'em homologação a SEFAZ exige a razão social de teste, senão rejeita');
});

test('em produção usa o nome real do cliente', () => {
  const nota = resolverNota({ ...ENTRADA, ambiente: 'producao' });
  assert.equal(nota.dest.xNome, 'SUPERMERCADO MANAR LTDA');
});

test('item sem regra tributária aborta nomeando o produto', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, regra: null }] }),
    /Costela Defumada/,
  );
});

test('produto sem NCM aborta nomeando o produto', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, produto: { ...ITEM.produto, ncm: null } }] }),
    /Costela Defumada.*NCM|NCM.*Costela Defumada/i,
  );
});

test('produto não liberado fiscalmente aborta — é a trava do cadastro', () => {
  assert.throws(
    () => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, produto: { ...ITEM.produto, ativo_fiscal: false } }] }),
    /Costela Defumada/,
  );
});

test('quantidade ou preço não positivo aborta', () => {
  assert.throws(() => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, pedidoItem: { ...ITEM.pedidoItem, quantidade: 0 } }] }), /quantidade/i);
  assert.throws(() => resolverNota({ ...ENTRADA, itens: [{ ...ITEM, pedidoItem: { ...ITEM.pedidoItem, preco_unitario: 0 } }] }), /pre[çc]o/i);
});

test('cliente sem município IBGE aborta antes de qualquer emissão', () => {
  assert.throws(() => resolverNota({ ...ENTRADA, cliente: { ...CLIENTE, codigo_municipio_ibge: null } }), /munic[íi]pio/i);
});

test('pedido sem itens aborta', () => {
  assert.throws(() => resolverNota({ ...ENTRADA, itens: [] }), /item/i);
});

test('PIS e COFINS saem da regra, sobre o valor do produto', () => {
  const comAliquota = { ...ITEM, regra: { ...ITEM.regra, cst_pis: '01', aliquota_pis: 1.65, cst_cofins: '01', aliquota_cofins: 7.6 } };
  const nota = resolverNota({ ...ENTRADA, itens: [comAliquota] });
  assert.equal(nota.itens[0].vPIS, 4.21);   // 255 * 1.65%
  assert.equal(nota.itens[0].vCOFINS, 19.38); // 255 * 7.6%
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/nfe-resolver.test.mjs`

- [ ] **Step 3: Implementar**

```javascript
// lib/nfe/resolverNota.js
//
// Junta pedido, cliente, produtos e regras tributárias num objeto neutro, que o
// serializador transforma em XML. Puro: recebe as linhas já lidas do banco.
//
// Existe separado do serializador de propósito: quando o leiaute mudar (IBS/CBS
// da Reforma Tributária alcança o Simples em 04/01/2027), muda o serializador,
// não este arquivo.
//
// Toda validação aqui roda ANTES de reservar número fiscal. Falhar aqui é de
// graça; falhar depois queima numeração.

// A SEFAZ exige esta razão social em homologação. Mandar o nome real do cliente
// num XML de teste é rejeição 999 / "NF-e de teste em ambiente de produção".
const RAZAO_SOCIAL_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

// CSOSN em que o Simples não destaca ICMS: a nota informa a situação, sem valor.
const CSOSN_SEM_DESTAQUE = ['101', '102', '103', '300', '400', '500'];

const duasCasas = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const digitos = v => String(v ?? '').replace(/\D/g, '');

function exigir(valor, mensagem) {
  const v = typeof valor === 'string' ? valor.trim() : valor;
  if (v === null || v === undefined || v === '') throw new Error(mensagem);
  return v;
}

function resolverItem({ pedidoItem, produto, regra }, indice) {
  const nome = produto?.nome || produto?.codigo || `item ${indice + 1}`;

  if (!regra) {
    throw new Error(
      `Não há regra tributária para "${nome}". Cadastre a tributação do produto em `
      + '/fiscal/tributacao antes de emitir.',
    );
  }
  if (!produto.ativo_fiscal) {
    throw new Error(`O produto "${nome}" não está liberado para emissão fiscal. Revise a aba Fiscal do produto.`);
  }
  exigir(produto.ncm, `O produto "${nome}" está sem NCM.`);
  exigir(regra.cfop, `A regra tributária de "${nome}" está sem CFOP.`);

  const quantidade = Number(pedidoItem.quantidade);
  const valorUnitario = Number(pedidoItem.preco_unitario);
  if (!(quantidade > 0)) throw new Error(`Quantidade inválida em "${nome}": ${pedidoItem.quantidade}`);
  if (!(valorUnitario > 0)) throw new Error(`Preço inválido em "${nome}": ${pedidoItem.preco_unitario}`);

  const vProd = duasCasas(quantidade * valorUnitario);

  // Simples Nacional sem destaque: informa o CSOSN, não o valor. Com destaque
  // (CSOSN 900 ou CST de regime normal), aplica redução de base e alíquota.
  const semDestaque = regra.csosn && CSOSN_SEM_DESTAQUE.includes(String(regra.csosn));
  let vBC = 0, vICMS = 0, pICMS = 0;
  if (!semDestaque) {
    const reducao = Number(regra.reducao_base_percentual || 0);
    pICMS = Number(regra.aliquota_interna_destino || 0);
    vBC = duasCasas(vProd * (1 - reducao / 100));
    vICMS = duasCasas(vBC * pICMS / 100);
  }

  const pPIS = Number(regra.aliquota_pis || 0);
  const pCOFINS = Number(regra.aliquota_cofins || 0);

  return {
    numeroItem: indice + 1,
    pedidoItemId: pedidoItem.id,
    produtoId: produto.id,
    cProd: String(produto.codigo || produto.id),
    xProd: nome,
    NCM: digitos(produto.ncm),
    CEST: produto.cest ? digitos(produto.cest) : undefined,
    cEAN: produto.gtin || 'SEM GTIN',
    cEANTrib: produto.gtin_tributavel || produto.gtin || 'SEM GTIN',
    CFOP: String(regra.cfop),
    uCom: produto.unidade || 'UN',
    uTrib: produto.unidade_tributavel || produto.unidade || 'UN',
    quantidade, valorUnitario, vProd,
    origem: String(produto.origem_mercadoria ?? '0'),
    csosn: regra.csosn || undefined,
    cstIcms: regra.cst_icms || undefined,
    vBC, pICMS, vICMS,
    cstPis: regra.cst_pis || '49',
    pPIS, vPIS: duasCasas(vProd * pPIS / 100),
    cstCofins: regra.cst_cofins || '49',
    pCOFINS, vCOFINS: duasCasas(vProd * pCOFINS / 100),
    regraTributariaId: regra.id,
  };
}

function resolverDestinatario(cliente, ambiente) {
  const doc = digitos(cliente.cnpj);
  if (doc.length !== 14 && doc.length !== 11) {
    throw new Error(`O cliente "${cliente.nome}" está sem CNPJ/CPF válido.`);
  }
  return {
    tipoPessoa: doc.length === 14 ? 'J' : 'F',
    documento: doc,
    // Em homologação a razão social é fixada pela SEFAZ; usar o nome real
    // ali é rejeição.
    xNome: ambiente === 'homologacao' ? RAZAO_SOCIAL_HOMOLOGACAO : exigir(cliente.nome, 'O cliente está sem nome.'),
    indIEDest: String(cliente.ind_ie_dest ?? '9'),
    IE: cliente.ie ? digitos(cliente.ie) : undefined,
    email: cliente.email_nfe || undefined,
    enderDest: {
      xLgr: exigir(cliente.logradouro, `O cliente "${cliente.nome}" está sem logradouro.`),
      nro: exigir(cliente.numero, `O cliente "${cliente.nome}" está sem número no endereço.`),
      xCpl: cliente.complemento || undefined,
      xBairro: exigir(cliente.bairro, `O cliente "${cliente.nome}" está sem bairro.`),
      cMun: exigir(digitos(cliente.codigo_municipio_ibge), `O cliente "${cliente.nome}" está sem o código do município (IBGE).`),
      xMun: exigir(cliente.municipio, `O cliente "${cliente.nome}" está sem município.`),
      UF: exigir(cliente.uf, `O cliente "${cliente.nome}" está sem UF.`),
      CEP: digitos(cliente.cep) || undefined,
      cPais: '1058',
      xPais: 'BRASIL',
      fone: digitos(cliente.telefone) || undefined,
    },
  };
}

export function resolverNota({ pedido, cliente, itens, emitente, naturezaOperacao, ambiente }) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('O pedido não tem nenhum item para emitir.');
  }
  const dest = resolverDestinatario(cliente, ambiente);
  const resolvidos = itens.map(resolverItem);
  const vProd = duasCasas(resolvidos.reduce((s, i) => s + i.vProd, 0));

  return {
    ide: {
      natOp: exigir(naturezaOperacao?.descricao, 'Escolha a natureza da operação antes de emitir.'),
      naturezaOperacaoId: naturezaOperacao.id,
      // Operação interna (mesma UF) = 1; interestadual = 2. Esta fase cobre
      // só a interna; o serializador recusa o resto.
      idDest: emitente.enderEmit.UF === dest.enderDest.UF ? '1' : '2',
      cMunFG: emitente.enderEmit.cMun,
      pedidoId: pedido.id,
      observacoes: pedido.observacoes || undefined,
    },
    emit: emitente,
    dest,
    itens: resolvidos,
    total: {
      vProd,
      vNF: vProd,
      vBC: duasCasas(resolvidos.reduce((s, i) => s + i.vBC, 0)),
      vICMS: duasCasas(resolvidos.reduce((s, i) => s + i.vICMS, 0)),
      vPIS: duasCasas(resolvidos.reduce((s, i) => s + i.vPIS, 0)),
      vCOFINS: duasCasas(resolvidos.reduce((s, i) => s + i.vCOFINS, 0)),
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/nfe-resolver.test.mjs` e depois `npm test`

- [ ] **Step 5: Commit**

```bash
git add lib/nfe/resolverNota.js tests/nfe-resolver.test.mjs
git commit -m "feat(nfe): resolver pedido, cliente e tributos num objeto neutro"
```

---

### Task 5: Serializador do XML 4.00

**Files:**
- Create: `lib/nfe/montarXml.js`
- Test: `tests/nfe-montar-xml.test.mjs`

**Interfaces:**
- Consumes: o objeto neutro de `resolverNota` (Task 4); `montarChaveAcesso`, `gerarCodigoNumerico` (Task 2).
- Produces: `montarXmlNFe(nota, { serie, numero, ambiente, dataEmissao, codigoNumerico })` → `{ xml, chave, codigoNumerico }`. O XML sai **sem assinatura** — quem assina é `assinarXml` de `lib/sefaz/assinatura.js`, no pipeline.

**Estrutura mínima do `infNFe` (leiaute 4.00), nesta ordem:**

`ide` → `emit` → `dest` → `det` (um por item) → `total` → `transp` → `pag` → `infAdic` (opcional)

Campos de `ide`: `cUF`, `cNF`, `natOp`, `mod`, `serie`, `nNF`, `dhEmi`, `tpNF` (1=saída), `idDest`, `cMunFG`, `tpImp` (1=retrato), `tpEmis` (1=normal), `cDV`, `tpAmb`, `finNFe` (1=normal), `indFinal` (0=normal), `indPres` (9=não se aplica), `procEmi` (0), `verProc`.

`det` traz `prod` e `imposto`. Em `imposto`, Simples Nacional usa `ICMS` → `ICMSSN102` (para CSOSN sem destaque) ou `ICMSSN900`; mais `PIS` → `PISNT`/`PISAliq` e `COFINS` → `COFINSNT`/`COFINSAliq` conforme o CST.

`dhEmi` é ISO 8601 **com fuso** (`-03:00`), não UTC com `Z`.

**Deve recusar explicitamente**, em vez de gerar XML que a SEFAZ rejeita depois: `idDest` diferente de `1` (interestadual não é desta fase) e CRT diferente de `1`/`2` (regime normal não é desta fase).

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// tests/nfe-montar-xml.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { montarXmlNFe } from '../lib/nfe/montarXml.js';
import { resolverNota } from '../lib/nfe/resolverNota.js';
import { dadosEmitente } from '../lib/nfe/emitente.js';
import { digitoVerificadorChave } from '../lib/nfe/chaveAcesso.js';

const EMITENTE = dadosEmitente({
  cnpj: '37541736000187', razao_social: '364 COMERCIO LTDA', inscricao_estadual: '00000005709288',
  regime_tributario: 'simples', endereco: 'AV DOIS DE ABRIL', numero: '1974', bairro: '2 DE ABRIL',
  cidade: 'JI-PARANÁ', uf: 'RO', cep: '76900808', codigo_municipio_ibge: '1100122',
});
const CLIENTE = {
  nome: 'MANAR', cnpj: '09057435000147', tipo_pessoa: 'J', ie: '00000002303388', ind_ie_dest: 1,
  logradouro: 'RUA X', numero: '725', bairro: 'NOVA BRASILIA', municipio: 'JI-PARANA',
  codigo_municipio_ibge: '1100122', uf: 'RO', cep: '76900000',
};
const ITEM = {
  pedidoItem: { id: 'i1', quantidade: 10, preco_unitario: 25.5 },
  produto: { id: 'p1', codigo: 'STK-001', nome: 'Costela Defumada 500g', unidade: 'UN', ncm: '16025000', origem_mercadoria: '0', ativo_fiscal: true },
  regra: { id: 'r1', cfop: '5101', csosn: '102', cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0 },
};

function notaBase(ambiente = 'homologacao') {
  return resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE, itens: [ITEM], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda de mercadoria' }, ambiente,
  });
}
const OPCOES = { serie: 1, numero: 1, ambiente: 'homologacao', dataEmissao: new Date('2026-08-25T10:00:00-03:00'), codigoNumerico: '10000001' };

test('o Id do infNFe é NFe + a chave, e a chave fecha no DV', () => {
  const { xml, chave } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, new RegExp(`<infNFe[^>]*Id="NFe${chave}"`));
  assert.equal(Number(chave[43]), digitoVerificadorChave(chave.slice(0, 43)));
});

test('declara o namespace e a versão do leiaute', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe"/);
  assert.match(xml, /versao="4\.00"/);
});

test('tpAmb 2 em homologação e 1 em produção', () => {
  assert.match(montarXmlNFe(notaBase(), OPCOES).xml, /<tpAmb>2<\/tpAmb>/);
  const prod = montarXmlNFe(notaBase('producao'), { ...OPCOES, ambiente: 'producao' });
  assert.match(prod.xml, /<tpAmb>1<\/tpAmb>/);
});

test('os blocos vêm na ordem que o schema exige', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  const ordem = ['<ide>', '<emit>', '<dest>', '<det ', '<total>', '<transp>', '<pag>'];
  let ultima = -1;
  for (const tag of ordem) {
    const pos = xml.indexOf(tag);
    assert.ok(pos > ultima, `${tag} está fora de ordem`);
    ultima = pos;
  }
});

test('o item traz produto e imposto, com CSOSN do Simples', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<det nItem="1">/);
  assert.match(xml, /<cProd>STK-001<\/cProd>/);
  assert.match(xml, /<NCM>16025000<\/NCM>/);
  assert.match(xml, /<CFOP>5101<\/CFOP>/);
  assert.match(xml, /<ICMSSN102>/);
  assert.match(xml, /<CSOSN>102<\/CSOSN>/);
});

test('quantidade e valores saem com as casas decimais do leiaute', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<qCom>10\.0000<\/qCom>/, 'qCom tem 4 casas');
  assert.match(xml, /<vUnCom>25\.5000000000<\/vUnCom>/, 'vUnCom tem 10 casas');
  assert.match(xml, /<vProd>255\.00<\/vProd>/, 'vProd tem 2 casas');
});

test('o total da nota bate com a soma dos itens', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<vNF>255\.00<\/vNF>/);
});

test('dhEmi sai com fuso, não em UTC', () => {
  const { xml } = montarXmlNFe(notaBase(), OPCOES);
  assert.match(xml, /<dhEmi>2026-08-25T10:00:00-03:00<\/dhEmi>/);
  assert.doesNotMatch(xml, /<dhEmi>[^<]*Z<\/dhEmi>/);
});

test('escapa caractere especial na descrição em vez de quebrar o XML', () => {
  const comEcomercial = { ...ITEM, produto: { ...ITEM.produto, nome: 'Costela & Cupim <500g>' } };
  const nota = resolverNota({
    pedido: { id: 'ped1' }, cliente: CLIENTE, itens: [comEcomercial], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda' }, ambiente: 'homologacao',
  });
  const { xml } = montarXmlNFe(nota, OPCOES);
  assert.match(xml, /&amp;/);
  assert.doesNotMatch(xml, /<xProd>[^<]*<500g>/);
});

test('operação interestadual é recusada nesta fase, em vez de sair errada', () => {
  const outraUf = resolverNota({
    pedido: { id: 'ped1' }, cliente: { ...CLIENTE, uf: 'SP' }, itens: [ITEM], emitente: EMITENTE,
    naturezaOperacao: { id: 'n1', descricao: 'Venda' }, ambiente: 'homologacao',
  });
  assert.throws(() => montarXmlNFe(outraUf, OPCOES), /interestadual/i);
});

test('regime normal é recusado nesta fase', () => {
  const emitenteNormal = { ...EMITENTE, CRT: '3' };
  const nota = { ...notaBase(), emit: emitenteNormal };
  assert.throws(() => montarXmlNFe(nota, OPCOES), /regime normal|CRT/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/nfe-montar-xml.test.mjs`

- [ ] **Step 3: Implementar**

Escreva `lib/nfe/montarXml.js` satisfazendo os testes acima. Diretrizes que os testes não capturam sozinhos:

- Construa o XML por concatenação de strings, com uma função `tag(nome, valor)` que **omite** a tag quando o valor é `undefined`/`null`/`''` (campos opcionais ausentes não podem virar `<xCpl></xCpl>`) e uma `escapar()` que trate `& < > " '`.
- Casas decimais por campo, conforme o leiaute: `qCom`/`qTrib` com 4; `vUnCom`/`vUnTrib` com 10; todo valor monetário (`vProd`, `vBC`, `vICMS`, `vNF`, …) com 2; alíquotas (`pICMS`, `pPIS`, `pCOFINS`) com 4.
- `dhEmi`: ISO com offset. Monte a partir dos componentes locais da data — `toISOString()` devolve UTC com `Z` e é rejeitado.
- `ICMS`: `ICMSSN102` quando o CSOSN não destaca (`101`,`102`,`103`,`300`,`400`), `ICMSSN500` para `500`, `ICMSSN900` quando há destaque. Dentro, `orig` e `CSOSN` sempre; nos que destacam, também `modBC`, `vBC`, `pICMS`, `vICMS`.
- `PIS`/`COFINS`: CST `01`/`02` → `PISAliq`/`COFINSAliq` com `vBC`, `pPIS`/`pCOFINS`, `vPIS`/`vCOFINS`. CST `07`,`08`,`09`,`49` → `PISNT`/`COFINSNT` só com o CST.
- `total` → `ICMSTot` com todos os campos zerados que o schema exige (`vBC`, `vICMS`, `vICMSDeson`, `vFCP`, `vBCST`, `vST`, `vFCPST`, `vFCPSTRet`, `vProd`, `vFrete`, `vSeg`, `vDesc`, `vII`, `vIPI`, `vIPIDevol`, `vPIS`, `vCOFINS`, `vOutro`, `vNF`) — omitir campo obrigatório zerado é rejeição de schema.
- `transp` → `modFrete` `9` (sem frete).
- `pag` → `detPag` com `indPag` `0`, `tPag` `90` (sem pagamento) e `vPag` igual ao total. Faturamento a prazo é tratado no plano de contas a receber.
- `infAdic`/`infCpl`: use `nota.ide.observacoes` e o texto de `empresas.informacoes_complementares_padrao` quando houver — mas **não** gere aviso legal automático aqui; isso é decisão registrada no spec de configuração.
- As recusas explícitas (`idDest !== '1'`, CRT fora de `1`/`2`) devem citar que a operação não é coberta por esta fase e apontar o plano seguinte.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/nfe-montar-xml.test.mjs` e depois `npm test`

- [ ] **Step 5: Conferir o XML a olho**

Imprima um XML gerado e leia-o inteiro uma vez, comparando com a ordem de blocos acima. Cole-o no relatório. Erro de ordem ou de casa decimal só aparece na SEFAZ, e lá custa uma numeração queimada.

- [ ] **Step 6: Commit**

```bash
git add lib/nfe/montarXml.js tests/nfe-montar-xml.test.mjs
git commit -m "feat(nfe): serializador do XML da NF-e 4.00 para Simples Nacional"
```

---

### Task 6: Pipeline de emissão e rota

**Files:**
- Create: `lib/nfe/emitir.js`
- Create: `app/api/fiscal/emitir-nfe/route.js`

**Interfaces:**
- Consumes: tudo das tarefas 2-5; `assinarXml` de `lib/sefaz/assinatura.js`; `chamarSefaz`, `envelopeSoap`, `lerCampos`, `extrairCorpoResposta`, `endpointSefaz`, `namespaceServico`, `tpAmb` de `lib/sefaz/*`; `obterCertificadoAtivo`.
- Produces: `POST /api/fiscal/emitir-nfe` com corpo `{ pedidoId, naturezaOperacaoId }`, devolvendo `{ status, chave, numero, protocolo, motivo }`.

**Ordem obrigatória do pipeline** — cada passo só acontece se o anterior deu certo:

1. Autorizar (módulo + empresa), carregar pedido, cliente, itens, produtos, empregador, configuração de emissão.
2. Resolver tributos item a item chamando `fn_resolver_regra_tributaria` e **resolver a nota** (Task 4). Falha aqui não gastou número.
3. Gravar `nfe_saida_documentos` em `rascunho` com os itens resolvidos.
4. **Reservar número** via `reservar_numero_fiscal`. Sem linha devolvida → abortar dizendo que a série não está configurada em `/fiscal/emissor`.
5. Montar XML e chave → status `numero_reservado`.
6. Assinar → `assinado`.
7. Transmitir `NFeAutorizacao4` com `idLote` e `indSinc` `1` (síncrono) → `enviado`.
8. Ler o retorno: `cStat` `100` → `autorizado`, gravando `protocolo_autorizacao` e o XML autorizado; qualquer outro → `rejeitado` com `motivo_rejeicao`.

**Sobre a leitura do retorno:** a resposta síncrona traz `cStat` no nível do lote **e** dentro de `protNFe/infProt`. Use `lerCampos(..., { dentroDe: 'infProt' })` para ler o veredito da nota — ler o do lote marcaria como autorizada uma nota rejeitada. Esse foi um achado da revisão da fase anterior e a função já suporta escopo.

**Reaproveitamento de número:** enquanto o status for `rascunho`, `numero_reservado` ou `assinado`, uma nova tentativa para o mesmo pedido reaproveita o documento e o número. A partir de `enviado`, não — reserve número novo, porque a SEFAZ já viu o anterior.

- [ ] **Step 1: Implementar `lib/nfe/emitir.js` e a rota**

Siga a ordem acima. A rota faz `autorizarModulo(request, 'fiscal')` e `garantirEmpresa(...)` antes de qualquer leitura, tem `export const runtime = 'nodejs'` e `export const maxDuration = 60` (a autorização é mais lenta que a consulta de status). Toda leitura do Supabase confere `error`. Nenhum campo do certificado entra em resposta ou log.

- [ ] **Step 2: Verificação estática**

Não há teste automatizado aqui — a prova é a Task 7, em homologação. Confira por leitura: cada coluna referenciada existe na migração da Task 1; a ordem do pipeline é a de cima; o `dentroDe: 'infProt'` está no lugar certo; os caminhos de erro deixam o documento num status coerente.

Run: `npm test` (nada deve quebrar).

- [ ] **Step 3: Commit**

```bash
git add lib/nfe/emitir.js "app/api/fiscal/emitir-nfe/route.js"
git commit -m "feat(nfe): pipeline de emissão e rota de autorização"
```

---

### Task 7: Botão no pedido e prova em homologação

**Files:**
- Modify: `app/pedidos/[id]/page.js`

**Interfaces:**
- Consumes: `POST /api/fiscal/emitir-nfe` (Task 6).

- [ ] **Step 1: Implementar a interface**

Leia `app/pedidos/[id]/page.js` como está antes de editar. Acrescente:

- Botão **"Emitir NF-e"**, visível quando o pedido está em `Faturado` e não há documento `autorizado` para ele. Abre um passo para escolher a natureza da operação (pré-selecionada quando só houver uma para a marca).
- Bloco de status da nota: chave, número, situação, e — quando rejeitada — o motivo da SEFAZ e um botão "Tentar novamente".
- O botão desabilita enquanto a emissão está em curso, e o resultado é limpo ao trocar de pedido (mesma armadilha de estado obsoleto que a tela do emissor teve).

- [ ] **Step 2: Commit**

```bash
git add "app/pedidos/[id]/page.js"
git commit -m "feat(nfe): botão de emissão e status da nota no pedido"
```

- [ ] **Step 3: Prova em homologação — é do dono, não do implementador**

Esta é a verificação que fecha o plano, e ela **não é sua**: exige a migração aplicada em produção, o deploy publicado e o certificado real. Deixe no relatório as instruções para o dono:

1. Aplicar `supabase/atualizacao_43_nfe_saida.sql` (comando no relatório da Task 1).
2. Em `/fiscal/emissor`, conferir que a série de **homologação** do modelo 55 está ativa e com numeração inicial definida para a marca 364 Food Service.
3. Garantir que o produto usado no pedido de teste tem NCM, grupo tributário e `ativo_fiscal` marcado, e que existe regra tributária resolvendo para a natureza escolhida.
4. Abrir um pedido em `Faturado` e clicar em **Emitir NF-e**.

Resultado esperado: status **autorizado**, com chave de 44 dígitos e protocolo. Rejeição vem com `cStat` e motivo da própria SEFAZ — que é informação acionável, e o motivo de exercitar isso em homologação antes de qualquer nota real.

---

## Self-Review

**Cobertura da spec:** numeração atômica → Task 1; chave de acesso → Task 2; emitente/CRT → Task 3; resolução de tributos congelada em `nfe_saida_itens` → Tasks 1 e 4; XML 4.00 → Task 5; máquina de estados, transmissão e reaproveitamento de número → Task 6; gatilho manual no pedido → Task 7. Cancelamento, carta de correção e DANFE ficam declaradamente fora, no plano seguinte.

**Placeholders:** as Tasks 5 (implementação) e 6 descrevem requisitos em vez de trazer o código inteiro. É deliberado e é o limite honesto deste documento: o serializador completo do leiaute 4.00 e o pipeline com I/O são grandes demais para caber aqui sem virar código não revisado. Em compensação, os **testes** das Tasks 2-5 estão completos e são o contrato — quem implementar tem alvo exato, e as Tasks 6-7 são verificadas em homologação, contra a SEFAZ.

**Consistência de tipos:** `montarChaveAcesso`/`gerarCodigoNumerico` (Task 2) usados na Task 5 com a assinatura definida; `dadosEmitente` (Task 3) alimenta `resolverNota` (Task 4) que alimenta `montarXmlNFe` (Task 5); `reservar_numero_fiscal` (Task 1) chamada na Task 6 com os quatro parâmetros na ordem declarada.

**Risco registrado:** o serializador é a peça onde erro silencioso custa mais — XML aceito pelo nosso teste e recusado pela SEFAZ. Mitigação: Task 5 exige leitura do XML gerado a olho, e a Task 7 exercita contra homologação antes de qualquer nota com valor fiscal.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-25-motor-emissao-nfe-nucleo.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
