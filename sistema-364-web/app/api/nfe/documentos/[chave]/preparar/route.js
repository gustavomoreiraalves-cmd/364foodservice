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
  const { data: documento, error: errDoc } = await sb.from('nfe_documentos')
    .select('*').eq('empresa_id', empresaId).eq('chave', chave).maybeSingle();
  // Sem isto, uma falha de banco vira "Nota não encontrada" segundos depois de um
  // upload bem-sucedido, e ninguém entende o que aconteceu.
  if (errDoc) return NextResponse.json({ error: 'Falha ao consultar a nota: ' + errDoc.message }, { status: 500 });
  if (!documento) return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 });
  if (!documento.xml_path) {
    return NextResponse.json({ error: 'O XML desta nota ainda não foi baixado da SEFAZ.' }, { status: 409 });
  }

  const { data: arquivo, error: errDl } = await sb.storage.from('recebimentos').download(documento.xml_path);
  if (errDl) return NextResponse.json({ error: 'Falha ao ler o XML guardado: ' + errDl.message }, { status: 500 });

  let xmlContent;
  try {
    xmlContent = await arquivo.text();
  } catch (e) {
    return NextResponse.json({ error: 'Não consegui ler o XML guardado desta nota: ' + e.message }, { status: 500 });
  }

  let nota;
  try {
    nota = parseNFe(xmlContent);
  } catch (e) {
    return NextResponse.json({ error: 'Não consegui ler o XML guardado desta nota: ' + e.message }, { status: 500 });
  }

  // `fornecedores.cnpj` é normalizado para só dígitos pela migração 22 — o CNPJ do
  // emitente já vem só com dígitos do parser, então a comparação é direta.
  //
  // Sem `.maybeSingle()` de propósito: dois cadastros com o mesmo CNPJ (o que a
  // busca quebrada de antes produzia, e que a migração 22 ainda não rodou para
  // limpar) fariam o maybeSingle devolver erro de "mais de uma linha", que viraria
  // um 500 e travaria a importação inteira. Fornecedor duplicado tem que degradar
  // para "casei com um deles", nunca para importação bloqueada. `limit(1)` com
  // ordem fixa mantém a escolha estável entre uma importação e outra.
  const [resFornecedor, resMapa, resRecebimento] = await Promise.all([
    sb.from('fornecedores').select('id, nome, cnpj')
      .eq('empresa_id', empresaId).eq('cnpj', nota.emitente.cnpj)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1),
    sb.from('fornecedor_produto_mapa')
      .select('codigo_produto, materia_prima_id, unidade_nf, fator_conversao')
      .eq('empresa_id', empresaId).eq('cnpj_emitente', nota.emitente.cnpj),
    sb.from('recebimentos').select('id').eq('empresa_id', empresaId).eq('nfe_chave', chave).maybeSingle(),
  ]);

  // Cada uma dessas falhas, engolida, tem uma consequência silenciosa: fornecedor
  // que some, de-para aprendido que reaparece vazio (e é reaprendido errado) e
  // nota duplicada que passa pela única checagem prévia de duplicidade.
  if (resFornecedor.error) {
    return NextResponse.json({ error: 'Falha ao procurar o fornecedor pelo CNPJ da nota: ' + resFornecedor.error.message }, { status: 500 });
  }
  if (resMapa.error) {
    return NextResponse.json({ error: 'Falha ao ler o de-para de produtos deste fornecedor: ' + resMapa.error.message }, { status: 500 });
  }
  if (resRecebimento.error) {
    return NextResponse.json({ error: 'Falha ao conferir se esta nota já virou recebimento: ' + resRecebimento.error.message }, { status: 500 });
  }

  // Vem lista por causa do limit(1): o primeiro (mais antigo) é o escolhido, e é o
  // mesmo que a migração 22 mantém quando funde os duplicados.
  const fornecedor = resFornecedor.data?.[0] || null;
  const mapa = resMapa.data;
  const recebimentoExistente = resRecebimento.data;

  return NextResponse.json({
    documento,
    nota: {
      chave: nota.chave, numero: nota.numero, serie: nota.serie,
      emitidaEm: nota.emitidaEm, valorTotal: nota.valorTotal,
      // somaItens (Σ vProd) é o que a tela compara com o total conferido; o
      // valorTotal (vNF) carrega frete, IPI e ST e serve só para exibição.
      somaItens: nota.somaItens,
      emitente: nota.emitente,
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
