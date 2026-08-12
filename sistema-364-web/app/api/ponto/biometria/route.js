import { NextResponse } from 'next/server';
import { autorizarModulo, cifrarDescritor, sha256Hex, auditar } from '../../../../lib/pontoServer';

// POST (RH logado): grava as amostras biométricas cifradas + consentimento LGPD.
// body: { colaboradorId, descritores: [[128 floats]...], qualidades: [n...], avisoId, baseLegal }
export async function POST(request) {
  const { sb, user, erro } = await autorizarModulo(request, 'ponto');
  if (erro) return erro;

  const { colaboradorId, descritores, qualidades = [], avisoId, baseLegal = 'obrigacao_legal' } = await request.json();
  if (!colaboradorId || !Array.isArray(descritores) || !descritores.length) {
    return NextResponse.json({ error: 'Informe colaborador e ao menos uma amostra.' }, { status: 400 });
  }
  if (descritores.some(d => !Array.isArray(d) || d.length !== 128)) {
    return NextResponse.json({ error: 'Descritores inválidos.' }, { status: 400 });
  }
  if (!avisoId) return NextResponse.json({ error: 'É obrigatório registrar a ciência do aviso de privacidade.' }, { status: 400 });

  const { data: colab } = await sb.from('colaboradores').select('id, nome').eq('id', colaboradorId).maybeSingle();
  if (!colab) return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });

  const { data: aviso } = await sb.from('ponto_avisos_privacidade').select('id, texto').eq('id', avisoId).maybeSingle();
  if (!aviso) return NextResponse.json({ error: 'Aviso de privacidade não encontrado.' }, { status: 404 });

  // recadastro: desativa amostras anteriores (histórico de auditoria fica pelos triggers)
  await sb.from('ponto_biometrias').update({ ativo: false }).eq('colaborador_id', colaboradorId).eq('ativo', true);

  const linhas = descritores.map((d, i) => ({
    colaborador_id: colaboradorId,
    descritor_cifrado: cifrarDescritor(d),
    qualidade: qualidades[i] ?? null,
    amostra: i + 1,
    cadastrado_por: user.id,
  }));
  const { error: eBio } = await sb.from('ponto_biometrias').insert(linhas);
  if (eBio) return NextResponse.json({ error: eBio.message }, { status: 500 });

  const { error: eCons } = await sb.from('ponto_consentimentos').insert([{
    colaborador_id: colaboradorId,
    aviso_id: aviso.id,
    tipo: 'ciencia_biometria',
    base_legal: baseLegal,
    coletado_por: user.id,
    hash_texto: sha256Hex(aviso.texto),
  }]);
  if (eCons) return NextResponse.json({ error: eCons.message }, { status: 500 });

  await sb.from('colaboradores').update({ biometria_status: 'cadastrada' }).eq('id', colaboradorId);
  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'biometria_cadastrada', entidade: 'colaboradores', entidade_id: colaboradorId });

  return NextResponse.json({ ok: true, amostras: linhas.length });
}

// DELETE (RH logado): bloqueia/remove a biometria ativa, com motivo obrigatório.
export async function DELETE(request) {
  const { sb, user, erro } = await autorizarModulo(request, 'ponto');
  if (erro) return erro;

  const { colaboradorId, motivo } = await request.json();
  if (!colaboradorId || !motivo) return NextResponse.json({ error: 'Informe colaborador e motivo.' }, { status: 400 });

  await sb.from('ponto_biometrias').update({ ativo: false }).eq('colaborador_id', colaboradorId).eq('ativo', true);
  await sb.from('colaboradores').update({ biometria_status: 'bloqueada' }).eq('id', colaboradorId);
  await auditar(sb, { ator_user_id: user.id, ator_tipo: 'usuario', acao: 'biometria_bloqueada', entidade: 'colaboradores', entidade_id: colaboradorId, motivo });

  return NextResponse.json({ ok: true });
}
