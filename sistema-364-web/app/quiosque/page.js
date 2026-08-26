'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from '../../components/CameraCapture';
import {
  carregarModelos, detectarComLandmarks, extrairDescritor, melhorMatch, calcularEAR,
  LIMIAR_MATCH, MARGEM_SEGUNDO, ZONA_CINZENTA, LIMIAR_EAR, EAR_ABERTO, QUALIDADE_MINIMA,
} from '../../lib/facial';
import { TIPOS_MARCACAO } from '../../lib/ponto';

const LS_TOKEN = 'quiosqueToken';
const LS_INFO = 'quiosqueInfo';
const VERSAO_APP = '1.0.0';
const MARCAS = 'Steakhouse · Afya · Foodservices · Buffet & Eventos';

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
      <img className="qk-logo" src="/logo-364.png" alt="Grupo 364" />
      <p className="qk-marcas">{MARCAS}</p>
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

const POSES_CADASTRO = [
  'Olhe de frente para a câmera',
  'Vire levemente o rosto para a direita',
  'Vire levemente o rosto para a esquerda',
];

function TelaQuiosque({ token, info, aoDesautorizar }) {
  // fases: idle | camera | confirmar | gravando | comprovante | pin | cadastro_biometria
  const [fase, setFase] = useState('idle');
  const [colabCadastro, setColabCadastro] = useState(null); // colaborador sem biometria, identificado via PIN
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
  const [emailDecidido, setEmailDecidido] = useState(null); // null=aguardando | true=enviar | false=recusado
  const [emailContagem, setEmailContagem] = useState(10);
  const [emailStatus, setEmailStatus] = useState('');
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

  // usado tanto pelo PIN direto (colaborador já tem biometria) quanto depois
  // de concluir o autocadastro de biometria no quiosque
  async function irParaConfirmar(colaborador, metodo) {
    let tipoSugerido = 'entrada';
    try {
      const resp = await fetch('/api/ponto/quiosque/contexto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body: JSON.stringify({ colaboradorId: colaborador.id }),
      });
      if (resp.ok) tipoSugerido = (await resp.json()).tipoSugerido;
    } catch { /* mantém padrão */ }
    setConfirmacao({ colaborador, tipoSel: tipoSugerido, score: null, liveness: null, descritor: null, metodo });
    setFase('confirmar');
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
        setEmailDecidido(json.comprovante.temEmail ? null : false);
        setEmailContagem(10);
        setEmailStatus('');
        setConfirmacao(null);
        setFase('comprovante');
        setTimeout(() => setFase(f => f === 'comprovante' ? 'idle' : f), 16000);
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

  // contagem de 10s pra decidir se envia o comprovante por e-mail; sem
  // resposta, conta como recusa (não envia nada sem confirmação)
  useEffect(() => {
    if (fase !== 'comprovante' || emailDecidido !== null) return;
    if (emailContagem <= 0) { setEmailDecidido(false); return; }
    const t = setTimeout(() => setEmailContagem(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [fase, emailDecidido, emailContagem]);

  async function decidirEnvioEmail(enviar) {
    setEmailDecidido(true);
    if (!enviar) { setEmailStatus(''); setEmailDecidido(false); return; }
    setEmailStatus('Enviando…');
    try {
      const resp = await fetch('/api/ponto/quiosque/comprovante-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body: JSON.stringify({ colaboradorId: comprovante.colaboradorId, nsr: comprovante.nsr }),
      });
      const json = await resp.json();
      setEmailStatus(resp.ok ? `Enviado para ${json.emailMascarado}.` : (json.error || 'Falha ao enviar.'));
    } catch {
      setEmailStatus('Falha de conexão ao enviar.');
    }
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
      <img className="qk-logo" src="/logo-364.png" alt="Grupo 364" />
      <p className="qk-marcas">{MARCAS}</p>
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

          {emailDecidido === null && (
            <div className="qk-email-prompt" style={{ marginTop: 16 }}>
              <p style={{ fontSize: 13 }}>Enviar este comprovante por e-mail para {comprovante.emailMascarado}?</p>
              <div className="row-actions" style={{ justifyContent: 'center', gap: 12 }}>
                <button className="btn qk-registrar" onClick={() => decidirEnvioEmail(true)}>Enviar ({emailContagem}s)</button>
                <button className="btn secondary" onClick={() => decidirEnvioEmail(false)}>Não enviar</button>
              </div>
            </div>
          )}
          {emailStatus && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{emailStatus}</p>}

          <button className="btn secondary small" style={{ marginTop: 14 }} onClick={() => setFase('idle')}>Fechar</button>
        </div>
      )}

      {fase === 'pin' && (
        <TelaPin token={token}
          aoIdentificar={async (colaborador) => {
            if (colaborador.biometriaStatus !== 'cadastrada') {
              setColabCadastro(colaborador);
              setFase('cadastro_biometria');
              return;
            }
            irParaConfirmar(colaborador, 'pin');
          }}
          aoCancelar={() => setFase('idle')} />
      )}

      {fase === 'cadastro_biometria' && colabCadastro && (
        <TelaCadastroBiometria token={token} colaborador={colabCadastro}
          aoConcluir={() => { irParaConfirmar(colabCadastro, 'pin'); setColabCadastro(null); }}
          aoCancelar={() => { setColabCadastro(null); setFase('idle'); }} />
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
      <p className="muted" style={{ fontSize: 11.5, maxWidth: 320, margin: '-4px 0 0' }}>
        Primeira vez? Digite um PIN de 4 a 6 dígitos — ele vira o seu PIN de acesso a partir de agora.
      </p>
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

// Colaborador identificado por matrícula+PIN mas sem biometria cadastrada:
// mostra o aviso de privacidade e captura as amostras direto no quiosque.
function TelaCadastroBiometria({ token, colaborador, aoConcluir, aoCancelar }) {
  const [etapa, setEtapa] = useState('aviso'); // aviso | captura | enviando
  const [aviso, setAviso] = useState(null);
  const [ciente, setCiente] = useState(false);
  const [modelosProntos, setModelosProntos] = useState(false);
  const [amostras, setAmostras] = useState([]);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
    fetch('/api/ponto/quiosque/aviso-privacidade', { headers: { 'x-device-token': token } })
      .then(r => r.json())
      .then(json => { if (json.aviso) setAviso(json.aviso); else setErro(json.error || 'Erro ao carregar aviso.'); })
      .catch(() => setErro('Falha de conexão ao carregar o aviso de privacidade.'));
  }, [token]);

  useEffect(() => {
    if (etapa !== 'captura') return;
    setMsg('Carregando reconhecimento…');
    carregarModelos().then(() => { setModelosProntos(true); setMsg(POSES_CADASTRO[0]); })
      .catch(err => setErro('Falha ao carregar os modelos: ' + err.message));
  }, [etapa]);

  async function capturarAmostra() {
    if (!modelosProntos || !videoRef.current) return;
    setMsg('Analisando…');
    const resultado = await extrairDescritor(videoRef.current);
    if (!resultado) { setMsg('Nenhum rosto detectado. ' + POSES_CADASTRO[amostras.length]); return; }
    if (resultado.score < QUALIDADE_MINIMA) {
      setMsg(`Qualidade baixa (${resultado.score.toFixed(2)}). Melhore a iluminação. ${POSES_CADASTRO[amostras.length]}`);
      return;
    }
    const novas = [...amostras, resultado];
    setAmostras(novas);
    if (novas.length < POSES_CADASTRO.length) { setMsg(POSES_CADASTRO[novas.length]); return; }

    setMsg('Amostras completas. Enviando…');
    setEtapa('enviando');
    try {
      const resp = await fetch('/api/ponto/quiosque/biometria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-token': token },
        body: JSON.stringify({
          colaboradorId: colaborador.id,
          descritores: novas.map(a => a.descritor),
          qualidades: novas.map(a => a.score),
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Erro ao salvar biometria.');
      aoConcluir();
    } catch (err) {
      setErro(err.message);
      setEtapa('captura');
      setAmostras([]);
      setMsg(POSES_CADASTRO[0]);
    }
  }

  return (
    <div className="qk-confirma" style={{ maxWidth: 420 }}>
      <div className="nome">Olá, {colaborador.primeiroNome}!</div>

      {etapa === 'aviso' && (
        <>
          <p style={{ fontSize: 13 }}>Você ainda não tem biometria facial cadastrada. Antes de continuar, leia o aviso de privacidade:</p>
          {!aviso && !erro && <p className="muted">Carregando…</p>}
          {aviso && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '10px 14px', fontSize: 12, margin: '8px 0 14px', whiteSpace: 'pre-wrap', textAlign: 'left', maxHeight: 160, overflowY: 'auto' }}>
              {aviso.texto}
            </div>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
            <input type="checkbox" checked={ciente} onChange={e => setCiente(e.target.checked)} />
            <span>Estou ciente do tratamento dos meus dados biométricos conforme o aviso acima.</span>
          </label>
          {erro && <p className="qk-erro">{erro}</p>}
          <div className="row-actions" style={{ justifyContent: 'center', gap: 12, marginTop: 14 }}>
            <button className="btn qk-registrar" disabled={!ciente || !aviso} onClick={() => setEtapa('captura')}>Iniciar captura facial</button>
            <button className="btn secondary" onClick={aoCancelar}>Voltar</button>
          </div>
        </>
      )}

      {(etapa === 'captura' || etapa === 'enviando') && (
        <>
          <div className="qk-video-wrap" style={{ maxWidth: 320, margin: '0 auto' }}>
            <CameraCapture onVideoPronto={v => { videoRef.current = v; }} onErro={e => setErro(e)} />
          </div>
          <p style={{ fontSize: 14, minHeight: 22 }}>{msg}</p>
          <p className="muted" style={{ fontSize: 12 }}>Amostras capturadas: {amostras.length} de {POSES_CADASTRO.length}</p>
          {erro && <p className="qk-erro">{erro}</p>}
          <div className="row-actions" style={{ justifyContent: 'center', gap: 12 }}>
            <button className="btn qk-registrar" disabled={!modelosProntos || etapa === 'enviando'} onClick={capturarAmostra}>
              {etapa === 'enviando' ? 'Enviando…' : 'Capturar amostra'}
            </button>
            <button className="btn secondary" onClick={aoCancelar}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}
