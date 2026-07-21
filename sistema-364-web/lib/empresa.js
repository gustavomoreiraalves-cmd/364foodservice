'use client';
import { createContext, useContext } from 'react';

// Empresa selecionada no momento (364 Steakhouse, Food Service, Burguer, Foodtruck/Afya).
// Provido por components/AppShell.js — toda página de negócio já está dentro dele.
export const EmpresaContext = createContext({ empresaAtual: null, empresas: [], setEmpresaAtual: () => {} });

export function useEmpresaAtual() {
  return useContext(EmpresaContext);
}
