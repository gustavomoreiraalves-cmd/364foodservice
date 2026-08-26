import test from 'node:test';
import assert from 'node:assert/strict';
import { montarChaveAcesso, digitoVerificadorChave, gerarCodigoNumerico } from '../lib/nfe/chaveAcesso.js';

const BASE = {
  cUF: '11', dataEmissao: new Date('2026-08-25T10:00:00-03:00'),
  cnpj: '37541736000187', modelo: '55', serie: 1, numero: 1,
  tipoEmissao: '1', codigoNumerico: '10000001',
  fusoHorario: 'America/Porto_Velho',
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

test('AAMM vem do fuso do emitente, não do fuso do processo — regressão', () => {
  // Mesmo instante de emissão, perto da virada do mês: em Rondônia (-04:00)
  // ainda é agosto; em UTC já é setembro. O fuso do PROCESSO não pode
  // vazar para o resultado — só o fuso passado explicitamente importa.
  const instante = new Date('2026-08-31T23:50:00-03:00'); // 2026-09-01T02:50:00Z

  const chaveManaus = montarChaveAcesso({ ...BASE, dataEmissao: instante, fusoHorario: 'America/Porto_Velho' });
  const chaveUTC = montarChaveAcesso({ ...BASE, dataEmissao: instante, fusoHorario: 'UTC' });

  assert.equal(chaveManaus.slice(2, 6), '2608', 'no fuso do emitente ainda é agosto/26');
  assert.equal(chaveUTC.slice(2, 6), '2609', 'em UTC já virou setembro/26');
  assert.notEqual(chaveManaus.slice(2, 6), chaveUTC.slice(2, 6));

  // Para um fuso FIXO, o resultado é estável — repetir a chamada não muda nada.
  const repetida = montarChaveAcesso({ ...BASE, dataEmissao: instante, fusoHorario: 'America/Porto_Velho' });
  assert.equal(repetida.slice(2, 6), chaveManaus.slice(2, 6));
});

test('AAMM independe do TZ do processo Node (TZ=UTC vs TZ=America/Sao_Paulo)', () => {
  // Exercita a regressão real relatada: mesmo instante, mesmo fusoHorario
  // explícito, variando apenas process.env.TZ (que rege os getters locais
  // que o código antigo usava, mas não deve mais afetar o resultado).
  // Node lê process.env.TZ preguiçosamente por meio de Intl/Date; alternar
  // aqui no mesmo processo é suportado no Node moderno (v18+) — se a
  // plataforma de teste não honrar a troca, essa asserção falharia de forma
  // visível em vez de mascarar o problema.
  const instante = new Date('2026-08-31T23:50:00-03:00');
  const tzOriginal = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const emUTC = montarChaveAcesso({ ...BASE, dataEmissao: instante, fusoHorario: 'America/Porto_Velho' });

    process.env.TZ = 'America/Sao_Paulo';
    const emSaoPaulo = montarChaveAcesso({ ...BASE, dataEmissao: instante, fusoHorario: 'America/Porto_Velho' });

    assert.equal(emUTC.slice(2, 6), '2608');
    assert.equal(emSaoPaulo.slice(2, 6), '2608');
    assert.equal(emUTC, emSaoPaulo, 'o TZ do processo não pode influenciar a chave');
  } finally {
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
  }
});

test('fusoHorario é obrigatório — sem ele, lança erro em vez de usar o fuso do processo', () => {
  const { fusoHorario, ...semFuso } = BASE;
  assert.throws(() => montarChaveAcesso(semFuso), /fusoHorario/);
});

test('fusoHorario inválido lança erro em vez de cair silenciosamente para outro fuso', () => {
  assert.throws(() => montarChaveAcesso({ ...BASE, fusoHorario: 'Manaus' }), /fusoHorario inválido/);
  assert.throws(() => montarChaveAcesso({ ...BASE, fusoHorario: '' }), /fusoHorario/);
});

test('digitoVerificadorChave rejeita entrada com letras/espaços em vez de normalizar', () => {
  const chave = montarChaveAcesso(BASE);
  const chave43 = chave.slice(0, 43);
  const comLetra = 'a' + chave43.slice(1);
  const comEspaco = ' ' + chave43.slice(1);
  assert.throws(() => digitoVerificadorChave(comLetra), /43/);
  assert.throws(() => digitoVerificadorChave(comEspaco), /43/);
});

test('gerarCodigoNumerico devolve 8 dígitos e nunca repete o número da nota', () => {
  for (let i = 0; i < 200; i++) {
    const cnf = gerarCodigoNumerico(12345);
    assert.match(cnf, /^\d{8}$/);
    assert.notEqual(Number(cnf), 12345, 'cNF igual a nNF é rejeição 539 na SEFAZ');
  }
});
