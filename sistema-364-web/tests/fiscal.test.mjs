import test from 'node:test';
import assert from 'node:assert/strict';
import {
  digitoVerificadorGtin, gtinValido, soDigitos,
  cestsDoNcm, pendenciasFiscaisProduto, prontoParaEmissao, SEM_GTIN,
  fatorConversaoTributavel,
  CAMPOS_COPIA_FISCAL, camposCopiaFiscal, gruposComRegra, situacaoFiscalProduto,
} from '../lib/fiscal.js';

test('dígito verificador do GTIN acompanha o do banco', () => {
  assert.equal(digitoVerificadorGtin('7891910000197'), 7);
  assert.equal(digitoVerificadorGtin('12345670'), 0);
  assert.equal(digitoVerificadorGtin('97898212822598'), 8); // GTIN-14 da nota do frigorífico
  assert.equal(digitoVerificadorGtin(''), null);
  assert.equal(digitoVerificadorGtin(null), null);
});

test('GTIN válido, inválido e o literal do layout', () => {
  assert.ok(gtinValido('7891910000197'));
  assert.ok(gtinValido('97898212822598'));
  assert.ok(gtinValido(SEM_GTIN));
  assert.ok(gtinValido(''), 'campo vazio ainda não é erro de cadastro');
  assert.ok(!gtinValido('7891910000198'), 'dígito verificador errado');
  assert.ok(!gtinValido('789'), 'tamanho fora de 8, 12, 13 e 14');
  assert.ok(!gtinValido('789191000019A'), 'letra no meio');
});

test('soDigitos limpa máscara sem destruir o resto', () => {
  assert.equal(soDigitos('0210.20.00'), '02102000');
  assert.equal(soDigitos('17.083.00'), '1708300');
  assert.equal(soDigitos(null), '');
});

test('CEST é oferecido só para o NCM escolhido', () => {
  const tabela = [
    { cest: '1708300', ncm: '02102000', descricao: 'bovina defumada' },
    { cest: '1708701', ncm: '02101900', descricao: 'suína defumada' },
    { cest: '1707906', ncm: '16025000', descricao: 'preparações bovinas' },
  ];
  assert.deepEqual(cestsDoNcm(tabela, '02102000').map(c => c.cest), ['1708300']);
  assert.deepEqual(cestsDoNcm(tabela, '0210.20.00').map(c => c.cest), ['1708300']);
  assert.deepEqual(cestsDoNcm(tabela, '99999999'), []);
  assert.equal(cestsDoNcm(tabela, '').length, 3, 'sem NCM escolhido, mostra tudo');
});

test('pendências dizem o que falta para faturar', () => {
  const completo = {
    ncm: '02102000', origem_mercadoria: 0, unidade: 'PC',
    unidade_tributavel: 'KG', fator_conversao_tributavel: 1.2,
    gtin: SEM_GTIN, gtin_tributavel: SEM_GTIN, sujeito_st: true, cest: '1708300',
    grupo_tributario_id: 'g1',
  };
  assert.deepEqual(pendenciasFiscaisProduto(completo), []);
  assert.ok(prontoParaEmissao(completo));

  assert.ok(pendenciasFiscaisProduto({ ...completo, ncm: null }).some(p => /NCM/.test(p)));
  assert.ok(pendenciasFiscaisProduto({ ...completo, origem_mercadoria: null }).some(p => /origem/i.test(p)));
  assert.ok(pendenciasFiscaisProduto({ ...completo, cest: null }).some(p => /CEST/.test(p)),
    'produto em ST sem CEST não fatura');
  assert.ok(pendenciasFiscaisProduto({ ...completo, grupo_tributario_id: null }).some(p => /tribut/i.test(p)));
  assert.ok(pendenciasFiscaisProduto({ ...completo, gtin: '7891910000198' }).some(p => /barras/i.test(p)));
});

test('produto fora da ST não precisa de CEST', () => {
  const semSt = {
    ncm: '16025000', origem_mercadoria: 0, unidade: 'UN',
    unidade_tributavel: 'UN', fator_conversao_tributavel: 1,
    sujeito_st: false, cest: null, grupo_tributario_id: 'g1',
  };
  assert.deepEqual(pendenciasFiscaisProduto(semSt), []);
});

test('escala não relevante exige o CNPJ do fabricante', () => {
  const base = {
    ncm: '02102000', origem_mercadoria: 0, unidade: 'UN', unidade_tributavel: 'UN',
    fator_conversao_tributavel: 1, sujeito_st: false, grupo_tributario_id: 'g1',
  };
  assert.deepEqual(pendenciasFiscaisProduto({ ...base, ind_escala: 'S' }), []);
  assert.ok(pendenciasFiscaisProduto({ ...base, ind_escala: 'N' }).some(p => /fabricante/i.test(p)));
  assert.deepEqual(
    pendenciasFiscaisProduto({ ...base, ind_escala: 'N', cnpj_fabricante: '06088741002520' }), []);
});

