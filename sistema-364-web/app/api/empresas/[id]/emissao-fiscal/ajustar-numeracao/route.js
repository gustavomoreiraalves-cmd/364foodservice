import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../../lib/pontoServer';
import { podeAjustarNumero } from '../../../../../../lib/emissaoFiscal';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  const { data: empresa, error: erroEmpresa } = await sb.from('empresas')
    .select('id, empregador_id').eq('id', params.id).maybeSingle();
  if (erroEmpresa) {
    return NextResponse.json({ error: `Falha ao verificar empresa: ${erroEmpresa.message}` }, { status: 500 });
  }
  if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  const { modelo, ambiente, novoNumero, motivo } = await request.json();
  if (!motivo || !motivo.trim()) {
    return NextResponse.json({ error: 'Informe o motivo do ajuste.' }, { status: 400 });
  }

  const { data: config, error: erroConfig } = await sb.from('empresas_emissao_fiscal')
    .select('serie').eq('empresa_id', empresa.id).eq('modelo', modelo).eq('ambiente', ambiente).maybeSingle();
  if (erroConfig) {
    return NextResponse.json({ error: `Falha ao verificar configuração de emissão: ${erroConfig.message}` }, { status: 500 });
  }
  if (!config) {
    return NextResponse.json({ error: 'Configure a série deste modelo/ambiente antes de ajustar a numeração.' }, { status: 400 });
  }

  const { data: atual, error: erroAtual } = await sb.from('fiscal_numeracao')
    .select('id, ultimo_numero')
    .eq('empregador_id', empresa.empregador_id).eq('modelo', modelo).eq('ambiente', ambiente).eq('serie', config.serie)
    .maybeSingle();
  if (erroAtual) {
    return NextResponse.json({ error: `Falha ao verificar numeração atual: ${erroAtual.message}` }, { status: 500 });
  }

  const ultimoAtual = atual ? atual.ultimo_numero : null;
  if (!podeAjustarNumero(ultimoAtual, novoNumero)) {
    return NextResponse.json({
      error: ultimoAtual === null
        ? 'Número inicial inválido — precisa ser um inteiro maior ou igual a zero.'
        : `O novo número (${novoNumero}) precisa ser maior que o atual (${ultimoAtual}) — numeração fiscal nunca retrocede.`,
    }, { status: 400 });
  }

  const { data: gravado, error } = atual
    ? await sb.from('fiscal_numeracao').update({ ultimo_numero: novoNumero }).eq('id', atual.id).select('id').single()
    : await sb.from('fiscal_numeracao').insert([{
        empregador_id: empresa.empregador_id, modelo, ambiente, serie: config.serie, ultimo_numero: novoNumero,
      }]).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Ajuste de numeração fiscal precisa deixar rastro auditável — se o registro
  // falhar, sinalizamos 500 em vez de devolver 200 silenciando a lacuna na trilha
  // de auditoria (o valor em fiscal_numeracao já foi gravado, mas sem essa
  // confirmação o operador não tem como saber que a auditoria não foi registrada).
  const { error: erroAuditoria } = await sb.rpc('fn_registrar_auditoria', {
    p_entidade: 'fiscal_numeracao', p_entidade_id: gravado.id, p_acao: 'ajuste',
    p_empresa_id: empresa.id,
    p_antes: { ultimo_numero: ultimoAtual }, p_depois: { ultimo_numero: novoNumero },
    p_motivo: motivo,
  });
  if (erroAuditoria) {
    return NextResponse.json({ error: `Numeração ajustada, mas falha ao registrar auditoria: ${erroAuditoria.message}` }, { status: 500 });
  }

  return NextResponse.json({ modelo, ambiente, serie: config.serie, ultimoNumero: novoNumero });
}
