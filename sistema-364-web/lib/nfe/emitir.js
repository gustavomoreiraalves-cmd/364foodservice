// lib/nfe/emitir.js
//
// Pipeline de emissão da NF-e de saída: junta pedido, cliente, produtos e
// tributos, grava o documento em banco, reserva numeração, monta e assina o
// XML, transmite à SEFAZ (NFeAutorizacao4, síncrono) e grava o veredito.
//
// A ORDEM IMPORTA e é a mesma do plano (docs/superpowers/plans/
// 2026-08-25-motor-emissao-nfe-nucleo.md, Task 6): tudo que pode falhar
// barato (autorização, validação de cadastro, resolução de tributos,
// certificado ausente/vencido, configuração inativa) roda ANTES de
// reservar_numero_fiscal. Depois de reservar, um número foi gasto — e depois
// de transmitir, a SEFAZ já viu a nota, então nem o número pode ser reusado
// (rever "Reaproveitamento de número" abaixo).
//
// Achado da revisão (fix round 1): o status 'enviado' é gravado ANTES de
// chamar a SEFAZ, não depois. O fato que precisa ficar durável antes da
// chamada de rede é "estamos prestes a deixar a SEFAZ ver este número", não
// "a SEFAZ já respondeu" — gravar depois deixava uma janela em que a
// transmissão podia ter sido aceita pela SEFAZ e o banco, mesmo assim,
// continuar mostrando um status reaproveitável (uma falha de escrita bem
// ali no meio bastava). Ver o comentário do passo 7, abaixo.
//
// Quem chama (app/api/fiscal/emitir-nfe/route.js) já fez autorizarModulo() e
// garantirEmpresa() antes de invocar esta função — aqui dentro só se lê o que
// o pedido, o cliente e o emitente precisam, sempre com sb (service role) já
// escopado pela rota.
import { dadosEmitente } from './emitente.js';
import { resolverNota } from './resolverNota.js';
import { montarXmlNFe } from './montarXml.js';
import { assinarXml } from '../sefaz/assinatura.js';
import { chamarSefaz } from '../sefaz/transporte.js';
import { envelopeSoap, extrairCorpoResposta, lerCampos } from '../sefaz/envelope.js';
import { endpointSefaz, namespaceServico, acaoSoapServico } from '../sefaz/endpoints.js';
import { obterCertificadoAtivo, extrairChaveECert, statusCertificado } from '../certificadoServer.js';

const MODELO = '55';

// Bucket privado já existente (reaproveitado de app/api/nfe/upload/route.js,
// que grava XML de entrada no mesmo bucket sob outro prefixo) — evita criar
// um bucket novo, e portanto uma migração nova, só para isto. RLS do bucket
// não importa aqui: quem escreve é sempre o client de service role que a
// rota já injeta.
const BUCKET_XML = 'recebimentos';

// Estados em que uma nova tentativa para o MESMO pedido reaproveita o mesmo
// documento e (quando já existir) o mesmo número — porque a SEFAZ ainda não
// viu nada. A partir de 'enviado' (gravado ANTES de chamar a SEFAZ — ver o
// passo 7), uma nova tentativa NUNCA reaproveita nem o documento nem o
// número: o anterior já pode ter sido visto pela SEFAZ e não pode voltar.
const STATUS_REAPROVEITAVEL = ['rascunho', 'numero_reservado', 'assinado'];

// Estados pós-transmissão cujo veredito da SEFAZ não ficou registrado de
// forma confiável neste sistema: 'enviado' sem nunca ter avançado para
// 'autorizado'/'rejeitado' (o UPDATE que gravaria o veredito falhou, ou o
// processo caiu no meio) e 'erro_comunicacao' (a chamada à SEFAZ falhou sem
// resposta — pode ter sido recebida e processada mesmo assim). Em nenhum dos
// dois emitir de novo para o mesmo pedido é seguro: pode duplicar uma nota
// que a SEFAZ já autorizou. 'rejeitado' fica de fora deste conjunto de
// propósito — ali o veredito da SEFAZ é conhecido e está gravado, então uma
// nova tentativa com número novo é o fluxo normal esperado.
const STATUS_INDETERMINADO = ['enviado', 'erro_comunicacao'];

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

