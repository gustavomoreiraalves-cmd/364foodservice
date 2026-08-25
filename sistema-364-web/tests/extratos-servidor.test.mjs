// Testes do orquestrador de importação (lib/extratosServer.js) com um dublê
// de `sb`: nenhum destes testes toca rede ou banco de verdade. O módulo em
// si não importa nada do Next — é o que permite rodar isto sob `node --test`
// (se algum dia extratosServer.js passar a importar `next/server` ou algo
// que puxe o Next, esta suíte inteira quebra: confira antes de mexer nos
// imports do topo do arquivo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processarImportacao } from '../lib/extratosServer.js';

// ---------- Dublê de arquivo ----------
// Usa o parseCsv de verdade (não mocado) — só a borda com o Supabase é
// dublada abaixo. Cabeçalho reconhecido pelo parser: Data;Descrição;Valor.
function csvExtrato(linhasCsv) {
  const cabecalho = 'Data;Descrição;Valor';
  const corpo = linhasCsv.map(l => `${l.data};${l.descricao};${l.valor}`).join('\n');
  return Buffer.from(`${cabecalho}\n${corpo}\n`, 'utf8');
}

// ---------- Dublê de `sb` ----------
// Builder encadeável e "then-ável", do jeito que o supabase-js é de verdade:
// cada método de filtro devolve o próprio builder, e o await em QUALQUER
// ponto da cadeia resolve chamando `resolver` com a lista de chamadas feitas
// até ali (o primeiro método chamado após `.from(tabela)` é sempre o verbo:
// select/insert/upsert/update/delete).
function criarBuilder(resolver) {
  const chamadasDaCadeia = [];
  const builder = {};
  for (const metodo of ['select', 'eq', 'in', 'not', 'insert', 'upsert', 'update', 'delete', 'maybeSingle']) {
    builder[metodo] = (...args) => {
      chamadasDaCadeia.push({ metodo, args });
      return builder;
    };
  }
  builder.then = (aoResolver, aoRejeitar) =>
    Promise.resolve().then(() => resolver(chamadasDaCadeia)).then(aoResolver, aoRejeitar);
  return builder;
}

const CONTA_PADRAO = { id: 'cb1', empresa_id: 'e1', tipo: 'conta_corrente' };

// `chamadas` registra toda operação que saiu do dublê (tabela + verbo,
// mais os argumentos relevantes) — é o que permite asserir "isto não foi
// escrito", além de conferir o que foi passado para cada escrita.
function criarSbFalso(cfg = {}) {
  const config = {
    conta: CONTA_PADRAO,
    parcelas: [],
    reservadas: [],
    vinculadas: [],
    erroVinculadas: null,
    padroes: [],
    erroPadroes: null,
    erroUpload: null,
    erroInsertImportacao: null,
    erroUpdateImportacao: null, // valor fixo, ou função (patch) => erro|null
    erroRpc: null,
    upsertResultado: null, // (linhas) => ({ data, error }) — sobrescreve o eco padrão
    ...cfg,
  };
  const chamadas = [];
  const registrar = (tabela, metodo, extra) => chamadas.push({ tabela, metodo, ...extra });

  const handlers = {
    contas_bancarias: () => {
      registrar('contas_bancarias', 'select');
      return { data: config.conta, error: null };
    },
    contas_a_pagar_parcelas: () => {
      registrar('contas_a_pagar_parcelas', 'select');
      return { data: config.parcelas, error: null };
    },
    conciliacao_padroes: () => {
      registrar('conciliacao_padroes', 'select');
      return { data: config.padroes, error: config.erroPadroes };
    },
    conciliacao_vinculos: () => {
      registrar('conciliacao_vinculos', 'select');
      return { data: config.vinculadas, error: config.erroVinculadas };
    },
    extrato_importacoes: (chamadasDaCadeia) => {
      const verbo = chamadasDaCadeia[0]?.metodo;
      if (verbo === 'insert') {
        registrar('extrato_importacoes', 'insert', { linha: chamadasDaCadeia[0].args[0][0] });
        return { error: config.erroInsertImportacao };
      }
      if (verbo === 'update') {
        const patch = chamadasDaCadeia[0].args[0];
        const erro = typeof config.erroUpdateImportacao === 'function'
          ? config.erroUpdateImportacao(patch)
          : config.erroUpdateImportacao;
        registrar('extrato_importacoes', 'update', { patch });
        return { error: erro || null };
      }
      throw new Error('Dublê: verbo inesperado em extrato_importacoes: ' + verbo);
    },
    extrato_lancamentos: (chamadasDaCadeia) => {
      const verbo = chamadasDaCadeia[0]?.metodo;
      if (verbo === 'select') {
        registrar('extrato_lancamentos', 'select-reservadas');
        return { data: config.reservadas, error: null };
      }
      if (verbo === 'upsert') {
        const linhas = chamadasDaCadeia[0].args[0];
        registrar('extrato_lancamentos', 'upsert', { linhas });
        if (config.upsertResultado) return config.upsertResultado(linhas);
        // Eco padrão: toda linha volta como "inserida", com o status que a
        // própria função já calculou — suficiente para testar a aritmética
        // de novas/duplicadas/sugeridas sem simular um Postgres de verdade.
        return { data: linhas.map((l, i) => ({ id: `gerada-${i}`, status: l.status })), error: null };
      }
      if (verbo === 'delete') {
        registrar('extrato_lancamentos', 'delete');
        return { error: null };
      }
      throw new Error('Dublê: verbo inesperado em extrato_lancamentos: ' + verbo);
    },
  };

  const sb = {
    from(tabela) {
      const handler = handlers[tabela];
      if (!handler) throw new Error('Dublê: tabela sem handler configurado: ' + tabela);
      return criarBuilder(chamadasDaCadeia => handler(chamadasDaCadeia));
    },
    storage: {
      from(bucket) {
        return {
          async upload(path) {
            registrar('storage:' + bucket, 'upload', { path });
            return { data: config.erroUpload ? null : { path }, error: config.erroUpload };
          },
        };
      },
    },
    async rpc(nome, params) {
      registrar('rpc:' + nome, 'rpc', { params });
      return { data: null, error: config.erroRpc };
    },
  };

  return { sb, chamadas };
}

