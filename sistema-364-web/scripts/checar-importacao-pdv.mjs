// =========================================================
// 364 OS — checador da importação do PDV (cron a cada 15 min).
//
// Não importa nada sozinho: só decide se vale chamar
// `npm run importar-pdv-backup` (que faz o trabalho pesado — download,
// docker/gbak, gravação). Roda quando:
//   - tem pedido manual pendente em pdv_importacao_solicitacoes (botão
//     "Atualizar agora" da tela /vendas/importacao), ou
//   - o backup do dia no Drive é mais novo que o último importado com
//     sucesso (cabeçalho gbak baixado com range request de 8 KB — o Drive
//     aceita Range, então não precisa puxar os ~365 MB pra checar a data).
//
// Nunca roda em cima de uma importação ainda em andamento (linha aberta em
// pdv_importacoes) — evita dois containers Firebird disputando a mesma
// porta.
// =========================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { urlDownload, dataDoCabecalhoGbak, arquivoDoDia } from '../lib/pdvBackup/drive.js';

// Cópia do mesmo helper de scripts/importar-pdv-backup.mjs — dez linhas sem
// estado, não vale um módulo compartilhado (mesma decisão de lá).
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

// `dataBackup` é a data lida do cabeçalho gbak (Date ou null, se o cabeçalho
// não leu). `dataConhecida` é `detalhes.backup_em` da última importação
// ok/parcial (string ISO ou null, se nunca importou com sucesso).
export function backupMaisNovo(dataBackup, dataConhecida) {
  if (!dataBackup) return false;
  if (!dataConhecida) return true;
  return dataBackup.getTime() > new Date(dataConhecida).getTime();
}

export function decidirRodada({ importacaoEmAndamento, pedidoManualPendente, backupMaisNovo }) {
  if (importacaoEmAndamento) return { rodar: false, motivo: 'já em andamento' };
  if (pedidoManualPendente) return { rodar: true, motivo: 'pedido manual pendente' };
  if (backupMaisNovo) return { rodar: true, motivo: 'backup mais novo disponível' };
  return { rodar: false, motivo: null };
}

function baixarCabecalho(url, destino) {
  execFileSync('curl', ['-fsS', '--location', '-r', '0-8191', '--max-time', '30', '-o', destino, url],
    { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Verdadeiro se QUALQUER loja ativa (origem='backup') tem, no Drive, um
// backup mais novo do que o último importado com sucesso pra ela. Uma loja
// que falhe a checagem (rede, Drive fora, cabeçalho não leu) só vira aviso —
// não trava a checagem das outras.
async function algumBackupNovo({ sb, lojas, agora, log }) {
  for (const loja of lojas) {
    const { dia, fileId } = arquivoDoDia(loja.drive_arquivos, agora, 0);
    if (!fileId) continue;
    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-check-'));
    try {
      const destino = path.join(diretorio, `${dia}.head`);
      baixarCabecalho(urlDownload(fileId), destino);
      const dataBackup = dataDoCabecalhoGbak(fs.readFileSync(destino));
      const { data: ultima } = await sb.from('pdv_importacoes')
        .select('detalhes').eq('empresa_id', loja.empresa_id).in('status', ['ok', 'parcial'])
        .order('iniciado_em', { ascending: false }).limit(1).maybeSingle();
      if (backupMaisNovo(dataBackup, ultima?.detalhes?.backup_em ?? null)) return true;
    } catch (e) {
      log(`  aviso: checagem de ${loja.nome_connect} falhou (${e.message})`);
    } finally {
      fs.rmSync(diretorio, { recursive: true, force: true });
    }
  }
  return false;
}

async function main() {
  carregarEnv(path.resolve(process.cwd(), '.env.local'));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) { console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.'); process.exit(1); }
  const sb = createClient(url, chave, { auth: { persistSession: false } });
  const log = m => console.log(m);

  const { data: emAndamento } = await sb.from('pdv_importacoes').select('id').is('terminado_em', null).limit(1).maybeSingle();
  const { data: pendentes } = await sb.from('pdv_importacao_solicitacoes').select('id').is('atendido_em', null);
  const pedidoManualPendente = (pendentes || []).length > 0;

  // O backup só precisa ser checado se ninguém pediu manual e nada está
  // rodando — evita 6 downloads de cabeçalho à toa quando a resposta já é
  // "roda" por outro motivo.
  let temBackupNovo = false;
  if (!emAndamento && !pedidoManualPendente) {
    const { data: lojas } = await sb.from('pdv_lojas')
      .select('empresa_id, nome_connect, drive_arquivos').eq('ativo', true).eq('origem', 'backup');
    temBackupNovo = await algumBackupNovo({ sb, lojas: lojas || [], agora: new Date(), log });
  }

  const decisao = decidirRodada({ importacaoEmAndamento: !!emAndamento, pedidoManualPendente, backupMaisNovo: temBackupNovo });
  if (!decisao.rodar) { log(`Nada a fazer (${decisao.motivo || 'sem novidade'}).`); return; }

  log(`Disparando importação (${decisao.motivo})...`);
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    execFileSync('npm', ['run', 'importar-pdv-backup'], { cwd: raiz, stdio: 'inherit' });
  } finally {
    // Marca os pedidos como atendidos mesmo se a importação falhar — uma
    // rodada com erro não pode ficar tentando de novo a cada 15 min pro
    // mesmo pedido; o próximo backup novo (ou um novo clique) tenta de novo.
    if (pedidoManualPendente) {
      await sb.from('pdv_importacao_solicitacoes').update({ atendido_em: new Date().toISOString() }).is('atendido_em', null);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
}