test('fator de conversão só é exigido quando as unidades diferem', () => {
  const base = {
    ncm: '02102000', origem_mercadoria: 0, sujeito_st: false, grupo_tributario_id: 'g1',
    unidade: 'KG', unidade_tributavel: 'KG',
  };
  assert.deepEqual(pendenciasFiscaisProduto(base), [], 'mesma unidade dispensa o fator');
  assert.ok(pendenciasFiscaisProduto({ ...base, unidade_tributavel: 'PC' })
    .some(p => /conversão/i.test(p)));
});

test('pendências do destinatário espelham o bloco dest da nota', async () => {
  const { pendenciasFiscaisCliente } = await import('../lib/fiscal.js');
  const completo = {
    tipo_pessoa: 'J', cnpj: '98765432000188', ind_ie_dest: 1, ie: '00000000000',
    consumidor_final: false, logradouro: 'Av. Brasil', numero: '1000', bairro: 'Centro',
    codigo_municipio_ibge: '1100122', municipio: 'Ji-Paraná', uf: 'RO', cep: '76900808',
  };
  assert.deepEqual(pendenciasFiscaisCliente(completo), []);

  assert.ok(pendenciasFiscaisCliente({ ...completo, logradouro: null }).some(p => /endereço|logradouro/i.test(p)));
  assert.ok(pendenciasFiscaisCliente({ ...completo, uf: null }).some(p => /UF/i.test(p)));
  assert.ok(pendenciasFiscaisCliente({ ...completo, cnpj: null }).some(p => /CNPJ|CPF/i.test(p)));
  assert.ok(pendenciasFiscaisCliente({ ...completo, consumidor_final: null }).some(p => /consumidor final/i.test(p)));
});

test('contribuinte precisa de inscrição estadual, não contribuinte não pode ter', async () => {
  const { pendenciasFiscaisCliente } = await import('../lib/fiscal.js');
  const base = {
    tipo_pessoa: 'J', cnpj: '98765432000188', consumidor_final: false,
    logradouro: 'Av. Brasil', numero: '1000', bairro: 'Centro',
    codigo_municipio_ibge: '1100122', municipio: 'Ji-Paraná', uf: 'RO', cep: '76900808',
  };
  assert.ok(pendenciasFiscaisCliente({ ...base, ind_ie_dest: 1, ie: null })
    .some(p => /inscrição estadual/i.test(p)));
  assert.deepEqual(pendenciasFiscaisCliente({ ...base, ind_ie_dest: 1, ie: '123456789' }), []);
  assert.ok(pendenciasFiscaisCliente({ ...base, ind_ie_dest: 9, ie: '123456789' })
    .some(p => /não contribuinte/i.test(p)));
  assert.deepEqual(pendenciasFiscaisCliente({ ...base, ind_ie_dest: 9, ie: null }), []);
});

test('pessoa física identifica-se por CPF', async () => {
  const { pendenciasFiscaisCliente } = await import('../lib/fiscal.js');
  const pf = {
    tipo_pessoa: 'F', cpf: '12345678901', ind_ie_dest: 9, consumidor_final: true,
    logradouro: 'Rua A', numero: '10', bairro: 'Centro',
    codigo_municipio_ibge: '1100122', municipio: 'Ji-Paraná', uf: 'RO', cep: '76900808',
  };
  assert.deepEqual(pendenciasFiscaisCliente(pf), []);
});


test('fator de conversão vale 1 quando a unidade de venda é a própria tributável', () => {
  // O caso do 0364-002: vende e tributa em UN, o formulário esconde o campo e a
  // constraint produtos_ativo_fiscal_completo recusava o Liberar por null.
  assert.equal(fatorConversaoTributavel({ unidade: 'un', unidade_tributavel: 'UN' }), 1);
  assert.equal(fatorConversaoTributavel({ unidade: ' KG ', unidade_tributavel: 'kg' }), 1);
});

test('fator informado pelo usuário prevalece sobre a derivação', () => {
  assert.equal(fatorConversaoTributavel({
    unidade: 'un', unidade_tributavel: 'KG', fator_conversao_tributavel: '0.5',
  }), 0.5);
  // Mesmo com unidades iguais, um fator digitado é dado humano: não sobrescrever.
  assert.equal(fatorConversaoTributavel({
    unidade: 'un', unidade_tributavel: 'un', fator_conversao_tributavel: 2,
  }), 2);
});

