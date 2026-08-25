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
  statusServico: 'NfeStatusServico/NfeStatusServico4.asmx',
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
