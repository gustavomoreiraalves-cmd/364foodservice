import test from 'node:test';
import assert from 'node:assert/strict';
import { arquivosDaNota, faltaArquivoDeNotaAutorizada } from '../lib/nfe/arquivos.js';

const CHAVE = '11260837541736000187550030000000021541041714';
const AUTORIZADA = {
  status: 'autorizado',
  chave: CHAVE,
  xml_path: `emp/nfe-saida/${CHAVE}.xml`,
  nfeproc_path: `emp/nfe-saida/${CHAVE}-procNFe.xml`,
};

test('o nfeProc vem primeiro e marcado como principal', () => {
  // Numa lista de dois links parecidos, quem está com pressa clica no
  // primeiro. O primeiro tem de ser o que prova autorização.
  const [primeiro, segundo] = arquivosDaNota(AUTORIZADA);
  assert.equal(primeiro.path, AUTORIZADA.nfeproc_path);
  assert.equal(primeiro.principal, true);
  assert.equal(segundo.path, AUTORIZADA.xml_path);
  assert.equal(segundo.principal, false);
});

test('o nome do arquivo sai pela chave, que é como o contador arquiva', () => {
  const [proc, assinado] = arquivosDaNota(AUTORIZADA);
  assert.equal(proc.nomeArquivo, `${CHAVE}-procNFe.xml`);
  assert.equal(assinado.nomeArquivo, `${CHAVE}.xml`);
});

test('sem nfeProc sobra só o assinado', () => {
  // Acontece de verdade: o upload do nfeProc é melhor-esforço e pode falhar
  // sozinho, depois do XML assinado já ter subido.
  const arquivos = arquivosDaNota({ ...AUTORIZADA, nfeproc_path: null });
  assert.equal(arquivos.length, 1);
  assert.equal(arquivos[0].principal, false);
});

test('documento sem arquivo nenhum devolve lista vazia, não quebra', () => {
  assert.deepEqual(arquivosDaNota({ status: 'rejeitado' }), []);
  assert.deepEqual(arquivosDaNota({}), []);
  assert.deepEqual(arquivosDaNota(), []);
});

test('nota autorizada sem arquivo é caso próprio, não é falha de emissão', () => {
  // A gravação no Storage é melhor-esforço de propósito: se falhar, a nota
  // continua autorizada. A tela precisa dizer "faltou o arquivo", não deixar
  // parecer que a emissão não aconteceu.
  assert.equal(faltaArquivoDeNotaAutorizada({ status: 'autorizado' }), true);
  assert.equal(faltaArquivoDeNotaAutorizada(AUTORIZADA), false);
  assert.equal(faltaArquivoDeNotaAutorizada({ status: 'rejeitado' }), false);
});
