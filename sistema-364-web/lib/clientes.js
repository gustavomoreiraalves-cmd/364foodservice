// Regras de cadastro de cliente: sanitização de campos antes de gravar, e o
// recorte comercial usado quando a atualização 36 (bloco fiscal) ainda não
// rodou no banco. Função pura: sem rede, sem Supabase, sem React.

const soDigitos = v => String(v || '').replace(/\D/g, '');
const ouNulo = v => (String(v || '').trim() || null);

export function clienteParaGravar(form) {
  return {
    nome: String(form.nome || '').trim(),
    nome_fantasia: ouNulo(form.nome_fantasia),
    cnpj: soDigitos(form.cnpj) || null,
    tipo: form.tipo || null,
    contato: ouNulo(form.contato),
    telefone: soDigitos(form.telefone) || null,
    tipo_pessoa: form.tipo_pessoa || 'J',
    cpf: soDigitos(form.cpf) || null,
    ie: soDigitos(form.ie) || null,
    ind_ie_dest: form.ind_ie_dest === '' || form.ind_ie_dest === null || form.ind_ie_dest === undefined
      ? null : Number(form.ind_ie_dest),
    consumidor_final: form.consumidor_final === undefined ? null : form.consumidor_final,
    logradouro: ouNulo(form.logradouro),
    numero: ouNulo(form.numero),
    complemento: ouNulo(form.complemento),
    bairro: ouNulo(form.bairro),
    codigo_municipio_ibge: soDigitos(form.codigo_municipio_ibge) || null,
    municipio: ouNulo(form.municipio),
    uf: (form.uf || '').toUpperCase().replace(/[^A-Z]/g, '') || null,
    cep: soDigitos(form.cep) || null,
    email_nfe: ouNulo(form.email_nfe),
  };
}

// Antes da atualização 36 o cadastro só tinha o recorte comercial; mandar as
// colunas do bloco dest para um banco sem elas derruba o insert inteiro.
export function recorteComercial(dados) {
  const { nome, nome_fantasia, cnpj, tipo, contato, telefone } = dados;
  return { nome, nome_fantasia, cnpj, tipo, contato, telefone };
}
