import { NextResponse } from 'next/server';
import { autenticarDispositivo, cifrarDescritor, sha256Hex, auditar } from '../../../../../lib/pontoServer';

// POST (x-device-token): autocadastro de biometria facial pelo próprio
// colaborador no quiosque, depois de se identificar por matrícula + PIN.
// Só aceita quando ele ainda não tem biometria cadastrada (recadastro/
// bloqueio continuam exigindo um RH logado em /ponto/colaboradores/[id]/facial).
// body: { colaboradorId, descritores: [[128 floats]...], qualidades: [n...] }
export async function POST(request) {
  const { sb, disp, erro } = await autenticarDispositivo(request);
  if (erro) return erro;

  const { colaboradorId, descritores, qualidades = [] } = await request.json();
  if (!colaboradorId || !Array.isArray(descritores) || !descritores.length) {
    return NextResponse.json({ error: 'Informe o colaborador e ao menos uma amostra.' }, { status: 400 });
  }
  if (descritores.some(d => !Array.isArray(d) || d.length !== 128)) {
    return NextResponse.json({ error: 'Descritores inválidos.' }, { status: 400 });
  }

  const { data: colab } = await sb.from('colaboradores')
    .select('id, nome, empresa_id, status, biometria_status')
    .eq('id', colaboradorId).maybeSingle();
  if (!colab || colab.empresa_id !== disp.empresa_id || colab.status !== 'ativo') {
    return NextResponse.json({ error: 'Colaborador não encontrado.' }, { status: 404 });
  }
  if (colab.biometria_status === 'cadastrada') {
    return NextResponse.json({ error: 'Este colaborador já tem biometria cadastrada. Um recadastro precisa ser feito por um administrador.' }, { status: 409 });
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: vinculo } = await sb.from('colaborador_unidades')
    .select('id').eq('colaborador_id', colaboradorId).eq('unidade_id', disp.unidade_id)
    .lte('data_inicio', hoje).or('data_fim.is.null,data_fim.gte.' + hoje).limit(1).maybeSingle();
  if (!vinculo) return NextResponse.json({ error: 'Colaborador sem vínculo com esta unidade.' }, { status: 403 });

  const { data: aviso } = await sb.from('ponto_avisos_privacidade')
    .select('id, texto').eq('ativo', true).order('versao', { ascending: false }).limit(1).maybeSingle();
  if (!aviso) return NextResponse.json({ error: 'Nenhum aviso de privacidade cadastrado.' }, { status: 404 });

  await sb.from('ponto_biometrias').update({ ativo: false }).eq('colaborador_id', colaboradorId).eq('ativo', true);

  const linhas = descritores.map((d, i) => ({
    colaborador_id: colaboradorId,
    descritor_cifrado: cifrarDescritor(d),
    qualidade: qualidades[i] ?? null,
    amostra: i + 1,
    dispositivo_id: disp.id,
  }));
  const { error: eBio } = await sb.from('ponto_biometrias').insert(linhas);
  if (eBio) return NextResponse.json({ error: eBio.message }, { status: 500 });

  const { error: eCons } = await sb.from('ponto_consentimentos').insert([{
    colaborador_id: colaboradorId,
    aviso_id: aviso.id,
    tipo: 'ciencia_biometria',
    base_legal: 'obrigacao_legal',
    meio: 'quiosque_autoatendimento',
    dispositivo_id: disp.id,
    hash_texto: sha256Hex(aviso.texto),
  }]);
  if (eCons) return NextResponse.json({ error: eCons.message }, { status: 500 });

  await sb.from('colaboradores').update({ biometria_status: 'cadastrada' }).eq('id', colaboradorId);
  await auditar(sb, {
    ator_tipo: 'dispositivo',
    ator_dispositivo_id: disp.id,
    acao: 'biometria_cadastrada_quiosque',
    entidade: 'colaboradores',
    entidade_id: colaboradorId,
  });

  return NextResponse.json({ ok: true, amostras: linhas.length });
}
