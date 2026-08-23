// =========================================================
// 364 OS — importação diária das vendas do PDV a partir do backup Firebird.
//
// Caminho principal (v2). Para cada loja com `pdv_lojas.origem = 'backup'`:
// baixa o `.fbconsumer` do dia da pasta pública do Drive (file id fixo por dia
// da semana, em `pdv_lojas.drive_arquivos`), confere a data no cabeçalho do
// gbak, restaura num container Firebird 5 efêmero (colima/docker), lê com
// `node-firebird`, normaliza e grava nas tabelas `pdv_*` do Supabase.
// O container e o arquivo baixado são apagados sempre, no `finally`.
//
// Reprocessa uma janela (padrão: D-3 até hoje) com upsert, então rodar de novo
// nunca duplica. O importador do painel (scripts/importar-pdv-consumer.mjs)
// continua existindo como plano B.
//
// Uso:
//   node scripts/importar-pdv-backup.mjs                       # janela padrão
//   node scripts/importar-pdv-backup.mjs --de 2026-08-01 --ate 2026-08-23
//   node scripts/importar-pdv-backup.mjs --loja -2147478159
//   node scripts/importar-pdv-backup.mjs --dry-run             # só conta
// Detalhes: scripts/IMPORTACAO-PDV.md
// =========================================================
import { createClient } from '@supabase/supabase-js';
import Firebird from 'node-firebird';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FUSO_MS } from '../lib/pdvConsumer/parse.js';
import { diasEntre } from '../lib/pdvConsumer/importar.js';
import { bancoSupabase, bancoSeco } from '../lib/pdvConsumer/banco.js';
import { urlDownload, dataDoCabecalhoGbak, arquivoDoDia } from '../lib/pdvBackup/drive.js';
import {
  SQL_PEDIDOS, SQL_ITENS, SQL_PAGAMENTOS, SQL_RECEBIMENTOS,
  SQL_CAIXAS, SQL_CAIXA_OPERACOES, SQL_ITENS_DIA,
} from '../lib/pdvBackup/consultas.js';
import {
  normalizaPedidoFb, normalizaCaixaFb, normalizaRecebimentoFb, itensDiaFb,
} from '../lib/pdvBackup/normaliza.js';

const IMAGEM = process.env.PDV_FB_IMAGEM || 'firebirdsql/firebird:5';
const CAMINHO_FDB = '/var/lib/firebird/data/consumer.fdb';
const HORAS_LIMITE = 48;
const MS_HORA = 3600000;

// Carrega .env.local sem depender de pacote: linha CHAVE=valor, aspas
// opcionais. Cópia do importador v1 (scripts/importar-pdv-consumer.mjs) — são
// dez linhas sem estado, não vale um módulo compartilhado.
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

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : padrao;
}

// ------------------------------------------------------------- Firebird

function abrirFirebird(opcoes) {
  return new Promise((ok, erro) => Firebird.attach(opcoes, (e, db) => (e ? erro(e) : ok(db))));
}

function consultar(db, sql, params) {
  return new Promise((ok, erro) => db.query(sql, params, (e, linhas) => (e ? erro(e) : ok(linhas))));
}

