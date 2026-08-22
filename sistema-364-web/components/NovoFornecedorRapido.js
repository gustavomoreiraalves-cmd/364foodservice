'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  CATEGORIAS_FORNECEDOR, soDigitos, formularioDaNota, fornecedorParaGravar, mensagemAoCadastrar,
} from '../lib/fornecedores';

// Abre no recebimento quando o XML traz um emitente que ainda não está cadastrado.
// O operador confere os dados que vieram da nota e cadastra sem sair da tela —
// antes disso era preciso abandonar o lançamento, ir em Fornecedores e recomeçar.
//
// `sugestao` é o `fornecedorSugerido` de /api/nfe/documentos/[chave]/preparar.
export default function NovoFornecedorRapido({ sugestao, empresaId, aoCadastrar, aoCancelar }) {
  const [form, setForm] = useState(() => formularioDaNota(sugestao));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // O documento é a chave que casa a nota com o fornecedor. Quando a nota traz um,
  // ele fica só-leitura: alterá-lo aqui cadastraria um fornecedor que não casa com
  // a própria nota que está sendo importada. Emitente sem documento (produtor rural
  // sem CPF no XML) deixa o campo aberto, e pode ficar em branco.
  const documentoDaNota = soDigitos(sugestao?.documento);

  async function cadastrar(e) {
    e.preventDefault();
    if (salvando) return;
    if (!form.nome.trim()) { setErro('O nome do fornecedor é obrigatório.'); return; }
    setErro('');
    setSalvando(true);
    try {
      const { data, error } = await supabase.from('fornecedores')
        .insert([{ ...fornecedorParaGravar(form), empresa_id: empresaId }])
        .select('*').single();
      if (error) { setErro(mensagemAoCadastrar(error)); return; }
      aoCadastrar(data);
    } catch (e2) {
      setErro('Não foi possível cadastrar o fornecedor: ' + e2.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={aoCancelar}>
      <div className="modal-box" style={{ width: 'min(94vw,560px)' }} onClick={e => e.stopPropagation()}>
        <p><b>Fornecedor não cadastrado</b></p>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          {documentoDaNota
            ? <>A nota é de <b>{sugestao?.nome || 'emitente sem nome'}</b> (CNPJ/CPF {documentoDaNota}), que
              ainda não está no cadastro. Confira os dados e cadastre para seguir com o recebimento.</>
            : <>Esta nota não traz o CNPJ nem o CPF do emitente. Preencha o documento se souber — sem ele,
              as próximas notas deste fornecedor não vão ser reconhecidas sozinhas.</>}
        </p>

        <form onSubmit={cadastrar} className="form-grid">
          <div><label>Nome / Razão social</label>
            <input required autoFocus value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div><label>CNPJ / CPF</label>
            <input inputMode="numeric" maxLength={14} placeholder="Só números"
              readOnly={Boolean(documentoDaNota)}
              title={documentoDaNota ? 'Veio do XML da nota e não pode ser alterado aqui.' : undefined}
              style={documentoDaNota ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
              value={form.cnpj} onChange={e => setForm({ ...form, cnpj: soDigitos(e.target.value) })} />
          </div>
          <div><label>Categoria</label>
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS_FORNECEDOR.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Contato</label>
            <input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} />
          </div>
          <div><label>Telefone</label>
            <input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} />
          </div>
          <div><label>E-mail</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </form>

        {erro && <p style={{ color: 'var(--bad, #c0392b)', marginTop: 10 }}>{erro}</p>}

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn" type="button" disabled={salvando} onClick={cadastrar}>
            {salvando ? 'Cadastrando…' : 'Cadastrar e continuar'}
          </button>
          <button className="btn secondary" type="button" disabled={salvando} onClick={aoCancelar}>
            Escolher da lista
          </button>
        </div>
      </div>
    </div>
  );
}
