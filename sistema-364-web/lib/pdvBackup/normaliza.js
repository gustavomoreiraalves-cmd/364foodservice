// Transforma as linhas do backup Firebird (consultas.js) nas MESMAS formas que
// o importador v1 entrega ao contrato `banco` (ver lib/pdvConsumer/importar.js):
// {pedido, itens, pagamentos}, {caixa, movimentos}, recebimento e item_dia, com
// os nomes de coluna da migração 32. Só funções puras — nada de rede nem banco.
//
// Fuso: o Firebird guarda hora local de Porto Velho (UTC-4, sem horário de
// verão) sem marcação de fuso; o instante real é o valor + 4 h. `FUSO_MS` vem
// do v1 para não haver duas verdades sobre isso.
//
// Charset: as strings chegam já decodificadas pelo driver; aqui só se lê.
import { FUSO_MS } from '../pdvConsumer/parse.js';
import { classificaTipo, classificaForma, separaMeio } from '../pdvConsumer/normaliza.js';

// O `node-firebird` devolve TIMESTAMP como Date montado com os componentes de
// parede no fuso do processo; ler esses mesmos componentes de volta reproduz a
// hora que está gravada, seja qual for o TZ da máquina. Strings
// ('AAAA-MM-DD HH:MM:SS.mmm') também são aceitas, que é o formato das fixtures.
function partes(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return [valor.getFullYear(), valor.getMonth() + 1, valor.getDate(),
      valor.getHours(), valor.getMinutes(), valor.getSeconds(), valor.getMilliseconds()];
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(String(valor));
  if (!m) return null;
  return [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0];
}

export function dataFirebird(valor) {
  const p = partes(valor);
  if (!p) return null;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5], p[6]) + FUSO_MS);
}

// Dia local (o que a tela chama de dia da venda): é a própria data de parede,
// sem conversão nenhuma — por isso não passa por `dataFirebird`.
export function diaFirebird(valor) {
  const p = partes(valor);
  if (!p) return null;
  return `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`;
}

const iso = d => (d ? d.toISOString() : null);
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const texto = v => {
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  return s || null;
};
const arredonda = (v, casas = 2) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  return Number(Number(v).toFixed(casas));
};

// O tipo do pedido não sai de `PEDIDOMESAS` nem de `NUMEROMESA` (a tabela está
// vazia e a coluna é sempre nula nesta base): quem separa mesa de balcão é a
// `TAG` — `M-*` é mesa/comanda, `D` é balcão ou delivery. Devolve o mesmo texto
// que o painel Connect mostrava, para `classificaTipo` continuar valendo.
export function tipoOriginalFb(linha) {
  const tag = (linha.TAG || '').toUpperCase();
  if (tag.startsWith('M')) return 'Mesas/Comandas';
  return linha.TEM_DELIVERY ? 'Delivery' : 'Balcão';
}

function statusPedido(linha) {
  if (linha.DATADELETE) return 'Excluído';
  return linha.DATAFECHAMENTO ? 'Finalizado' : 'Em Aberto';
}

