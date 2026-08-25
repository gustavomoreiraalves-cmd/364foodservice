// Regras de cadastro de fornecedor, compartilhadas pela tela de Fornecedores e
// pelo cadastro rápido que abre no recebimento quando o XML traz um emitente
// desconhecido. Função pura: sem rede, sem banco, sem estado.

import { enderecoParaGravar } from './endereco.js';

export const CATEGORIAS_FORNECEDOR = ['Carnes', 'Temperos', 'Embalagens', 'Equipamentos', 'Serviços', 'Outros'];

// O documento é gravado só com dígitos: é assim que ele vem no XML da NF-e, e é
// por igualdade exata que a importação encontra o fornecedor da nota. Fornecedor
// cadastrado como 12.345.678/0001-99 nunca casava com a nota.
export const soDigitos = v => String(v || '').replace(/\D/g, '');

const FORM_VAZIO = {
  nome: '', nome_fantasia: '', cnpj: '', categoria: 'Outros', contato: '', telefone: '', email: '',
  logradouro: '', numero: '', complemento: '', bairro: '', codigo_municipio_ibge: '', municipio: '', uf: '', cep: '',
};

// Monta o formulário do cadastro rápido a partir do `fornecedorSugerido` que a
// rota /preparar devolve. Campo que a nota não traz vem null de lá e precisa
// virar string vazia: `value={null}` transforma um input controlado em não
// controlado no meio do caminho, e o campo para de responder.
//
// A NF-e não diz a categoria do fornecedor, então o padrão é "Outros" — afirmar
// "Carnes" por um frigorífico seria adivinhar, e o operador troca no próprio
// pop-up quando quiser.
export function formularioDaNota(sugestao) {
  if (!sugestao) return { ...FORM_VAZIO };
  return {
    ...FORM_VAZIO,
    nome: sugestao.nome || '',
    cnpj: soDigitos(sugestao.documento),
    telefone: sugestao.telefone || '',
    email: sugestao.email || '',
  };
}

// Campo opcional em branco vai como null: a coluna é opcional e string vazia não
// passa no check de "só dígitos" da atualização 23.
const ouNulo = v => (String(v || '').trim() || null);

export function fornecedorParaGravar(form) {
  return {
    nome: String(form.nome || '').trim(),
    nome_fantasia: ouNulo(form.nome_fantasia),
    cnpj: soDigitos(form.cnpj) || null,
    categoria: form.categoria || 'Outros',
    contato: ouNulo(form.contato),
    telefone: soDigitos(form.telefone) || null,
    email: ouNulo(form.email),
    ...enderecoParaGravar(form),
  };
}

// A atualização 23 criou um índice único em (empresa_id, cnpj). Bater nele quer
// dizer que o fornecedor já está cadastrado — em geral porque outra aba acabou
// de cadastrá-lo. Isso é uma instrução, não um erro de banco na cara do operador.
// Qualquer outro erro continua aparecendo como veio, que é o que ajuda a
// diagnosticar (RLS recusada, coluna faltando, check de dígitos).
export function mensagemAoCadastrar(erro) {
  if (erro?.code === '23505') {
    return 'Já existe um fornecedor com este CNPJ/CPF nesta empresa. Feche este pop-up e '
      + 'escolha-o na lista de fornecedores do recebimento.';
  }
  return 'Não foi possível cadastrar o fornecedor: ' + (erro?.message || 'erro desconhecido');
}
