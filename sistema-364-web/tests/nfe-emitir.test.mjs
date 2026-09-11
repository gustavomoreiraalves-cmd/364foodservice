// tests/nfe-emitir.test.mjs
//
// emitir.js (Task 11) agora exige `expedicao` e só emite a partir de um
// pedido 'Conferido' (romaneio finalizado). Um teste de integração completo
// (até a SEFAZ) não é viável aqui: obterCertificadoAtivo importa
// pontoServer.js, que puxa next/server (não resolve em `node --test`) e usa
// clienteAdmin() sobre o Supabase do .env.local de desenvolvimento — que
// aponta para produção. Por isso este arquivo cobre só o que dá pra exercitar
// com segurança, sem rede:
//
//   1. as guardas de entrada (pedido.status !== 'Conferido', expedicao
//      ausente) rodam ANTES de qualquer coisa — nem tocam em `sb`;
//   2. quantidadesAlocadasPorItem (exportada de emitir.js pelo mesmo motivo de
//      linhaItem: pura, sem sb, sem rede) é o ponto exato que decide se um
//      item do pedido entra ou não em itensParaResolver — testada
//      isoladamente;
//   3. registrarFaturamentoDoPedido (também exportada pelo mesmo motivo — é o
//      código do sucesso 9a que não dá pra alcançar via uma chamada completa
//      a emitirNfe) cobre o avanço do pedido para Faturado e a
//      conta a receber/parcela condicionadas a gera_financeiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emitirNfe, quantidadesAlocadasPorItem, registrarFaturamentoDoPedido } from '../lib/nfe/emitir.js';

// Proxy que explode em qualquer acesso — prova que a guarda de status não
// consulta `sb` (nenhuma query, nenhum rpc, nenhuma chamada de rede) antes de
// rejeitar. Um mock "silencioso" (que apenas não faz nada) não provaria isso:
// só falharia depois, tarde demais, se algum dia alguém mover a guarda pra
// depois de uma consulta.
const SB_PROIBIDO = new Proxy({}, {
  get(_alvo, propriedade) {
    throw new Error(`sb.${String(propriedade)} não deveria ter sido chamado antes da guarda de status`);
  },
});

test('emitirNfe: pedido fora de "Conferido" é rejeitado antes de qualquer chamada a sb (nenhuma query, nenhuma rede)', async () => {
  await assert.rejects(
    () => emitirNfe({
      sb: SB_PROIBIDO,
      pedido: { id: 'p1', status: 'Pendente', empresa_id: 'e1', cliente_id: 'c1' },
      expedicao: { transportadora: null, caixas: [] },
      naturezaOperacaoId: 'n1',
      userId: 'u1',
    }),
    /Conferido/,
  );
});

test('emitirNfe: pedido "Faturado" (status antigo do gatilho manual) também é rejeitado — só "Conferido" emite agora', async () => {
  await assert.rejects(
    () => emitirNfe({
      sb: SB_PROIBIDO,
      pedido: { id: 'p1', status: 'Faturado', empresa_id: 'e1', cliente_id: 'c1' },
      expedicao: { transportadora: null, caixas: [] },
      naturezaOperacaoId: 'n1',
      userId: 'u1',
    }),
    /Conferido/,
  );
});

test('emitirNfe: pedido "Conferido" sem expedição correspondente é rejeitado antes de qualquer chamada a sb (nenhuma query, nenhuma rede, nenhum certificado)', async () => {
  await assert.rejects(
    () => emitirNfe({
      sb: SB_PROIBIDO,
      pedido: { id: 'p1', status: 'Conferido', empresa_id: 'e1', cliente_id: 'c1' },
      expedicao: undefined,
      naturezaOperacaoId: 'n1',
      userId: 'u1',
    }),
    /expedi[çc][ãa]o/i,
  );
});

test('emitirNfe: expedição sem `caixas` (formato inesperado) também é rejeitada antes de qualquer chamada a sb', async () => {
  await assert.rejects(
    () => emitirNfe({
      sb: SB_PROIBIDO,
      pedido: { id: 'p1', status: 'Conferido', empresa_id: 'e1', cliente_id: 'c1' },
      expedicao: { transportadora: null }, // sem `caixas`
      naturezaOperacaoId: 'n1',
      userId: 'u1',
    }),
    /expedi[çc][ãa]o/i,
  );
});

