// =========================================================
// 364 OS — importação do CADASTRO de produtos do PDV Consumer.
//
// Irmão de importar-pdv-backup.mjs, que traz o movimento. Aqui é cadastro:
// não há janela de datas, roda inteiro, e é sob demanda — cadastro não muda
// todo dia e a primeira carga precisa de olho humano no relatório.
//
// Tipo Produto vira `produtos`, tipo Insumo vira `materias_primas`. Os dados
// fiscais que o Consumer tem (NCM, CEST, origem) vêm junto, mas nenhum
// produto nasce liberado para emissão: ativo_fiscal é sempre false.
//
// Rodar de novo nunca desfaz edição humana — ver lib/pdvBackup/mergeProdutos.js.
//
// Uso:
//   node scripts/importar-produtos-pdv.mjs --dry-run    # obrigatório na 1ª vez
//   node scripts/importar-produtos-pdv.mjs
//   node scripts/importar-produtos-pdv.mjs --loja -2147478159
// =========================================================
import { createClient } from '@supabase/supabase-js';
import Firebird from 'node-firebird';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  baixarBackup, garantirDocker, restaurarNoContainer, derrubarContainer,
} from './importar-pdv-backup.mjs';
import { SQL_PRODUTOS } from '../lib/pdvBackup/consultasProdutos.js';
import { normalizaProdutosFb, gruposDoLote } from '../lib/pdvBackup/normalizaProdutos.js';
import { mesclar } from '../lib/pdvBackup/mergeProdutos.js';

const CAMINHO_FDB = '/var/lib/firebird/data/consumer.fdb';

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

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

function consultar(db, sql) {
  return new Promise((ok, falhou) => {
    db.query(sql, [], (erro, linhas) => (erro ? falhou(erro) : ok(linhas || [])));
  });
}

function abrirFirebird(opcoes) {
  return new Promise((ok, falhou) => {
    Firebird.attach(opcoes, (erro, db) => (erro ? falhou(erro) : ok(db)));
  });
}

// Cria os grupos tributários que faltam e devolve o mapa código -> id. São
// quatro combinações para 458 produtos: a pessoa cria a regra tributária uma
// vez por grupo, não uma por produto. O CFOP/CSOSN do PDV NÃO vira
// regras_tributarias — regra se resolve por natureza de operação e UF, que o
// Consumer não tem, e inventar uma seria fabricar informação fiscal.
async function garantirGrupos({ sb, empresaId, grupos, dryRun, log }) {
  const { data: existentes, error } = await sb.from('grupos_tributarios')
    .select('id, codigo').eq('empresa_id', empresaId);
  if (error) throw new Error('não consegui ler os grupos tributários: ' + error.message);

  const mapa = new Map((existentes || []).map(g => [g.codigo, g.id]));
  const faltando = grupos.filter(g => !mapa.has(g.codigo));
  if (!faltando.length) return mapa;

  log(`  ${faltando.length} grupo(s) tributário(s) a criar: ${faltando.map(g => g.codigo).join(', ')}`);
  if (dryRun) return mapa;

  const { data: criados, error: erroCriar } = await sb.from('grupos_tributarios')
    .insert(faltando.map(g => ({ empresa_id: empresaId, codigo: g.codigo, descricao: g.descricao })))
    .select('id, codigo');
  if (erroCriar) throw new Error('não consegui criar os grupos tributários: ' + erroCriar.message);
  for (const g of criados) mapa.set(g.codigo, g.id);
  return mapa;
}

// Colunas NOT NULL com default no banco que a normalização deixa de fora
// quando o Consumer não informa (preço e custo ausentes ou zerados). O valor
// entra só na criação, e entra também no retrato: se a linha nascesse com 0 e
// o retrato não soubesse disso, a rodada seguinte leria "0 aqui, nada no
// retrato", concluiria que uma pessoa digitou aquele 0 e nunca mais
// atualizaria o campo — o produto ficaria sem custo para sempre.
//
// vw_produto_custo (atualização 21) já trata custo_unitario = 0 como "não
// informado" e cai na ficha técnica, que é exatamente a semântica que o
// Consumer dá ao 0.0000.
const PADRAO_CRIACAO = {
  produtos: { custo_unitario: 0, preco_venda: 0 },
  materias_primas: { custo_unitario: 0 },
};

