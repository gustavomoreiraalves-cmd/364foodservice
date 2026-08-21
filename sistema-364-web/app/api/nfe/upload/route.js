import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { parseNFe } from '../../../../lib/nfe/parseNFe';

export const runtime = 'nodejs';

const LIMITE_XML = 2 * 1024 * 1024; // NF-e realista não passa disso; corta abuso

// POST: registra um XML enviado à mão (fornecedor mandou por e-mail, ou o
// certificado ainda não está configurado). body: { empresaId, xml }
export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const { empresaId, xml } = await request.json();
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (typeof xml !== 'string' || !xml.trim()) {
    return NextResponse.json({ error: 'Envie o conteúdo do XML.' }, { status: 400 });
  }
  if (xml.length > LIMITE_XML) {
    return NextResponse.json({ error: 'XML acima de 2 MB — confira se é mesmo uma NF-e.' }, { status: 400 });
  }

  let nota;
  try {
    nota = parseNFe(xml);
  } catch (e) {
    return NextResponse.json({ error: 'Não consegui ler este XML: ' + e.message }, { status: 400 });
  }

  const ehNFe = nota.modelo === '55';
  const path = `${empresaId}/nfe/${nota.chave}.xml`;
  const { error: errUp } = await sb.storage.from('recebimentos')
    .upload(path, Buffer.from(xml, 'utf8'), { contentType: 'application/xml', upsert: true });
  if (errUp) return NextResponse.json({ error: 'Falha ao guardar o XML: ' + errUp.message }, { status: 500 });

  const { data, error } = await sb.from('nfe_documentos').upsert([{
    empresa_id: empresaId,
    chave: nota.chave,
    modelo: nota.modelo,
    cnpj_emitente: nota.emitente.cnpj,
    nome_emitente: nota.emitente.nome,
    numero: nota.numero,
    serie: nota.serie,
    emitida_em: nota.emitidaEm || null,
    valor_total: nota.valorTotal,
    status: ehNFe ? 'xml_baixado' : 'ignorada',
    origem: 'upload',
    xml_path: path,
    ultimo_erro: null,
  }], { onConflict: 'empresa_id,chave' }).select('*').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ehNFe) {
    return NextResponse.json({ documento: data, aviso: 'Documento registrado, mas não é NF-e modelo 55 — não pode virar recebimento.' });
  }
  return NextResponse.json({ documento: data });
}
