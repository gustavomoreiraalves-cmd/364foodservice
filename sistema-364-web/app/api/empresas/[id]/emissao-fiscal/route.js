import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { validarConfiguracaoEmissao, serieConflita, MODELOS_EMISSAO, AMBIENTES_EMISSAO } from '../../../../../lib/emissaoFiscal';
import { cifrarCsc } from '../../../../../lib/fiscalSecretServer';

export const runtime = 'nodejs';

async function empresaOu404(sb, id) {
  const { data } = await sb.from('empresas').select('id, empregador_id').eq('id', id).maybeSingle();
  return data || null;
}

async function certificadoValido(sb, empregadorId) {
  if (!empregadorId) return false;
  const { data, error } = await sb.from('certificados_digitais')
    .select('valido_ate').eq('empregador_id', empregadorId).eq('ativo', true).maybeSingle();
  // Erro de banco vira 500 (via exceção capturada pelo chamador) em vez de virar
  // silenciosamente "sem certificado válido", que mascararia uma falha real de DB.
  if (error) throw new Error(`Falha ao verificar certificado digital: ${error.message}`);
  return Boolean(data) && new Date(data.valido_ate) > new Date();
}

async function montarResposta(sb, empresa) {
  const [
    { data: config, error: erroConfig },
    { data: numeracoes, error: erroNumeracoes },
    { data: emp, error: erroEmp },
  ] = await Promise.all([
    sb.from('empresas_emissao_fiscal')
      .select('id, modelo, ambiente, ativo, serie, csc_id, csc_token_cifrado')
      .eq('empresa_id', empresa.id),
    sb.from('fiscal_numeracao')
      .select('modelo, ambiente, serie, ultimo_numero')
      .eq('empregador_id', empresa.empregador_id),
    sb.from('empresas').select('informacoes_complementares_padrao').eq('id', empresa.id).single(),
  ]);
  // Cada leitura falha vira exceção, capturada por GET/PUT como 500 — sem isso, uma falha
  // de DB aqui viraria um 200 enganoso com dados vazios/errados.
  if (erroConfig) throw new Error(`Falha ao carregar configuração de emissão: ${erroConfig.message}`);
  if (erroNumeracoes) throw new Error(`Falha ao carregar numeração fiscal: ${erroNumeracoes.message}`);
  if (erroEmp) throw new Error(`Falha ao carregar dados da empresa: ${erroEmp.message}`);
  const configuracoes = (config || []).map(c => {
    const numeracao = (numeracoes || []).find(n => n.modelo === c.modelo && n.ambiente === c.ambiente && n.serie === c.serie);
    return {
      modelo: c.modelo, ativo: c.ativo, ambiente: c.ambiente, serie: c.serie,
      cscConfigurado: Boolean(c.csc_token_cifrado),
      ultimoNumero: numeracao ? numeracao.ultimo_numero : null,
    };
  });
  return { empresa: { informacoesComplementaresPadrao: emp?.informacoes_complementares_padrao || '' }, configuracoes };
}

