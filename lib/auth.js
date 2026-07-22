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
  { id: 'depositos', label: 'Depósitos', href: '/depositos', ic: '▥', desc: 'Espaços de armazenamento por unidade (CD, câmaras, etc.)' },
  { id: 'centros_custo', label: 'Centros de custo', href: '/centros-custo', ic: '◇', desc: 'Centros de custo por empresa e unidade' },
  { id: 'produtos', label: 'Produtos', href: '/produtos', ic: '▧', desc: 'Catálogo, ficha técnica, custo e preço de venda' },
  { id: 'producoes', label: 'Produção', href: '/producoes', ic: '▨', desc: 'Lançamento de lotes produzidos e cálculo de custo' },
  { id: 'clientes', label: 'Clientes', href: '/clientes', ic: '▦', desc: 'Cadastro de clientes e revendas' },
  { id: 'pedidos', label: 'Pedidos de Venda', href: '/pedidos', ic: '▩', desc: 'Pedidos, faturamento e baixa de estoque' },
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
  const [state, setState] = useState({ loading: true, session: null, permissoes: [], isAdmin: false, empresas: [] });

  useEffect(() => {
    let ativo = true;
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      const [{ data: permData }, { data: empresas }] = await Promise.all([
        supabase.from('permissoes').select('modulo').eq('user_id', session.user.id),
        // RLS de `empresas` já filtra pelas empresas permitidas (admin vê todas)
        supabase.from('empresas').select('id, nome, slug, prefixo_codigo').eq('ativo', true).order('nome'),
      ]);
      const permissoes = (permData || []).map(p => p.modulo);
      const isAdmin = permissoes.includes('admin');

      if (moduloRequerido && !isAdmin && !permissoes.includes(moduloRequerido)) {
        router.replace('/');
        return;
      }
      if (ativo) setState({ loading: false, session, permissoes, isAdmin, empresas: empresas || [] });
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
