'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, sair, MODULOS } from '../lib/auth';
import { EmpresaContext } from '../lib/empresa';

const EMPRESA_LS_KEY = 'empresaAtualId';

// Estrutura padrão de todas as telas: sidebar com as abas que o usuário
// pode acessar (conforme permissões) + seletor de empresa + usuário logado.
// `modulo` é a permissão exigida pela tela (null = qualquer usuário logado).
export default function AppShell({ modulo, titulo, desc, children }) {
  const router = useRouter();
  const pathname = usePathname();
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

  const abas = MODULOS.filter(m => isAdmin || permissoes.includes(m.id));
  const nome = session.user.user_metadata?.nome || session.user.email;

  return (
    <EmpresaContext.Provider value={{ empresaAtual, empresas, setEmpresaAtual }}>
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="num">364</div>
          <div className="sub">Grupo 364 · Gestão</div>
        </div>
        <div className="empresa-switch" style={{ padding: '0 18px 14px' }}>
          <label>Empresa</label>
          <select value={empresaAtual.id} onChange={e => setEmpresaAtual(empresas.find(x => x.id === e.target.value))}>
            {empresas.map(emp => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
          </select>
        </div>
        <nav>
          <a href="/" className={pathname === '/' ? 'active' : ''}><span className="ic">◆</span>Dashboard</a>
          {abas.map(m => (
            <a key={m.id} href={m.href} className={pathname === m.href ? 'active' : ''}>
              <span className="ic">{m.ic}</span>{m.label}
            </a>
          ))}
          {isAdmin && (
            <a href="/usuarios" className={pathname === '/usuarios' ? 'active' : ''}>
              <span className="ic">⚙</span>Usuários
            </a>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="userbadge">Logado como <b>{nome}</b></div>
          <button className="btn secondary small" style={{ marginTop: 10, width: '100%' }} onClick={() => sair(router)}>Sair</button>
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