// ambiente_nfe é o campo que o emitente usa para decidir, de propósito
// explícito (comentário da atualização 36: "passar para 1 é uma decisão
// explícita"), se a emissão sai em produção ou homologação. Não existe
// per-pedido: é uma propriedade do CNPJ emissor.
function ambienteDoEmpregador(empregador) {
  if (empregador.ambiente_nfe === 1) return 'producao';
  if (empregador.ambiente_nfe === 2) return 'homologacao';
  throw erro('O emitente não tem um ambiente de emissão (ambiente_nfe) válido configurado.', 500);
}

// A regra mais específica por item. `data` é sempre array (a função SQL é
// `returns setof regras_tributarias`, chamada via RPC do Supabase) — vazio
// significa "nenhuma regra casou", não erro; resolverNota (Task 4) é quem
// recusa isso, item a item, com uma mensagem que aponta para /fiscal/tributacao.
async function resolverRegraDoItem(sb, { empresaId, produto, naturezaOperacaoId, cliente }) {
  const { data, error } = await sb.rpc('fn_resolver_regra_tributaria', {
    p_empresa_id: empresaId,
    p_produto_id: produto.id,
    p_natureza_operacao_id: naturezaOperacaoId,
    p_uf_destino: cliente.uf,
    p_contribuinte: cliente.ind_ie_dest === 1 || cliente.ind_ie_dest === 2,
    p_consumidor_final: cliente.consumidor_final ?? null,
  });
  if (error) throw erro(`Falha ao resolver a tributação de "${produto.nome || produto.codigo}": ${error.message}`, 500);
  return (data || [])[0] || null;
}

// nfe_saida_itens congela o que o motor de regras decidiu nesta emissão — ver
// o comentário da atualização 43. Colunas conferidas contra
// supabase/atualizacao_43_nfe_saida.sql.
function linhaItem(documentoId, empresaId, item) {
  return {
    nfe_saida_documento_id: documentoId,
    empresa_id: empresaId,
    pedido_item_id: item.pedidoItemId,
    produto_id: item.produtoId,
    numero_item: item.numeroItem,
    codigo: item.cProd,
    descricao: item.xProd,
    ncm: item.NCM,
    cest: item.CEST || null,
    gtin: item.cEAN,
    cfop: item.CFOP,
    unidade: item.uCom,
    quantidade: item.quantidade,
    valor_unitario: item.valorUnitario,
    valor_total: item.vProd,
    origem_mercadoria: item.origem,
    csosn: item.csosn || null,
    cst_icms: item.cstIcms || null,
    base_calculo_icms: item.vBC,
    aliquota_icms: item.pICMS,
    valor_icms: item.vICMS,
    cst_pis: item.cstPis,
    aliquota_pis: item.pPIS,
    valor_pis: item.vPIS,
    cst_cofins: item.cstCofins,
    aliquota_cofins: item.pCOFINS,
    valor_cofins: item.vCOFINS,
    regra_tributaria_id: item.regraTributariaId || null,
  };
}