function chamou(chamadas, tabela, metodo) {
  return chamadas.some(c => c.tabela === tabela && (!metodo || c.metodo === metodo));
}

function importar(sb, extras = {}) {
  return processarImportacao({
    sb, empresaId: 'e1', contaBancariaId: 'cb1', tipo: 'extrato', arquivoNome: 'extrato.csv', ...extras,
  });
}

// ---------- Correção 1: parcela reservada por outra importação ----------

test('parcela já sugerida por um lançamento aberto de OUTRA importação não é oferecida de novo', async () => {
  const buffer = csvExtrato([{ data: '11/08/2026', descricao: 'PAGAMENTO FORNECEDOR X', valor: '-1200,00' }]);
  const { sb, chamadas } = criarSbFalso({
    parcelas: [{ id: 'p1', valor: 1200, vencimento: '2026-08-10', contas_a_pagar: { fornecedor_id: null } }],
    reservadas: [{ parcela_sugerida_id: 'p1' }], // outra importação já sugeriu p1 e segue aberta
  });

  const resultado = await importar(sb, { buffer });

  const upsert = chamadas.find(c => c.tabela === 'extrato_lancamentos' && c.metodo === 'upsert');
  assert.equal(upsert.linhas[0].status, 'pendente');
  assert.equal(upsert.linhas[0].parcela_sugerida_id, null);
  assert.equal(resultado.sugeridas, 0);
});

test('controle: sem reserva de outra importação, a mesma parcela É sugerida normalmente', async () => {
  // Mesmo cenário do teste acima, só sem `reservadas` — prova que é a
  // exclusão que muda o resultado, e não outra coisa (ex.: data/valor que já
  // não bateriam de qualquer jeito).
  const buffer = csvExtrato([{ data: '11/08/2026', descricao: 'PAGAMENTO FORNECEDOR X', valor: '-1200,00' }]);
  const { sb, chamadas } = criarSbFalso({
    parcelas: [{ id: 'p1', valor: 1200, vencimento: '2026-08-10', contas_a_pagar: { fornecedor_id: null } }],
    reservadas: [],
  });

  const resultado = await importar(sb, { buffer });

  const upsert = chamadas.find(c => c.tabela === 'extrato_lancamentos' && c.metodo === 'upsert');
  assert.equal(upsert.linhas[0].status, 'sugerido');
  assert.equal(upsert.linhas[0].parcela_sugerida_id, 'p1');
  assert.equal(resultado.sugeridas, 1);
});

// ---------- Parcela que já tem vínculo não volta ao sorteio ----------

