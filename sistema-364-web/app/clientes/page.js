'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import ListaCadastro from '../../components/ListaCadastro';
import FichaModal from '../../components/FichaModal';
import FichaParceiro from '../../components/FichaParceiro';
import { useEmpresaAtual } from '../../lib/empresa';
import { camposDoFormulario } from '../../lib/cadastro';
import { filtrarRegistros } from '../../lib/listaCadastro';
import { pendenciasFiscaisCliente, soDigitos } from '../../lib/fiscal';
import { montarListaParceiros, salvarParceiro, excluirParceiro, alternarAtivoParceiro } from '../../lib/parceiro';
import { formatarCnpj } from '../../lib/cnpj';
import { formatarCpf } from '../../lib/ponto';
import { formatarTelefone } from '../../lib/formatacao';

// Sem fonte nacional gratuita para inscrição estadual (SINTEGRA é por estado
// e a consulta pública do RO exige captcha, não dá pra automatizar) — o botão
// abaixo só leva o usuário até o portal para conferir manualmente.
const URL_SEFIN_RO = 'https://portalcontribuinte.sefin.ro.gov.br/Publico/parametropublica.jsp';

const FORM_VAZIO = {
  nome: '', nome_fantasia: '', cnpj: '', contato: '', telefone: '',
  tipo: 'Revenda',
  // Bloco <dest> da NF-e (atualização 36). Sem ele não se emite nota para
  // este cliente, por mais completo que esteja o cadastro comercial.
  tipo_pessoa: 'J', cpf: '', ie: '', ind_ie_dest: null, consumidor_final: null,
  logradouro: '', numero: '', complemento: '', bairro: '',
  codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', email_nfe: '',
  categoria: 'Carnes', email: '',
};
const CAMPOS_BUSCA = ['nome', 'nome_fantasia', 'cnpj', 'cpf', 'tipo', 'municipio', 'categoria', 'email', 'contato'];