// { sb, pedido, naturezaOperacaoId, userId } → { status, chave, numero, protocolo, motivo }
//
// `pedido` já vem carregado e com a empresa conferida (garantirEmpresa) por
// quem chamou — aqui só falta o resto: cliente, itens, produtos, emitente,
// configuração de emissão e certificado.
export async function emitirNfe({ sb, pedido, naturezaOperacaoId, userId }) {
  // ---------- 1. Carregar tudo (nada disto gasta número) ----------
  const [
    { data: itensPedido, error: erroItens },
    { data: cliente, error: erroCliente },
    { data: empresa, error: erroEmpresa },
    { data: documentoExistente, error: erroDocumentoExistente },
  ] = await Promise.all([
    sb.from('pedido_itens').select('id, produto_id, quantidade, preco_unitario').eq('pedido_id', pedido.id),
    sb.from('clientes').select('*').eq('id', pedido.cliente_id).maybeSingle(),
    sb.from('empresas').select('id, empregador_id, informacoes_complementares_padrao').eq('id', pedido.empresa_id).maybeSingle(),
    // A mais recente: um pedido pode acumular mais de um documento ao longo do
    // tempo (cada tentativa pós-'enviado' cria uma linha nova — ver
    // STATUS_REAPROVEITAVEL). É sempre a última que representa o estado atual.
    sb.from('nfe_saida_documentos').select('*').eq('pedido_id', pedido.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (erroItens) throw erro(`Falha ao carregar os itens do pedido: ${erroItens.message}`, 500);
  if (!itensPedido?.length) throw erro('O pedido não tem itens para emitir.');
  if (erroCliente) throw erro(`Falha ao carregar o cliente: ${erroCliente.message}`, 500);
  if (!cliente) throw erro('O cliente deste pedido não foi encontrado.');
  if (erroEmpresa) throw erro(`Falha ao carregar a empresa: ${erroEmpresa.message}`, 500);
  if (!empresa?.empregador_id) throw erro('Esta marca não tem pessoa jurídica vinculada. Vincule em /empresas antes de emitir.');
  if (erroDocumentoExistente) throw erro(`Falha ao verificar documento fiscal existente: ${erroDocumentoExistente.message}`, 500);

  // Falha mais barata de todas: nem vale a pena resolver tributos se este
  // pedido já tem uma NF-e autorizada. Emitir de novo duplicaria a nota.
  if (documentoExistente?.status === 'autorizado') {
    throw erro(
      `Este pedido já tem uma NF-e autorizada (chave ${documentoExistente.chave}, `
      + `protocolo ${documentoExistente.protocolo_autorizacao}). Não é possível emitir de novo para o mesmo pedido.`,
      409,
    );
  }

  // Achado da revisão (fix round 1, Crítico 2): um documento parado em
  // 'enviado' ou 'erro_comunicacao' já foi transmitido, mas o que a SEFAZ
  // decidiu não ficou gravado de forma confiável aqui (o UPDATE do veredito
  // falhou, o processo caiu no meio, ou a resposta HTTP nunca chegou). Sem
  // esta parada, uma nova tentativa criava um documento NOVO com número NOVO
  // e reenviava — se a nota anterior tiver sido autorizada, duas notas
  // autorizadas para o mesmo pedido. Aqui não adivinhamos: paramos e mandamos
  // conferir com a SEFAZ antes de qualquer coisa. (Reconciliação automática
  // via NfeConsultaProtocolo4 é a resposta completa e já está arquivada como
  // tarefa separada — esse serviço ainda não existe.)
  if (documentoExistente && STATUS_INDETERMINADO.includes(documentoExistente.status)) {
    throw erro(
      `Este pedido já teve uma NF-e transmitida à SEFAZ (chave ${documentoExistente.chave}) cujo resultado `
      + 'não ficou confirmado neste sistema. Antes de tentar emitir de novo, confira essa chave diretamente '
      + 'na SEFAZ (consulta de protocolo) — emitir agora arrisca autorizar duas notas para o mesmo pedido.',
      409,
    );
  }

  const produtoIds = [...new Set(itensPedido.map(i => i.produto_id))];
  const [
    { data: produtos, error: erroProdutos },
    { data: empregador, error: erroEmpregador },
    { data: natureza, error: erroNatureza },
  ] = await Promise.all([
    sb.from('produtos').select('*').in('id', produtoIds),
    sb.from('empregadores').select('*').eq('id', empresa.empregador_id).maybeSingle(),
    sb.from('naturezas_operacao').select('id, descricao, empresa_id, tipo_operacao, ativo').eq('id', naturezaOperacaoId).maybeSingle(),
  ]);
  if (erroProdutos) throw erro(`Falha ao carregar os produtos: ${erroProdutos.message}`, 500);
  if (erroEmpregador) throw erro(`Falha ao carregar o emitente: ${erroEmpregador.message}`, 500);
  if (!empregador) throw erro('A pessoa jurídica (emitente) desta empresa não foi encontrada.', 500);
  if (erroNatureza) throw erro(`Falha ao carregar a natureza da operação: ${erroNatureza.message}`, 500);
  // Mesmo id inexistente e id de outra empresa dão a mesma mensagem — evita
  // que a rota vire oráculo de ids de outra marca.
  if (!natureza || natureza.empresa_id !== pedido.empresa_id) {
    throw erro('Natureza da operação não encontrada.');
  }
  if (!natureza.ativo) {
    throw erro(`A natureza "${natureza.descricao}" está inativa. Reative-a ou escolha outra.`);
  }
  if (natureza.tipo_operacao !== 'saida') {
    throw erro(`A natureza "${natureza.descricao}" é de entrada, não de saída — escolha outra para emitir esta NF-e.`);
  }

  const ambiente = ambienteDoEmpregador(empregador);

  // ---------- Configuração de emissão (série ativa) e certificado ----------
  // Duas falhas baratas e clássicas desta tela: série não ativada e
  // certificado vencido/ausente. As duas travam ANTES de resolver tributos.
  const { data: config, error: erroConfig } = await sb.from('empresas_emissao_fiscal')
    .select('serie, ativo').eq('empresa_id', empresa.id).eq('modelo', MODELO).eq('ambiente', ambiente).maybeSingle();
  if (erroConfig) throw erro(`Falha ao carregar a configuração de emissão: ${erroConfig.message}`, 500);
  if (!config?.ativo) {
    throw erro(
      `A emissão de NF-e (modelo 55, ambiente ${ambiente}) não está ativa para esta marca. `
      + 'Configure a série em /fiscal/emissor antes de emitir.',
    );
  }

  let certificado;
  try {
    certificado = await obterCertificadoAtivo(empresa.empregador_id);
  } catch (e) {
    // Mensagem de obterCertificadoAtivo nunca carrega pfx/senha — só o texto
    // de erro do Supabase ou da decifragem (ver lib/certificadoServer.js).
    throw erro(e.message, 500);
  }
  if (!certificado) {
    throw erro('Nenhum certificado A1 ativo para o CNPJ desta marca. Envie o certificado em /empresas.', 400);
  }
  // Achado da revisão (fix round 1, Crítico 1): `ativo` é uma flag manual —
  // só muda quando alguém envia um substituto (ver
  // app/api/empresas/[id]/certificado/route.js) — e não tem nenhuma relação
  // com a validade de calendário. Sem esta checagem, um certificado vencido
  // mas ainda `ativo` só seria descoberto lá na frente, no handshake mTLS da
  // transmissão — depois de já ter reservado número e assinado o XML. Mesmo
  // padrão de app/api/fiscal/testar-conexao/route.js.
  const { status: statusCert, diasParaVencer } = statusCertificado(certificado.meta.valido_ate);
  if (statusCert === 'vencido') {
    const dataVencimento = new Date(certificado.meta.valido_ate).toLocaleDateString('pt-BR');
    throw erro(
      `O certificado A1 desta marca venceu em ${dataVencimento} (há ${Math.abs(diasParaVencer)} dia(s)). `
      + 'Envie um certificado novo em /empresas antes de emitir.',
      400,
    );
  }

  // ---------- 2. Resolver tributos item a item e resolver a nota ----------
  const produtoPorId = new Map((produtos || []).map(p => [p.id, p]));
  const itensParaResolver = [];
  for (const pedidoItem of itensPedido) {
    const produto = produtoPorId.get(pedidoItem.produto_id);
    if (!produto) throw erro(`O produto do item ${pedidoItem.id} do pedido não foi encontrado.`);
    const regra = await resolverRegraDoItem(sb, { empresaId: pedido.empresa_id, produto, naturezaOperacaoId, cliente });
    itensParaResolver.push({ pedidoItem, produto, regra });
  }

  const emitente = dadosEmitente(empregador);
  // Achado da revisão da Task 5: montarXml lê
  // nota.emit.informacoesComplementaresPadrao, mas nada populava o campo até
  // aqui. É aqui, no pipeline, que ele precisa ser anexado ao emitente ANTES
  // de resolverNota — resolverNota carrega `emit` para dentro do objeto
  // neutro sem alterá-lo, então isto é o único lugar que precisa fazer isto.
  emitente.informacoesComplementaresPadrao = empresa.informacoes_complementares_padrao || undefined;

  const nota = resolverNota({ pedido, cliente, itens: itensParaResolver, emitente, naturezaOperacao: natureza, ambiente });

  // montarXmlNFe (Task 5) recusa operação interestadual e regime normal, mas
  // só descobre isso ao montar o XML — depois de reservar_numero_fiscal no
  // nosso pipeline. As duas checagens abaixo são exatamente as mesmas dela,
  // só que rodam aqui, ainda de graça, usando dados que `nota` já tem prontos
  // (idDest e CRT não dependem de número/série nenhum). Se algum dia
  // montarXml.js mudar essas condições, replicar a mudança aqui.
  if (String(nota.ide.idDest) !== '1') {
    throw erro(
      'Operação interestadual (idDest diferente de 1) não é coberta por esta fase do motor de '
      + 'emissão. Só operação interna (mesma UF do emitente e do destinatário) é suportada aqui.',
    );
  }
  const crt = String(nota.emit.CRT);
  if (crt !== '1' && crt !== '2') {
    throw erro(
      `Regime normal (CRT = ${crt}) não é coberto por esta fase do motor de emissão. Só CRT 1 ou 2 `
      + '(Simples Nacional) é suportado aqui.',
    );
  }

  // ---------- 3. Gravar em rascunho, com os itens resolvidos ----------
  const reaproveitar = documentoExistente && STATUS_REAPROVEITAVEL.includes(documentoExistente.status);
  const valorTotal = nota.total.vNF;

  let documento;
  if (reaproveitar) {
    const { data, error } = await sb.from('nfe_saida_documentos').update({
      empregador_id: empresa.empregador_id,
      natureza_operacao_id: naturezaOperacaoId,
      ambiente,
      valor_total: valorTotal,
      status: 'rascunho',
      motivo_rejeicao: null,
    }).eq('id', documentoExistente.id).select('*').single();
    if (error) throw erro(`Falha ao atualizar o documento fiscal: ${error.message}`, 500);
    documento = data;
  } else {
    const { data, error } = await sb.from('nfe_saida_documentos').insert([{
      empresa_id: pedido.empresa_id,
      empregador_id: empresa.empregador_id,
      pedido_id: pedido.id,
      natureza_operacao_id: naturezaOperacaoId,
      modelo: MODELO,
      ambiente,
      status: 'rascunho',
      valor_total: valorTotal,
      criado_por: userId,
    }]).select('*').single();
    if (error) throw erro(`Falha ao criar o documento fiscal: ${error.message}`, 500);
    documento = data;
  }

  // A regra pode ter mudado desde uma tentativa anterior (correção de
  // alíquota, CFOP etc.) — os itens são sempre regravados do zero a partir do
  // que acabou de ser resolvido, nunca só complementados.
  const { error: erroLimpaItens } = await sb.from('nfe_saida_itens').delete().eq('nfe_saida_documento_id', documento.id);
  if (erroLimpaItens) throw erro(`Falha ao limpar os itens fiscais de uma tentativa anterior: ${erroLimpaItens.message}`, 500);

  const linhasItens = nota.itens.map(item => linhaItem(documento.id, pedido.empresa_id, item));
  const { error: erroGravaItens } = await sb.from('nfe_saida_itens').insert(linhasItens);
  if (erroGravaItens) throw erro(`Falha ao gravar os itens fiscais: ${erroGravaItens.message}`, 500);

  // ---------- 4. Reservar número — só se o documento ainda não tiver um ----------
  // `documento.numero` já vem preenchido quando reaproveitamos um documento
  // que chegou a 'numero_reservado' ou 'assinado' numa tentativa anterior:
  // nesse caso o número já foi visto por NINGUÉM fora deste processo (a SEFAZ
  // não), então ele continua bom e reservar de novo desperdiçaria numeração.
  let { serie, numero } = documento;
  // Se o ambiente do emitente mudou entre uma tentativa e outra (raro — só
  // acontece se alguém trocar homologação/produção no meio do caminho), um
  // número já reservado no ambiente velho pertence à sequência errada de
  // fiscal_numeracao (chaveada também por ambiente). Mais seguro tratar como
  // se não houvesse número nenhum e reservar de novo no ambiente certo.
  if (numero != null && documento.ambiente !== ambiente) {
    numero = null;
    serie = null;
  }
  if (numero == null) {
    serie = config.serie;
    const { data: reservado, error: erroReserva } = await sb.rpc('reservar_numero_fiscal', {
      p_empregador_id: empresa.empregador_id, p_modelo: MODELO, p_ambiente: ambiente, p_serie: serie,
    });
    if (erroReserva) throw erro(`Falha ao reservar a numeração fiscal: ${erroReserva.message}`, 500);
    // reservar_numero_fiscal é `returns setof int`: array vazio (não null,
    // não zero escalar) é como a função sinaliza "esta série não está
    // configurada em fiscal_numeracao" — ver o comentário da atualização 43.
    if (!Array.isArray(reservado) || reservado.length === 0) {
      throw erro(
        `A numeração fiscal (modelo 55, série ${serie}, ambiente ${ambiente}) não está configurada `
        + 'para esta marca. Configure em /fiscal/emissor.',
      );
    }
    numero = reservado[0];
    const { error: erroGravaNumero } = await sb.from('nfe_saida_documentos')
      .update({ serie, numero }).eq('id', documento.id);
    if (erroGravaNumero) throw erro(`Falha ao gravar o número reservado: ${erroGravaNumero.message}`, 500);
  }

  // ---------- 5. Montar XML e chave → numero_reservado ----------
  const dataEmissao = new Date();
  const { xml, chave, codigoNumerico } = montarXmlNFe(nota, { serie, numero, ambiente, dataEmissao });
  {
    const { error } = await sb.from('nfe_saida_documentos')
      .update({ chave, codigo_numerico: codigoNumerico, status: 'numero_reservado' })
      .eq('id', documento.id);
    if (error) throw erro(`Falha ao gravar o XML/chave: ${error.message}`, 500);
  }

  // ---------- 6. Assinar → assinado ----------
  // certificado.pfx/senha nunca saem desta função: só chavePrivadaPem e
  // certificadoPem (derivados aqui) alimentam assinarXml, e nem esses dois
  // aparecem em resposta ou log — só entram na assinatura, em memória.
  let xmlAssinado;
  try {
    const { chavePrivadaPem, certificadoPem } = extrairChaveECert(certificado.pfx, certificado.senha);
    xmlAssinado = assinarXml(xml, { chavePrivadaPem, certificadoPem, tagReferencia: 'infNFe' });
  } catch (e) {
    // Nunca inclui chave/senha: extrairChaveECert e assinarXml só lançam texto
    // sobre formato/senha do arquivo, nunca o material em si.
    throw erro(`Falha ao assinar a nota: ${e.message}`, 500);
  }
  {
    const { error } = await sb.from('nfe_saida_documentos').update({ status: 'assinado' }).eq('id', documento.id);
    if (error) throw erro(`Falha ao gravar o status assinado: ${error.message}`, 500);
  }

  // ---------- 7. Marcar 'enviado' — ANTES de chamar a SEFAZ ----------
  // Achado da revisão (fix round 1, Crítico 2): esta gravação precisa
  // acontecer ANTES da chamada de rede, não depois. O fato que precisa ficar
  // durável antes do passo arriscado é "estamos prestes a deixar a SEFAZ ver
  // este número" — não "a SEFAZ já respondeu".
  //
  // Se este UPDATE falhar, abortamos AQUI: nada foi transmitido, o documento
  // fica em 'assinado' (ainda em STATUS_REAPROVEITAVEL) e uma nova tentativa
  // reaproveita o mesmo número sem risco — o pior caso vira "não emitiu",
  // recuperável (lacuna na numeração, ou inutilização depois).
  //
  // A ordem antiga gravava 'enviado' só depois de chamarSefaz retornar: se a
  // SEFAZ autorizasse a nota e o UPDATE seguinte falhasse, o documento ficava
  // parado em 'assinado' — reaproveitável — e uma nova tentativa reservava o
  // MESMO número e reenviava a MESMA chave para uma nota que a SEFAZ já podia
  // ter autorizado: duas notas autorizadas para o mesmo pedido, o pior
  // cenário e exatamente o que este pipeline existe para evitar. Invertendo a
  // ordem, o pior caso possível vira um número queimado sem transmissão —
  // recuperável — nunca uma nota duplicada — irrecuperável.
  //
  // Daqui em diante o status nunca mais volta a ser
  // 'rascunho'/'numero_reservado'/'assinado': o número já está fora de jogo
  // para reaproveitamento, aconteça o que acontecer com a chamada abaixo.
  {
    const { error } = await sb.from('nfe_saida_documentos').update({ status: 'enviado' }).eq('id', documento.id);
    if (error) throw erro(`Falha ao gravar o status antes de transmitir a nota: ${error.message}`, 500);
  }

  // ---------- 8. Transmitir (NFeAutorizacao4, síncrono) ----------
  // idLote é só um identificador da nossa própria chamada (o layout pede um
  // número, não que ele signifique nada) — não é o nRec que a SEFAZ devolve.
  const idLote = String(Date.now());
  // O XML assinado carrega seu próprio prólogo <?xml ...?>; dentro de
  // <enviNFe> só pode haver um por documento, e esse é o de fora.
  const xmlSemProlog = xmlAssinado.replace(/^<\?xml[^>]*\?>/, '');
  const corpoEnviNFe = '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">'
    + `<idLote>${idLote}</idLote><indSinc>1</indSinc>${xmlSemProlog}</enviNFe>`;

  let respostaXml;
  try {
    respostaXml = await chamarSefaz({
      url: endpointSefaz('autorizacao', ambiente),
      corpoXml: envelopeSoap(corpoEnviNFe, namespaceServico('autorizacao')),
      acaoSoap: acaoSoapServico('autorizacao'),
      pfx: certificado.pfx,
      senha: certificado.senha,
    });
  } catch (e) {
    // O documento já está em 'enviado' desde o passo anterior — o número já
    // está fora de jogo para reaproveitamento, não importa o que este UPDATE
    // faça a seguir. Aqui só refinamos o status/motivo para quem for
    // investigar manualmente: 'erro_comunicacao' registra que a chamada
    // falhou sem resposta (pode ter sido recebida e processada pela SEFAZ
    // mesmo assim — por isso STATUS_INDETERMINADO barra uma nova tentativa
    // até alguém confirmar).
    //
    // Achado da revisão (Crítico 3): esta gravação tinha o erro descartado
    // em silêncio. Agora é checado — se falhar, o documento continua em
    // 'enviado' (já barrado do mesmo jeito por STATUS_INDETERMINADO), só sem
    // o motivo anexado, e a mensagem abaixo diz isso em vez de fingir que
    // gravou.
    const { error: erroMotivo } = await sb.from('nfe_saida_documentos')
      .update({ status: 'erro_comunicacao', motivo_rejeicao: e.message }).eq('id', documento.id);
    const sufixoMotivo = erroMotivo
      ? ` (e também falhou ao registrar o motivo do erro de comunicação: ${erroMotivo.message})`
      : '';
    // e.message é do chamarSefaz, que documenta nunca carregar material de
    // certificado (só excerto de resposta HTTP da própria SEFAZ).
    throw erro(
      `Falha ao transmitir a nota à SEFAZ: ${e.message}${sufixoMotivo}. O resultado desta nota `
      + `(chave ${chave}) ficou indeterminado — confirme na SEFAZ antes de tentar emitir de novo para `
      + 'este pedido.',
      502,
    );
  }

  // ---------- 9. Ler o retorno e gravar o veredito ----------
  // A resposta síncrona traz cStat no nível do lote E dentro de
  // protNFe/infProt. O veredito da NOTA (100 = autorizada) só pode vir do
  // segundo — ler o do lote (ex.: 104 "lote processado") marcaria como
  // autorizada uma nota que a SEFAZ rejeitou. Ver o comentário de
  // lerCampos em lib/sefaz/envelope.js.
  //
  // A partir daqui os UPDATEs só REFINAM o resultado (autorizado/rejeitado,
  // recibo_lote) — o documento já é irreversivelmente não-reaproveitável
  // desde o passo 7, então nada aqui muda esse fato caso falhe.
  const corpoResposta = extrairCorpoResposta(respostaXml);
  const lote = lerCampos(corpoResposta, ['cStat', 'xMotivo', 'nRec']);
  const veredito = lerCampos(corpoResposta, ['cStat', 'xMotivo', 'nProt'], { dentroDe: 'infProt' });

  if (veredito.cStat === '100') {
    // Guarda o XML assinado que a SEFAZ autorizou, melhor esforço: se o
    // Storage falhar aqui a nota CONTINUA autorizada de verdade (a SEFAZ já
    // disse sim) — não é razão para reverter o status.
    let xmlPath = null;
    try {
      const caminho = `${pedido.empresa_id}/nfe-saida/${chave}.xml`;
      const { error: erroUpload } = await sb.storage.from(BUCKET_XML)
        .upload(caminho, Buffer.from(xmlAssinado, 'utf8'), { contentType: 'application/xml', upsert: true });
      if (!erroUpload) xmlPath = caminho;
    } catch {
      // Melhor esforço — ver comentário acima.
    }

    const { error } = await sb.from('nfe_saida_documentos').update({
      status: 'autorizado',
      recibo_lote: lote.nRec || null,
      protocolo_autorizacao: veredito.nProt,
      xml_path: xmlPath,
      emitida_em: new Date().toISOString(),
    }).eq('id', documento.id);
    if (error) {
      // Se este UPDATE falhar, o documento fica parado em 'enviado' — a
      // SEFAZ autorizou de verdade (é o que está sendo dito aqui), mas este
      // sistema não conseguiu registrar isso. STATUS_INDETERMINADO barra
      // qualquer nova tentativa para este pedido até alguém confirmar; por
      // isso a mensagem nomeia protocolo e chave.
      throw erro(
        `A nota foi autorizada pela SEFAZ (protocolo ${veredito.nProt}, chave ${chave}), mas falhou ao `
        + `gravar isso neste sistema: ${error.message}. A nota está autorizada de verdade — não tente `
        + 'emitir de novo para este pedido; registre manualmente ou concilie com a SEFAZ.',
        500,
      );
    }

    return { status: 'autorizado', chave, numero, protocolo: veredito.nProt, motivo: null };
  }

  // Rejeitada: prioriza o veredito de dentro de infProt; cai para o do lote só
  // se a nota nem chegou a ter protNFe (lote inteiro rejeitado antes disso).
  const motivo = veredito.cStat
    ? `${veredito.cStat} - ${veredito.xMotivo}`
    : `${lote.cStat} - ${lote.xMotivo}`;

  const { error: erroGravaRejeitado } = await sb.from('nfe_saida_documentos')
    .update({ status: 'rejeitado', recibo_lote: lote.nRec || null, motivo_rejeicao: motivo }).eq('id', documento.id);
  if (erroGravaRejeitado) {
    // Mesmo raciocínio do bloco de autorização acima: se este UPDATE falhar,
    // o documento fica em 'enviado' e STATUS_INDETERMINADO barra uma nova
    // tentativa até alguém confirmar na SEFAZ — mesmo a rejeição sendo, na
    // prática, um resultado seguro para reemitir, este sistema não tem como
    // confiar nisso se nem este UPDATE vingou.
    throw erro(
      `A nota foi rejeitada pela SEFAZ (${motivo}, chave ${chave}), mas falhou ao gravar isso neste `
      + `sistema: ${erroGravaRejeitado.message}.`,
      500,
    );
  }

  return { status: 'rejeitado', chave, numero, protocolo: null, motivo };
}
