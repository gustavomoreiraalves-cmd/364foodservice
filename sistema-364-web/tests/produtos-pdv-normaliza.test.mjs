import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  codigoDoProduto, unidadeDoPdv, chaveDoGrupo, gruposDoLote, normalizaProdutosFb,
} from '../lib/pdvBackup/normalizaProdutos.js';

const LINHAS = JSON.parse(
  readFileSync(new URL('./fixtures/pdv-backup/produtos.json', import.meta.url), 'utf8'),
);
const EMPRESA = '0dda3c8e-228b-4d05-b50a-2e2f301d75a3';

const normaliza = (extra = {}) => normalizaProdutosFb({
  linhas: LINHAS, empresaId: EMPRESA, prefixo: 'STK', ...extra,
});

// ------------------------------------------------------------- código

test('codigoDoProduto junta o prefixo da empresa ao número do PDV', () => {
  assert.equal(codigoDoProduto('STK', 339), 'STK-P339');
  assert.equal(codigoDoProduto('0364', 7), '0364-P7');
});

// ------------------------------------------------------------ unidade

test('unidadeDoPdv devolve a sigla em minúsculo e cai em "un" sem sigla', () => {
  assert.equal(unidadeDoPdv('kg'), 'kg');
  assert.equal(unidadeDoPdv('KG'), 'kg');
  assert.equal(unidadeDoPdv(null), 'un');
  assert.equal(unidadeDoPdv('  '), 'un');
});

// ------------------------------------------------------------- grupos

test('chaveDoGrupo nomeia a combinação CFOP/CSOSN e ignora linha sem config', () => {
  assert.equal(chaveDoGrupo({ CFOP: 5405, SITUACAOTRIBUTARIA: '500' }), 'PDV 5405/500');
  assert.equal(chaveDoGrupo({ CFOP: null, SITUACAOTRIBUTARIA: null }), null);
  assert.equal(chaveDoGrupo({ CFOP: 5102, SITUACAOTRIBUTARIA: null }), null);
});

test('gruposDoLote devolve uma entrada por combinação, sem repetir', () => {
  const grupos = gruposDoLote(LINHAS);
  const codigos = grupos.map(g => g.codigo).sort();
  assert.deepEqual(codigos, [...new Set(codigos)].sort(), 'não pode repetir combinação');
  assert.ok(grupos.every(g => g.descricao.includes('CFOP')), 'descrição diz de onde veio');
});

// --------------------------------------------------------- roteamento

test('tipo 1 vai para produtos e tipo 2 vai para matérias-primas', () => {
  const { produtos, materiasPrimas } = normaliza();
  assert.ok(produtos.every(p => p.pdv_codigo_produto !== 16), 'Salsa é insumo, não produto');
  assert.ok(materiasPrimas.some(m => m.pdv_codigo_produto === 16), 'Salsa tem que estar nos insumos');
});

test('insumo não leva campo fiscal nenhum', () => {
  const { materiasPrimas } = normaliza();
  const salsa = materiasPrimas.find(m => m.pdv_codigo_produto === 16);
  assert.equal(salsa.ncm, undefined);
  assert.equal(salsa.grupo_tributario_codigo, undefined);
  assert.equal(salsa.unidade, 'kg');
});

// ------------------------------------------------------------- origem

test('origem vem de CONFIGICMS, não de PRODUTOS', () => {
  // Em PRODUTOS a coluna é nula em 687 das 699 linhas; em CONFIGICMS está
  // preenchida em 526 de 527. Ler do lugar errado zera a origem de todo mundo.
  const { produtos } = normaliza();
  const comConfig = produtos.find(p => p.pdv_codigo_produto === 165);
  assert.equal(comConfig.origem_mercadoria, 0);
});

// ----------------------------------------------------------------- ST

test('sujeito_st só é verdadeiro no CSOSN 500', () => {
  const { produtos } = normaliza();
  const st = produtos.find(p => p.pdv_codigo_produto === 165);
  const semSt = produtos.find(p => p.pdv_codigo_produto === 157);
  assert.equal(st.sujeito_st, true);
  assert.equal(semSt.sujeito_st, false);
});

// -------------------------------------------------------------- trava

test('produto importado nunca nasce liberado para emissão', () => {
  const { produtos } = normaliza();
  assert.ok(produtos.every(p => p.ativo_fiscal === false));
  assert.ok(produtos.every(p => p.sugerido_automaticamente === true));
});

// ------------------------------------------------------------ recusas

test('NCM fora de 8 dígitos é recusado e não vira null silencioso', () => {
  const { produtos, recusados } = normaliza();
  assert.equal(produtos.find(p => p.pdv_codigo_produto === 9001), undefined);
  const r = recusados.find(x => x.codigo === 9001);
  assert.equal(r.campo, 'ncm');
  assert.equal(r.valor, '02');
});

test('CEST fora de 7 dígitos é recusado', () => {
  const { produtos, recusados } = normaliza();
  assert.equal(produtos.find(p => p.pdv_codigo_produto === 9002), undefined);
  assert.equal(recusados.find(x => x.codigo === 9002).campo, 'cest');
});

