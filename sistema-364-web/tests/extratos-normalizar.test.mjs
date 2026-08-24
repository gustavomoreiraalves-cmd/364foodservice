import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarDescricao } from '../lib/extratos/normalizar.js';
import { hashDedupe } from '../lib/extratos/dedupe.js';

test('normaliza caixa, acento e pontuação', () => {
  assert.equal(normalizarDescricao('Pix enviado - Distribuição Boi Forte'),
    'PIX ENVIADO DISTRIBUICAO BOI FORTE');
});

test('descarta números: data, documento, CNPJ e valor não são aprendizado', () => {
  assert.equal(
    normalizarDescricao('PIX ENVIADO 12/08 BOI FORTE LTDA 45.678.901/0001-23 R$ 1.500,00'),
    'PIX ENVIADO BOI FORTE LTDA R');
});

test('duas linhas do mesmo fornecedor em meses diferentes viram a mesma chave', () => {
  const a = normalizarDescricao('DEB AUT ENERGISA 08/2026 fatura 998877');
  const b = normalizarDescricao('DEB AUT ENERGISA 09/2026 fatura 112233');
  assert.equal(a, b);
  assert.equal(a, 'DEB AUT ENERGISA FATURA');
});

test('entrada vazia ou nula devolve string vazia', () => {
  assert.equal(normalizarDescricao(''), '');
  assert.equal(normalizarDescricao(null), '');
  assert.equal(normalizarDescricao(undefined), '');
});

test('corta em 120 caracteres', () => {
  assert.equal(normalizarDescricao('A'.repeat(200)).length, 120);
});

test('hash é estável e separa lançamentos diferentes', () => {
  const base = {
    contaBancariaId: 'cccccccc-0000-0000-0000-000000000001',
    data: '2026-08-10', valor: 750, descricaoNormalizada: 'PIX ENVIADO BOI FORTE',
  };
  assert.equal(hashDedupe(base), hashDedupe({ ...base }));
  assert.notEqual(hashDedupe(base), hashDedupe({ ...base, valor: 750.01 }));
  assert.notEqual(hashDedupe(base), hashDedupe({ ...base, data: '2026-08-11' }));
  assert.notEqual(hashDedupe(base), hashDedupe({ ...base, contaBancariaId: 'outra' }));
  assert.match(hashDedupe(base), /^[0-9a-f]{64}$/);
});

test('valor entra no hash com dois decimais fixos', () => {
  const base = { contaBancariaId: 'c1', data: '2026-08-10', descricaoNormalizada: 'X' };
  assert.equal(hashDedupe({ ...base, valor: 750.001 }), hashDedupe({ ...base, valor: 750.004 }));
});

test('FITID do OFX manda no hash — dois débitos iguais no mesmo dia não colidem', () => {
  const base = {
    contaBancariaId: 'c1', data: '2026-08-10', valor: 100, descricaoNormalizada: 'TARIFA',
  };
  const a = hashDedupe({ ...base, fitid: 'A1' });
  const b = hashDedupe({ ...base, fitid: 'A2' });
  assert.notEqual(a, b);
  assert.notEqual(a, hashDedupe(base));
});

test('ocorrência diferencia duas linhas idênticas sem FITID (duas tarifas iguais no mesmo dia, PDF/CSV)', () => {
  const base = {
    contaBancariaId: 'c1', data: '2026-08-10', valor: 50, descricaoNormalizada: 'TARIFA MANUTENCAO CONTA',
  };
  const primeira = hashDedupe({ ...base, ocorrencia: 0 });
  const segunda = hashDedupe({ ...base, ocorrencia: 1 });
  assert.notEqual(primeira, segunda);
});

test('ocorrência não interfere quando há FITID — o banco já identifica a transação', () => {
  const base = {
    contaBancariaId: 'c1', data: '2026-08-10', valor: 50,
    descricaoNormalizada: 'TARIFA MANUTENCAO CONTA', fitid: 'X1',
  };
  assert.equal(hashDedupe({ ...base, ocorrencia: 0 }), hashDedupe({ ...base, ocorrencia: 1 }));
  assert.equal(hashDedupe({ ...base, ocorrencia: 7 }), hashDedupe(base));
});

test('omitir ocorrência equivale a passar ocorrência 0 (o default do parâmetro)', () => {
  // Prova só a fiação do default — NÃO prova (e não podia provar) que o hash
  // bate com o de antes desta correção: a chave antiga era
  // "conta|data|valor|descricao" e a nova é sempre "...|descricao|N", com ou
  // sem `ocorrencia` explícito. São strings diferentes, hashes diferentes.
  // Sem consequência prática porque a tabela é nova e não há hash gravado
  // com o esquema antigo — mas o nome do teste não pode alegar o contrário.
  const base = {
    contaBancariaId: 'c1', data: '2026-08-10', valor: 50, descricaoNormalizada: 'TARIFA MANUTENCAO CONTA',
  };
  assert.equal(hashDedupe(base), hashDedupe({ ...base, ocorrencia: 0 }));
});
