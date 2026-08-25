// Consulta de CNPJ na Receita Federal (via BrasilAPI) para autopreencher o
// cadastro de clientes. Sem SINTEGRA aqui: inscrição estadual não tem fonte
// nacional gratuita e fica manual (ver botão "Consultar IE" na tela).
import { somenteDigitos, cnpjValido } from './cnpj.js';

const BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1';

export function mapearCnpjReceita(json) {
  return {
    nome: json.razao_social || '',
    nome_fantasia: json.nome_fantasia || '',
    logradouro: json.logradouro || '',
    numero: json.numero || '',
    complemento: json.complemento || '',
    bairro: json.bairro || '',
    municipio: json.municipio || '',
    uf: json.uf || '',
    cep: somenteDigitos(json.cep),
    codigo_municipio_ibge: json.codigo_municipio_ibge ? String(json.codigo_municipio_ibge) : '',
    situacaoCadastral: json.descricao_situacao_cadastral || '',
  };
}

export async function buscarCnpjReceita(cnpj, { fetchImpl = fetch } = {}) {
  const digitos = somenteDigitos(cnpj);
  if (!cnpjValido(digitos)) throw erro(400, 'CNPJ inválido.');

  let resposta;
  try {
    // A BrasilAPI fica atrás de um edge que devolve 403 pra requisições sem
    // User-Agent — o fetch nativo do Node não manda um por padrão.
    resposta = await fetchImpl(`${BASE_URL}/${digitos}`, {
      headers: { 'User-Agent': 'sistema-364-web (+https://sistema.364steakhouse.com)' },
    });
  } catch {
    throw erro(503, 'Não foi possível consultar a Receita Federal agora.');
  }
  if (resposta.status === 404) throw erro(404, 'CNPJ não encontrado na Receita Federal.');
  if (!resposta.ok) throw erro(502, 'Consulta à Receita Federal falhou.');

  return mapearCnpjReceita(await resposta.json());
}

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}
