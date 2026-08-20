'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../../../lib/supabase';
import AppShell from '../../../../../components/AppShell';
import PontoTabs from '../../../../../components/PontoTabs';
import CameraCapture from '../../../../../components/CameraCapture';
import PromptDialog from '../../../../../components/PromptDialog';
import { useIsAdmin } from '../../../../../lib/ponto';
import { carregarModelos, extrairDescritor, QUALIDADE_MINIMA } from '../../../../../lib/facial';

const POSES = [
  'Olhe de frente para a câmera',
  'Vire levemente o rosto para a direita',
  'Vire levemente o rosto para a esquerda',
];

export default function FacialPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Cadastro biométrico facial" desc="Captura de amostras para reconhecimento no quiosque">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { id } = useParams();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [colab, setColab] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ciente, setCiente] = useState(false);
  const [etapa, setEtapa] = useState('aviso'); // aviso | captura | enviando | concluido
  const [amostras, setAmostras] = useState([]); // {descritor, score}
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const videoRef = useRef(null);
  const [modelosProntos, setModelosProntos] = useState(false);
  const [pedirMotivoBloqueio, setPedirMotivoBloqueio] = useState(false);

  useEffect(() => {
    async function init() {
      const [{ data: c }, { data: av }] = await Promise.all([
        supabase.from('colaboradores').select('id, nome, biometria_status').eq('id', id).single(),
        supabase.from('ponto_avisos_privacidade').select('*').eq('ativo', true).order('versao', { ascending: false }).limit(1).single(),
      ]);
      setColab(c);
      setAviso(av);
    }
    init();
  }, [id]);

  useEffect(() => {
    if (etapa !== 'captura') return;
    setMsg('Carregando modelos de reconhecimento…');
    carregarModelos().then(() => {
      setModelosProntos(true);
      setMsg(POSES[0]);
    }).catch(err => setErro('Falha ao carregar os modelos: ' + err.message));
  }, [etapa]);

  async function capturarAmostra() {
    if (!modelosProntos || !videoRef.current) return;
    setMsg('Analisando…');
    const resultado = await extrairDescritor(videoRef.current);
    if (!resultado) { setMsg('Nenhum rosto detectado. ' + POSES[amostras.length]); return; }
    if (resultado.score < QUALIDADE_MINIMA) {
      setMsg(`Qualidade baixa (${resultado.score.toFixed(2)}). Melhore a iluminação. ${POSES[amostras.length]}`);
      return;
    }
    const novas = [...amostras, resultado];
    setAmostras(novas);
    if (novas.length < POSES.length) {
      setMsg(POSES[novas.length]);
    } else {
      setMsg('Amostras completas. Enviando…');
      await enviar(novas);
    }
  }

  async function enviar(novas) {
    setEtapa('enviando');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('/api/ponto/biometria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          colaboradorId: id,
          descritores: novas.map(a => a.descritor),
          qualidades: novas.map(a => a.score),
          avisoId: aviso.id,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Erro na API');
      setEtapa('concluido');
    } catch (err) {
      setErro('Erro ao salvar biometria: ' + err.message);
      setEtapa('captura');
      setAmostras([]);
      setMsg(POSES[0]);
    }
  }

  async function bloquear(motivo) {
    setPedirMotivoBloqueio(false);
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch('/api/ponto/biometria', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ colaboradorId: id, motivo }),
    });
    const json = await resp.json();
    if (!resp.ok) { alert(json.error || 'Erro'); return; }
    router.push('/ponto/colaboradores');
  }

  if (!colab || !aviso) return <p className="muted">Carregando…</p>;

  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <h3>Biometria facial — {colab.nome}</h3>

      {etapa === 'aviso' && (
        <>
          <p className="muted" style={{ fontSize: 12 }}>Aviso de privacidade (versão {aviso.versao}):</p>
          <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '10px 14px', fontSize: 12.5, margin: '8px 0 14px', whiteSpace: 'pre-wrap' }}>
            {aviso.texto}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={ciente} onChange={e => setCiente(e.target.checked)} />
            <span>O colaborador foi informado do tratamento dos seus dados biométricos e declarou ciência do aviso acima.</span>
          </label>
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="btn" disabled={!ciente} onClick={() => setEtapa('captura')}>Iniciar captura</button>
            {colab.biometria_status !== 'pendente' && isAdmin && (
              <button className="btn danger" onClick={() => setPedirMotivoBloqueio(true)}>Bloquear/excluir biometria atual</button>
            )}
          </div>
          {colab.biometria_status === 'cadastrada' && (
            <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>Este colaborador já tem biometria cadastrada — uma nova captura substitui a anterior (o histórico fica em auditoria).</p>
          )}
        </>
      )}

      {(etapa === 'captura' || etapa === 'enviando') && (
        <>
          <div style={{ width: 320, margin: '0 auto' }}>
            <CameraCapture
              className="qk-camera"
              onVideoPronto={v => { videoRef.current = v; }}
              onErro={e => setErro(e)}
            />
          </div>
          <style>{`.qk-camera{width:320px;height:240px;object-fit:cover;transform:scaleX(-1);border-radius:6px;border:1px solid var(--border);background:#000;}`}</style>
          <p style={{ textAlign: 'center', fontSize: 14, minHeight: 22 }}>{msg}</p>
          <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>Amostras capturadas: {amostras.length} de {POSES.length}</p>
          {erro && <p className="erro" style={{ textAlign: 'center' }}>{erro}</p>}
          <div className="row-actions" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button className="btn" disabled={!modelosProntos || etapa === 'enviando'} onClick={capturarAmostra}>
              {etapa === 'enviando' ? 'Enviando…' : 'Capturar amostra'}
            </button>
          </div>
        </>
      )}

      {etapa === 'concluido' && (
        <>
          <p style={{ fontSize: 15 }}>✔ Biometria cadastrada com sucesso. O colaborador já pode registrar ponto no quiosque.</p>
          <button className="btn" onClick={() => router.push('/ponto/colaboradores')}>Voltar aos colaboradores</button>
        </>
      )}

      {pedirMotivoBloqueio && (
        <PromptDialog
          titulo="Bloquear/excluir biometria atual"
          label="Motivo"
          placeholder="Ex.: recadastro por má qualidade, saída do colaborador"
          aoConfirmar={bloquear}
          aoCancelar={() => setPedirMotivoBloqueio(false)}
        />
      )}
    </div>
  );
}
