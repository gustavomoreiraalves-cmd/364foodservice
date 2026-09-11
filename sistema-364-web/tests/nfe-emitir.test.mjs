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
//   1. a guarda de status (pedido.status !== 'Conferido') roda ANTES de
//      qualquer coisa — nem toca em `sb`;
//   2. quantidadesAlocadasPorItem (exportada de emitir.js pelo mesmo motivo de
//      linhaItem: pura, sem sb, sem rede) é o ponto exato que decide se um
//      item do pedido entra ou não em itensParaResolver — testada
//      isoladamente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emitirNfe, quantidadesAlocadasPorItem } from '../lib/nfe/emitir.js';

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
