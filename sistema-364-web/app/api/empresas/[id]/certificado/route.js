import { NextResponse } from 'next/server';
import { autorizarModulo } from '../../../../../lib/pontoServer';
import { inspecionarPfx, cifrar, resumoCertificado } from '../../../../../lib/certificadoServer';
import { somenteDigitos } from '../../../../../lib/cnpj';

export const runtime = 'nodejs';

// Um A1 real tem 3–6 KB; 64 KB corta upload errado (alguém mandando um PDF).
const LIMITE_PFX = 64 * 1024;

async function empregadorOu404(sb, id) {
  const { data } = await sb.from('empregadores').select('id, cnpj, razao_social').eq('id', id).maybeSingle();
  return data || null;
}

export async function GET(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;
  const { data, error } = await sb.from('certificados_digitais')
    .select('id, titular, emissor, cnpj_certificado, numero_serie, valido_de, valido_ate, created_at')
    .eq('empregador_id', params.id).eq('ativo', true).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ certificado: data ? resumoCertificado(data) : null });
}

export async function POST(request, { params }) {
  const { sb, user, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;

  const empregador = await empregadorOu404(sb, params.id);
  if (!empregador) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  const form = await request.formData();
  const arquivo = form.get('arquivo');
  const senha = String(form.get('senha') || '');
  if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'Envie o arquivo .pfx do certificado.' }, { status: 400 });
  }
  if (arquivo.size > LIMITE_PFX) {
    return NextResponse.json({ error: 'Arquivo acima de 64 KB — confira se é mesmo o .pfx do certificado A1.' }, { status: 400 });
  }
  if (!senha) return NextResponse.json({ error: 'Informe a senha do certificado.' }, { status: 400 });

  const pfx = Buffer.from(await arquivo.arrayBuffer());
  let meta;
  try {
    meta = inspecionarPfx(pfx, senha);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const cnpjEmpresa = somenteDigitos(empregador.cnpj);
  if (!meta.cnpj) {
    return NextResponse.json({ error: 'Não encontrei o CNPJ dentro do certificado. Confira se é um A1 de pessoa jurídica (e-CNPJ).' }, { status: 400 });
  }
  if (meta.cnpj !== cnpjEmpresa) {
    return NextResponse.json({
      error: `Este certificado é do CNPJ ${meta.cnpj}, e a empresa ${empregador.razao_social} tem o CNPJ ${cnpjEmpresa}. Confira se o arquivo é da empresa certa.`,
    }, { status: 400 });
  }
  const agora = new Date();
  if (meta.validoAte < agora) {
    return NextResponse.json({ error: `Este certificado venceu em ${meta.validoAte.toLocaleDateString('pt-BR')}. Envie um certificado vigente.` }, { status: 400 });
  }
  const aviso = meta.validoDe > agora
    ? `Atenção: o certificado só passa a valer em ${meta.validoDe.toLocaleDateString('pt-BR')}.` : undefined;

  let pfxCifrado, senhaCifrada;
  try {
    pfxCifrado = cifrar(pfx);
    senhaCifrada = cifrar(Buffer.from(senha, 'utf8'));
  } catch (e) {
    // Chave ausente na Vercel: a mensagem já diz o que configurar.
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Guarda o id do certificado ativo atual antes de desativar: se o insert
  // abaixo falhar (inclusive por corrida com outro envio simultâneo), restaura
  // este id em vez de deixar a empresa sem nenhum certificado ativo.
  const { data: anterior } = await sb.from('certificados_digitais')
    .select('id').eq('empregador_id', params.id).eq('ativo', true).maybeSingle();

  // Substituição = desativa o anterior e insere o novo; o histórico fica.
  const { error: errDesativa } = await sb.from('certificados_digitais')
    .update({ ativo: false }).eq('empregador_id', params.id).eq('ativo', true);
  if (errDesativa) return NextResponse.json({ error: errDesativa.message }, { status: 500 });

  const { data, error } = await sb.from('certificados_digitais').insert([{
    empregador_id: params.id,
    pfx_cifrado: pfxCifrado,
    senha_cifrada: senhaCifrada,
    cnpj_certificado: meta.cnpj,
    titular: meta.titular,
    emissor: meta.emissor,
    numero_serie: meta.numeroSerie,
    valido_de: meta.validoDe.toISOString(),
    valido_ate: meta.validoAte.toISOString(),
    enviado_por: user.id,
  }]).select('id, titular, emissor, cnpj_certificado, numero_serie, valido_de, valido_ate, created_at').single();
  if (error) {
    // Desfaz a desativação: sem isto, um insert que falha (inclusive a corrida
    // abaixo) deixaria a empresa sem nenhum certificado ativo.
    if (anterior) {
      await sb.from('certificados_digitais').update({ ativo: true }).eq('id', anterior.id);
    }
    // Dois envios simultâneos para a mesma empresa colidem no índice único
    // parcial (um ativo por empregador); quem perde a corrida cai aqui.
    if (error.code === '23505') {
      return NextResponse.json({
        error: 'Outro envio para esta empresa foi processado ao mesmo tempo. Recarregue a tela e tente de novo.',
      }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ certificado: resumoCertificado(data), aviso });
}

export async function DELETE(request, { params }) {
  const { sb, erro } = await autorizarModulo(request, 'admin');
  if (erro) return erro;
  const { error } = await sb.from('certificados_digitais')
    .update({ ativo: false }).eq('empregador_id', params.id).eq('ativo', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