// ----------------------------------------------------- descontinuados

test('descontinuado só entra se tiver venda', () => {
  const semVenda = normaliza();
  assert.equal(semVenda.produtos.find(p => p.pdv_codigo_produto === 3), undefined);
});

test('produto descontinuado com venda entra inativo', () => {
  const comVenda = normaliza({ codigosVendidos: new Set([3]) });
  const p = comVenda.produtos.find(x => x.pdv_codigo_produto === 3);
  assert.equal(p.ativo, false);
});

test('insumo descontinuado com venda entra inativo', () => {
  const { materiasPrimas } = normaliza({ codigosVendidos: new Set([17]) });
  const p = materiasPrimas.find(x => x.pdv_codigo_produto === 17);
  assert.equal(p.ativo, false);
});

// ------------------------------------------------------------- zeros

test('alíquota de transparência zerada vira null', () => {
  // 0.0000 no Consumer é "não informado", não um valor de zero real. Insumo
  // não tem coluna preco_venda (materias_primas tem preco_alvo_kg), então nem
  // entra nesse objeto — daí o undefined, não um null explícito.
  const { materiasPrimas, produtos } = normaliza({ codigosVendidos: new Set([3]) });

  const salsa = materiasPrimas.find(m => m.pdv_codigo_produto === 16);
  assert.equal(salsa.preco_venda, undefined);
  assert.equal(salsa.custo_unitario, 17.5);

  // Código 3 só entra com codigosVendidos; tem ALIQUOTATRANSPARENCIA 0 e NCM
  // válido, então é ele quem prova que o zero vira null, não um número real.
  const descontinuado = produtos.find(p => p.pdv_codigo_produto === 3);
  assert.equal(descontinuado.aliquota_transparencia, null);

  // 157 tem ALIQUOTATRANSPARENCIA 12 de verdade: confirma que o zero acima
  // não é um bug que também zeraria um valor real.
  const black = produtos.find(p => p.pdv_codigo_produto === 157);
  assert.equal(black.aliquota_transparencia, 12);
});

// Custo e preço são NOT NULL no banco, com default 0. Um null explícito não
// cai no default: é violação de NOT NULL e derruba a carga no primeiro
// insert. Por isso a chave não pode existir quando o Consumer não informa —
// é o que estes dois testes fixam.
test('custo não informado não vira null: a chave nem entra', () => {
  const { produtos, materiasPrimas } = normaliza({ codigosVendidos: new Set([3, 17]) });

  const semCusto = produtos.find(p => p.pdv_codigo_produto === 3);
  assert.ok(!('custo_unitario' in semCusto), 'custo_unitario não devia estar no objeto');

  const insumoSemCusto = materiasPrimas.find(m => m.pdv_codigo_produto === 17);
  assert.ok(!('custo_unitario' in insumoSemCusto), 'insumo sem custo não devia trazer a chave');

  // 157 tem custo real: confirma que a ausência acima não é a chave sumindo
  // para todo mundo.
  const black = produtos.find(p => p.pdv_codigo_produto === 157);
  assert.equal(black.custo_unitario, 12);
});

test('preço não informado ou zerado não vira null: a chave nem entra', () => {
  const { produtos } = normaliza({ codigosVendidos: new Set([3]) });

  const semPreco = produtos.find(p => p.pdv_codigo_produto === 3);
  assert.ok(!('preco_venda' in semPreco), 'preco_venda não devia estar no objeto');

  const black = produtos.find(p => p.pdv_codigo_produto === 157);
  assert.equal(black.preco_venda, 37.9);
});

test('CSOSN 500 sem CEST é recusado, não vira produto com ST sem CEST', () => {
  // produtos_st_exige_cest é um CHECK do banco: sujeito_st sem CEST não entra.
  // Recusar aqui é o que impede a linha de matar a carga lá.
  const linha = {
    CODIGO: 9100, NOME: 'Picanha ST sem CEST', DESCONTINUADO: 'N', CODIGOPRODUTOTIPO: 1,
    NCM: '02013000', CEST: null, ALIQUOTATRANSPARENCIA: 0, UNIDADE: 'kg',
    CATEGORIA: 'Carnes', CFOP: 5405, SITUACAOTRIBUTARIA: '500', ORIGEMMERCADORIA: 0,
    PRECOVENDA: 99.9, PRECOCUSTO: 60,
  };
  const { produtos, recusados } = normaliza({ linhas: [linha] });

  assert.equal(produtos.length, 0);
  const r = recusados.find(x => x.codigo === 9100);
  assert.equal(r.campo, 'cest');
  assert.match(r.motivo, /CSOSN 500/);
});

test('CSOSN 500 com CEST válido continua passando', () => {
  const { produtos } = normaliza();
  const comCest = produtos.find(p => p.pdv_codigo_produto === 165);
  assert.equal(comCest.sujeito_st, true);
  assert.equal(comCest.cest, '1707900');
});