export function normalizaPedidoFb({ linhaPedido, itens = [], pagamentos = [], empresaId }) {
  const tipoOriginal = tipoOriginalFb(linhaPedido);
  const abertoEm = dataFirebird(linhaPedido.DATAABERTURA);
  const numero = num(linhaPedido.NUMERO);
  const pedido = {
    empresa_id: empresaId,
    codigo: Number(linhaPedido.CODIGO),
    // O backup não conhece o ID interno do Connect; a chave natural é o código.
    id_connect: null,
    tipo: classificaTipo(tipoOriginal),
    tipo_original: tipoOriginal,
    origem: texto(linhaPedido.ORIGEM_DESCRICAO),
    status: statusPedido(linhaPedido),
    finalizado: Boolean(linhaPedido.DATAFECHAMENTO) && !linhaPedido.DATADELETE,
    cliente: texto(linhaPedido.CLIENTE),
    // Número 0 é "sem número" (delivery e balcão), como no painel.
    numero: numero ? numero : null,
    colaborador: texto(linhaPedido.COLABORADOR),
    qtd_itens: num(linhaPedido.QTD_ITENS),
    valor_total: Number(linhaPedido.VALORTOTAL || 0),
    valor_itens: num(linhaPedido.VALORTOTALITENS),
    valor_desconto: num(linhaPedido.TOTALDESCONTO),
    valor_entrega: num(linhaPedido.VALORENTREGA),
    valor_servico: num(linhaPedido.TOTALSERVICO),
    // `TOTALACRESCIMO` no Firebird é o somatório dos acréscimos (serviço +
    // entrega), não um acréscimo avulso: gravá-lo aqui contaria duas vezes o
    // que já está em `valor_servico`/`valor_entrega`. Fica no `origem_raw`.
    valor_acrescimo: null,
    aberto_em: iso(abertoEm),
    fechado_em: iso(dataFirebird(linhaPedido.DATAFECHAMENTO)),
    dia_venda: diaFirebird(linhaPedido.DATAABERTURA),
    excluido_em: iso(dataFirebird(linhaPedido.DATADELETE)),
    origem_raw: linhaPedido,
    // Não há HTML de painel no caminho do backup.
    origem_html: null,
  };

  const ordenados = [...itens].sort((a, b) => Number(a.CODIGO) - Number(b.CODIGO));
  const posicaoPorCodigo = new Map(ordenados.map((i, idx) => [Number(i.CODIGO), idx + 1]));
  const itensOut = ordenados.map((i, idx) => ({
    empresa_id: empresaId,
    posicao: idx + 1,
    nome: i.NOMEPRODUTO,
    observacao: texto(i.DETALHES),
    quantidade: Number(i.QUANTIDADE || 0),
    preco_unitario: num(i.VALORUNITARIO),
    // `VALORITEM` é o valor da linha; `VALORTOTAL` do pai já embute os filhos.
    valor: num(i.VALORITEM),
    item_pai_posicao: i.CODIGOPAI ? (posicaoPorCodigo.get(Number(i.CODIGOPAI)) ?? null) : null,
    eh_combo: false,
  }));
  // Pai que tem filho é combo/personalizado — marcado depois de mapear todos.
  for (const it of itensOut) {
    if (it.item_pai_posicao) itensOut[it.item_pai_posicao - 1].eh_combo = true;
  }

  const pagamentosOut = [...pagamentos]
    .sort((a, b) => Number(a.CODIGO) - Number(b.CODIGO))
    .map((p, idx) => ({
      empresa_id: empresaId,
      posicao: idx + 1,
      valor: num(p.VALOR),
      forma: texto(p.FORMA),
      operadora: texto(p.OPERADORA),
      forma_grupo: classificaForma(p.FORMA, p.OPERADORA),
      pago_em: iso(dataFirebird(p.DATAPAGAMENTO)),
    }));

  return { pedido, itens: itensOut, pagamentos: pagamentosOut };
}

// Nomes das operações de `CAIXAOPERACAO.TIPO`. O estorno (E) fica de fora dos
// movimentos de propósito: ele acompanha um pagamento que já saiu da conta por
// `DATADELETE`, então lançá-lo como saída baixaria o valor duas vezes. Conferido
// em 9 caixas: saldo inicial + pagamentos vivos + suprimentos − sangrias e
// despesas bate exatamente com `CAIXA.SALDOFINAL` (caixa 1561 = 7.902,13).
const OPERACAO = { A: 'Suprimento', S: 'Sangria', D: 'Despesa' };

function movimentosDeCaixa({ linhaCaixa, pagamentos, operacoes, empresaId }) {
  const movimentos = [];
  const abertura = dataFirebird(linhaCaixa.DATAABERTURA);
  movimentos.push({
    operacao: 'Abertura',
    origem: 'Caixa',
    pedido_codigo: null,
    momento: abertura,
    entrada: num(linhaCaixa.SALDOINICIAL),
    saida: null,
    forma: 'Diversos',
    operadora: null,
    observacao: null,
  });

  for (const p of pagamentos) {
    const codigo = p.CODIGOPEDIDO === null || p.CODIGOPEDIDO === undefined ? null : Number(p.CODIGOPEDIDO);
    movimentos.push({
      operacao: 'Recebimento',
      origem: codigo ? `Pedido ${codigo}` : 'Caixa',
      pedido_codigo: codigo,
      momento: dataFirebird(p.DATAPAGAMENTO),
      entrada: num(p.VALOR),
      saida: null,
      forma: texto(p.FORMA),
      operadora: texto(p.OPERADORA),
      observacao: texto(p.OBSERVACAO),
    });
  }

  for (const o of operacoes) {
    const operacao = OPERACAO[(o.TIPO || '').toUpperCase()];
    if (!operacao) continue;
    // `CAIXAOPERACAO` só tem a forma de pagamento em texto; `separaMeio` é o
    // mesmo divisor usado no v1 caso venha com a operadora colada.
    const { forma, operadora } = separaMeio(o.FORMA);
    movimentos.push({
      operacao,
      origem: 'Caixa',
      pedido_codigo: null,
      momento: dataFirebird(o.DATAOPERACAO),
      entrada: num(o.VALORENTRADA),
      saida: num(o.VALORSAIDA),
      forma,
      operadora,
      observacao: texto(o.OBSERVACAO),
    });
  }

  return movimentos
    .sort((a, b) => (a.momento?.getTime() ?? 0) - (b.momento?.getTime() ?? 0))
    .map((m, idx) => ({
      empresa_id: empresaId,
      posicao: idx + 1,
      operacao: m.operacao,
      origem: m.origem,
      pedido_codigo: m.pedido_codigo,
      momento: iso(m.momento),
      entrada: m.entrada,
      saida: m.saida,
      forma: m.forma,
      operadora: m.operadora,
      forma_grupo: classificaForma(m.forma, m.operadora),
      observacao: m.observacao,
    }));
}

