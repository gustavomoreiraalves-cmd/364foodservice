import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../lib/pontoServer';
import { garantirEmpresa } from '../../../../lib/autorizacao';
import { obterCertificadoAtivo, statusCertificado } from '../../../../lib/certificadoServer';
import { consultarStatusServico } from '../../../../lib/sefaz/statusServico';

export const runtime = 'nodejs';
// Teto de PLATAFORMA: sem isto, se o limite de função da Vercel for menor que
// o timeout de 20s que chamarSefaz já usa internamente, a plataforma mata a
// função primeiro e o operador vê um 504 opaco em vez do 502 explicado que a
// rota monta. Ver app/api/financeiro/extratos/upload/route.js para o mesmo
// idioma.
export const maxDuration = 30;

// cStat 107 = "Serviço em Operação". Qualquer outro valor é a SEFAZ dizendo que
// está fora do ar ou em manutenção — não é erro de configuração nossa.
const SERVICO_EM_OPERACAO = '107';
const AMBIENTES_VALIDOS = ['producao', 'homologacao'];

export async function POST(request) {
  const { sb, user, isAdmin, erro } = await autorizarModulo(request, 'fiscal');
  if (erro) return erro;

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  const { empresaId, ambiente } = corpo;

  // Sem isto, um `ambiente` inválido só falha dentro do try mais abaixo e sai
  // como 502 "Não foi possível falar com a SEFAZ" — culpando a SEFAZ por um
  // erro de input do cliente.
  if (!AMBIENTES_VALIDOS.includes(ambiente)) {
    return NextResponse.json({ error: `Ambiente inválido: use 'producao' ou 'homologacao'.` }, { status: 400 });
  }

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

  // Sem isto, um A1 vencido só aparece lá na frente como erro de TLS do
  // undici ("certificate expired" ou pior) — opaco e sem dizer o que fazer.
  // statusCertificado já é o que /empresas usa para mostrar o selo de
  // validade; reaproveitar aqui evita reimplementar a conta de dias.
  const { status: statusCert, diasParaVencer } = statusCertificado(certificado.meta.valido_ate);
  if (statusCert === 'vencido') {
    const dataVencimento = new Date(certificado.meta.valido_ate).toLocaleDateString('pt-BR');
    return NextResponse.json({
      error: `O certificado A1 desta marca venceu em ${dataVencimento} (há ${Math.abs(diasParaVencer)} dia(s)). Envie um certificado novo em /empresas antes de testar a conexão.`,
    }, { status: 400 });
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
