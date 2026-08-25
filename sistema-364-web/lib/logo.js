// Logo da marca (tabela `empresas`): validação do arquivo e caminho no bucket.
//
// Só PNG: é o formato que o navegador, a impressão e o futuro DANFE leem sem
// conversão, e é o que o bucket 'logos' aceita (a atualização 42 restringe o
// allowed_mime_types, então mandar outra coisa quebraria só no upload).

export const LIMITE_LOGO_BYTES = 1024 * 1024; // 1 MB — mesmo teto do bucket

function ehPng(file) {
  const tipo = (file.type || '').toLowerCase();
  const extensaoPng = /\.png$/i.test(file.name || '');
  // O type vem vazio em alguns navegadores/sistemas; aí a extensão decide.
  // Quando os dois existem, os dois precisam concordar: .png com type de JPEG
  // é arquivo renomeado, e o bucket recusaria.
  if (tipo) return tipo === 'image/png' && (extensaoPng || !file.name);
  return extensaoPng;
}

// Retorna sempre { ok, erro } — a tela mostra `erro` direto, sem try/catch.
export function validarLogo(file) {
  if (!file) return { ok: false, erro: 'Selecione um arquivo PNG.' };
  if (!ehPng(file)) return { ok: false, erro: 'A logo precisa ser um arquivo PNG.' };
  if (!file.size) return { ok: false, erro: 'O arquivo está vazio.' };
  if (file.size > LIMITE_LOGO_BYTES) return { ok: false, erro: 'A logo precisa ter no máximo 1 MB.' };
  return { ok: true, erro: '' };
}

// O carimbo entra por parâmetro para o caminho ser testável e para a troca de
// logo gerar um path novo (o CDN do bucket público cacheia por URL).
export function caminhoLogo(empresaId, carimbo) {
  if (!empresaId) throw new Error('caminhoLogo: empresa não informada.');
  return `${empresaId}/logo-${carimbo}.png`;
}
