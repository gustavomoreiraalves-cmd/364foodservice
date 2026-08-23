'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Hook leve para saber se o usuário logado é admin (gating de UI;
// a segurança de verdade é feita por RLS no banco).
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let ativo = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      supabase.from('permissoes').select('modulo').eq('user_id', session.user.id).eq('modulo', 'admin')
        .then(({ data }) => { if (ativo) setIsAdmin(!!data?.length); });
    });
    return () => { ativo = false; };
  }, []);
  return isAdmin;
}

export { formatarCnpj } from './cnpj.js';

export function formatarCpf(v) {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export const TIPOS_MARCACAO = {
  entrada: 'Entrada',
  intervalo_inicio: 'Início do intervalo',
  intervalo_fim: 'Retorno do intervalo',
  saida: 'Saída',
};

export const METODOS_MARCACAO = {
  facial: 'Facial',
  pin: 'PIN',
  manual_gestor: 'Manual (gestor)',
};