test('sem unidade tributável, ou com unidades diferentes, o fator continua nulo', () => {
  assert.equal(fatorConversaoTributavel({ unidade: 'un', unidade_tributavel: '' }), null);
  assert.equal(fatorConversaoTributavel({ unidade: 'un', unidade_tributavel: 'KG' }), null);
  assert.equal(fatorConversaoTributavel({}), null);
  assert.equal(fatorConversaoTributavel({
    unidade: 'un', unidade_tributavel: 'un', fator_conversao_tributavel: 'abc',
  }), 1, 'lixo digitado não vira NaN: cai na derivação');
});

const FONTE = {
  id: 'p1', codigo: '0364-001', nome: 'Costela Defumada 500g', unidade: 'KG',
  ncm: '02102000', ex_tipi: null, cest: '1708300', origem_mercadoria: 0,
  unidade_tributavel: 'KG', fator_conversao_tributavel: 1,
  grupo_tributario_id: 'g1', ind_escala: 'S', cnpj_fabricante: null,
  cst_ibs_cbs: null, ativo_fiscal: true,
  gtin: '7891234567895', gtin_tributavel: '7891234567895',
  peso_liquido_kg: 0.5, peso_bruto_kg: 0.55, sujeito_st: true,
};

test('o payload da cópia leva os dez campos fiscais previstos', () => {
  const payload = camposCopiaFiscal(FONTE);
  assert.deepEqual(Object.keys(payload).sort(), [...CAMPOS_COPIA_FISCAL].sort());
  assert.equal(CAMPOS_COPIA_FISCAL.length, 10);
  assert.equal(payload.ncm, '02102000');
  assert.equal(payload.grupo_tributario_id, 'g1');
});

test('o payload não leva identidade do produto nem declaração de conferência', () => {
  const payload = camposCopiaFiscal(FONTE);
  // Código de barras é único por produto; peso e unidade de venda são do item,
  // não da classificação; ativo_fiscal é assinatura de quem conferiu.
  for (const proibido of ['gtin', 'gtin_tributavel', 'unidade', 'peso_liquido_kg',
    'peso_bruto_kg', 'ativo_fiscal', 'id', 'codigo', 'nome']) {
    assert.ok(!(proibido in payload), `${proibido} não pode ser copiado`);
  }
});

test('campo nulo na fonte é copiado como nulo, não omitido', () => {
  // Copiar é espelhar, inclusive o vazio. Mesclar produziria um produto que
  // não é igual a nenhum dos dois e que ninguém conferiu.
  const payload = camposCopiaFiscal({ ...FONTE, cest: null });
  assert.ok('cest' in payload);
  assert.equal(payload.cest, null);
});

test('campo ausente na fonte também vira nulo explícito', () => {
  const payload = camposCopiaFiscal({ ncm: '02102000' });
  assert.equal(payload.cest, null);
  assert.equal(payload.grupo_tributario_id, null);
});

test('gruposComRegra conta só as regras ativas', () => {
  const grupos = gruposComRegra([
    { grupo_tributario_id: 'g1', ativo: true },
    { grupo_tributario_id: 'g2', ativo: false },
    { grupo_tributario_id: null, ativo: true },
  ]);
  assert.ok(grupos.has('g1'));
  assert.ok(!grupos.has('g2'), 'regra desativada não habilita o grupo');
  assert.equal(grupos.size, 1, 'regra por produto ou por NCM não tem grupo e não entra');
});

test('regra sem a coluna ativo conta como ativa', () => {
  // O select da tela pode não trazer a coluna; ausência não é desativação.
  assert.ok(gruposComRegra([{ grupo_tributario_id: 'g1' }]).has('g1'));
});

test('produto cujo grupo não tem regra ativa recebe o aviso', () => {
  const s = situacaoFiscalProduto({ ...FONTE, grupo_tributario_id: 'g9' }, gruposComRegra([]));
  assert.equal(s.grupoSemRegra, true);
});

test('produto cujo grupo tem regra ativa não recebe o aviso', () => {
  const s = situacaoFiscalProduto(FONTE, gruposComRegra([{ grupo_tributario_id: 'g1', ativo: true }]));
  assert.equal(s.grupoSemRegra, false);
  assert.deepEqual(s.pendencias, []);
  assert.equal(s.liberado, true);
});

test('produto sem grupo nenhum tem a pendência, não o aviso — são coisas diferentes', () => {
  // "sem grupo" é cadastro incompleto e aparece em pendenciasFiscaisProduto.
  // "grupo sem regra" é cadastro completo que ainda assim vai ser recusado na
  // emissão. Misturar os dois esconde um dos dois problemas.
  const s = situacaoFiscalProduto({ ...FONTE, grupo_tributario_id: null }, gruposComRegra([]));
  assert.equal(s.grupoSemRegra, false);
  assert.ok(s.pendencias.some(p => /grupo tributário/i.test(p)), s.pendencias.join(' | '));
});
