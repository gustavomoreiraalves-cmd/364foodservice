'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from '../../components/CameraCapture';
import {
  carregarModelos, detectarComLandmarks, extrairDescritor, melhorMatch, calcularEAR,
  LIMIAR_MATCH, MARGEM_SEGUNDO, ZONA_CINZENTA, LIMIAR_EAR, EAR_ABERTO,
} from '../../lib/facial';
import { TIPOS_MARCACAO } from '../../lib/ponto';

const LS_TOKEN = 'quiosqueToken';
const LS_INFO = 'quiosqueInfo';
const VERSAO_APP = '1.0.0';

export default function QuiosquePage() {
  const [token, setToken] = useState(undefined); // undefined = carregando
  const [info, setInfo] = useState(null);

  useEffect(() => {
    setToken(localStorage.getItem(LS_TOKEN));
    const raw = localStorage.getItem(LS_INFO);
    if (raw) try { setInfo(JSON.parse(raw)); } catch { /* ignora */ }
  }, []);

  function aoAtivar(deviceToken, dados) {
    localStorage.setItem(LS_TOKEN, deviceToken);
    localStorage.setItem(LS_INFO, JSON.stringify(dados));
    setToken(deviceToken);
    setInfo(dados);
  }

  function aoDesautorizar() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_INFO);
    setToken(null);
    setInfo(null);
  }

  if (token === undefined) return <div className="quiosque"><p className="muted">Carregando…</p></div>;
  if (!token) return <TelaAtivacao aoAtivar={aoAtivar} />;
  return <TelaQuiosque token={token} info={info} aoDesautorizar={aoDesautorizar} />;
}

function TelaAtivacao({ aoAtivar }) {
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function ativar(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const resp = await fetch('/api/ponto/dispositivos/ativar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Erro na ativação');
      aoAtivar(json.deviceToken, { dispositivo: json.dispositivo, unidade: json.unidade, empresa: json.empresa });
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="quiosque">
      <div className="qk-brand">364</div>
      <div className="qk-unidade">Ativação do dispositivo</div>
      <p className="muted" style={{ maxWidth: 380 }}>
        Peça a um administrador para gerar o código de ativação em <b>Ponto → Dispositivos</b> e digite-o abaixo.
      </p>
      <form onSubmit={ativar} style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <input className="qk-input" inputMode="numeric" maxLength={6} value={codigo}
          onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="······" autoFocus />
        {erro && <p className="qk-erro">{erro}</p>}
        <button className="btn qk-registrar" type="submit" disabled={codigo.length !== 6 || enviando}>
          {enviando ? 'Ativando…' : 'Ativar'}
        </button>
      </form>
    </div>
  );
}

