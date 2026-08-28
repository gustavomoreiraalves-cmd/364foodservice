// Quais arquivos de uma NF-e emitida existem para baixar, e como chamá-los.
//
// Puro: recebe a linha de nfe_saida_documentos, devolve a lista. Quem gera a
// URL assinada é a tela (signedUrlRecebimento), porque o caminho está no
// bucket privado 'recebimentos' e a policy já permite ao usuário logado ler
// o que começa com um empresa_id que ele alcança.
//
// A distinção entre os dois arquivos não é detalhe: o nfeProc é a NFe assinada
// MAIS o protocolo de autorização da SEFAZ. É ele que se guarda pelos cinco
// anos, é ele que o contador precisa, e é o único que prova que a nota foi
// autorizada. O XML assinado sozinho é só o que foi enviado — sem o protocolo
// ele não prova nada. Por isso o nfeProc vem primeiro e marcado como
// principal: numa lista de dois links parecidos, quem está com pressa clica
// no primeiro.

export function arquivosDaNota(documento = {}) {
  const arquivos = [];
  const chave = documento.chave || 'nota';

  if (documento.nfeproc_path) {
    arquivos.push({
      path: documento.nfeproc_path,
      rotulo: 'XML autorizado (nfeProc)',
      descricao: 'Nota assinada com o protocolo da SEFAZ — é o arquivo que vale para guarda e para o contador.',
      nomeArquivo: `${chave}-procNFe.xml`,
      principal: true,
    });
  }

  if (documento.xml_path) {
    arquivos.push({
      path: documento.xml_path,
      rotulo: 'XML assinado (sem protocolo)',
      descricao: 'O que foi transmitido à SEFAZ, antes da resposta. Não prova autorização.',
      nomeArquivo: `${chave}.xml`,
      principal: false,
    });
  }

  return arquivos;
}

// Uma nota pode estar autorizada e mesmo assim não ter arquivo: a gravação no
// Storage é melhor-esforço em lib/nfe/emitir.js, de propósito — se o upload
// falhar, a nota CONTINUA autorizada (a SEFAZ já disse sim) e reverter seria
// pior. A tela precisa saber diferenciar "não tem arquivo" de "não emitiu",
// para não sugerir que a emissão falhou quando o que falhou foi o upload.
export function faltaArquivoDeNotaAutorizada(documento = {}) {
  return documento.status === 'autorizado' && arquivosDaNota(documento).length === 0;
}
