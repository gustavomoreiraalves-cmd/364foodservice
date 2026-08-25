// Normalização de endereço compartilhada entre clientes e fornecedores — os
// dois lados têm exatamente os mesmos campos e precisam sair idênticos quando
// o parceiro está vinculado nos dois papéis. Função pura: sem rede, sem banco.

const soDigitos = v => String(v || '').replace(/\D/g, '');
const ouNulo = v => (String(v || '').trim() || null);

export function enderecoParaGravar(form) {
  return {
    logradouro: ouNulo(form.logradouro),
    numero: ouNulo(form.numero),
    complemento: ouNulo(form.complemento),
    bairro: ouNulo(form.bairro),
    codigo_municipio_ibge: soDigitos(form.codigo_municipio_ibge) || null,
    municipio: ouNulo(form.municipio),
    uf: (form.uf || '').toUpperCase().replace(/[^A-Z]/g, '') || null,
    cep: soDigitos(form.cep) || null,
  };
}