// Grava um lote numa tabela, linha a linha pela regra de merge. Linha a linha
// de propósito: o upsert em bloco não sabe congelar campo, e são 458 linhas
// uma vez por carga — não vale trocar clareza por microssegundos.
async function gravarLote({ sb, tabela, linhas, dryRun, log }) {
  const resumo = { novos: 0, atualizados: 0, semMudanca: 0, conflitos: [], congelados: 0 };
  if (!linhas.length) return resumo;

  const empresaId = linhas[0].empresa_id;
  // As duas tabelas têm revisado_em — é a coluna que a atualização 36 criou
  // para marcar "uma pessoa conferiu os campos fiscais desta linha".
  const { data: existentes, error } = await sb.from(tabela).select('*')
    .eq('empresa_id', empresaId).not('pdv_codigo_produto', 'is', null);
  if (error) throw new Error(`não consegui ler ${tabela}: ${error.message}`);

  const porCodigo = new Map((existentes || []).map(l => [l.pdv_codigo_produto, l]));

  for (const novo of linhas) {
    const atual = porCodigo.get(novo.pdv_codigo_produto) || null;
    const retrato = atual?.pdv_valores || null;
    const { valores, conflitos, congelados } = mesclar({
      novo,
      atual,
      retrato,
      revisado: Boolean(atual?.revisado_em),
    });
    resumo.conflitos.push(...conflitos.map(c => ({ ...c, codigo: novo.pdv_codigo_produto })));
    resumo.congelados += congelados.length;

    if (!atual) {
      resumo.novos += 1;
      if (dryRun) continue;
      const linha = { ...PADRAO_CRIACAO[tabela], ...valores };
      const { error: erroInsert } = await sb.from(tabela)
        .insert([{ ...linha, pdv_valores: linha, pdv_importado_em: new Date().toISOString() }]);
      if (erroInsert) throw new Error(`não consegui inserir ${novo.pdv_codigo_produto} em ${tabela}: ${erroInsert.message}`);
      continue;
    }

    if (!Object.keys(valores).length) { resumo.semMudanca += 1; continue; }
    resumo.atualizados += 1;
    if (dryRun) continue;
    // O retrato tem que dizer o que ficou NA LINHA, não o que o PDV mandou.
    // Gravar `novo` inteiro faria o retrato afirmar que a importação gravou um
    // NCM congelado que ela não gravou — e a rodada seguinte compararia contra
    // uma mentira.
    const { error: erroUpdate } = await sb.from(tabela)
      .update({
        ...valores,
        pdv_valores: { ...(retrato || {}), ...valores },
        pdv_importado_em: new Date().toISOString(),
      })
      .eq('id', atual.id);
    if (erroUpdate) throw new Error(`não consegui atualizar ${novo.pdv_codigo_produto} em ${tabela}: ${erroUpdate.message}`);
  }

  log(`  ${tabela}: ${resumo.novos} novo(s), ${resumo.atualizados} atualizado(s), `
    + `${resumo.semMudanca} sem mudança, ${resumo.conflitos.length} conflito(s), `
    + `${resumo.congelados} campo(s) congelado(s) por revisão`);
  return resumo;
}