function TelaQuiosque({ token, info, aoDesautorizar }) {
  // fases: idle | camera | confirmar | gravando | comprovante | pin
  const [fase, setFase] = useState('idle');
  const [agora, setAgora] = useState(new Date());
  const offsetRef = useRef(0);
  const [online, setOnline] = useState(true);
  const [syncFalhas, setSyncFalhas] = useState(0);
  const colaboradoresRef = useRef([]);
  const [nSincronizados, setNSincronizados] = useState(0);
  const [modelosProntos, setModelosProntos] = useState(false);
  const [instrucao, setInstrucao] = useState('');
  const [erro, setErro] = useState('');
  const [confirmacao, setConfirmacao] = useState(null); // {colaborador, tipoSugerido, tipoSel, score, liveness, descritor}
  const [comprovante, setComprovante] = useState(null);
  const videoRef = useRef(null);
  const cancelarLoopRef = useRef(false);

  const horaCorrigida = useCallback(() => new Date(Date.now() + offsetRef.current), []);

  // relógio na tela
  useEffect(() => {
    const t = setInterval(() => setAgora(horaCorrigida()), 1000);
    return () => clearInterval(t);
  }, [horaCorrigida]);

  // sync + heartbeat a cada 60s
  const sincronizar = useCallback(async () => {
    try {
      const t0 = Date.now();
      const resp = await fetch('/api/ponto/quiosque/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body: JSON.stringify({ versaoApp: VERSAO_APP }),
      });
      if (resp.status === 401 || resp.status === 403) { aoDesautorizar(); return; }
      if (!resp.ok) throw new Error('sync falhou');
      const json = await resp.json();
      const rtt = Date.now() - t0;
      offsetRef.current = json.agoraUtcMs + rtt / 2 - Date.now();
      colaboradoresRef.current = json.colaboradores || [];
      setNSincronizados(colaboradoresRef.current.length);
      setOnline(true);
      setSyncFalhas(0);
    } catch {
      setSyncFalhas(f => f + 1);
      setOnline(false);
    }
  }, [token, aoDesautorizar]);

  useEffect(() => {
    sincronizar();
    const t = setInterval(sincronizar, 60 * 1000);
    return () => clearInterval(t);
  }, [sincronizar]);

  // modelos faciais
  useEffect(() => {
    carregarModelos().then(() => setModelosProntos(true)).catch(() => setErro('Falha ao carregar modelos de reconhecimento.'));
  }, []);

  // ---- fluxo de captura: detecção -> liveness (piscada) -> matching ----
  async function iniciarCaptura() {
    setErro('');
    setComprovante(null);
    setFase('camera');
  }

  function registrarTentativaLocal(motivo, melhorScore) {
    fetch('/api/ponto/quiosque/tentativa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-token': token },
      body: JSON.stringify({ motivo, melhorScore: melhorScore ?? null }),
    }).catch(() => { /* telemetria: falha silenciosa */ });
  }

  async function aoVideoPronto(video) {
    videoRef.current = video;
    cancelarLoopRef.current = false;
    if (!modelosProntos) {
      setInstrucao('Carregando reconhecimento…');
      await carregarModelos();
      setModelosProntos(true);
    }

    // 1) rosto estável
    setInstrucao('Posicione o rosto na moldura');
    const detTimeout = Date.now() + 20000;
    let estaveis = 0;
    while (!cancelarLoopRef.current && Date.now() < detTimeout) {
      const dets = await detectarComLandmarks(video);
      if (dets.length === 1) {
        const box = dets[0].detection.box;
        const proporcao = box.width / video.videoWidth;
        if (proporcao > 0.22) { estaveis++; if (estaveis >= 3) break; }
        else setInstrucao('Aproxime-se um pouco da câmera');
      } else if (dets.length > 1) {
        setInstrucao('Apenas uma pessoa por vez, por favor');
        estaveis = 0;
      } else {
        setInstrucao('Posicione o rosto na moldura');
        estaveis = 0;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    if (cancelarLoopRef.current) return;
    if (estaveis < 3) { encerrarCamera('Não foi possível detectar o rosto. Tente novamente.'); return; }

    // 2) liveness: piscada via EAR
    setInstrucao('Agora pisque os olhos');
    const liveTimeout = Date.now() + 8000;
    let piscadas = 0;
    let earMin = 1;
    let fechado = false;
    while (!cancelarLoopRef.current && Date.now() < liveTimeout && piscadas < 1) {
      const dets = await detectarComLandmarks(video);
      if (dets.length === 1) {
        const ear = calcularEAR(dets[0].landmarks);
        earMin = Math.min(earMin, ear);
        if (!fechado && ear < LIMIAR_EAR) fechado = true;
        if (fechado && ear > EAR_ABERTO) { piscadas++; fechado = false; }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    if (cancelarLoopRef.current) return;
    const livenessOk = piscadas >= 1;
    if (!livenessOk) {
      registrarTentativaLocal('liveness_falhou');
      encerrarCamera('Prova de vida não confirmada. Tente novamente e pisque quando pedido.');
      return;
    }

    // 3) matching
    setInstrucao('Reconhecendo…');
    let resultado = await extrairDescritor(video);
    if (!resultado) { encerrarCamera('Rosto perdido durante o reconhecimento. Tente novamente.'); return; }
    let { melhor, segundo } = melhorMatch(resultado.descritor, colaboradoresRef.current);

    // zona cinzenta: recaptura e usa a média
    if (melhor.dist > LIMIAR_MATCH && melhor.dist <= ZONA_CINZENTA) {
      const r2 = await extrairDescritor(video);
      if (r2) {
        const media = resultado.descritor.map((v, i) => (v + r2.descritor[i]) / 2);
        ({ melhor, segundo } = melhorMatch(media, colaboradoresRef.current));
        resultado = { ...resultado, descritor: media };
      }
    }

    const margemOk = !segundo.colaborador || (segundo.dist - melhor.dist) >= MARGEM_SEGUNDO;
    if (!melhor.colaborador || melhor.dist > LIMIAR_MATCH || !margemOk) {
      registrarTentativaLocal('sem_match', melhor.dist === Infinity ? null : Number(melhor.dist.toFixed(4)));
      encerrarCamera('Não reconhecido. Tente novamente ou use a matrícula + PIN.');
      return;
    }

    // 4) contexto (tipo sugerido)
    let tipoSugerido = 'entrada';
    try {
      const resp = await fetch('/api/ponto/quiosque/contexto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body: JSON.stringify({ colaboradorId: melhor.colaborador.id }),
      });
      if (resp.ok) tipoSugerido = (await resp.json()).tipoSugerido;
    } catch { /* mantém sugestão padrão */ }

    cancelarLoopRef.current = true;
    setConfirmacao({
      colaborador: melhor.colaborador,
      tipoSel: tipoSugerido,
      score: melhor.dist,
      liveness: { piscadas, ear_min: Number(earMin.toFixed(3)) },
      descritor: resultado.descritor,
      metodo: 'facial',
    });
    setFase('confirmar');
  }

  function encerrarCamera(mensagemErro) {
    cancelarLoopRef.current = true;
    setFase('idle');
    if (mensagemErro) setErro(mensagemErro);
  }

  async function confirmarMarcacao() {
    setFase('gravando');
    const idempotencia = crypto.randomUUID();
    const body = {
      idempotencia,
      colaboradorId: confirmacao.colaborador.id,
      tipo: confirmacao.tipoSel,
      metodo: confirmacao.metodo,
      score: confirmacao.score != null ? Number(confirmacao.score.toFixed(4)) : null,
      livenessOk: confirmacao.metodo === 'facial' ? true : null,
      livenessDetalhe: confirmacao.liveness || null,
      descritorCapturado: confirmacao.descritor || null,
      capturadoEmCliente: new Date().toISOString(),
      offsetRelogioMs: Math.round(offsetRef.current),
    };

    let ultimoErro = '';
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const resp = await fetch('/api/ponto/quiosque/marcar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-token': token },
          body: JSON.stringify(body),
        });
        const json = await resp.json();
        if (!resp.ok) { ultimoErro = json.error || 'Erro ao registrar.'; break; }
        setComprovante(json.comprovante);
        setConfirmacao(null);
        setFase('comprovante');
        setTimeout(() => setFase(f => f === 'comprovante' ? 'idle' : f), 8000);
        return;
      } catch {
        ultimoErro = 'Falha de conexão. Tentando de novo…';
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    setConfirmacao(null);
    setFase('idle');
    setErro(ultimoErro);
  }

  // timeout da confirmação
  useEffect(() => {
    if (fase !== 'confirmar') return;
    const t = setTimeout(() => { setConfirmacao(null); setFase('idle'); }, 20000);
    return () => clearTimeout(t);
  }, [fase]);

  const dataFmt = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const horaFmt = agora.toLocaleTimeString('pt-BR');

  return (
    <div className="quiosque">
      <div className="qk-brand">364</div>
      <div className="qk-unidade">{info?.unidade?.nome || 'Unidade'} · {info?.empresa?.nome || ''}</div>

      {fase === 'idle' && (
        <>
          <div className="qk-relogio">{horaFmt}</div>
          <div className="qk-data">{dataFmt}</div>
          <div className="qk-status">
            <span className={online ? 'on' : 'off'}>{online ? '● Online' : '● Sem conexão'}</span>
            <span>{nSincronizados} colaborador(es) sincronizado(s)</span>
            <span>{modelosProntos ? 'Reconhecimento pronto' : 'Carregando reconhecimento…'}</span>
          </div>
          {erro && <p className="qk-erro">{erro}</p>}
          <button className="btn qk-registrar" onClick={iniciarCaptura} disabled={!online && syncFalhas >= 3}>
            Registrar ponto
          </button>
          {!online && syncFalhas >= 3 && <p className="qk-erro">Sem conexão com o servidor — chame o gestor.</p>}
          <button className="btn secondary small" style={{ marginTop: 16 }} onClick={() => { setErro(''); setFase('pin'); }}>
            Não consigo usar o reconhecimento facial
          </button>
          <p className="muted" style={{ fontSize: 10.5, maxWidth: 420 }}>
            Este dispositivo usa reconhecimento facial com prova de vida para registro de jornada.
            Dados tratados conforme o aviso de privacidade do Grupo 364.
          </p>
        </>
      )}

      {fase === 'camera' && (
        <>
          <div className="qk-video-wrap">
            <CameraCapture onVideoPronto={aoVideoPronto} onErro={e => encerrarCamera(e)} />
          </div>
          <div className="qk-instrucao">{instrucao}</div>
          <button className="btn secondary" onClick={() => encerrarCamera()}>Cancelar</button>
        </>
      )}

      {fase === 'confirmar' && confirmacao && (
        <div className="qk-confirma">
          <div className="nome">Olá, {confirmacao.colaborador.primeiroNome}!</div>
          <div className="qk-data">{horaFmt} — confirme o tipo de marcação:</div>
          <div className="qk-tipos">
            {Object.entries(TIPOS_MARCACAO).map(([k, label]) => (
              <button key={k} className={'qk-tipo' + (confirmacao.tipoSel === k ? ' sel' : '')}
                onClick={() => setConfirmacao({ ...confirmacao, tipoSel: k })}>
                {label}
              </button>
            ))}
          </div>
          <div className="row-actions" style={{ justifyContent: 'center', gap: 12 }}>
            <button className="btn qk-registrar" style={{ fontSize: 16, padding: '14px 34px' }} onClick={confirmarMarcacao}>Confirmar</button>
            <button className="btn secondary" onClick={() => { setConfirmacao(null); setFase('idle'); }}>Cancelar</button>
          </div>
        </div>
      )}

      {fase === 'gravando' && <div className="qk-instrucao">Registrando…</div>}

      {fase === 'comprovante' && comprovante && (
        <div className="qk-comprovante">
          <div className="ok">✔ Ponto registrado com sucesso</div>
          <div style={{ fontSize: 18 }}>{comprovante.primeiroNome} — {TIPOS_MARCACAO[comprovante.tipo]}</div>
          <div style={{ fontSize: 26, fontFamily: 'Georgia, serif', marginTop: 6 }}>
            {new Date(comprovante.dataHoraLocal).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="det">NSR {comprovante.nsr} · {comprovante.hashPrefixo}</div>
          <button className="btn secondary small" style={{ marginTop: 14 }} onClick={() => setFase('idle')}>Fechar</button>
        </div>
      )}

      {fase === 'pin' && (
        <TelaPin token={token}
          aoIdentificar={async (colaborador) => {
            let tipoSugerido = 'entrada';
            try {
              const resp = await fetch('/api/ponto/quiosque/contexto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-device-token': token },
                body: JSON.stringify({ colaboradorId: colaborador.id }),
              });
              if (resp.ok) tipoSugerido = (await resp.json()).tipoSugerido;
            } catch { /* mantém padrão */ }
            setConfirmacao({ colaborador, tipoSel: tipoSugerido, score: null, liveness: null, descritor: null, metodo: 'pin' });
            setFase('confirmar');
          }}
          aoCancelar={() => setFase('idle')} />
      )}
    </div>
  );
}

function TelaPin({ token, aoIdentificar, aoCancelar }) {
  const [matricula, setMatricula] = useState('');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const resp = await fetch('/api/ponto/quiosque/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body: JSON.stringify({ matricula, pin }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Erro');
      aoIdentificar(json.colaborador);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <div className="qk-instrucao">Identificação por matrícula + PIN</div>
      <input className="qk-input" style={{ fontSize: 20, letterSpacing: 2 }} placeholder="Matrícula"
        value={matricula} onChange={e => setMatricula(e.target.value)} autoFocus />
      <input className="qk-input" style={{ fontSize: 20 }} type="password" inputMode="numeric" maxLength={6} placeholder="PIN"
        value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
      {erro && <p className="qk-erro">{erro}</p>}
      <div className="row-actions" style={{ gap: 12 }}>
        <button className="btn" type="submit" disabled={!matricula || pin.length < 4 || enviando}>{enviando ? 'Verificando…' : 'Continuar'}</button>
        <button className="btn secondary" type="button" onClick={aoCancelar}>Voltar</button>
      </div>
    </form>
  );
}
