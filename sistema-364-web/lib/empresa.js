'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// Empresa selecionada no momento (364 Steakhouse, Food Service, Burguer, Foodtruck/Afya).
// Provido por components/AppShell.js — toda página de negócio já está dentro dele.
export const EmpresaContext = createContext({ empresaAtual: null, empresas: [], setEmpresaAtual: () => {} });

export function useEmpresaAtual() {
  return useContext(EmpresaContext);
}

// A marca (empresas) aponta para a pessoa jurídica (empregadores) por
// empregador_id. É daqui que impressões e processos leem razão social, CNPJ e
// endereço — nunca de texto fixo. Cache por sessão: o cadastro muda raramente.
const cachePJ = new Map();

export async function obterPessoaJuridica(empresaId) {
  if (!empresaId) return null;
  if (cachePJ.has(empresaId)) return cachePJ.get(empresaId);
  const { data, error } = await supabase.from('empresas')
    .select('empregador_id, empregadores(*)').eq('id', empresaId).maybeSingle();
  if (error) throw new Error('Falha ao buscar a pessoa jurídica: ' + error.message);
  const pj = data?.empregadores || null;
  cachePJ.set(empresaId, pj);
  return pj;
}

export function limparCachePessoaJuridica() {
  cachePJ.clear();
}

export function usePessoaJuridica() {
  const { empresaAtual } = useEmpresaAtual();
  const [pessoaJuridica, setPessoaJuridica] = useState(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    obterPessoaJuridica(empresaAtual?.id)
      .then(pj => { if (ativo) setPessoaJuridica(pj); })
      .catch(() => { if (ativo) setPessoaJuridica(null); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [empresaAtual?.id]);
  return { pessoaJuridica, carregando };
}