async function main() {
  carregarEnv(path.resolve(process.cwd(), '.env.local'));
  const dryRun = process.argv.includes('--dry-run');
  const somenteLoja = arg('--loja', null);
  const log = msg => console.log(msg);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.');
    process.exit(1);
  }
  const sb = createClient(url, chave, { auth: { persistSession: false } });

  const { data: lojas, error } = await sb.from('pdv_lojas')
    .select('id_connect, empresa_id, nome_connect, drive_arquivos, empresas(prefixo_codigo)')
    .eq('ativo', true).eq('origem', 'backup');
  if (error) { console.error('ERRO ao ler pdv_lojas: ' + error.message); process.exit(1); }

  const alvo = somenteLoja
    ? lojas.filter(l => String(l.id_connect) === String(somenteLoja))
    : lojas;
  if (!alvo.length) { console.error('Nenhuma loja ativa com origem=backup.'); process.exit(1); }

  console.log(`Importação de cadastro do PDV${dryRun ? ' (dry-run — nada será gravado)' : ''}`);
  garantirDocker(log);
  const porta = Number(process.env.PDV_FB_PORTA || 3050);

  for (const loja of alvo) {
    console.log(`\n${loja.nome_connect}`);
    const prefixo = loja.empresas?.prefixo_codigo;
    if (!prefixo) throw new Error(`a empresa da loja ${loja.nome_connect} está sem prefixo_codigo`);

    const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-cadastro-'));
    const nomeContainer = `pdv-cadastro-${randomBytes(4).toString('hex')}`;
    const senha = randomBytes(12).toString('hex');
    let db = null;

    try {
      const { caminho } = baixarBackup({ loja, diretorio, agora: new Date(), log });
      await restaurarNoContainer({ nome: nomeContainer, porta, senha, arquivo: caminho, log });
      log("  conectando no Firebird restaurado...");
      db = await abrirFirebird({
        host: '127.0.0.1', port: porta, database: CAMINHO_FDB,
        user: 'SYSDBA', password: senha, lowercase_keys: false,
      });

      const linhas = await consultar(db, SQL_PRODUTOS);
      log(`  ${linhas.length} linha(s) de cadastro lidas`);

      const { data: vendidos, error: erroVendidos } = await sb.from('pdv_vendas_itens_dia')
        .select('codigo_produto').eq('empresa_id', loja.empresa_id).not('codigo_produto', 'is', null);
      if (erroVendidos) throw new Error('não consegui ler os produtos vendidos: ' + erroVendidos.message);
      const codigosVendidos = new Set((vendidos || []).map(v => v.codigo_produto));

      const grupos = gruposDoLote(linhas);
      const mapaGrupos = await garantirGrupos({ sb, empresaId: loja.empresa_id, grupos, dryRun, log });

      const { produtos, materiasPrimas, recusados } = normalizaProdutosFb({
        linhas, empresaId: loja.empresa_id, prefixo, codigosVendidos,
      });

      // O código do grupo só vira id aqui: a normalização é pura e não fala
      // com banco. Em dry-run os grupos ainda não existem, então o id sai
      // nulo — é esperado, e o relatório já disse quais seriam criados.
      for (const p of produtos) {
        p.grupo_tributario_id = mapaGrupos.get(p.grupo_tributario_codigo) || null;
        delete p.grupo_tributario_codigo;
      }

      const rp = await gravarLote({ sb, tabela: 'produtos', linhas: produtos, dryRun, log });
      const rm = await gravarLote({ sb, tabela: 'materias_primas', linhas: materiasPrimas, dryRun, log });

      if (recusados.length) {
        console.log(`\n  ${recusados.length} linha(s) recusada(s) por formato:`);
        for (const r of recusados) console.log(`    produto ${r.codigo}: ${r.motivo} (${r.campo} = "${r.valor}")`);
      }
      const conflitos = [...rp.conflitos, ...rm.conflitos];
      if (conflitos.length) {
        console.log(`\n  ${conflitos.length} campo(s) não atualizados porque alguém editou à mão:`);
        for (const c of conflitos) {
          console.log(`    produto ${c.codigo} · ${c.campo}: aqui "${c.atual}", no PDV "${c.novo}"`);
        }
      }
    } finally {
      if (db) { try { db.detach(); } catch { /* já caiu */ } }
      derrubarContainer(nomeContainer);
      fs.rmSync(diretorio, { recursive: true, force: true });
    }
  }

  console.log(`\n${dryRun ? 'Dry-run concluído — nada foi gravado.' : 'Importação concluída.'}`);
}

main().catch(e => { console.error('\nERRO: ' + e.message); process.exit(1); });
