import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/autorizacao';
import { somenteDigitos } from '../../../../lib/cnpj';
import { buscarAssinaturasWix, wixConfigurado } from '../../../../lib/wixAssinaturas';

export const runtime = 'nodejs';

// GET ?empresaId=... — lista ao vivo as assinaturas ativas no site Wix,
// casadas por CPF com os clientes já cadastrados desta empresa. Sem tabela
// própria: cada carregamento busca direto no Wix (ver docs/IDEIAS.md).
export async function GET(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'pedidos');
  if (erro) return erro;

  const empresaId = new URL(request.url).searchParams.get('empresaId');
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  if (!wixConfigurado()) {
    return NextResponse.json({ error: 'Configure WIX_CLIENT_ID, WIX_CLIENT_SECRET e WIX_CLIENT_INSTANCE_ID no .env.local para importar assinaturas do Wix.' }, { status: 500 });
  }

  let assinaturas;
  try {
    assinaturas = await buscarAssinaturasWix();
  } catch (e) {
    return NextResponse.json({ error: `Falha ao buscar assinaturas no Wix: ${e.message}` }, { status: 502 });
  }

  const { data: clientes, error: erroClientes } = await sb.from('clientes')
    .select('id, nome, cpf').eq('empresa_id', empresaId).not('cpf', 'is', null);
  if (erroClientes) return NextResponse.json({ error: erroClientes.message }, { status: 500 });

  const porCpf = new Map((clientes || []).map(c => [somenteDigitos(c.cpf), c]));
  const comCliente = assinaturas.map(a => {
    const cliente = porCpf.get(somenteDigitos(a.compradorCpf)) || null;
    return { ...a, clienteId: cliente?.id || null, clienteNome: cliente?.nome || null };
  });

  return NextResponse.json({ assinaturas: comCliente });
}