export async function GET(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;
  const empresa = await empresaOu404(sb, params.id);
  if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
  try {
    return NextResponse.json(await montarResposta(sb, empresa));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;
  const empresa = await empresaOu404(sb, params.id);
  if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
  if (!empresa.empregador_id) {
    return NextResponse.json({ error: 'Esta marca não tem pessoa jurídica vinculada. Vincule em /empresas antes.' }, { status: 400 });
  }

  const body = await request.json();
  const entradas = Array.isArray(body.configuracoes) ? body.configuracoes : [];

  // Snapshot único antes do loop: como cada iteração cobre um modelo/ambiente distinto
  // (validado logo abaixo) e o upsert seguinte usa onConflict empresa_id+modelo+ambiente,
  // não há como uma iteração invalidar o snapshot lido por outra dentro do mesmo PUT.
  const { data: existentesEmpregador, error: erroExistentesEmpregador } = await sb.from('empresas_emissao_fiscal')
    .select('id, empresa_id, modelo, ambiente, serie').eq('empregador_id', empresa.empregador_id);
  if (erroExistentesEmpregador) {
    return NextResponse.json({ error: `Falha ao verificar séries existentes do CNPJ: ${erroExistentesEmpregador.message}` }, { status: 500 });
  }
  const { data: existentesMarca, error: erroExistentesMarca } = await sb.from('empresas_emissao_fiscal')
    .select('id, modelo, ambiente').eq('empresa_id', empresa.id);
  if (erroExistentesMarca) {
    return NextResponse.json({ error: `Falha ao verificar configurações existentes da marca: ${erroExistentesMarca.message}` }, { status: 500 });
  }

  let certValido;
  try {
    certValido = await certificadoValido(sb, empresa.empregador_id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  for (const entrada of entradas) {
    if (!MODELOS_EMISSAO.includes(entrada.modelo)) {
      return NextResponse.json({ error: `Modelo inválido: ${entrada.modelo}.` }, { status: 400 });
    }
    if (!AMBIENTES_EMISSAO.includes(entrada.ambiente)) {
      return NextResponse.json({ error: `Ambiente inválido: ${entrada.ambiente}.` }, { status: 400 });
    }
    const linhaAtual = (existentesMarca || []).find(l => l.modelo === entrada.modelo && l.ambiente === entrada.ambiente);
    const erros = validarConfiguracaoEmissao({
      modelo: entrada.modelo, ativo: entrada.ativo, ambiente: entrada.ambiente, serie: entrada.serie,
      cscId: entrada.cscId, cscToken: entrada.cscToken, certificadoValido: certValido,
    });
    if (erros.length) return NextResponse.json({ error: erros.join(' ') }, { status: 400 });

    // outrasDoEmpregador já exclui toda a marca atual (empresa_id !== empresa.id), então
    // linhaAtual?.id nunca poderia aparecer nessa lista — passamos o id mesmo assim só
    // por respeitar a assinatura genérica de serieConflita (lib/emissaoFiscal.js), que
    // também recebe candidato.id para se auto-excluir quando o chamador não filtra antes.
    const outrasDoEmpregador = (existentesEmpregador || [])
      .filter(l => l.empresa_id !== empresa.id)
      .map(l => ({ id: l.id, modelo: l.modelo, ambiente: l.ambiente, serie: l.serie }));
    if (serieConflita(outrasDoEmpregador, { id: linhaAtual?.id, modelo: entrada.modelo, ambiente: entrada.ambiente, serie: entrada.serie })) {
      return NextResponse.json({
        error: `A série ${entrada.serie} do modelo ${entrada.modelo} em ${entrada.ambiente} já está em uso por outra marca deste CNPJ.`,
      }, { status: 400 });
    }

    const linha = {
      empresa_id: empresa.id, modelo: entrada.modelo, ambiente: entrada.ambiente,
      ativo: Boolean(entrada.ativo), serie: entrada.serie,
      csc_id: entrada.modelo === '65' ? (entrada.cscId || null) : null,
    };
    // CSC token só é recifrado se veio valor novo — campo vazio no PUT
    // mantém o cifrado atual, mesmo comportamento do certificado A1.
    if (entrada.modelo === '65' && entrada.cscToken) {
      linha.csc_token_cifrado = cifrarCsc(Buffer.from(entrada.cscToken, 'utf8'));
    }

    const { error } = await sb.from('empresas_emissao_fiscal')
      .upsert([linha], { onConflict: 'empresa_id,modelo,ambiente' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ('informacoesComplementaresPadrao' in body) {
    const { error } = await sb.from('empresas')
      .update({ informacoes_complementares_padrao: body.informacoesComplementaresPadrao || null })
      .eq('id', empresa.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    return NextResponse.json(await montarResposta(sb, empresa));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
