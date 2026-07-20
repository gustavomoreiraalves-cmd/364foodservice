'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, sair, MODULOS } from '../lib/auth';

// Estrutura padrão de todas as telas: sidebar com as abas que o usuário
// pode acessar (conforme permissões) + topo com título e usuário logado.
// `modulo` é a permissão exigida pela tela (null = qualquer usuário logado).
export default function AppShell({ modulo, titulo, desc, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, session, permissoes, isAdmin } = useAuth(modulo);

  if (loading) {
    return <div className="app"><main className="main"><p className="muted">Carregando…</p></main></div>;
  }

  const abas = MODULOS.filter(m => isAdmin || permissoes.includes(m.id));
  const nome = session.user.user_metadata?.nome || session.user.email;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="num">364</div>
          <div className="sub">Foodservices · Gestão</div>
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
  );
}
