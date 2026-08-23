// Endereçamento do backup diário do PDV no Drive e leitura do cabeçalho gbak.
// Só funções puras — quem baixa é o script (scripts/importar-pdv-backup.mjs).
//
// O PDV sobe um arquivo por dia da semana na pasta pública "Backup Consumer",
// sempre no MESMO file id (o arquivo é sobrescrito). Por isso a configuração
// por loja (`pdv_lojas.drive_arquivos`, migração 33) é um mapa
// dia-da-semana → file id, e não há listagem de pasta (que exigiria
// credencial do Google).
import { FUSO_MS } from '../pdvConsumer/parse.js';

// Chaves exatamente como a migração 33 semeia: minúsculas, com acento e
// hífen, de domingo a sábado (a mesma ordem de `Date#getUTCDay`).
export const DIAS_SEMANA = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

// Download anônimo de arquivo grande da pasta compartilhada por link.
// `confirm=t` pula a interstitial "o Google não conseguiu verificar o
// arquivo" que aparece acima de ~100 MB.
export function urlDownload(fileId) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(fileId || ''))) {
    throw new Error(`file id do Drive inválido: ${JSON.stringify(fileId)}`);
  }
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// O gbak grava no começo do arquivo o caminho do banco de origem e a data do
// backup no formato do `ctime` em C ("Sun Aug 23 09:20:09 2026"), em hora
// local de Porto Velho e sem fuso — como tudo que vem do PDV. Devolve o
// instante real (valor + 4 h) ou `null` se o arquivo não parecer um backup
// (HTML de erro do Drive, download truncado, lixo).
export function dataDoCabecalhoGbak(buffer) {
  if (!buffer || !buffer.length) return null;
  const texto = Buffer.from(buffer).subarray(0, 4096).toString('latin1');
  // Dia entre 1 e 9 vem alinhado com dois espaços ("Wed Aug  5 ..."), como no
  // `ctime`, daí o ` {1,2}`.
  const m = /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})/.exec(texto);
  if (!m) return null;
  const mes = MESES.indexOf(m[1]);
  if (mes < 0) return null;
  return new Date(Date.UTC(+m[6], mes, +m[2], +m[3], +m[4], +m[5]) + FUSO_MS);
}

// Arquivo do dia da semana em Porto Velho. `diasAtras = 1` devolve o de
// ontem, que é o fallback quando o upload de hoje ainda não chegou (o script
// confere a data do cabeçalho antes de restaurar). `fileId` vem `null` quando
// a loja não tem aquele dia configurado — quem decide o que fazer é o script.
export function arquivoDoDia(driveArquivos, agora, diasAtras = 0) {
  const local = new Date(agora.getTime() - FUSO_MS - diasAtras * 86400000);
  const dia = DIAS_SEMANA[local.getUTCDay()];
  return { dia, fileId: (driveArquivos && driveArquivos[dia]) || null };
}
