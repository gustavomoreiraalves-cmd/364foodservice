import { supabase } from './supabase';

const BUCKET = 'recebimentos';

function extensaoSegura(nomeArquivo) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(nomeArquivo || '');
  return (m ? m[1] : 'bin').toLowerCase();
}

// Envia um anexo do recebimento (nota fiscal ou foto) para o bucket privado
// 'recebimentos', em {empresaId}/{recebimentoId}/{prefixo}-{timestamp}.{ext}.
// Retorna o PATH salvo no bucket (não é URL pública — o bucket é privado).
export async function uploadArquivoRecebimento(empresaId, recebimentoId, prefixo, file) {
  const ext = extensaoSegura(file.name);
  const path = `${empresaId}/${recebimentoId}/${prefixo}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

// Gera uma signed URL sob demanda para abrir/baixar um anexo privado.
// Não guardar em estado por muito tempo — expira em `segundos`.
export async function signedUrlRecebimento(path, segundos = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos);
  if (error) throw error;
  return data.signedUrl;
}

// Remove anexos do bucket (melhor esforço — a política de delete é admin-only,
// então para usuários comuns isso pode falhar silenciosamente por RLS).
export async function removerAnexosRecebimento(paths) {
  const validos = (paths || []).filter(Boolean);
  if (!validos.length) return;
  await supabase.storage.from(BUCKET).remove(validos);
}