export function normalizaCaixaFb({ linhaCaixa, pagamentos = [], operacoes = [], empresaId }) {
  const status = linhaCaixa.DATAFECHAMENTO ? 'Fechado' : 'Aberto';
  const movimentos = movimentosDeCaixa({ linhaCaixa, pagamentos, operacoes, empresaId });
  const dinheiro = movimentos
    .filter(m => m.forma_grupo === 'dinheiro' || m.operacao === 'Abertura')
    .reduce((s, m) => s + (m.entrada || 0) - (m.saida || 0), 0);

  const caixa = {
    empresa_id: empresaId,
    codigo: Number(linhaCaixa.CODIGO),
    id_connect: null,
    usuario: texto(linhaCaixa.USUARIO),
    status,
    aberto_em: iso(dataFirebird(linhaCaixa.DATAABERTURA)),
    fechado_em: iso(dataFirebird(linhaCaixa.DATAFECHAMENTO)),
    dia_caixa: diaFirebird(linhaCaixa.DATAABERTURA),
    saldo_inicial: num(linhaCaixa.SALDOINICIAL),
    // Caixa aberto ainda não tem saldo final — mesma regra do v1.
    saldo_final: status === 'Fechado' ? num(linhaCaixa.SALDOFINAL) : null,
    total_dinheiro: arredonda(dinheiro),
    observacao: texto(linhaCaixa.OBSERVACAO),
    origem_raw: linhaCaixa,
    origem_html: null,
  };
  return { caixa, movimentos };
}

export function normalizaRecebimentoFb(linha, empresaId) {
  const valor = Number(linha.VALOR || 0);
  return {
    empresa_id: empresaId,
    pedido_codigo: num(linha.CODIGOPEDIDO),
    caixa_codigo: num(linha.CODIGOCAIXA),
    categoria: texto(linha.CATEGORIA),
    forma: texto(linha.FORMA),
    operadora: texto(linha.OPERADORA),
    forma_grupo: classificaForma(linha.FORMA, linha.OPERADORA),
    valor,
    // O backup não traz o líquido nem a taxa da credenciadora (vinham do
    // Connect): grava-se bruto = líquido e taxa nula, como decidido no spec.
    valor_liquido: valor,
    percentual_taxa: null,
    parcela: num(linha.NROPARCELA),
    pago_em: iso(dataFirebird(linha.DATAPAGAMENTO)),
    dia_pagamento: diaFirebird(linha.DATAPAGAMENTO),
    credito_em: diaFirebird(linha.DATACREDITO),
    observacao: texto(linha.OBSERVACAO),
    origem_raw: linha,
  };
}

// Agrega o que depende do conjunto do dia. A soma por dia × produto já vem
// pronta do SQL (`SQL_ITENS_DIA`); aqui saem lucro, margem, participação e
// curva ABC, que precisam do total do dia inteiro.
//
// ABC: itens em ordem decrescente de lucro; enquanto o acumulado ANTES do item
// não passa de 80 % ele é A, até 95 % é B, o resto é C. Dia sem lucro (só
// custo) fica todo em C, com participação zero. A tela recalcula o ABC do
// período que estiver na fita, então isto aqui é só o retrato do dia.
export function itensDiaFb(linhas, empresaId) {
  const porDia = new Map();
  const saida = linhas.map(l => {
    const dia = typeof l.DIA === 'string' ? l.DIA.slice(0, 10) : diaFirebird(l.DIA);
    const valorVendido = arredonda(l.VALOR_VENDIDO) ?? 0;
    const custo = arredonda(l.CUSTO) ?? 0;
    const quantidade = Number(l.QUANTIDADE || 0);
    const lucro = arredonda(valorVendido - custo);
    const item = {
      empresa_id: empresaId,
      dia,
      codigo_produto: num(l.CODIGO_PRODUTO),
      codigo_detalhe: Number(l.CODIGO_DETALHE),
      nome: l.NOME,
      categoria: texto(l.CATEGORIA),
      quantidade,
      valor_vendido: valorVendido,
      preco_venda: num(l.PRECO_VENDA),
      preco_custo: num(l.PRECO_CUSTO),
      custo_medio: quantidade ? arredonda(custo / quantidade) : null,
      lucro,
      margem: valorVendido ? arredonda((lucro / valorVendido) * 100) : null,
      participacao_lucro: 0,
      curva_abc: 'C',
      origem_raw: l,
    };
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(item);
    return item;
  });

  for (const itens of porDia.values()) {
    const totalLucro = itens.reduce((s, i) => s + i.lucro, 0);
    if (totalLucro <= 0) continue;
    let acumulado = 0;
    for (const i of [...itens].sort((a, b) => b.lucro - a.lucro)) {
      const pct = (i.lucro / totalLucro) * 100;
      i.participacao_lucro = arredonda(pct, 4);
      i.curva_abc = acumulado < 80 ? 'A' : acumulado < 95 ? 'B' : 'C';
      acumulado += pct;
    }
  }

  return saida;
}
