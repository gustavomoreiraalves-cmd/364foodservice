import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mesCorrente,
  mesesAte,
  mesAnterior,
  div,
  consolidar,
  porEmpresa,
  variacao,
  serie12,
  dominioSerie,
} from '../lib/consolidado.js';

const A = '20000000-0000-0000-0000-00000000000a';
const B = '20000000-0000-0000-0000-00000000000b';

// O PostgREST devolve numeric como string — os testes usam string de propósito.
function linha(over) {
  return {
    empresa_id: A, mes: '2026-07',
    receita_competencia: '0', receita_caixa: '0', cmv: '0',
    pedidos_qtd: '0', itens_qtd: '0',
    produtos_sem_custo: '0', produtos_custo_ficha: '0',
    despesa_competencia: '0', despesa_caixa: '0', compras: '0',
    ...over,
  };
}

test('div devolve 0 quando o denominador é zero', () => {
  assert.equal(div(10, 0), 0);
  assert.equal(div(10, 2), 5);
});

test('mesesAte devolve a quantidade pedida terminando no mês final', () => {
  assert.deepEqual(mesesAte('2026-03', 4), ['2025-12', '2026-01', '2026-02', '2026-03']);
});

test('mesesAte atravessa a virada de ano para trás', () => {
  assert.equal(mesesAte('2026-01', 12)[0], '2025-02');
  assert.equal(mesesAte('2026-01', 12).length, 12);
});

test('mesAnterior atravessa a virada de ano', () => {
  assert.equal(mesAnterior('2026-01'), '2025-12');
  assert.equal(mesAnterior('2026-08'), '2026-07');
});

test('mesCorrente formata AAAA-MM com mês de dois dígitos', () => {
  assert.equal(mesCorrente(new Date(2026, 2, 15)), '2026-03');
});

test('consolidar soma empresas diferentes e converte string em número', () => {
  const t = consolidar([
    linha({ empresa_id: A, receita_competencia: '1000', cmv: '400', pedidos_qtd: '4' }),
    linha({ empresa_id: B, receita_competencia: '500',  cmv: '100', pedidos_qtd: '1' }),
  ]);
  assert.equal(t.receitaCompetencia, 1500);
  assert.equal(t.cmv, 500);
  assert.equal(t.pedidos, 5);
  assert.equal(t.lucroBruto, 1000);
  assert.equal(t.ticketMedio, 300);
});

test('consolidar calcula margem, lucro líquido e saldo de caixa', () => {
  const t = consolidar([linha({
    receita_competencia: '1000', cmv: '400', despesa_competencia: '200',
    receita_caixa: '900', despesa_caixa: '150', compras: '250',
  })]);
  assert.equal(t.margemBrutaPct, 60);
  assert.equal(t.lucroLiquido, 400);
  // 900 de entradas menos 150 de parcelas pagas. As compras (250) são
  // competência e não entram no saldo.
  assert.equal(t.saldoCaixa, 750);
});

// Regressão: o recebimento aprovado vira `compras` (competência, na data do
// recebimento) E uma conta a pagar cuja parcela, quando quitada, vira
// `despesa_caixa`. A fórmula antiga subtraía as duas coisas do mesmo saldo e
// descontava cada compra duas vezes.
test('a mesma compra sai do saldo de caixa uma vez só', () => {
  const semCompra = consolidar([linha({ receita_caixa: '1000', despesa_caixa: '0' })]);
  const comCompraPaga = consolidar([linha({
    receita_caixa: '1000',
    compras: '300',       // recebimento de 300 no mês
    despesa_caixa: '300', // a parcela dessa mesma nota, paga no mês
  })]);
  assert.equal(semCompra.saldoCaixa, 1000);
  assert.equal(comCompraPaga.saldoCaixa, 700);
  assert.equal(semCompra.saldoCaixa - comCompraPaga.saldoCaixa, 300);
  // `compras` continua disponível para a tela mostrar como informação.
  assert.equal(comCompraPaga.compras, 300);
});

test('compra ainda não paga não mexe no saldo de caixa', () => {
  const t = consolidar([linha({ receita_caixa: '1000', compras: '300', despesa_caixa: '0' })]);
  assert.equal(t.saldoCaixa, 1000);
});

test('consolidar sem linhas devolve zeros, não NaN', () => {
  const t = consolidar([]);
  assert.equal(t.receitaCompetencia, 0);
  assert.equal(t.margemBrutaPct, 0);
  assert.equal(t.ticketMedio, 0);
});

test('ticket médio com zero pedidos devolve 0', () => {
  const t = consolidar([linha({ receita_competencia: '1000', pedidos_qtd: '0' })]);
  assert.equal(t.ticketMedio, 0);
});

test('porEmpresa mantém empresa sem movimento e calcula participação', () => {
  const empresas = [{ id: A, nome: 'Food Service' }, { id: B, nome: 'Steakhouse' }];
  const r = porEmpresa([linha({ empresa_id: A, receita_competencia: '800' })], empresas);
  assert.equal(r.length, 2);
  assert.equal(r[0].nome, 'Food Service');
  assert.equal(r[0].participacaoPct, 100);
  assert.equal(r[1].nome, 'Steakhouse');
  assert.equal(r[1].receitaCompetencia, 0);
  assert.equal(r[1].participacaoPct, 0);
});

test('porEmpresa ordena por receita decrescente', () => {
  const empresas = [{ id: A, nome: 'Food Service' }, { id: B, nome: 'Steakhouse' }];
  const r = porEmpresa([
    linha({ empresa_id: A, receita_competencia: '100' }),
    linha({ empresa_id: B, receita_competencia: '900' }),
  ], empresas);
  assert.equal(r[0].nome, 'Steakhouse');
  assert.equal(r[0].participacaoPct, 90);
});

test('variacao devolve null quando a base é zero', () => {
  assert.equal(variacao(500, 0), null);
});

test('variacao usa o módulo da base para não inverter o sinal', () => {
  assert.equal(variacao(150, 100), 50);
  assert.equal(variacao(-50, -100), 50);
});

test('serie12 devolve doze posições e preenche mês sem movimento com zero', () => {
  const s = serie12([linha({ mes: '2026-07', receita_competencia: '300' })], '2026-08');
  assert.equal(s.length, 12);
  assert.equal(s[11].mes, '2026-08');
  assert.equal(s[11].receitaCompetencia, 0);
  assert.equal(s[10].mes, '2026-07');
  assert.equal(s[10].receitaCompetencia, 300);
});

test('dominioSerie sempre inclui o zero e acomoda lucro negativo', () => {
  const s = serie12([
    linha({ mes: '2026-08', receita_competencia: '100', cmv: '400', despesa_competencia: '200' }),
  ], '2026-08');
  const d = dominioSerie(s);
  assert.equal(d.max >= 600, true);   // custo total = cmv + despesa
  assert.equal(d.min <= -500, true);  // lucro líquido = 100 - 400 - 200
});

test('dominioSerie sem dados não devolve intervalo degenerado', () => {
  const d = dominioSerie([]);
  assert.equal(d.min, 0);
  assert.equal(d.max, 1);
});