test('parcela que já tem vínculo não é sugerida de novo, mesmo continuando Pendente', async () => {
  // É o caso da linha de fatura de cartão: ela concilia deixando a parcela
  // 'Pendente' de propósito (quem baixa é o pagamento da fatura). Sem esta
  // exclusão a parcela reaparece na importação seguinte e um débito do extrato
  // de mesmo valor é sugerido para a MESMA obrigação.
  const buffer = csvExtrato([{ data: '14/08/2026', descricao: 'PIX ENVIADO LOJA B', valor: '-150,00' }]);
  const { sb, chamadas } = criarSbFalso({
    parcelas: [{ id: 'p9', valor: 150, vencimento: '2026-08-14', contas_a_pagar: { fornecedor_id: null } }],
    reservadas: [],                        // nenhum lançamento aberto a segura
    vinculadas: [{ parcela_id: 'p9' }],    // mas uma linha de fatura já a reivindica
  });

  const resultado = await importar(sb, { buffer });

  const upsert = chamadas.find(c => c.tabela === 'extrato_lancamentos' && c.metodo === 'upsert');
  assert.equal(upsert.linhas[0].status, 'pendente');
  assert.equal(upsert.linhas[0].parcela_sugerida_id, null);
  assert.equal(resultado.sugeridas, 0);
});

test('controle: sem vínculo, a mesma parcela Pendente É sugerida normalmente', async () => {
  const buffer = csvExtrato([{ data: '14/08/2026', descricao: 'PIX ENVIADO LOJA B', valor: '-150,00' }]);
  const { sb, chamadas } = criarSbFalso({
    parcelas: [{ id: 'p9', valor: 150, vencimento: '2026-08-14', contas_a_pagar: { fornecedor_id: null } }],
    vinculadas: [],
  });

  const resultado = await importar(sb, { buffer });

  const upsert = chamadas.find(c => c.tabela === 'extrato_lancamentos' && c.metodo === 'upsert');
  assert.equal(upsert.linhas[0].status, 'sugerido');
  assert.equal(upsert.linhas[0].parcela_sugerida_id, 'p9');
  assert.equal(resultado.sugeridas, 1);
});

test('falha ao ler os vínculos existentes termina em erro (não sugere contra parcela já tomada)', async () => {
  const buffer = csvExtrato([{ data: '14/08/2026', descricao: 'PIX ENVIADO LOJA B', valor: '-150,00' }]);
  const { sb } = criarSbFalso({
    parcelas: [{ id: 'p9', valor: 150, vencimento: '2026-08-14', contas_a_pagar: { fornecedor_id: null } }],
    erroVinculadas: { message: 'timeout' },
  });

  await assert.rejects(
    () => importar(sb, { buffer }),
    /Não consegui conferir as parcelas já conciliadas/,
  );
});

// ---------- Extrato lido sem nenhuma saída ----------

test('extrato que não produziu nenhuma saída levanta alerta (layout mal lido)', async () => {
  // CSV com valores positivos: tudo vira entrada. Sem alerta, a importação
  // nasce "concluida" (não sobra saída aberta), a tag fica verde e o painel
  // abre vazio, porque entradas ficam escondidas por padrão.
  const buffer = csvExtrato([
    { data: '10/08/2026', descricao: 'PAGAMENTO FORNECEDOR X', valor: '1200,00' },
    { data: '11/08/2026', descricao: 'PAGAMENTO FORNECEDOR Y', valor: '800,00' },
  ]);
  const { sb, chamadas } = criarSbFalso({});

  const resultado = await importar(sb, { buffer });

  assert.match(resultado.alerta, /nenhuma das 2 linha\(s\)/i);
  assert.match(resultado.alerta, /saída/i);
  const update = chamadas.find(c => c.tabela === 'extrato_importacoes' && c.metodo === 'update'
    && c.patch.status === 'aguardando_conciliacao');
  assert.equal(update.patch.alerta, resultado.alerta,
    'o alerta tem que ficar gravado na importação, não só no retorno da rota');
});

test('extrato com pelo menos uma saída não levanta esse alerta', async () => {
  const buffer = csvExtrato([
    { data: '10/08/2026', descricao: 'PIX RECEBIDO CLIENTE', valor: '1200,00' },
    { data: '11/08/2026', descricao: 'TARIFA', valor: '-50,00' },
  ]);
  const { sb } = criarSbFalso({});

  const resultado = await importar(sb, { buffer });

  assert.equal(resultado.alerta, null);
});

test('fatura sem saída nenhuma não usa esse alerta — a regra é de extrato', async () => {
  const buffer = csvExtrato([{ data: '10/08/2026', descricao: 'ESTORNO COMPRA', valor: '120,00' }]);
  const { sb } = criarSbFalso({ conta: { id: 'cb1', empresa_id: 'e1', tipo: 'cartao_credito' } });

  const resultado = await importar(sb, { buffer, tipo: 'fatura_cartao' });

  assert.equal(resultado.alerta, null);
});

// ---------- Correção 2: erros de escrita descartados no caminho de sucesso ----------

