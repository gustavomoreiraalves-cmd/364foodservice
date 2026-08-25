'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import CertificadoA1, { BadgeCertificado } from '../../components/CertificadoA1';
import LogoEmpresa from '../../components/LogoEmpresa';
import { useEmpresaAtual, limparCachePessoaJuridica } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';
import { formatarCnpj, somenteDigitos, cnpjValido } from '../../lib/cnpj';

const FORM_VAZIO = {
  razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '', inscricao_municipal: '',
  regime_tributario: '', cnae_principal: '',
  endereco: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '', codigo_municipio_ibge: '',
  fuso: 'America/Sao_Paulo',
  telefone: '', email: '', email_fiscal: '',
  responsavel_legal: '', responsavel_legal_cpf: '', responsavel_legal_email: '', responsavel_legal_telefone: '',
  contador_nome: '', contador_crc: '', contador_email: '', contador_telefone: '',
  observacoes: '',
};
const REGIMES = [['', '—'], ['simples', 'Simples Nacional'], ['presumido', 'Lucro Presumido'], ['real', 'Lucro Real'], ['mei', 'MEI']];

export default function EmpresasPage() {
  return (
    <AppShell modulo="admin" titulo="Empresas" desc="Pessoas jurídicas do grupo, certificados e responsáveis">
      <Conteudo />
    </AppShell>
  );
}

