import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { buscarCnpjReceita } from '../../../../lib/cnpjReceita';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { erro } = await autorizarModulo(request, 'clientes');
  if (erro) return erro;

  try {
    const dados = await buscarCnpjReceita(params.cnpj);
    return NextResponse.json(dados);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