test('falha ao atualizar o resumo final da importação termina em erro, não em resumo de sucesso', async () => {
  const buffer = csvExtrato([{ data: '10/08/2026', descricao: 'TARIFA', valor: '-50,00' }]);
  const { sb, chamadas } = criarSbFalso({
    erroUpdateImportacao: patch =>
      (patch.status === 'aguardando_conciliacao' ? { message: 'conexão perdida' } : null),
  });

  await assert.rejects(
    () => importar(sb, { buffer }),
    /Não consegui atualizar o resumo da importação/,
  );

  assert.equal(chamou(chamadas, 'extrato_lancamentos', 'delete'), true,
    'o catch deveria limpar as linhas parciais');
  const ultimoUpdate = chamadas.filter(c => c.tabela === 'extrato_importacoes' && c.metodo === 'update').pop();
  assert.equal(ultimoUpdate.patch.status, 'erro');
});

test('falha no rpc de recalcular também termina em erro (não fica com status a meio caminho)', async () => {
  const buffer = csvExtrato([{ data: '10/08/2026', descricao: 'TARIFA', valor: '-50,00' }]);
  const { sb } = criarSbFalso({ erroRpc: { message: 'função indisponível' } });

  await assert.rejects(
    () => importar(sb, { buffer }),
    /Não consegui recalcular os totais da importação/,
  );
});

test('falha ao ler os padrões de conciliação também termina em erro (não degrada em silêncio)', async () => {
  const buffer = csvExtrato([{ data: '10/08/2026', descricao: 'TARIFA', valor: '-50,00' }]);
  const { sb } = criarSbFalso({ erroPadroes: { message: 'timeout' } });

  await assert.rejects(
    () => importar(sb, { buffer }),
    /Não consegui ler os padrões de conciliação aprendidos/,
  );
});

// ---------- Numeração de ocorrências, ponta a ponta ----------

test('duas linhas idênticas no mesmo arquivo geram hash_dedupe diferentes e as duas são inseridas', async () => {
  const buffer = csvExtrato([
    { data: '10/08/2026', descricao: 'TARIFA MANUTENCAO CONTA', valor: '-50,00' },
    { data: '10/08/2026', descricao: 'TARIFA MANUTENCAO CONTA', valor: '-50,00' },
  ]);
  const { sb, chamadas } = criarSbFalso({});

  const resultado = await importar(sb, { buffer });

  const upsert = chamadas.find(c => c.tabela === 'extrato_lancamentos' && c.metodo === 'upsert');
  assert.equal(upsert.linhas.length, 2);
  assert.notEqual(upsert.linhas[0].hash_dedupe, upsert.linhas[1].hash_dedupe);
  assert.equal(resultado.total, 2);
  assert.equal(resultado.novas, 2);
  assert.equal(resultado.duplicadas, 0);
});

// ---------- Contagens devolvidas batem com o que o dublê disse que aconteceu ----------

test('novas, duplicadas e sugeridas batem com o que o dublê devolveu do upsert', async () => {
  const buffer = csvExtrato([
    { data: '10/08/2026', descricao: 'TARIFA A', valor: '-10,00' },
    { data: '10/08/2026', descricao: 'TARIFA B', valor: '-20,00' },
    { data: '10/08/2026', descricao: 'TARIFA C', valor: '-30,00' },
  ]);
  const { sb } = criarSbFalso({
    // Simula que a 3ª linha já existia (duplicada): o dublê devolve só 2 das 3.
    upsertResultado: linhas => ({
      data: [
        { id: 'g1', status: linhas[0].status },
        { id: 'g2', status: 'sugerido' },
      ],
      error: null,
    }),
  });

  const resultado = await importar(sb, { buffer });

  assert.equal(resultado.total, 3);
  assert.equal(resultado.novas, 2);
  assert.equal(resultado.duplicadas, 1);
  assert.equal(resultado.sugeridas, 1);
});

// ---------- Escopo de empresa antes de qualquer escrita ----------

test('conta bancária de outra empresa é recusada antes de qualquer escrita', async () => {
  const buffer = csvExtrato([{ data: '10/08/2026', descricao: 'TARIFA', valor: '-50,00' }]);
  const { sb, chamadas } = criarSbFalso({
    conta: { id: 'cb1', empresa_id: 'OUTRA-EMPRESA', tipo: 'conta_corrente' },
  });

  await assert.rejects(
    () => importar(sb, { buffer }),
    /Conta bancária de outra empresa/,
  );

  assert.equal(chamadas.some(c => c.tabela.startsWith('storage:')), false,
    'não deveria ter subido arquivo nenhum');
  assert.equal(chamou(chamadas, 'extrato_importacoes', 'insert'), false,
    'não deveria ter criado a importação');
});
