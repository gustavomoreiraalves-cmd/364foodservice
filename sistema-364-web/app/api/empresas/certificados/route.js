import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { resumoCertificado } from '../../../../lib/certificadoServer';

export const runtime = 'nodejs';

// Uma chamada para a lista inteira da tela Empresas, em vez de um GET por linha.
export async function GET(request) {
  const { sb, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;
  const { data, error } = await sb.from('certificados_digitais')
    .select('id, empregador_id, titular, emissor, cnpj_certificado, numero_serie, valido_de, valido_ate, created_at')
    .eq('ativo', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const porEmpregador = {};
  for (const linha of data || []) porEmpregador[linha.empregador_id] = resumoCertificado(linha);
  return NextResponse.json({ porEmpregador });
}
