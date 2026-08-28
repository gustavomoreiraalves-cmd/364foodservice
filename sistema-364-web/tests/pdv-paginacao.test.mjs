import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPaginado, TAMANHO_PAGINA } from '../lib/pdvBackup/paginacao.js';

// Uma tabela falsa que respeita o intervalo pedido, como o PostgREST faz.
function tabelaFalsa(total, tamanhoPagina = TAMANHO_PAGINA) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }));
  const intervalos = [];
  const buscar = async (de, ate) => {
    intervalos.push([de, ate]);
    return linhas.slice(de, Math.min(ate + 1, de + tamanhoPagina));
  };
  return { buscar, intervalos };
}

test('tabela vazia devolve lista vazia numa página só', async () => {
  const { buscar, intervalos } = tabelaFalsa(0, 10);
  assert.deepEqual(await lerPaginado(buscar, 10), []);
  assert.equal(intervalos.length, 1);
});

test('menos que uma página não pede a segunda', async () => {
  const { buscar, intervalos } = tabelaFalsa(7, 10);
  assert.equal((await lerPaginado(buscar, 10)).length, 7);
  assert.equal(intervalos.length, 1);
});

test('múltiplo exato do tamanho da página pede a página vazia final', async () => {
  // Sem essa volta a mais, uma tabela de exatamente 1000 linhas pararia sem
  // saber se havia mais — e é justamente o caso que trunca em silêncio.
  const { buscar, intervalos } = tabelaFalsa(20, 10);
  assert.equal((await lerPaginado(buscar, 10)).length, 20);
  assert.equal(intervalos.length, 3);
  assert.deepEqual(intervalos, [[0, 9], [10, 19], [20, 29]]);
});

test('lê tudo além do teto de mil linhas, que é onde o PostgREST corta', async () => {
  const { buscar } = tabelaFalsa(2345, TAMANHO_PAGINA);
  const linhas = await lerPaginado(buscar);
  assert.equal(linhas.length, 2345);
  assert.equal(linhas[0].id, 0);
  assert.equal(linhas.at(-1).id, 2344);
});

test('chamador que ignora o intervalo vira erro nomeado, não laço infinito', async () => {
  // Devolver sempre uma página cheia é o sintoma de um select sem .range().
  const sempreCheia = async () => Array.from({ length: 10 }, (_, i) => ({ id: i }));
  await assert.rejects(
    () => lerPaginado(sempreCheia, 10),
    /passou de 1000 páginas/,
  );
});
