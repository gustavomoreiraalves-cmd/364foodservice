'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';

// Uma seção por (modelo, ambiente) — não por modelo. O schema guarda
// homologação e produção como linhas independentes (unique index em
// empresa_id+modelo+ambiente), justamente para trocar de ambiente nunca
// sobrescrever a config do outro. Ver docs/superpowers/specs/
// 2026-08-25-configuracao-emissor-fiscal-design.md.
const SECOES = [
  ['55', 'homologacao', 'NF-e — Homologação'],
  ['55', 'producao', 'NF-e — Produção'],
  ['65', 'homologacao', 'NFC-e — Homologação'],
  ['65', 'producao', 'NFC-e — Produção'],
];

function chave(modelo, ambiente) {
  return `${modelo}_${ambiente}`;
}

async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' };
}

export default function EmissorFiscalPage() {
  return (
    <AppShell modulo="fiscal" titulo="Emissão fiscal" desc="Ambiente, série, numeração e CSC por marca">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [marcas, setMarcas] = useState([]);
  const [selecionada, setSelecionada] = useState('');
  const [dados, setDados] = useState(null);
  const [form, setForm] = useState({});
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [conexao, setConexao] = useState({}); // { homologacao: {...}, producao: {...} }
  const [testando, setTestando] = useState('');

  useEffect(() => {
    supabase.from('empresas').select('id, nome, empregador_id').order('nome')
      .then(({ data }) => { setMarcas(data || []); if (data?.[0]) setSelecionada(data[0].id); });
  }, []);

  async function carregar(empresaId) {
    setMensagem('');
    const r = await fetch(`/api/empresas/${empresaId}/emissao-fiscal`, { headers: await cabecalhoAuth() });
    const json = await r.json();
    if (!r.ok) { setMensagem(json.error || 'Falha ao carregar.'); return; }
    setDados(json);
    const combos = {};
    for (const [m, amb] of SECOES) {
      const k = chave(m, amb);
      const existente = json.configuracoes.find(c => c.modelo === m && c.ambiente === amb);
      combos[k] = existente
        ? {
            ativo: existente.ativo, serie: existente.serie,
            cscId: existente.cscId || '', cscToken: '', cscConfigurado: existente.cscConfigurado,
            ultimoNumero: existente.ultimoNumero, jaExistia: true,
          }
        : { ativo: false, serie: 1, cscId: '', cscToken: '', cscConfigurado: false, ultimoNumero: null, jaExistia: false };
    }
    setForm({ combos, informacoesComplementaresPadrao: json.empresa.informacoesComplementaresPadrao });
  }

  useEffect(() => { if (selecionada) carregar(selecionada); }, [selecionada]);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setMensagem('');
    try {
      // Só entra no PUT quem já existia no servidor ou foi ativado agora — uma
      // combinação nunca tocada e inativa não é enviada. Sem isso, salvar
      // qualquer coisa reenviaria os 4 combos com série 1 de default, e a
      // marca B de um CNPJ compartilhado nunca conseguiria salvar nada (série 1
      // já em uso pela marca A). Ver Finding 8 da revisão final.
      const configuracoes = SECOES
        .filter(([m, amb]) => form.combos[chave(m, amb)].jaExistia || form.combos[chave(m, amb)].ativo)
        .map(([m, amb]) => ({
          modelo: m,
          ambiente: amb,
          ativo: form.combos[chave(m, amb)].ativo,
          serie: Number(form.combos[chave(m, amb)].serie),
          cscId: form.combos[chave(m, amb)].cscId || undefined,
          cscToken: form.combos[chave(m, amb)].cscToken || undefined,
        }));
      const corpo = { configuracoes, informacoesComplementaresPadrao: form.informacoesComplementaresPadrao };
      const r = await fetch(`/api/empresas/${selecionada}/emissao-fiscal`, {
        method: 'PUT', headers: await cabecalhoAuth(), body: JSON.stringify(corpo),
      });
      const json = await r.json();
      if (!r.ok) { setMensagem(json.error || 'Falha ao salvar.'); return; }
      setMensagem('Configuração salva.');
      await carregar(selecionada);
    } finally {
      setSalvando(false);
    }
  }

  async function ajustarNumero(modelo, ambiente) {
    const k = chave(modelo, ambiente);
    const atual = form.combos[k].ultimoNumero;
    const novo = prompt(`Novo último número (atual: ${atual ?? 'não configurado'}):`);
    if (novo === null) return;
    const motivo = prompt('Motivo do ajuste:');
    if (!motivo) { alert('Motivo é obrigatório.'); return; }
    const r = await fetch(`/api/empresas/${selecionada}/emissao-fiscal/ajustar-numeracao`, {
      method: 'POST', headers: await cabecalhoAuth(),
      body: JSON.stringify({ modelo, ambiente, novoNumero: Number(novo), motivo }),
    });
    const json = await r.json();
    if (!r.ok) { alert(json.error || 'Falha ao ajustar.'); return; }
    await carregar(selecionada);
  }

  async function testarConexao(ambiente) {
    setTestando(ambiente);
    setConexao(c => ({ ...c, [ambiente]: null }));
    try {
      const r = await fetch('/api/fiscal/testar-conexao', {
        method: 'POST',
        headers: await cabecalhoAuth(),
        body: JSON.stringify({ empresaId: selecionada, ambiente }),
      });
      const json = await r.json();
      setConexao(c => ({
        ...c,
        [ambiente]: r.ok
          ? { ok: json.ok, texto: `${json.cStat} — ${json.xMotivo}` }
          : { ok: false, texto: json.error || 'Falha ao testar.' },
      }));
    } catch (e) {
      setConexao(c => ({ ...c, [ambiente]: { ok: false, texto: e.message } }));
    } finally {
      setTestando('');
    }
  }

  function campoCombo(modelo, ambiente, campo, valor) {
    const k = chave(modelo, ambiente);
    setForm(f => ({ ...f, combos: { ...f.combos, [k]: { ...f.combos[k], [campo]: valor } } }));
  }

  if (!marcas.length) return <p className="muted">Carregando marcas…</p>;

  return (
    <div className="panel">
      <div className="form-grid">
        <div>
          <label>Marca</label>
          <select value={selecionada} onChange={e => setSelecionada(e.target.value)}>
            {marcas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
      </div>

      {marcas.find(m => m.id === selecionada && !m.empregador_id) && (
        <p className="muted">Esta marca não tem pessoa jurídica (CNPJ) vinculada — vincule em /empresas antes.</p>
      )}

      {form.combos && (
        <form onSubmit={salvar}>
          {SECOES.map(([m, amb, label]) => {
            const k = chave(m, amb);
            const c = form.combos[k];
            return (
              <fieldset className="form-grid" key={k} style={{ marginTop: 12 }}>
                <legend><strong>{label}</strong></legend>
                <div>
                  <label>Ativo</label>
                  <input type="checkbox" checked={c.ativo} onChange={e => campoCombo(m, amb, 'ativo', e.target.checked)} />
                </div>
                <div>
                  <label>Série</label>
                  <input type="number" min="1" value={c.serie} onChange={e => campoCombo(m, amb, 'serie', e.target.value)} />
                </div>
                <div>
                  <label>Último número utilizado</label>
                  <input readOnly value={c.ultimoNumero ?? 'não configurado'} />
                  <button className="btn secondary small" type="button" onClick={() => ajustarNumero(m, amb)}>Ajustar numeração</button>
                </div>
                {m === '65' && (
                  <>
                    <div>
                      <label>Identificador do CSC (ID Token)</label>
                      <input value={c.cscId} onChange={e => campoCombo(m, amb, 'cscId', e.target.value)} placeholder={c.cscConfigurado ? 'já configurado — deixe em branco para manter' : ''} />
                    </div>
                    <div>
                      <label>CSC / Código de Segurança</label>
                      <input type="password" autoComplete="off" value={c.cscToken} onChange={e => campoCombo(m, amb, 'cscToken', e.target.value)} placeholder={c.cscConfigurado ? 'já configurado — deixe em branco para manter' : ''} />
                    </div>
                  </>
                )}
              </fieldset>
            );
          })}

          <fieldset className="form-grid" style={{ marginTop: 12 }}>
            <legend><strong>Conexão com a SEFAZ</strong></legend>
            {['homologacao', 'producao'].map(amb => (
              <div key={amb} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn secondary" type="button" disabled={testando === amb} onClick={() => testarConexao(amb)}>
                  {testando === amb ? 'Testando…' : `Testar ${amb === 'producao' ? 'produção' : 'homologação'}`}
                </button>
                {conexao[amb] && (
                  <span className={`tag ${conexao[amb].ok ? 'ok' : 'bad'}`}>{conexao[amb].texto}</span>
                )}
              </div>
            ))}
            <p className="muted" style={{ gridColumn: '1 / -1' }}>
              Consulta o status do serviço da SEFAZ com o certificado desta marca. Não emite nota nem consome numeração.
            </p>
          </fieldset>

          <div style={{ marginTop: 12 }}>
            <label>Informações complementares (texto seu — não substitui avisos fiscais automáticos)</label>
            <textarea rows={3} value={form.informacoesComplementaresPadrao || ''} onChange={e => setForm(f => ({ ...f, informacoesComplementaresPadrao: e.target.value }))} />
          </div>

          <button className="btn" type="submit" disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      )}
      {mensagem && <p className="muted" style={{ marginTop: 8 }}>{mensagem}</p>}
    </div>
  );
}
