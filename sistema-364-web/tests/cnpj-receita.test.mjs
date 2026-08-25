// Testes de lib/cnpjReceita.js: nenhum bate rede de verdade — o fetch é
// injetado, então roda sob `node --test` sem depender da BrasilAPI estar no ar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapearCnpjReceita, buscarCnpjReceita } from '../lib/cnpjReceita.js';

const CNPJ_VALIDO = '37541736000187';

const RESPOSTA_BRASILAPI = {
  razao_social: 'OPEN KNOWLEDGE BRASIL',
  nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
  logradouro: 'PAULISTA',
  numero: '37',
  complemento: 'ANDAR 4',
  bairro: 'BELA VISTA',
  municipio: 'SAO PAULO',
  uf: 'SP',
  cep: '01311-902',
  codigo_municipio_ibge: 3550308,
  descricao_situacao_cadastral: 'ATIVA',
};

test('mapearCnpjReceita converte campos da Receita Federal para o formulário de cliente', () => {
  const mapeado = mapearCnpjReceita(RESPOSTA_BRASILAPI);
  assert.deepEqual(mapeado, {
    nome: 'OPEN KNOWLEDGE BRASIL',
    nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
    logradouro: 'PAULISTA',
    numero: '37',
    complemento: 'ANDAR 4',
    bairro: 'BELA VISTA',
    municipio: 'SAO PAULO',
    uf: 'SP',
    cep: '01311902',
    codigo_municipio_ibge: '3550308',
    situacaoCadastral: 'ATIVA',
  });
});

test('mapearCnpjReceita não quebra com campos ausentes', () => {
  assert.deepEqual(mapearCnpjReceita({}), {
    nome: '', nome_fantasia: '', logradouro: '', numero: '', complemento: '', bairro: '',
    municipio: '', uf: '', cep: '', codigo_municipio_ibge: '', situacaoCadastral: '',
  });
});

test('buscarCnpjReceita rejeita CNPJ inválido sem chamar a rede', async () => {
  let chamou = false;
  const fetchImpl = async () => { chamou = true; };
  await assert.rejects(
    () => buscarCnpjReceita('111', { fetchImpl }),
    /CNPJ inválido/,
  );
  assert.equal(chamou, false);
});

test('buscarCnpjReceita resolve os dados mapeados quando a consulta funciona', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, `https://brasilapi.com.br/api/cnpj/v1/${CNPJ_VALIDO}`);
    return { ok: true, status: 200, json: async () => RESPOSTA_BRASILAPI };
  };
  const dados = await buscarCnpjReceita(CNPJ_VALIDO, { fetchImpl });
  assert.equal(dados.nome, 'OPEN KNOWLEDGE BRASIL');
  assert.equal(dados.uf, 'SP');
});

// A BrasilAPI fica atrás de um edge que devolve 403 pra requisições sem
// User-Agent (é o que o fetch nativo do Node manda por padrão) — sem este
// cabeçalho a consulta falha em produção mesmo com CNPJ válido e API no ar.
test('buscarCnpjReceita manda um User-Agent explícito (a BrasilAPI bloqueia requisição sem ele)', async () => {
  let cabecalhos;
  const fetchImpl = async (url, opcoes) => {
    cabecalhos = opcoes?.headers;
    return { ok: true, status: 200, json: async () => RESPOSTA_BRASILAPI };
  };
  await buscarCnpjReceita(CNPJ_VALIDO, { fetchImpl });
  assert.ok(cabecalhos?.['User-Agent'], 'esperava um header User-Agent na chamada');
});

test('buscarCnpjReceita rejeita com status 404 quando a Receita não conhece o CNPJ', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(
    () => buscarCnpjReceita(CNPJ_VALIDO, { fetchImpl }),
    err => err.status === 404,
  );
});

test('buscarCnpjReceita rejeita com status 503 quando a rede falha', async () => {
  const fetchImpl = async () => { throw new Error('timeout'); };
  await assert.rejects(
    () => buscarCnpjReceita(CNPJ_VALIDO, { fetchImpl }),
    err => err.status === 503,
  );
});
