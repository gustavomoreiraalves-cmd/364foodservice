import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../../../lib/nfe/autorizacao';
import { parseNFe } from '../../../../../../lib/nfe/parseNFe';
import { aplicarDePara } from '../../../../../../lib/nfe/dePara';

export const runtime = 'nodejs';

// GET: devolve tudo que a tela de recebimento precisa para abrir o formulário
// já preenchido. Não grava nada.
export async function GET(request, { params }) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'recebimentos');
  if (erro) return erro;

  const empresaId = new URL(request.url).searchParams.get('empresaId');
  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }

  const chave = String(params.chave || '').replace(/\D/g, '');
  const { data: documento } = await sb.from('nfe_documentos')
    .select('*').eq('empresa_id', empresaId).eq('chave', chave).maybeSingle();
  if (!documento) return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 });
  if (!documento.xml_path) {
    return NextResponse.json({ error: 'O XML desta nota ainda não foi baixado da SEFAZ.' }, { status: 409 });
  }

  const { data: arquivo, error: errDl } = await sb.storage.from('recebimentos').download(documento.xml_path);
  if (errDl) return NextResponse.json({ error: 'Falha ao ler o XML guardado: ' + errDl.message }, { status: 500 });
  const nota = parseNFe(await arquivo.text());

  const [{ data: fornecedor }, { data: mapa }, { data: recebimentoExistente }] = await Promise.all([
    sb.from('fornecedores').select('id, nome, cnpj')
      .eq('empresa_id', empresaId).eq('cnpj', nota.emitente.cnpj).maybeSingle(),
    sb.from('fornecedor_produto_mapa')
      .select('codigo_produto, materia_prima_id, unidade_nf, fator_conversao')
      .eq('empresa_id', empresaId).eq('cnpj_emitente', nota.emitente.cnpj),
    sb.from('recebimentos').select('id').eq('empresa_id', empresaId).eq('nfe_chave', chave).maybeSingle(),
  ]);

  return NextResponse.json({
    documento,
    nota: {
      chave: nota.chave, numero: nota.numero, serie: nota.serie,
      emitidaEm: nota.emitidaEm, valorTotal: nota.valorTotal, emitente: nota.emitente,
    },
    fornecedor: fornecedor || null,
    fornecedorSugerido: fornecedor ? null : {
      nome: nota.emitente.nome,
      cnpj: nota.emitente.cnpj,
      telefone: nota.emitente.telefone,
      email: nota.emitente.email,
    },
    itens: aplicarDePara(nota, mapa || []),
    duplicatas: nota.duplicatas,
    jaVinculada: Boolean(recebimentoExistente),
  });
}
