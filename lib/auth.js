'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabase';

// Abas do sistema controladas por permissão (ver ROADMAP.md).
// O módulo especial 'admin' dá acesso a todas + à aba Usuários.
export const MODULOS = [
  { id: 'fornecedores', label: 'Fornecedores', href: '/fornecedores', ic: '▤', desc: 'Cadastro de fornecedores e categorias' },
  { id: 'recebimentos', label: 'Recebimento', href: '/recebimentos', ic: '▣', desc: 'Entrada de matéria-prima e geração de lotes' },
  { id: 'estoque', label: 'Estoque', href: '/estoque', ic: '▥', desc: 'Saldo de matéria-prima e produto acabado' },
  { id: 'produtos', label: 'Produtos', href: '/produtos', ic: '▧', desc: 'Catálogo, ficha técnica, custo e preço de venda' },
  { id: 'producoes', label: 'Defumação', href: '/producoes', ic: '▨', desc: 'Ficha de defumação: manipulação, perdas, sobras e rendimento' },
  { id: 'embalagem', label: 'Embalagem', href: '/embalagem', ic: '▤', desc: 'Manipulação dos defumados e geração do produto final' },
  { id: 'clientes', label: 'Clientes', href: '/clientes', ic: '▦', desc: 'Cadastro de clientes e revendas' },
  { id: 'pedidos', label: 'Pedidos de Venda', href: '/pedidos', ic: '▩', desc: 'Pedidos, faturamento e baixa de estoque' },
  { id: 'assinaturas', label: 'Assinaturas', href: '/assinaturas', ic: '◈', desc: 'Boxes mensais Bronze, Prata e Ouro' },
  { id: 'funcionarios', label: 'Funcionários', href: '/funcionarios', ic: '☺', desc: 'Equipe e responsáveis por cada registro' },
  { id: 'despesas', label: 'Despesas', href: '/despesas', ic: '◇', desc: 'Despesas operacionais' },
  { id: 'relatorios', label: 'Relatórios', href: '/relatorios', ic: '▢', desc: 'Produção, compras e financeiro' },
];

// Logins sem "@" viram e-mail interno (ex.: admin -> admin@364.local)
export function usuarioParaEmail(usuario) {
  const u = usuario.trim();
  return u.includes('@') ? u : `${u}@364.local`;
}

// Protege a página: exige sessão e, se informado, a permissão do módulo.
// Uso: const { loading, session, permissoes, isAdmin } = useAuth('fornecedores');
// Para exigir administrador (aba Usuários): useAuth('admin').
export function useAuth(moduloRequerido) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, session: null, permissoes: [], isAdmin: false });

  useEffect(() => {
    let ativo = true;
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      const { data } = await supabase.from('permissoes').select('modulo').eq('user_id', session.user.id);
      const permissoes = (data || []).map(p => p.modulo);
      const isAdmin = permissoes.includes('admin');

      if (moduloRequerido && !isAdmin && !permissoes.includes(moduloRequerido)) {
        router.replace('/');
        return;
      }
      if (ativo) setState({ loading: false, session, permissoes, isAdmin });
    }
    init();
    return () => { ativo = false; };
  }, [moduloRequerido, router]);

  return state;
}

export async function sair(router) {
  await supabase.auth.signOut();
  router.replace('/login');
}
