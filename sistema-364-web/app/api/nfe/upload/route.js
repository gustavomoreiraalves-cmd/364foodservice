import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/nfe/autorizacao';
import { parseNFe } from '../../../../lib/nfe/parseNFe';

export const runtime = 'nodejs';

const LIMITE_XML = 2 * 1024 * 1024; // NF-e realista não passa disso; corta abuso

// Status que já passaram do simples "xml baixado" — reenviar o mesmo XML não
// pode rebaixar um documento que já foi manifestado ou já virou recebimento.
const STATUS_AVANCADOS = ['manifestada', 'vinculada'];

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

  // Só NF-e modelo 55 vira recebimento; o resto entra na caixa como 'ignorada' e
  // não passa por estas conferências, que existem para proteger estoque e
  // financeiro de uma nota que não é uma compra desta empresa.
  if (ehNFe) {
    // tpNF = 1 é saída do emitente, isto é, entrada aqui — é a nota de compra.
    // tpNF = 0 é nota de entrada emitida pelo próprio emitente (devolução, nota
    // própria do grupo) e não pode gerar entrada de estoque com conta a pagar.
    if (nota.tipoOperacao !== '1') {
      return NextResponse.json({
        error: 'Esta NF-e não é uma nota de compra: o tipo de operação (tpNF) indica nota de entrada '
          + 'emitida pelo próprio emitente. Só nota de saída do fornecedor vira recebimento.',
      }, { status: 400 });
    }

    const { data: empresa, error: errEmpresa } = await sb.from('empresas')
      .select('cnpj').eq('id', empresaId).maybeSingle();
    if (errEmpresa) {
      return NextResponse.json({ error: 'Falha ao conferir o CNPJ da empresa: ' + errEmpresa.message }, { status: 500 });
    }
    const cnpjEmpresa = String(empresa?.cnpj || '').replace(/\D/g, '');
    // O CNPJ é opcional no cadastro da empresa. Sem ele não há com o que comparar,
    // e travar a importação por um campo de cadastro em branco pararia o
    // recebimento inteiro — então segue sem a conferência, como era antes.
    if (cnpjEmpresa) {
      if (!nota.destinatario.cnpj) {
        return NextResponse.json({
          error: 'Esta NF-e não traz o CNPJ do destinatário, então não dá para confirmar que ela foi '
            + 'emitida para esta empresa.',
        }, { status: 400 });
      }
      if (nota.destinatario.cnpj !== cnpjEmpresa) {
        return NextResponse.json({
          error: `Esta NF-e foi emitida para o CNPJ ${nota.destinatario.cnpj}, e a empresa selecionada `
            + `tem o CNPJ ${cnpjEmpresa}. Confira se o XML é da empresa certa.`,
        }, { status: 400 });
      }
    }
  }

  const path = `${empresaId}/nfe/${nota.chave}.xml`;
  const { error: errUp } = await sb.storage.from('recebimentos')
    .upload(path, Buffer.from(xml, 'utf8'), { contentType: 'application/xml', upsert: true });
  if (errUp) return NextResponse.json({ error: 'Falha ao guardar o XML: ' + errUp.message }, { status: 500 });

  // Reupload de uma nota que já avançou (manifestada/vinculada) não pode voltar
  // pra "xml_baixado" — senão a listagem mostra como pendente algo que já foi
  // lançado, mesmo com o recebimento_id (preservado por não entrar no upsert)
  // ainda apontando pro recebimento existente.
  const { data: existente } = await sb.from('nfe_documentos')
    .select('status').eq('empresa_id', empresaId).eq('chave', nota.chave).maybeSingle();
  const statusFinal = existente && STATUS_AVANCADOS.includes(existente.status)
    ? existente.status
    : (ehNFe ? 'xml_baixado' : 'ignorada');

  const { data, error } = await sb.from('nfe_documentos').upsert([{
    empresa_id: empresaId,
    chave: nota.chave,
    modelo: nota.modelo,
    // O documento do emitente, CNPJ ou CPF: nota de produtor rural gravava vazio
    // aqui, e o de-para de produtos ficava sem chave para casar.
    cnpj_emitente: nota.emitente.documento,
    nome_emitente: nota.emitente.nome,
    numero: nota.numero,
    serie: nota.serie,
    emitida_em: nota.emitidaEm || null,
    valor_total: nota.valorTotal,
    status: statusFinal,
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
