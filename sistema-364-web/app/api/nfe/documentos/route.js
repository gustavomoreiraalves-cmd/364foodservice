import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/autorizacao';

export const runtime = 'nodejs';

const STATUS_VALIDOS = ['resumo', 'manifestada', 'xml_baixado', 'vinculada', 'ignorada'];

// GET ?empresaId=...&status=... — lista a caixa de entrada, mais recente primeiro.
export async function GET(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const { searchParams } = new URL(request.url);
  const empresaId = searchParams.get('empresaId');
  const status = searchParams.get('status');

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  let q = sb.from('nfe_documentos')
    .select('id, chave, numero, serie, cnpj_emitente, nome_emitente, emitida_em, valor_total, status, origem, recebimento_id, ultimo_erro')
    .eq('empresa_id', empresaId)
    .order('emitida_em', { ascending: false, nullsFirst: false })
    .limit(300);
  if (status && STATUS_VALIDOS.includes(status)) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documentos: data || [] });
}