test('quantidadesAlocadasPorItem: item sem nenhuma caixa correspondente não aparece no mapa (fica de fora de itensParaResolver)', () => {
  const expedicao = {
    caixas: [
      { peso_bruto_kg: 5, itens: [{ pedido_item_id: 'i1', quantidade: 3 }] },
    ],
  };
  const mapa = quantidadesAlocadasPorItem(expedicao);
  assert.equal(mapa.get('i1'), 3);
  // i2 nunca foi alocado em nenhuma caixa — o loop de itensParaResolver em
  // emitir.js usa `mapa.get(pedidoItem.id) || 0` e depois
  // `if (!(quantidadeAlocada > 0)) continue`, então undefined aqui é
  // exatamente o que faz o item ser pulado, sem entrar na nota.
  assert.equal(mapa.get('i2'), undefined);
  assert.equal(mapa.get('i2') || 0, 0);
});

test('quantidadesAlocadasPorItem: soma alocações do mesmo item espalhadas em caixas diferentes', () => {
  const expedicao = {
    caixas: [
      { peso_bruto_kg: 2, itens: [{ pedido_item_id: 'i1', quantidade: 2 }] },
      { peso_bruto_kg: 3, itens: [{ pedido_item_id: 'i1', quantidade: 4 }, { pedido_item_id: 'i2', quantidade: 1 }] },
    ],
  };
  const mapa = quantidadesAlocadasPorItem(expedicao);
  assert.equal(mapa.get('i1'), 6);
  assert.equal(mapa.get('i2'), 1);
});

test('quantidadesAlocadasPorItem: expedição sem caixas produz mapa vazio — nenhum item entraria na nota', () => {
  const mapa = quantidadesAlocadasPorItem({ caixas: [] });
  assert.equal(mapa.size, 0);
});

// ---------------------------------------------------------------------
// registrarFaturamentoDoPedido — o código do sucesso 9a (pedido → Faturado
// e conta a receber/parcela). Dublê mínimo de sb: só update/insert/eq/
// select/single, que é tudo que a função usa — mesmo espírito do dublê já
// usado em tests/parceiro.test.mjs.
// ---------------------------------------------------------------------
function criarSbFaturamento(banco, { falharEm = new Set() } = {}) {
  let proximoId = 1;
  function builder(tabela) {
    const estado = {};
    const chain = {
      update: valores => { estado.op = 'update'; estado.valores = valores; return chain; },
      insert: linhas => { estado.op = 'insert'; estado.linhas = linhas; return chain; },
      eq: (campo, valor) => { estado.eqCampo = campo; estado.eqValor = valor; return chain; },
      select: () => chain,
      single: () => executar(),
      then: (resolve, reject) => executar().then(resolve, reject),
    };
    async function executar() {
      if (falharEm.has(tabela)) {
        return { data: null, error: { message: `falha simulada em ${tabela}` } };
      }
      if (estado.op === 'update') {
        const linha = (banco[tabela] || []).find(l => l[estado.eqCampo] === estado.eqValor);
        if (linha) Object.assign(linha, estado.valores);
        return { data: linha || null, error: null };
      }
      if (estado.op === 'insert') {
        const linha = { id: `${tabela}-${proximoId++}`, ...estado.linhas[0] };
        banco[tabela] = banco[tabela] || [];
        banco[tabela].push(linha);
        return { data: linha, error: null };
      }
      return { data: null, error: null };
    }
    return chain;
  }
  return { from: builder };
}

const PEDIDO_FATURAR = { id: 'p1', empresa_id: 'e1', cliente_id: 'c1' };
const CLIENTE_FATURAR = { nome: 'Supermercado Manar' };
const DOCUMENTO_FATURAR = { id: 'doc1' };

function entradaFaturar(overrides = {}) {
  return {
    pedido: PEDIDO_FATURAR,
    natureza: { gera_financeiro: true },
    numero: 42,
    protocolo: '135260000000001',
    chave: '11223344556677889900112233445566778899001122',
    dataEmissao: new Date('2026-09-10T18:00:00.000Z'),
    valorTotal: 255.5,
    documento: DOCUMENTO_FATURAR,
    cliente: CLIENTE_FATURAR,
    ...overrides,
  };
}