async function cabecalhoAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ''}` };
}

function Conteudo() {
  const { empresaAtual, empresas } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [marcas, setMarcas] = useState([]);
  const [certificados, setCertificados] = useState({});
  const [loading, setLoading] = useState(true);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [erroCarga, setErroCarga] = useState('');

  async function carregar() {
    setLoading(true);
    const [{ data: emps, error: erroEmps }, { data: mcs, error: erroMcs }] = await Promise.all([
      supabase.from('empregadores').select('*').order('razao_social'),
      supabase.from('empresas').select('id, nome, empregador_id, logo_path').order('nome'),
    ]);
    const erro = erroEmps || erroMcs;
    setErroCarga(erro ? 'Não foi possível carregar as empresas: ' + erro.message : '');
    setLista(emps || []);
    setMarcas(mcs || []);
    try {
      const r = await fetch('/api/empresas/certificados', { headers: await cabecalhoAuth() });
      const json = await r.json();
      if (r.ok) setCertificados(json.porEmpregador || {});
    } catch { /* lista continua sem o badge; o bloco do certificado mostra o erro real */ }
    limparCachePessoaJuridica();
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  // empregadores não tem empresa_id: o insert precisa do grupo, que vem da
  // empresa selecionada. `empresa_id: undefined` some no JSON e o PostgREST não vê.
  // Na edição não reenviamos grupo_id: a empresa já tem o seu, e o valor aqui
  // é só o da empresa atualmente selecionada no topo, que pode ser outra.
  function paraGravar(f) {
    const vazioVira = v => (typeof v === 'string' && v.trim() === '' ? null : v);
    const saida = { ...f };
    if (!editando) saida.grupo_id = empresaAtual?.grupo_id || empresas?.[0]?.grupo_id;
    for (const k of Object.keys(saida)) saida[k] = vazioVira(saida[k]);
    saida.cnpj = somenteDigitos(f.cnpj);
    saida.cep = somenteDigitos(f.cep) || null;
    saida.cnae_principal = somenteDigitos(f.cnae_principal) || null;
    saida.codigo_municipio_ibge = somenteDigitos(f.codigo_municipio_ibge) || null;
    saida.responsavel_legal_cpf = somenteDigitos(f.responsavel_legal_cpf) || null;
    saida.uf = (f.uf || '').toUpperCase() || null;
    saida.fuso = f.fuso || 'America/Sao_Paulo';
    return saida;
  }

  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo } =
    useCadastro({ tabela: 'empregadores', formVazio: FORM_VAZIO, empresaId: undefined, aoTerminar: carregar, paraGravar });

  function aoSubmeter(e) {
    if (!cnpjValido(form.cnpj)) { e.preventDefault(); alert('CNPJ inválido: confira os dígitos.'); return; }
    if (lista.some(x => x.id !== editando && x.cnpj === somenteDigitos(form.cnpj))) {
      e.preventDefault();
      alert('Já existe uma empresa com este CNPJ.');
      return;
    }
    // grupo_id só é enviado na criação (ver paraGravar); se o contexto ainda
    // está carregando ou não há nenhuma empresa, o insert cairia numa violação
    // de NOT NULL em inglês — barra aqui com mensagem em português. Na edição
    // o grupo já está gravado na empresa, então não é preciso checar.
    if (!editando && !(empresaAtual?.grupo_id || empresas?.[0]?.grupo_id)) {
      e.preventDefault();
      alert('Selecione uma empresa antes de cadastrar (grupo não identificado).');
      return;
    }
    return salvar(e);
  }

  async function vincularMarca(marcaId, empregadorId, alvoSelect) {
    const { error } = await supabase.from('empresas').update({ empregador_id: empregadorId || null }).eq('id', marcaId);
    // O select de vínculo é não-controlado (defaultValue): sem zerar aqui, uma
    // tentativa que falhou deixa o valor "preso" na opção escolhida e uma nova
    // seleção da mesma marca não dispara onChange (o DOM já está nesse valor).
    if (alvoSelect) alvoSelect.value = '';
    if (error) { alert('Não foi possível vincular: ' + error.message); return; }
    await carregar();
  }

  const emEdicao = editando ? lista.find(x => x.id === editando) : null;
  const visiveis = mostrarInativos ? lista : lista.filter(x => x.ativo !== false);
  const campo = (k, label, props = {}) => (
    <div><label>{label}</label><input value={form[k] ?? ''} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, [k]: v })); }} {...props} /></div>
  );

  return (
    <>
      <div className="panel">
        <h3>{emEdicao ? `Editando: ${emEdicao.razao_social}` : 'Nova empresa (pessoa jurídica)'}</h3>
        <form onSubmit={aoSubmeter}>
          <fieldset className="form-grid">
            <legend><strong>Dados fiscais</strong></legend>
            {campo('razao_social', 'Razão social', { required: true })}
            {campo('nome_fantasia', 'Nome fantasia')}
            <div><label>CNPJ</label><input required value={formatarCnpj(form.cnpj)} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, cnpj: v })); }} placeholder="00.000.000/0000-00" /></div>
            {campo('inscricao_estadual', 'Inscrição estadual')}
            {campo('inscricao_municipal', 'Inscrição municipal')}
            <div><label>Regime tributário</label>
              <select value={form.regime_tributario || ''} onChange={e => setForm({ ...form, regime_tributario: e.target.value })}>
                {REGIMES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            {campo('cnae_principal', 'CNAE principal', { placeholder: '5611201' })}
            {campo('endereco', 'Logradouro')}
            {campo('numero', 'Número')}
            {campo('complemento', 'Complemento')}
            {campo('bairro', 'Bairro')}
            {campo('cidade', 'Cidade')}
            {campo('uf', 'UF', { maxLength: 2 })}
            {campo('cep', 'CEP')}
            {campo('codigo_municipio_ibge', 'Código IBGE do município', { placeholder: '3550308' })}
            {campo('fuso', 'Fuso horário')}
          </fieldset>

          <fieldset className="form-grid" style={{ marginTop: 12 }}>
            <legend><strong>Contato e responsáveis</strong></legend>
            {campo('telefone', 'Telefone')}
            {campo('email', 'E-mail', { type: 'email' })}
            {campo('email_fiscal', 'E-mail fiscal (NF-e, intimações)', { type: 'email' })}
            {campo('responsavel_legal', 'Responsável legal')}
            {campo('responsavel_legal_cpf', 'CPF do responsável')}
            {campo('responsavel_legal_email', 'E-mail do responsável', { type: 'email' })}
            {campo('responsavel_legal_telefone', 'Telefone do responsável')}
            {campo('contador_nome', 'Contador(a)')}
            {campo('contador_crc', 'CRC')}
            {campo('contador_email', 'E-mail do contador', { type: 'email' })}
            {campo('contador_telefone', 'Telefone do contador')}
            <div style={{ gridColumn: '1 / -1' }}><label>Observações</label>
              <textarea rows={3} value={form.observacoes ?? ''} onChange={e => { const v = e.target.value; setForm(f => ({ ...f, observacoes: v })); }} />
            </div>
          </fieldset>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar empresa')}
            </button>
            {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
          </div>
        </form>

        {emEdicao && (
          <>
            <CertificadoA1
              key={emEdicao.id}
              empregadorId={emEdicao.id}
              resumoInicial={certificados[emEdicao.id]}
              aoMudar={r => setCertificados(c => ({ ...c, [emEdicao.id]: r || undefined }))}
            />
            <fieldset className="panel" style={{ marginTop: 12 }}>
              <legend><strong>Operações vinculadas</strong></legend>
              <ul>
                {marcas.filter(m => m.empregador_id === emEdicao.id).map(m => (
                  <li key={m.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {m.nome}
                      <button className="btn secondary small" type="button" onClick={() => vincularMarca(m.id, null)}>Desvincular</button>
                    </div>
                    <LogoEmpresa marca={m} aoMudar={carregar} />
                  </li>
                ))}
              </ul>
              {marcas.some(m => !m.empregador_id) && (
                <div className="form-grid">
                  <div><label>Vincular marca sem pessoa jurídica</label>
                    <select defaultValue="" onChange={e => { if (e.target.value) vincularMarca(e.target.value, emEdicao.id, e.target); }}>
                      <option value="">Selecione…</option>
                      {marcas.filter(m => !m.empregador_id).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </fieldset>
          </>
        )}
        {!emEdicao && <p className="muted" style={{ marginTop: 8 }}>Salve a empresa e clique em Editar para enviar o certificado A1 e vincular as operações.</p>}
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Empresas cadastradas ({visiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} /> Mostrar inativas
          </label>
        </div>
        {erroCarga && <p className="muted">{erroCarga}</p>}
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Razão social</th><th>CNPJ</th><th>Regime</th><th>Certificado A1</th><th>Operações</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {visiveis.length ? visiveis.map(p => {
                  const inativo = p.ativo === false;
                  const n = marcas.filter(m => m.empregador_id === p.id).length;
                  return (
                    <tr key={p.id} style={inativo ? { opacity: 0.55 } : undefined}>
                      <td>{p.razao_social}{p.nome_fantasia ? <span className="muted"> ({p.nome_fantasia})</span> : null}</td>
                      <td className="muted">{formatarCnpj(p.cnpj)}</td>
                      <td className="muted">{REGIMES.find(r => r[0] === (p.regime_tributario || ''))?.[1] || '—'}</td>
                      <td><BadgeCertificado resumo={certificados[p.id]} /></td>
                      <td className="muted">{n}</td>
                      <td>{inativo ? <span className="tag bad">Inativa</span> : <span className="tag ok">Ativa</span>}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => iniciarEdicao(p)}>Editar</button>
                        <button className="btn secondary" onClick={() => {
                          if (!inativo && n > 0 && !confirm(`${n} operação(ões) apontam para esta empresa. Inativar mesmo assim?`)) return;
                          alternarAtivo(p);
                        }}>{inativo ? 'Reativar' : 'Inativar'}</button>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={7}>Nenhuma empresa {mostrarInativos ? 'cadastrada' : 'ativa'}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {marcas.some(m => !m.empregador_id) && (
          <p className="muted" style={{ marginTop: 8 }}>
            Operações sem pessoa jurídica: {marcas.filter(m => !m.empregador_id).map(m => m.nome).join(', ')}. Edite a empresa certa e vincule.
          </p>
        )}
      </div>
    </>
  );
}
