// =========================================================
// 364 OS — importação diária das vendas do PDV Consumer.
//
// Lê o painel Consumer Connect com o cookie de uma sessão aberta no navegador
// (CONSUMER_CONNECT_COOKIE no .env.local) e grava nas tabelas pdv_* do
// Supabase com a service role. Reprocessa uma janela (padrão: D-3 até hoje)
// com upsert, então rodar de novo nunca duplica.
//
// Uso:
//   node scripts/importar-pdv-consumer.mjs                 # janela padrão, todas as lojas
//   node scripts/importar-pdv-consumer.mjs --de 2026-08-01 --ate 2026-08-23
//   node scripts/importar-pdv-consumer.mjs --loja -2147458165
//   node scripts/importar-pdv-consumer.mjs --dry-run        # só conta, não grava
// Detalhes: scripts/IMPORTACAO-PDV.md
// =========================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { criarClienteConnect, SessaoExpiradaError } from '../lib/pdvConsumer/connect.js';
import { importarLoja } from '../lib/pdvConsumer/importar.js';
import { FUSO_MS } from '../lib/pdvConsumer/parse.js';

// Carrega .env.local sem depender de pacote: linha CHAVE=valor, aspas opcionais.
function carregarEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const linhaBruta of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const linha = linhaBruta.replace(/\r$/, '');
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith('#')) continue;
    let v = m[2].trimEnd();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
carregarEnv(path.resolve(process.cwd(), '.env.local'));

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : padrao;
}
const dryRun = process.argv.includes('--dry-run');
const hojeLocal = new Date(Date.now() - FUSO_MS).toISOString().slice(0, 10);
const janelaDias = Number(process.env.PDV_JANELA_DIAS || 3);
const de = arg('--de', new Date(new Date(hojeLocal + 'T00:00:00Z').getTime() - janelaDias * 86400000).toISOString().slice(0, 10));
const ate = arg('--ate', hojeLocal);
const somenteLoja = arg('--loja', null);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cookie = process.env.CONSUMER_CONNECT_COOKIE;
if (!url || !chave) { console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.'); process.exit(1); }
if (!cookie) { console.error('ERRO: CONSUMER_CONNECT_COOKIE não definido. Veja scripts/IMPORTACAO-PDV.md.'); process.exit(1); }

const sb = createClient(url, chave, { auth: { persistSession: false } });
const falhou = (erro, ctx) => { if (erro) throw new Error(`${ctx}: ${erro.message}`); };

// Implementação do contrato de banco usado por importarLoja (ver lib/pdvConsumer/importar.js).
function bancoSupabase() {
  return {
    async pedidosExistentes(empresaId, codigos) {
      const mapa = new Map();
      for (let i = 0; i < codigos.length; i += 500) {
        const { data, error } = await sb.from('pdv_pedidos')
          .select('id, codigo, status, valor_total, excluido_em, fechado_em')
          .eq('empresa_id', empresaId).in('codigo', codigos.slice(i, i + 500));
        falhou(error, 'pedidosExistentes');
        for (const p of data || []) mapa.set(p.codigo, p);
      }
      return mapa;
    },
    async gravarPedido({ pedido, itens, pagamentos }) {
      const { data, error } = await sb.from('pdv_pedidos').upsert(pedido, { onConflict: 'empresa_id,codigo' }).select('id').single();
      falhou(error, `gravarPedido ${pedido.codigo}`);
      const pedidoId = data.id;
      falhou((await sb.from('pdv_pedido_itens').delete().eq('pedido_id', pedidoId)).error, 'apagar itens');
      falhou((await sb.from('pdv_pagamentos').delete().eq('pedido_id', pedidoId)).error, 'apagar pagamentos');
      if (itens.length) falhou((await sb.from('pdv_pedido_itens').insert(itens.map(i => ({ ...i, pedido_id: pedidoId })))).error, 'inserir itens');
      if (pagamentos.length) falhou((await sb.from('pdv_pagamentos').insert(pagamentos.map(p => ({ ...p, pedido_id: pedidoId })))).error, 'inserir pagamentos');
    },
    async caixasExistentes(empresaId, codigos) {
      const mapa = new Map();
      for (let i = 0; i < codigos.length; i += 500) {
        const { data, error } = await sb.from('pdv_caixas')
          .select('id, codigo, status')
          .eq('empresa_id', empresaId).in('codigo', codigos.slice(i, i + 500));
        falhou(error, 'caixasExistentes');
        for (const c of data || []) mapa.set(c.codigo, c);
      }
      return mapa;
    },
    async gravarCaixa({ caixa, movimentos }) {
      const { data, error } = await sb.from('pdv_caixas').upsert(caixa, { onConflict: 'empresa_id,codigo' }).select('id').single();
      falhou(error, `gravarCaixa ${caixa.codigo}`);
      falhou((await sb.from('pdv_caixa_movimentos').delete().eq('caixa_id', data.id)).error, 'apagar movimentos');
      if (movimentos.length) falhou((await sb.from('pdv_caixa_movimentos').insert(movimentos.map(m => ({ ...m, caixa_id: data.id })))).error, 'inserir movimentos');
    },
    async gravarRecebimentos(linhas) {
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await sb.from('pdv_recebimentos').upsert(linhas.slice(i, i + 500), {
          onConflict: 'empresa_id,pedido_codigo,caixa_codigo,forma,operadora,valor,pago_em', ignoreDuplicates: false,
        });
        falhou(error, 'gravarRecebimentos');
      }
    },
    async substituirItensDia(empresaId, dia, linhas) {
      falhou((await sb.from('pdv_vendas_itens_dia').delete().eq('empresa_id', empresaId).eq('dia', dia)).error, 'apagar itens do dia');
      if (linhas.length) falhou((await sb.from('pdv_vendas_itens_dia').insert(linhas)).error, 'inserir itens do dia');
    },
  };
}

