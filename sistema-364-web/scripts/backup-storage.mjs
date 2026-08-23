// =========================================================
// 364 OS — espelho incremental dos buckets do Supabase Storage.
// Chamado por scripts/backup-364.sh. Uso direto:
//   node scripts/backup-storage.mjs "/caminho/do/destino/storage"
//
// Baixa apenas arquivos que ainda nao existem localmente com o mesmo
// tamanho — os anexos do 364 sao imutaveis, entao a execucao diaria
// gasta quase nada de egress (importante no plano free: 5 GB/mes).
// =========================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';

const destino = process.argv[2];
if (!destino) {
  console.error('ERRO: informe o diretorio de destino.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !chave) {
  console.error('ERRO: NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.');
  process.exit(1);
}

const sb = createClient(url, chave, { auth: { persistSession: false } });

// Lista recursivamente todos os objetos de um bucket (paginado de 100 em 100).
async function listarTudo(bucket, prefixo = '') {
  const itens = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefixo, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${bucket}/${prefixo}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const item of data) {
      if (item.name === '.emptyFolderPlaceholder') continue;
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (item.id === null) {
        itens.push(...(await listarTudo(bucket, caminho))); // pasta
      } else {
        itens.push({ caminho, tamanho: item.metadata?.size ?? null });
      }
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return itens;
}

async function jaExiste(arquivoLocal, tamanho) {
  try {
    const st = await fs.stat(arquivoLocal);
    return tamanho === null ? true : st.size === tamanho;
  } catch {
    return false;
  }
}

const { data: buckets, error: erroBuckets } = await sb.storage.listBuckets();
if (erroBuckets) {
  console.error('ERRO ao listar buckets:', erroBuckets.message);
  process.exit(1);
}

let baixados = 0;
let pulados = 0;
let falhas = 0;

for (const bucket of buckets) {
  const objetos = await listarTudo(bucket.name);
  console.log(`  bucket "${bucket.name}": ${objetos.length} objeto(s)`);

  for (const obj of objetos) {
    const arquivoLocal = path.join(destino, bucket.name, obj.caminho);
    if (await jaExiste(arquivoLocal, obj.tamanho)) {
      pulados++;
      continue;
    }
    const { data, error } = await sb.storage.from(bucket.name).download(obj.caminho);
    if (error) {
      console.error(`  FALHA ${bucket.name}/${obj.caminho}: ${error.message}`);
      falhas++;
      continue;
    }
    await fs.mkdir(path.dirname(arquivoLocal), { recursive: true });
    await fs.writeFile(arquivoLocal, Buffer.from(await data.arrayBuffer()));
    baixados++;
  }
}

console.log(`  storage: ${baixados} novo(s), ${pulados} ja existente(s), ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