test('registrarFaturamentoDoPedido: gera_financeiro=true avança o pedido e cria a conta a receber e a parcela', async () => {
  const banco = { pedidos: [{ id: 'p1', status: 'Conferido' }], contas_a_receber: [], contas_a_receber_parcelas: [] };
  const sb = criarSbFaturamento(banco);
  await registrarFaturamentoDoPedido(sb, entradaFaturar());

  assert.equal(banco.pedidos[0].status, 'Faturado');

  assert.equal(banco.contas_a_receber.length, 1);
  const conta = banco.contas_a_receber[0];
  // Campos conferidos contra supabase/atualizacao_51_contas_a_receber.sql.
  assert.equal(conta.descricao, 'NF-e 42 — Supermercado Manar');
  assert.equal(conta.cliente_id, 'c1');
  assert.equal(conta.pedido_id, 'p1');
  assert.equal(conta.nfe_saida_documento_id, 'doc1');
  assert.equal(conta.valor_total, 255.5);
  assert.equal(conta.empresa_id, 'e1');

  assert.equal(banco.contas_a_receber_parcelas.length, 1);
  const parcela = banco.contas_a_receber_parcelas[0];
  assert.equal(parcela.conta_a_receber_id, conta.id);
  assert.equal(parcela.numero, 1);
  assert.equal(parcela.valor, 255.5);
  assert.equal(parcela.empresa_id, 'e1');
});

test('registrarFaturamentoDoPedido: gera_financeiro=false avança o pedido mas NÃO cria conta nem parcela', async () => {
  const banco = { pedidos: [{ id: 'p1', status: 'Conferido' }], contas_a_receber: [], contas_a_receber_parcelas: [] };
  const sb = criarSbFaturamento(banco);
  await registrarFaturamentoDoPedido(sb, entradaFaturar({ natureza: { gera_financeiro: false } }));

  assert.equal(banco.pedidos[0].status, 'Faturado', 'o pedido avança pra Faturado mesmo sem gerar financeiro');
  assert.equal(banco.contas_a_receber.length, 0);
  assert.equal(banco.contas_a_receber_parcelas.length, 0);
});

// Achado da revisão (Importante I2): vencimento precisa ser a data LOCAL de
// emissão (America/Porto_Velho, UTC-4), não a data UTC de
// dataEmissao.toISOString(). 2026-09-11T02:00:00Z é 2026-09-10 22:00 em
// Porto Velho — toISOString().slice(0,10) devolveria '2026-09-11' (dia
// seguinte, errado); o vencimento tem que sair '2026-09-10'.
test('registrarFaturamentoDoPedido: vencimento da parcela usa a data local do emitente (America/Porto_Velho), não a data UTC', async () => {
  const banco = { pedidos: [{ id: 'p1', status: 'Conferido' }], contas_a_receber: [], contas_a_receber_parcelas: [] };
  const sb = criarSbFaturamento(banco);
  await registrarFaturamentoDoPedido(sb, entradaFaturar({ dataEmissao: new Date('2026-09-11T02:00:00.000Z') }));

  assert.equal(banco.contas_a_receber_parcelas[0].vencimento, '2026-09-10');
});

test('registrarFaturamentoDoPedido: falha ao avançar o pedido lança nomeando protocolo e chave, e não tenta criar a conta', async () => {
  const banco = { pedidos: [{ id: 'p1', status: 'Conferido' }], contas_a_receber: [], contas_a_receber_parcelas: [] };
  const sb = criarSbFaturamento(banco, { falharEm: new Set(['pedidos']) });
  await assert.rejects(
    () => registrarFaturamentoDoPedido(sb, entradaFaturar()),
    /135260000000001.*Atualize o status manualmente|Atualize o status manualmente.*135260000000001/is,
  );
  assert.equal(banco.contas_a_receber.length, 0);
});

test('registrarFaturamentoDoPedido: falha ao gravar a conta a receber lança dizendo que a nota já está autorizada e o pedido já avançou', async () => {
  const banco = { pedidos: [{ id: 'p1', status: 'Conferido' }], contas_a_receber: [], contas_a_receber_parcelas: [] };
  const sb = criarSbFaturamento(banco, { falharEm: new Set(['contas_a_receber']) });
  await assert.rejects(
    () => registrarFaturamentoDoPedido(sb, entradaFaturar()),
    /autorizada.*Faturado.*Lance manualmente em Financeiro/is,
  );
  assert.equal(banco.pedidos[0].status, 'Faturado', 'o pedido já tinha avançado antes da conta falhar');
});
