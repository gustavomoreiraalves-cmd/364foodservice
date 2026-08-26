//
// Endereços dos webservices da NF-e. Rondônia não tem SEFAZ própria para NF-e:
// autoriza pela SVRS (Sefaz Virtual do Rio Grande do Sul). Por isso os hosts
// abaixo são svrs.rs.gov.br e não sefaz.ro.gov.br.
//
// Fonte: portal da SVRS (dfe-portal.svrs.rs.gov.br/NFE/Servicos), consultado em
// 2026-08-25. O Manual de Integração muda de tempos em tempos e uma UF pode
// migrar de ambiente virtual — quando a comunicação parar de funcionar sem que
// o código tenha mudado, é aqui que se olha primeiro. A tela /fiscal/emissor
// tem um botão "Testar conexão" justamente para essa conferência.

export const CUF_RONDONIA = '11';

const BASE = {
  producao: 'https://nfe.svrs.rs.gov.br/ws',
  homologacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws',
};

const CAMINHO = {
  // O segundo segmento (nome do arquivo .asmx, sem extensão) também é a fonte
  // do nome de serviço WSDL usado em namespaceServico() abaixo — por isso a
  // grafia "NFeStatusServico4" (F maiúsculo) importa aqui: é o nome real do
  // serviço, confirmado batendo com o SOAP Fault que a SEFAZ devolveu em
  // homologação. O path em si é tolerante a maiúscula/minúscula (IIS/ASMX),
  // mas o nome derivado dele não pode ser.
  statusServico: 'NfeStatusServico/NFeStatusServico4.asmx',
  autorizacao: 'NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  recepcaoEvento: 'recepcaoevento/recepcaoevento4.asmx',
  // consultaProtocolo: a máquina de estados da próxima etapa usa isto para se
  // recuperar de um timeout — reenviar de novo arrisca duplicar a nota, mas
  // consultar o protocolo pelo mesmo cUF/chave é seguro e resolve o "não sei
  // se autorizou ou não" sem reemitir.
  consultaProtocolo: 'NfeConsultaProtocolo/NfeConsultaProtocolo4.asmx',
  // inutilizacao: a numeração usa isto para pular um número queimado (nota
  // cancelada antes de transmitir, erro de sequência etc.) sem deixar buraco
  // não declarado na sequência do modelo/série.
  inutilizacao: 'NfeInutilizacao/NfeInutilizacao4.asmx',
};

// A configuração guarda 'producao'/'homologacao'; o XML da NF-e usa tpAmb 1/2.
// Traduzir num só lugar evita que os dois vocabulários se misturem no resto do
// código — trocar os dois valores por engano manda nota de teste para produção.
export function tpAmb(ambiente) {
  if (ambiente === 'producao') return '1';
  if (ambiente === 'homologacao') return '2';
  throw new Error(`Ambiente inválido: ${ambiente}. Use 'producao' ou 'homologacao'.`);
}

export function endpointSefaz(servico, ambiente) {
  const base = BASE[ambiente];
  if (!base) throw new Error(`Ambiente inválido: ${ambiente}. Use 'producao' ou 'homologacao'.`);
  const caminho = CAMINHO[servico];
  if (!caminho) throw new Error(`Serviço desconhecido: ${servico}.`);
  return `${base}/${caminho}`;
}

// Nome do serviço tal como o WSDL o declara: o nome do arquivo .asmx em
// CAMINHO, sem extensão. Deriva do mesmo CAMINHO que monta a URL — de
// propósito, para não existir uma segunda lista que possa divergir dele.
function nomeServicoWsdl(servico) {
  const caminho = CAMINHO[servico];
  if (!caminho) throw new Error(`Serviço desconhecido: ${servico}.`);
  const arquivo = caminho.split('/').pop();
  return arquivo.replace(/\.asmx$/i, '');
}

// Namespace do elemento <nfeDadosMsg> que envolve o payload dentro do
// soap:Body. Sem isso (ou com o namespace errado), a SEFAZ devolve
// soap:Fault/soap:Sender: ela recebeu a mensagem mas rejeitou a forma.
export function namespaceServico(servico) {
  return `http://www.portalfiscal.inf.br/nfe/wsdl/${nomeServicoWsdl(servico)}`;
}

// SOAPAction por serviço. No SOAP 1.2 isso vai como parâmetro `action` do
// Content-Type (não como header SOAPAction separado — isso era SOAP 1.1).
// Cada serviço tem um nome de método próprio dentro do seu WSDL, e esses
// nomes NÃO seguem um padrão uniforme entre si (serviços em lote usam verbos
// diferentes) — ao contrário do namespace, não dá para derivar isso de
// CAMINHO. Por isso só entra aqui o que já foi conferido contra o WSDL real;
// os demais devem ser adicionados um a um, na hora de implementar aquele
// fluxo, nunca por suposição. Pedir a ação de um serviço ainda não
// verificado lança, em vez de silenciosamente mandar a requisição sem
// SOAPAction ou com um verbo chutado — foi exatamente uma suposição não
// verificada (undici aceitando .pfx bruto) que causou esta sessão de debug.
const METODO_SOAP_VERIFICADO = {
  statusServico: 'nfeStatusServicoNF',
  // Conferidos contra o WSDL real via mTLS (não adivinhados) na Task 6 do motor
  // de emissão, 2026-08-25 — os dois confirmam nfeDadosMsg como elemento do
  // corpo, mesma forma dos demais serviços já verificados.
  autorizacao: 'nfeAutorizacaoLote',
  retAutorizacao: 'nfeRetAutorizacaoLote',
};

export function acaoSoapServico(servico) {
  const metodo = METODO_SOAP_VERIFICADO[servico];
  if (!metodo) {
    throw new Error(
      `SOAPAction de '${servico}' ainda não foi verificada contra o WSDL do serviço. `
      + 'Confira o método real no WSDL antes de implementar esse fluxo — não adivinhe.',
    );
  }
  return `${namespaceServico(servico)}/${metodo}`;
}
