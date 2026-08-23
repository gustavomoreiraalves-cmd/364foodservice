'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const ROTULO = {
  vigente: { texto: 'Vigente', classe: 'ok' },
  vence_em_30_dias: { texto: 'Vence em breve', classe: 'warn' },
  vencido: { texto: 'Vencido', classe: 'bad' },
};

async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}` };
}

export function BadgeCertificado({ resumo }) {
  if (!resumo) return <span className="tag">Sem certificado</span>;
  const r = ROTULO[resumo.status] || ROTULO.vigente;
  return <span className={`tag ${r.classe}`}>{r.texto}</span>;
}

// Arquivo e senha vivem aqui, fora do useCadastro: não podem ir no update de
// empregadores nem ficar no estado depois do envio.
export default function CertificadoA1({ empregadorId, resumoInicial, aoMudar }) {
  const [resumo, setResumo] = useState(resumoInicial || null);
  const [arquivo, setArquivo] = useState(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // Troca de empresa em edição reaproveita esta instância (mesma posição na
  // árvore) — sem isto, arquivo/senha/mensagem digitados para uma empresa
  // vazariam para a próxima. Ver também `key={emEdicao.id}` em app/empresas/page.js,
  // que já força remontagem; este reset cobre o caso de a key não bastar.
  useEffect(() => {
    setResumo(resumoInicial || null);
    setArquivo(null);
    setSenha('');
    setMensagem('');
  }, [resumoInicial?.id, empregadorId]);

  async function enviar(e) {
    e.preventDefault();
    if (!arquivo || !senha || enviando) return;
    setEnviando(true); setMensagem('');
    try {
      const corpo = new FormData();
      corpo.append('arquivo', arquivo);
      corpo.append('senha', senha);
      const r = await fetch(`/api/empresas/${empregadorId}/certificado`, { method: 'POST', headers: await cabecalhoAuth(), body: corpo });
      const json = await r.json();
      if (!r.ok) { setMensagem(json.error || 'Falha ao enviar.'); return; }
      setResumo(json.certificado);
      setMensagem(json.aviso || 'Certificado salvo.');
      setArquivo(null); setSenha('');
      e.target.reset();
      aoMudar?.(json.certificado);
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    if (!confirm('Remover o certificado ativo? Ele deixa de ser usado, mas fica no histórico.')) return;
    const r = await fetch(`/api/empresas/${empregadorId}/certificado`, { method: 'DELETE', headers: await cabecalhoAuth() });
    const json = await r.json();
    if (!r.ok) { setMensagem(json.error || 'Falha ao remover.'); return; }
    setResumo(null); setMensagem('Certificado removido.');
    aoMudar?.(null);
  }

  return (
    <fieldset className="panel" style={{ marginTop: 12 }}>
      <legend><strong>Certificado digital A1</strong></legend>
      <p style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <BadgeCertificado resumo={resumo} />
        {resumo && (
          <span className="muted">
            {resumo.titular} · emitido por {resumo.emissor || '—'} · válido até {new Date(resumo.validoAte).toLocaleDateString('pt-BR')}
            {resumo.status !== 'vencido' && ` (${resumo.diasParaVencer} dias)`}
          </span>
        )}
      </p>
      <form onSubmit={enviar} className="form-grid">
        <div><label>Arquivo .pfx / .p12</label><input type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)} /></div>
        <div><label>Senha do certificado</label><input type="password" autoComplete="off" value={senha} onChange={e => setSenha(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button className="btn" type="submit" disabled={!arquivo || !senha || enviando}>
            {enviando ? 'Enviando…' : (resumo ? 'Substituir certificado' : 'Enviar certificado')}
          </button>
          {resumo && <button className="btn danger" type="button" onClick={remover}>Remover</button>}
        </div>
      </form>
      {mensagem && <p className="muted" style={{ marginTop: 8 }}>{mensagem}</p>}
    </fieldset>
  );
}
