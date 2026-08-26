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

test('CRT fora da faixa válida (1, 2, 3, 4) falha', () => {
  assert.throws(() => crtDoRegime('simples', '5'), /CRT inválido/i);
  assert.throws(() => crtDoRegime('simples', 5), /CRT inválido/i);
  assert.throws(() => crtDoRegime('simples', 'X'), /CRT inválido/i);
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
  const fieldPatterns = {
    cnpj: /cnpj/i,
    razao_social: /razão social/i,
    inscricao_estadual: /inscricao.estadual/i,
    endereco: /endereco/i,
    numero: /número/i,
    bairro: /bairro/i,
    codigo_municipio_ibge: /codigo.municipio.ibge/i,
    cidade: /cidade/i,
    uf: /uf/i,
    cep: /cep/i,
  };

  for (const campo of Object.keys(fieldPatterns)) {
    assert.throws(
      () => dadosEmitente({ ...EMPREGADOR, [campo]: null }),
      fieldPatterns[campo],
      `faltando ${campo} deveria falhar citando o campo`,
    );
  }
});