// Em --dry-run o banco só conta; nada é escrito.
function bancoSeco() {
  return {
    async pedidosExistentes() { return new Map(); },
    async gravarPedido() {},
    async caixasExistentes() { return new Map(); },
    async gravarCaixa() {},
    async gravarRecebimentos() {},
    async substituirItensDia() {},
  };
}

async function main() {
  const { data: lojas, error } = await sb.from('pdv_lojas').select('id_connect, empresa_id, nome_connect').eq('ativo', true);
  falhou(error, 'pdv_lojas');
  const alvo = somenteLoja ? lojas.filter(l => String(l.id_connect) === String(somenteLoja)) : lojas;
  if (!alvo.length) { console.error('Nenhuma loja ativa em pdv_lojas.'); process.exit(1); }

  console.log(`Importação PDV Consumer — ${de} a ${ate}${dryRun ? ' (dry-run)' : ''}`);
  const cliente = criarClienteConnect({ cookie });
  const banco = dryRun ? bancoSeco() : bancoSupabase();
  let statusGeral = 'ok';

  for (const loja of alvo) {
    console.log(`\n${loja.nome_connect}`);
    let logId = null;
    if (!dryRun) {
      const { data, error } = await sb.from('pdv_importacoes').insert({ empresa_id: loja.empresa_id, janela_inicio: de, janela_fim: ate }).select('id').single();
      falhou(error, 'pdv_importacoes insert');
      logId = data?.id;
    }
    try {
      const r = await importarLoja({ cliente, banco, loja, de, ate, log: m => console.log(m) });
      console.log(`  gravados: ${r.pedidos} pedidos, ${r.caixas} caixas, ${r.recebimentos} recebimentos, ${r.itensDia} itens/dia`);
      r.avisos.forEach(a => console.warn('  aviso: ' + a));
      const status = r.avisos.length ? 'parcial' : 'ok';
      if (status === 'parcial') statusGeral = 'parcial';
      if (logId) {
        const { error } = await sb.from('pdv_importacoes').update({ terminado_em: new Date().toISOString(), status, pedidos: r.pedidos, caixas: r.caixas, recebimentos: r.recebimentos, itens_dia: r.itensDia, detalhes: { avisos: r.avisos } }).eq('id', logId);
        if (error) { console.error('  ERRO ao gravar pdv_importacoes: ' + error.message); statusGeral = 'erro'; }
      }
    } catch (e) {
      console.error(`  ERRO: ${e.message}`);
      statusGeral = 'erro';
      if (logId) {
        const { error } = await sb.from('pdv_importacoes').update({ terminado_em: new Date().toISOString(), status: 'erro', erro: e.message }).eq('id', logId);
        if (error) console.error('  ERRO ao gravar pdv_importacoes: ' + error.message);
      }
      if (e instanceof SessaoExpiradaError) break; // as outras lojas vão falhar igual
    }
  }
  console.log(`\nFim: ${statusGeral}`);
  process.exit(statusGeral === 'erro' ? 2 : 0);
}

main().catch(e => { console.error('ERRO: ' + e.message); process.exit(2); });
