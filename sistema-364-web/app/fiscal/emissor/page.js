'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';

const MODELOS = [['55', 'NF-e'], ['65', 'NFC-e']];

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
    const porModelo = {};
    for (const [m] of MODELOS) {
      const existente = json.configuracoes.find(c => c.modelo === m);
      porModelo[m] = existente
        ? { ativo: existente.ativo, ambiente: existente.ambiente, serie: existente.serie, cscId: '', cscToken: '', cscConfigurado: existente.cscConfigurado, ultimoNumero: existente.ultimoNumero }
        : { ativo: false, ambiente: 'homologacao', serie: 1, cscId: '', cscToken: '', cscConfigurado: false, ultimoNumero: null };
    }
    setForm({ modelos: porModelo, informacoesComplementaresPadrao: json.empresa.informacoesComplementaresPadrao });
  }

  useEffect(() => { if (selecionada) carregar(selecionada); }, [selecionada]);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setMensagem('');
    try {
      const corpo = {
        configuracoes: MODELOS.map(([m]) => ({
          modelo: m,
          ativo: form.modelos[m].ativo,
          ambiente: form.modelos[m].ambiente,
          serie: Number(form.modelos[m].serie),
          cscId: form.modelos[m].cscId || undefined,
          cscToken: form.modelos[m].cscToken || undefined,
        })),
        informacoesComplementaresPadrao: form.informacoesComplementaresPadrao,
      };
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

  async function ajustarNumero(modelo) {
    const atual = form.modelos[modelo].ultimoNumero;
    const novo = prompt(`Novo último número (atual: ${atual ?? 'não configurado'}):`);
    if (novo === null) return;
    const motivo = prompt('Motivo do ajuste:');
    if (!motivo) { alert('Motivo é obrigatório.'); return; }
    const r = await fetch(`/api/empresas/${selecionada}/emissao-fiscal/ajustar-numeracao`, {
      method: 'POST', headers: await cabecalhoAuth(),
      body: JSON.stringify({ modelo, ambiente: form.modelos[modelo].ambiente, novoNumero: Number(novo), motivo }),
    });
    const json = await r.json();
    if (!r.ok) { alert(json.error || 'Falha ao ajustar.'); return; }
    await carregar(selecionada);
  }

  function campoModelo(modelo, chave, valor) {
    setForm(f => ({ ...f, modelos: { ...f.modelos, [modelo]: { ...f.modelos[modelo], [chave]: valor } } }));
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

      {form.modelos && (
        <form onSubmit={salvar}>
          {MODELOS.map(([m, label]) => (
            <fieldset className="form-grid" key={m} style={{ marginTop: 12 }}>
              <legend><strong>{label}</strong></legend>
              <div>
                <label>Ativo</label>
                <input type="checkbox" checked={form.modelos[m].ativo} onChange={e => campoModelo(m, 'ativo', e.target.checked)} />
              </div>
              <div>
                <label>Ambiente</label>
                <select value={form.modelos[m].ambiente} onChange={e => campoModelo(m, 'ambiente', e.target.value)}>
                  <option value="homologacao">Homologação</option>
                  <option value="producao">Produção</option>
                </select>
              </div>
              <div>
                <label>Série</label>
                <input type="number" min="1" value={form.modelos[m].serie} onChange={e => campoModelo(m, 'serie', e.target.value)} />
              </div>
              <div>
                <label>Último número utilizado</label>
                <input readOnly value={form.modelos[m].ultimoNumero ?? 'não configurado'} />
                <button className="btn secondary small" type="button" onClick={() => ajustarNumero(m)}>Ajustar numeração</button>
              </div>
              {m === '65' && (
                <>
                  <div>
                    <label>Identificador do CSC (ID Token)</label>
                    <input value={form.modelos[m].cscId} onChange={e => campoModelo(m, 'cscId', e.target.value)} placeholder={form.modelos[m].cscConfigurado ? 'já configurado — deixe em branco para manter' : ''} />
                  </div>
                  <div>
                    <label>CSC / Código de Segurança</label>
                    <input type="password" autoComplete="off" value={form.modelos[m].cscToken} onChange={e => campoModelo(m, 'cscToken', e.target.value)} placeholder={form.modelos[m].cscConfigurado ? 'já configurado — deixe em branco para manter' : ''} />
                  </div>
                </>
              )}
            </fieldset>
          ))}

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