export default function ClientesPage() {
  return (
    <AppShell modulo="clientes" titulo="Clientes/Fornecedores" desc="Cadastro de clientes, fornecedores e revendas, com dados para nota fiscal">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [listaParceiros, setListaParceiros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [fiscalDisponivel, setFiscalDisponivel] = useState(true);

  const [selecionado, setSelecionado] = useState(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [papeis, setPapeis] = useState(['cliente']);
  const [salvando, setSalvando] = useState(false);

  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [erroConsultaCnpj, setErroConsultaCnpj] = useState('');
  const [situacaoCnpj, setSituacaoCnpj] = useState('');
  const [cnpjCopiado, setCnpjCopiado] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [{ data: clientesData }, { data: fornecedoresData }] = await Promise.all([
      supabase.from('clientes').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
    ]);
    setListaParceiros(montarListaParceiros(clientesData || [], fornecedoresData || []));
    // Sem a atualização 36 as colunas do bloco dest não existem, e gravá-las
    // faria o PostgREST recusar o registro inteiro.
    setFiscalDisponivel(!clientesData?.length || 'uf' in (clientesData[0] || {}));
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const visiveis = useMemo(
    () => filtrarRegistros(listaParceiros, { campos: CAMPOS_BUSCA, busca, mostrarInativos }),
    [listaParceiros, busca, mostrarInativos],
  );
  const pendencias = fiscalDisponivel && papeis.includes('cliente') ? pendenciasFiscaisCliente(form) : [];
  const aberto = criando || !!selecionado;

  function limparConsultaCnpj() { setErroConsultaCnpj(''); setSituacaoCnpj(''); setCnpjCopiado(false); }

  function abrirNovo() {
    setSelecionado(null); setCriando(true); setForm(FORM_VAZIO); setPapeis(['cliente']); limparConsultaCnpj();
  }
  function fechar() {
    setSelecionado(null); setCriando(false); setForm(FORM_VAZIO); setPapeis(['cliente']); limparConsultaCnpj();
  }
  function abrir(p) {
    setCriando(false); setSelecionado(p);
    setForm(camposDoFormulario({ ...(p.fornecedor || {}), ...(p.cliente || {}) }, FORM_VAZIO));
    setPapeis(p.papeis);
    limparConsultaCnpj();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const { error } = await salvarParceiro(supabase, {
        form, papeis,
        clienteExistente: selecionado?.cliente || null,
        fornecedorExistente: selecionado?.fornecedor || null,
        empresaId: empresaAtual?.id,
        fiscalDisponivel,
      });
      if (error) { alert(error); return; }
      await carregar();
      fechar();
    } finally {
      setSalvando(false);
    }
  }

  async function excluirSelecionado() {
    if (!selecionado) return;
    if (!confirm(`Excluir ${selecionado.nome}?`)) return;
    const { error } = await excluirParceiro(supabase, selecionado);
    if (error) { alert(error); return; }
    await carregar();
    fechar();
  }

  async function alternarAtivoSelecionado() {
    if (!selecionado) return;
    const { error } = await alternarAtivoParceiro(supabase, selecionado);
    if (error) { alert(error); return; }
    await carregar();
  }

  // O formulário da SEFIN-RO é POST com token CSRF por sessão e captcha —
  // não existe link que abra a página já preenchida. O que dá pra fazer é
  // copiar o CNPJ pra área de transferência antes de abrir, pra só colar lá.
  async function abrirConsultaIe() {
    // window.open primeiro: depois de um await, alguns navegadores (Safari)
    // não reconhecem mais o clique como gesto do usuário e bloqueiam o popup.
    window.open(URL_SEFIN_RO, '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(formatarCnpj(form.cnpj));
      setCnpjCopiado(true);
    } catch {
      setCnpjCopiado(false);
    }
  }

  async function consultarCnpj() {
    setConsultandoCnpj(true);
    limparConsultaCnpj();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/cnpj/${soDigitos(form.cnpj)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const dados = await r.json();
      if (!r.ok) { setErroConsultaCnpj(dados.error || 'Não foi possível consultar o CNPJ.'); return; }
      const { situacaoCadastral, ...camposForm } = dados;
      setForm(f => ({ ...f, ...camposForm }));
      setSituacaoCnpj(situacaoCadastral);
    } catch {
      setErroConsultaCnpj('Não foi possível consultar o CNPJ.');
    } finally {
      setConsultandoCnpj(false);
    }
  }

  const COLUNAS = [
    { titulo: 'Nome', principal: true, minimo: 200, render: p => p.nome, textoPuro: p => p.nome },
    {
      titulo: 'Papel', largura: 150,
      render: p => (
        <span style={{ display: 'flex', gap: 4 }}>
          {p.papeis.includes('cliente') && <span className="tag categoria">Cliente</span>}
          {p.papeis.includes('fornecedor') && <span className="tag categoria">Fornecedor</span>}
        </span>
      ),
      textoPuro: p => p.papeis.map(x => (x === 'cliente' ? 'Cliente' : 'Fornecedor')).join(' e '),
    },
    {
      titulo: 'CNPJ / CPF', largura: 132, mono: true,
      render: p => docFormatado(p) || null, textoPuro: p => docFormatado(p),
    },
    { titulo: 'Município', largura: 130, render: p => (p.municipio ? `${p.municipio}/${p.uf || ''}` : null), textoPuro: p => p.municipio || '' },
    { titulo: 'Contato', largura: 140, render: p => p.contato || null, textoPuro: p => p.contato || '' },
    {
      titulo: 'Telefone', largura: 118, mono: true,
      render: p => (p.telefone ? formatarTelefone(p.telefone) : null),
      textoPuro: p => (p.telefone ? formatarTelefone(p.telefone) : ''),
    },
    {
      titulo: 'Nota', largura: 66, alinhamento: 'center',
      render: p => (!fiscalDisponivel || !p.papeis.includes('cliente') ? null
        : pendenciasFiscaisCliente(p.cliente).length
          ? <span className="tag warn">falta</span>
          : <span className="tag ok">ok</span>),
      textoPuro: p => (!p.papeis.includes('cliente') ? '' : pendenciasFiscaisCliente(p.cliente).length ? 'faltam dados para emitir' : 'pronto para emitir'),
    },
  ];

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-parceiro">Buscar</label>
            <input id="busca-parceiro" value={busca} placeholder="nome, CNPJ, CPF, categoria ou município"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}>
            <Icone nome="mais" tamanho={14} /> Novo parceiro
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visiveis.length} de {listaParceiros.length} parceiro{listaParceiros.length === 1 ? '' : 's'}
          </span>
          <label className="check-line" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>

        <ListaCadastro
          colunas={COLUNAS} registros={visiveis} selecionado={selecionado?.id} onAbrir={abrir}
          rotulo="Clientes/Fornecedores"
          vazio={busca ? 'Nenhum parceiro encontrado para essa busca.' : 'Nenhum cliente ou fornecedor cadastrado ainda.'} />
      </section>

      {aberto && (
        <FichaModal
          titulo={selecionado ? selecionado.nome : 'Novo parceiro'}
          subtitulo={selecionado ? (docFormatado(selecionado) || null) : null}
          onFechar={fechar}>
          <form onSubmit={salvar}>
            <FichaParceiro
              form={form} setForm={setForm} papeis={papeis} setPapeis={setPapeis}
              fiscalDisponivel={fiscalDisponivel} pendencias={pendencias}
              consultandoCnpj={consultandoCnpj} erroConsultaCnpj={erroConsultaCnpj}
              situacaoCnpj={situacaoCnpj} onConsultarCnpj={consultarCnpj}
              cnpjCopiado={cnpjCopiado} onConsultarIe={abrirConsultaIe}
            />
            <div className="modal-foot">
              <button className="btn" type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : (selecionado ? 'Salvar alterações' : 'Criar parceiro')}
              </button>
              <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
              {selecionado && (
                <>
                  <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }}
                          onClick={alternarAtivoSelecionado}>
                    {selecionado.ativo === false ? 'Reativar' : 'Desativar'}
                  </button>
                  <button className="btn danger" type="button" onClick={excluirSelecionado}>
                    <Icone nome="lixeira" tamanho={13} /> Excluir
                  </button>
                </>
              )}
            </div>
          </form>
        </FichaModal>
      )}
    </>
  );
}

function docFormatado(p) {
  if (p.cliente?.tipo_pessoa === 'F' && p.cliente?.cpf) return formatarCpf(p.cliente.cpf);
  if (p.cnpj) return formatarCnpj(p.cnpj);
  return '';
}