// A janela chega em dias LOCAIS de Porto Velho (--de/--ate, como no v1) e as
// consultas de `consultas.js` esperam exatamente isso: hora de parede, que é
// como o Firebird guarda os timestamps. Nenhuma conversão de fuso aqui — a
// soma das 4 h acontece só na normalização, ao virar instante real.
//
// O `node-firebird` transforma a string em `new Date(ano, mês, ...)` local e
// depois lê os componentes locais de volta, então o valor chega ao servidor
// igual ao texto, seja qual for o TZ da máquina.
function somaDias(dia, n) {
  return new Date(new Date(dia + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}

function janelaFirebird(de, ate) {
  return [`${de} 00:00:00`, `${somaDias(ate, 1)} 00:00:00`];
}

function agrupaPor(linhas, coluna) {
  const mapa = new Map();
  for (const l of linhas) {
    const chave = l[coluna] === null || l[coluna] === undefined ? null : Number(l[coluna]);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(l);
  }
  return mapa;
}

// Mesma ideia do `pedidoMudou` do v1 (lib/pdvConsumer/normaliza.js), só que
// comparando o pedido JÁ normalizado com o que está no banco — a linha do
// Firebird não tem os campos do Connect. Evita reescrever no Supabase os
// pedidos que não mudaram desde a última rodada da janela.
function pedidoMudouFb(pedido, existente) {
  if (!existente) return true;
  if ((existente.status || null) !== (pedido.status || null)) return true;
  if (Number(existente.valor_total) !== Number(pedido.valor_total)) return true;
  const iso = v => (v ? new Date(v).toISOString() : null);
  if (iso(existente.excluido_em) !== iso(pedido.excluido_em)) return true;
  return iso(existente.fechado_em) !== iso(pedido.fechado_em);
}

// Extrai a janela do banco restaurado, normaliza e grava pelo contrato
// `banco` (o mesmo do v1). Exportada para poder ser exercitada contra um
// Firebird já restaurado, sem download nem docker — ver IMPORTACAO-PDV.md.
export async function extrairLoja({ db, banco, loja, de, ate, log = () => {} }) {
  const empresaId = loja.empresa_id;
  const avisos = [];
  const r = { pedidos: 0, caixas: 0, recebimentos: 0, itensDia: 0 };
  const [inicio, fim] = janelaFirebird(de, ate);
  // Um caixa aberto no fim da janela recebe pagamentos depois da meia-noite
  // seguinte; para os movimentos baterem com `CAIXA.SALDOFINAL` os pagamentos
  // são lidos com dois dias a mais. Os recebimentos que vão para o banco são
  // só os da janela pedida (filtrados por `dia_pagamento` mais abaixo).
  const fimFolgado = `${somaDias(ate, 3)} 00:00:00`;

  // ---- pedidos ----
  const linhasPedidos = await consultar(db, SQL_PEDIDOS, [inicio, fim]);
  log(`  pedidos na janela: ${linhasPedidos.length}`);
  const itensPorPedido = agrupaPor(await consultar(db, SQL_ITENS, [inicio, fim]), 'CODIGOPEDIDO');
  const pagsPorPedido = agrupaPor(await consultar(db, SQL_PAGAMENTOS, [inicio, fim]), 'CODIGOPEDIDO');
  const existentes = await banco.pedidosExistentes(empresaId, linhasPedidos.map(l => Number(l.CODIGO)));
  for (const linhaPedido of linhasPedidos) {
    const codigo = Number(linhaPedido.CODIGO);
    try {
      const normalizado = normalizaPedidoFb({
        linhaPedido,
        itens: itensPorPedido.get(codigo) || [],
        pagamentos: pagsPorPedido.get(codigo) || [],
        empresaId,
      });
      if (!pedidoMudouFb(normalizado.pedido, existentes.get(codigo) || null)) continue;
      await banco.gravarPedido(normalizado);
      r.pedidos++;
    } catch (e) {
      // Um pedido problemático não pode derrubar a loja inteira (regra do v1).
      avisos.push(`pedido ${codigo}: ${e.message}`);
    }
  }

  // ---- recebimentos (também alimentam os movimentos de caixa) ----
  const linhasReceb = await consultar(db, SQL_RECEBIMENTOS, [inicio, fimFolgado]);
  const recebimentos = linhasReceb.map(l => normalizaRecebimentoFb(l, empresaId));

  // ---- caixas ----
  const linhasCaixas = await consultar(db, SQL_CAIXAS, [inicio, fim]);
  const operacoesPorCaixa = agrupaPor(await consultar(db, SQL_CAIXA_OPERACOES, [inicio, fim]), 'CODIGOCAIXA');
  const pagsPorCaixa = agrupaPor(linhasReceb, 'CODIGOCAIXA');
  const caixasBanco = await banco.caixasExistentes(empresaId, linhasCaixas.map(l => Number(l.CODIGO)));
  for (const linhaCaixa of linhasCaixas) {
    const codigo = Number(linhaCaixa.CODIGO);
    const atual = caixasBanco.get(codigo);
    // Caixa fechado que já está fechado no banco não muda mais (regra do v1).
    if (atual && atual.status === 'Fechado' && linhaCaixa.DATAFECHAMENTO) continue;
    try {
      await banco.gravarCaixa(normalizaCaixaFb({
        linhaCaixa,
        pagamentos: pagsPorCaixa.get(codigo) || [],
        operacoes: operacoesPorCaixa.get(codigo) || [],
        empresaId,
      }));
      r.caixas++;
    } catch (e) {
      avisos.push(`caixa ${codigo}: ${e.message}`);
    }
  }

  // Recebimento não tem chave natural confiável (duas parcelas do mesmo pedido
  // são iguais em tudo): a janela de `dia_pagamento` é apagada e regravada
  // inteira. Chamado mesmo com 0 linhas — é assim que um pagamento estornado
  // no PDV some do nosso banco.
  const daJanela = recebimentos.filter(x => x.dia_pagamento >= de && x.dia_pagamento <= ate);
  await banco.substituirRecebimentos(empresaId, de, ate, daJanela);
  r.recebimentos = daJanela.length;

  // ---- itens vendidos por dia ----
  // Diferente do v1: aqui a lista vazia não é ambígua (o backup ou tem o dia
  // inteiro ou nenhum pedido), então o dia sem venda é gravado como vazio
  // mesmo — é o que apaga um snapshot de um dia que foi todo cancelado.
  const porDia = new Map();
  for (const item of itensDiaFb(await consultar(db, SQL_ITENS_DIA, [inicio, fim]), empresaId)) {
    if (!porDia.has(item.dia)) porDia.set(item.dia, []);
    porDia.get(item.dia).push(item);
  }
  for (const dia of diasEntre(de, ate)) {
    const linhas = porDia.get(dia) || [];
    await banco.substituirItensDia(empresaId, dia, linhas);
    r.itensDia += linhas.length;
  }

  return { ...r, avisos };
}

// --------------------------------------------------------------- download

function lerCabecalho(caminho) {
  const buffer = Buffer.alloc(4096);
  const fd = fs.openSync(caminho, 'r');
  try {
    const lidos = fs.readSync(fd, buffer, 0, 4096, 0);
    return buffer.subarray(0, lidos);
  } finally {
    fs.closeSync(fd);
  }
}

function baixar(url, destino) {
  // `curl` em vez de fetch: são ~365 MB por arquivo, e ele já traz retomada,
  // retry e escrita direta em disco sem passar pela memória do Node.
  execFileSync('curl', ['-fsS', '--location', '--retry', '3', '--retry-delay', '5',
    '--max-time', String(Number(process.env.PDV_DOWNLOAD_TIMEOUT_S || 1800)),
    '-o', destino, url], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Baixa o backup do dia (e, se ele não estiver fresco, o de ontem). Devolve
// `{caminho, dia, data}` do primeiro que servir.
function baixarBackup({ loja, diretorio, agora, log }) {
  const tentativas = [];
  for (const diasAtras of [0, 1]) {
    const { dia, fileId } = arquivoDoDia(loja.drive_arquivos, agora, diasAtras);
    if (!fileId) { tentativas.push(`${dia}: sem file id em pdv_lojas.drive_arquivos`); continue; }
    const caminho = path.join(diretorio, `${dia}.fbconsumer`);
    log(`  baixando o backup de ${dia} do Drive...`);
    baixar(urlDownload(fileId), caminho);
    const tamanho = fs.statSync(caminho).size;
    const data = dataDoCabecalhoGbak(lerCabecalho(caminho));
    if (!data) {
      // Link privado ou quota estourada devolvem HTML, não um gbak.
      tentativas.push(`${dia}: o arquivo baixado (${(tamanho / 1e6).toFixed(1)} MB) não é um backup gbak`);
      fs.rmSync(caminho, { force: true });
      continue;
    }
    const horas = (agora.getTime() - data.getTime()) / MS_HORA;
    if (horas > HORAS_LIMITE) {
      tentativas.push(`${dia}: backup de ${data.toISOString()} (${horas.toFixed(1)} h atrás)`);
      fs.rmSync(caminho, { force: true });
      continue;
    }
    log(`  backup de ${dia}: ${(tamanho / 1e6).toFixed(0)} MB, gerado ${horas.toFixed(1)} h atrás`);
    return { caminho, dia, data };
  }
  throw new Error(`nenhum backup recente (< ${HORAS_LIMITE} h) no Drive — ${tentativas.join('; ')}`);
}

// ----------------------------------------------------------- docker/gbak

function existe(programa) {
  try { execFileSync('which', [programa], { stdio: 'ignore' }); return true; } catch { return false; }
}

// O docker deste Mac roda dentro do colima; se a VM estiver parada, sobe.
function garantirDocker(log) {
  if (existe('colima')) {
    try {
      execFileSync('colima', ['status'], { stdio: 'ignore' });
    } catch {
      log('  colima parado; iniciando (pode levar um minuto)...');
      execFileSync('colima', ['start'], { stdio: 'inherit' });
    }
  }
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    throw new Error('docker não respondeu (colima start?)');
  }
}

function esperarPorta(porta, limiteMs) {
  const fim = Date.now() + limiteMs;
  return new Promise((ok, erro) => {
    const tentar = () => {
      const s = net.connect({ host: '127.0.0.1', port: porta });
      s.setTimeout(2000);
      // `error` costuma vir logo depois de `timeout`: sem a trava, cada
      // tentativa viraria duas e o número de sockets dobraria a cada rodada.
      let encerrado = false;
      const falhou = () => {
        if (encerrado) return;
        encerrado = true;
        s.destroy();
        if (Date.now() > fim) erro(new Error(`Firebird não abriu a porta ${porta} a tempo`));
        else setTimeout(tentar, 500);
      };
      s.once('connect', () => { encerrado = true; s.destroy(); ok(); });
      s.once('timeout', falhou);
      s.once('error', falhou);
    };
    tentar();
  });
}

// Sobe o container efêmero e restaura o backup nele. A senha é sorteada por
// rodada e o container só escuta em 127.0.0.1 — nada disso sai da máquina.
//
// Exportada junto com `derrubarContainer` para o par subir/derrubar poder ser
// exercitado sozinho, com um backup já baixado (ver IMPORTACAO-PDV.md).
export async function restaurarNoContainer({ nome, porta, senha, arquivo, log }) {
  log(`  subindo ${IMAGEM} (container ${nome})...`);
  execFileSync('docker', ['run', '-d', '--name', nome,
    '-e', `FIREBIRD_ROOT_PASSWORD=${senha}`,
    '-p', `127.0.0.1:${porta}:3050`, IMAGEM], { stdio: ['ignore', 'ignore', 'inherit'] });
  await esperarPorta(porta, 120000);
  execFileSync('docker', ['cp', arquivo, `${nome}:/tmp/backup.fbk`], { stdio: ['ignore', 'ignore', 'inherit'] });
  log('  restaurando com gbak (alguns minutos)...');
  execFileSync('docker', ['exec', nome, 'gbak', '-c', '-user', 'SYSDBA', '-password', senha,
    '/tmp/backup.fbk', CAMINHO_FDB], {
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: Number(process.env.PDV_GBAK_TIMEOUT_S || 1800) * 1000,
  });
}

export function derrubarContainer(nome) {
  try { execFileSync('docker', ['rm', '-f', nome], { stdio: 'ignore' }); } catch { /* já não existe */ }
}

// ------------------------------------------------------------------ main

async function main() {
  carregarEnv(path.resolve(process.cwd(), '.env.local'));

  const dryRun = process.argv.includes('--dry-run');
  const hojeLocal = new Date(Date.now() - FUSO_MS).toISOString().slice(0, 10);
  const janelaDias = Number(process.env.PDV_JANELA_DIAS || 3);
  const de = arg('--de', new Date(new Date(hojeLocal + 'T00:00:00Z').getTime() - janelaDias * 86400000).toISOString().slice(0, 10));
  const ate = arg('--ate', hojeLocal);
  const somenteLoja = arg('--loja', null);

  const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (!dataOk(de) || !dataOk(ate) || de > ate) {
    console.error('ERRO: --de/--ate precisam ser YYYY-MM-DD e --de <= --ate');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) { console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.'); process.exit(1); }

  const sb = createClient(url, chave, { auth: { persistSession: false } });
  const falhou = (erro, ctx) => { if (erro) throw new Error(`${ctx}: ${erro.message}`); };

  const { data: lojas, error } = await sb.from('pdv_lojas')
    .select('id_connect, empresa_id, nome_connect, drive_arquivos')
    .eq('ativo', true).eq('origem', 'backup');
  falhou(error, 'pdv_lojas');
  const alvo = somenteLoja ? lojas.filter(l => String(l.id_connect) === String(somenteLoja)) : lojas;
  if (!alvo.length) { console.error("Nenhuma loja ativa com origem='backup' em pdv_lojas."); process.exit(1); }

  console.log(`Importação PDV via backup Firebird — ${de} a ${ate}${dryRun ? ' (dry-run)' : ''}`);
  const banco = dryRun ? bancoSeco() : bancoSupabase(sb);
  const porta = Number(process.env.PDV_FB_PORTA || 3050);
  let statusGeral = 'ok';

  for (const loja of alvo) {
    console.log(`\n${loja.nome_connect}`);
    let logId = null;
    if (!dryRun) {
      const { data, error } = await sb.from('pdv_importacoes')
        .insert({ empresa_id: loja.empresa_id, janela_inicio: de, janela_fim: ate })
        .select('id').single();
      falhou(error, 'pdv_importacoes insert');
      logId = data?.id;
    }

    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-backup-'));
    const nomeContainer = `pdv-backup-${Date.now()}-${process.pid}`;
    const senha = randomBytes(18).toString('base64url');
    let db = null;
    let arquivo = null;
    try {
      arquivo = baixarBackup({ loja, diretorio, agora: new Date(), log: m => console.log(m) });
      garantirDocker(m => console.log(m));
      await restaurarNoContainer({ nome: nomeContainer, porta, senha, arquivo: arquivo.caminho, log: m => console.log(m) });
      // O arquivo já cumpriu o papel; 365 MB não precisam esperar o fim.
      fs.rmSync(arquivo.caminho, { force: true });

      db = await abrirFirebird({
        host: '127.0.0.1', port: porta, database: CAMINHO_FDB,
        user: 'SYSDBA', password: senha,
        // O driver decodifica cada coluna pelo charset dela (o banco é
        // ISO8859_1) e devolve string JS; `encoding` é só o lc_ctype da
        // conexão. UTF8 é o padrão e traz "Cartão de Crédito" certo.
        encoding: 'UTF8',
      });

      const r = await extrairLoja({ db, banco, loja, de, ate, log: m => console.log(m) });
      console.log(`  ${dryRun ? '(dry-run, nada gravado) ' : ''}gravados: ${r.pedidos} pedidos, ${r.caixas} caixas, ${r.recebimentos} recebimentos, ${r.itensDia} itens/dia`);
      r.avisos.forEach(a => console.warn('  aviso: ' + a));
      const status = r.avisos.length ? 'parcial' : 'ok';
      if (status === 'parcial') statusGeral = 'parcial';
      if (logId) {
        const { error } = await sb.from('pdv_importacoes').update({
          terminado_em: new Date().toISOString(), status,
          pedidos: r.pedidos, caixas: r.caixas, recebimentos: r.recebimentos, itens_dia: r.itensDia,
          detalhes: { fonte: 'backup', arquivo: arquivo.dia, backup_em: arquivo.data.toISOString(), avisos: r.avisos },
        }).eq('id', logId);
        if (error) { console.error('  ERRO ao gravar pdv_importacoes: ' + error.message); statusGeral = 'erro'; }
      }
    } catch (e) {
      console.error(`  ERRO: ${e.message}`);
      statusGeral = 'erro';
      if (logId) {
        const { error } = await sb.from('pdv_importacoes').update({
          terminado_em: new Date().toISOString(), status: 'erro', erro: e.message,
          detalhes: { fonte: 'backup', arquivo: arquivo?.dia ?? null },
        }).eq('id', logId);
        if (error) console.error('  ERRO ao gravar pdv_importacoes: ' + error.message);
      }
    } finally {
      if (db) { try { db.detach(); } catch { /* conexão já caiu */ } }
      derrubarContainer(nomeContainer);
      fs.rmSync(diretorio, { recursive: true, force: true });
    }
  }

  console.log(`\nFim: ${statusGeral}`);
  process.exit(statusGeral === 'erro' ? 2 : 0);
}

// Só roda quando chamado direto: importar o módulo (para testar `extrairLoja`
// contra um Firebird já restaurado) não pode disparar a rodada inteira.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ERRO: ' + e.message); process.exit(2); });
}
