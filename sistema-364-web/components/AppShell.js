'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, sair } from '../lib/auth';
import { EmpresaContext } from '../lib/empresa';
import { urlLogoEmpresa } from '../lib/storage';
import SidebarNav from './SidebarNav';
import VersaoBadge from './VersaoBadge';

const EMPRESA_LS_KEY = 'empresaAtualId';

// Estrutura padrão de todas as telas: sidebar com o menu por categorias que o
// usuário pode acessar (ver lib/menu.js) + seletor de empresa + usuário logado.
// `modulo` é a permissão exigida pela tela (null = qualquer usuário logado).
export default function AppShell({ modulo, titulo, desc, children }) {
  const router = useRouter();
  const { loading, session, permissoes, isAdmin, empresas } = useAuth(modulo);
  const [empresaAtual, setEmpresaAtualState] = useState(null);

  useEffect(() => {
    if (!empresas.length) return;
    const salvoId = localStorage.getItem(EMPRESA_LS_KEY);
    setEmpresaAtualState(empresas.find(e => e.id === salvoId) || empresas[0]);
  }, [empresas]);

  function setEmpresaAtual(empresa) {
    setEmpresaAtualState(empresa);
    localStorage.setItem(EMPRESA_LS_KEY, empresa.id);
  }

  if (loading || (empresas.length > 0 && !empresaAtual)) {
    return <div className="app"><main className="main"><p className="muted">Carregando…</p></main></div>;
  }
  if (!empresas.length) {
    return <div className="app"><main className="main"><p className="erro">Seu usuário não tem acesso a nenhuma empresa. Fale com um administrador.</p></main></div>;
  }

  const nome = session.user.user_metadata?.nome || session.user.email;

  // Logo da marca selecionada (atualização 42). Sem logo cadastrada, o
  // cabeçalho continua no texto de sempre.
  const logoUrl = urlLogoEmpresa(empresaAtual.logo_path);

  return (
    <EmpresaContext.Provider value={{ empresaAtual, empresas, setEmpresaAtual }}>
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          {logoUrl
            ? <img className="brand-logo" src={logoUrl} alt={empresaAtual.nome} />
            : <div className="num">364</div>}
          <div className="sub">Grupo 364 · Gestão</div>
        </div>
        <div className="empresa-switch" style={{ padding: '0 18px 14px' }}>
          <label>Empresa</label>
          <select value={empresaAtual.id} onChange={e => setEmpresaAtual(empresas.find(x => x.id === e.target.value))}>
            {empresas.map(emp => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
          </select>
        </div>
        <SidebarNav permissoes={permissoes} isAdmin={isAdmin} />
        <div className="sidebar-foot">
          <div className="userbadge">Logado como <b>{nome}</b></div>
          <button className="btn secondary small" style={{ marginTop: 10, width: '100%' }} onClick={() => sair(router)}>Sair</button>
          <VersaoBadge />
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <h1>{titulo}</h1>
            <div className="desc">{desc}</div>
          </div>
        </div>
        {children}
      </main>
    </div>
    </EmpresaContext.Provider>
  );
}
