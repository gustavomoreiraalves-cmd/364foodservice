import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../../lib/nfe/autorizacao';
import { processarImportacao } from '../../../../../lib/extratosServer';

export const runtime = 'nodejs';
export const maxDuration = 300; // PDF grande passa por leitura de IA

const LIMITE = 10 * 1024 * 1024; // teto do bucket 'recebimentos'
const TIPOS = ['extrato', 'fatura_cartao'];

// POST multipart: arquivo, empresaId, contaBancariaId, tipo
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'financeiro');
  if (erro) return erro;

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Envio inválido: use o botão de importar da tela.' }, { status: 400 });
  }

  const empresaId = form.get('empresaId');
  const contaBancariaId = form.get('contaBancariaId');
  const tipo = form.get('tipo');
  const arquivo = form.get('arquivo');

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (!contaBancariaId) return NextResponse.json({ error: 'Escolha a conta bancária.' }, { status: 400 });
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 });
  if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Anexe o arquivo do extrato.' }, { status: 400 });
  }
  if (arquivo.size > LIMITE) {
    return NextResponse.json({ error: 'Arquivo acima de 10 MB. Exporte um período menor.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await arquivo.arrayBuffer());
    const resumo = await processarImportacao({
      sb, empresaId, contaBancariaId, tipo, arquivoNome: arquivo.name || 'extrato', buffer,
    });
    return NextResponse.json(resumo);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
