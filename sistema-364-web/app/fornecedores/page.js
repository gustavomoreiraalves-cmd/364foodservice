'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import ListaCadastro from '../../components/ListaCadastro';
import FichaModal from '../../components/FichaModal';
import { useEmpresaAtual } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';
import { filtrarRegistros } from '../../lib/listaCadastro';
import { CATEGORIAS_FORNECEDOR, soDigitos, fornecedorParaGravar } from '../../lib/fornecedores';

// As mesmas regras valem no cadastro rápido que abre no recebimento quando o XML
// traz um emitente desconhecido; por isso elas moram em lib/fornecedores.js.
const FORM_VAZIO = { nome: '', cnpj: '', categoria: 'Carnes', contato: '', telefone: '', email: '' };
const CAMPOS_BUSCA = ['nome', 'cnpj', 'categoria', 'contato', 'email'];

export default function FornecedoresPage() {
  return (
    <AppShell modulo="fornecedores" titulo="Fornecedores" desc="Cadastro de fornecedores e categorias">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [criando, setCriando] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data, error } = await supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    if (!error) setLista(data);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({
      tabela: 'fornecedores',
      formVazio: FORM_VAZIO,
      empresaId: empresaAtual?.id,
      aoTerminar: async () => { await carregar(); fechar(); },
      paraGravar: fornecedorParaGravar,
    });

  const emEdicao = editando ? lista.find(f => f.id === editando) : null;
  const visiveis = useMemo(
    () => filtrarRegistros(lista, { campos: CAMPOS_BUSCA, busca, mostrarInativos }),
    [lista, busca, mostrarInativos],
  );
  const aberto = criando || !!editando;

  function abrirNovo() { cancelarEdicao(); setCriando(true); }
  function fechar() { cancelarEdicao(); setCriando(false); }
  function abrir(f) { setCriando(false); iniciarEdicao(f); }

  const COLUNAS = [
    { titulo: 'Nome', principal: true, minimo: 200, render: f => f.nome, textoPuro: f => f.nome },
    {
      titulo: 'Categoria', largura: 128,
      render: f => (f.categoria ? <span className="tag categoria">{f.categoria}</span> : null),
      textoPuro: f => f.categoria || '',
    },
    { titulo: 'CNPJ', largura: 132, mono: true, render: f => f.cnpj || null, textoPuro: f => f.cnpj || '' },
    { titulo: 'Contato', largura: 150, render: f => f.contato || null, textoPuro: f => f.contato || '' },
    { titulo: 'Telefone', largura: 118, mono: true, render: f => f.telefone || null, textoPuro: f => f.telefone || '' },
    { titulo: 'E-mail', largura: 190, render: f => f.email || null, textoPuro: f => f.email || '' },
  ];

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-fornecedor">Buscar</label>
            <input id="busca-fornecedor" value={busca} placeholder="nome, CNPJ, categoria ou contato"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}>
            <Icone nome="mais" tamanho={14} /> Novo fornecedor
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visiveis.length} de {lista.length} fornecedor{lista.length === 1 ? '' : 'es'}
          </span>
          <label className="check-line" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>

        <ListaCadastro
          colunas={COLUNAS} registros={visiveis} selecionado={editando} onAbrir={abrir}
          rotulo="Fornecedores"
          vazio={busca ? 'Nenhum fornecedor encontrado para essa busca.' : 'Nenhum fornecedor cadastrado ainda.'} />
      </section>

      {aberto && (
        <FichaModal
          titulo={emEdicao ? emEdicao.nome : 'Novo fornecedor'}
          subtitulo={emEdicao?.cnpj || null}
          onFechar={fechar}>
          <form onSubmit={salvar}>
            <div className="modal-body">
              <div className="form-grid">
                <div className="secao">Identificação</div>
                <div className="largo">
                  <label htmlFor="f-nome">Nome / Razão social</label>
                  <input id="f-nome" required autoFocus value={form.nome}
                         onChange={e => setForm({ ...form, nome: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="f-cnpj">CNPJ</label>
                  <input id="f-cnpj" inputMode="numeric" maxLength={14} placeholder="Só números"
                         value={form.cnpj} onChange={e => setForm({ ...form, cnpj: soDigitos(e.target.value) })} />
                </div>
                <div>
                  <label htmlFor="f-cat">Categoria</label>
                  <select id="f-cat" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
                    {CATEGORIAS_FORNECEDOR.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>

                <div className="secao">Contato</div>
                <div>
                  <label htmlFor="f-contato">Pessoa de contato</label>
                  <input id="f-contato" value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="f-fone">Telefone</label>
                  <input id="f-fone" value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="f-email">E-mail</label>
                  <input id="f-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <button className="btn" type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Criar fornecedor')}
              </button>
              <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
              {emEdicao && (
                <>
                  <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }}
                          onClick={() => alternarAtivo(emEdicao)}>
                    {emEdicao.ativo === false ? 'Reativar' : 'Desativar'}
                  </button>
                  <button className="btn danger" type="button"
                          onClick={() => excluir(emEdicao, `Excluir o fornecedor ${emEdicao.nome}?`)}>
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
