import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/autorizacao';
import { obterCertificadoAtivo } from '../../../../lib/certificadoServer';
import { consultarStatusServico } from '../../../../lib/sefaz/statusServico';

export const runtime = 'nodejs';

// cStat 107 = "Serviço em Operação". Qualquer outro valor é a SEFAZ dizendo que
// está fora do ar ou em manutenção — não é erro de configuração nossa.
const SERVICO_EM_OPERACAO = '107';

export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  const { empresaId, ambiente } = await request.json();

  try {
    await garantirEmpresa(sb, user, isAdmin, empresaId);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 403 });
  }

  const { data: empresa, error: erroEmpresa } = await sb.from('empresas')
    .select('empregador_id').eq('id', empresaId).maybeSingle();
  if (erroEmpresa) return NextResponse.json({ error: erroEmpresa.message }, { status: 500 });
  if (!empresa?.empregador_id) {
    return NextResponse.json({ error: 'Esta marca não tem pessoa jurídica vinculada. Vincule em /empresas antes.' }, { status: 400 });
  }

  let certificado;
  try {
    certificado = await obterCertificadoAtivo(empresa.empregador_id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  if (!certificado) {
    return NextResponse.json({ error: 'Nenhum certificado A1 ativo para o CNPJ desta marca. Envie o certificado em /empresas.' }, { status: 400 });
  }

  try {
    const { cStat, xMotivo } = await consultarStatusServico({
      ambiente, pfx: certificado.pfx, senha: certificado.senha,
    });
    return NextResponse.json({ ok: cStat === SERVICO_EM_OPERACAO, cStat, xMotivo });
  } catch (e) {
    // Falha de rede/TLS/timeout: a mensagem do undici é técnica, mas é a única
    // pista real de por que não conectou. Nunca inclui material do certificado.
    return NextResponse.json({ error: `Não foi possível falar com a SEFAZ: ${e.message}` }, { status: 502 });
  }
}
