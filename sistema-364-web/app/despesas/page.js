'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Despesas foi unificado ao módulo Financeiro (Contas a Pagar). Esta rota
// permanece só para não quebrar links/bookmarks antigos.
export default function DespesasPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/financeiro/contas-a-pagar'); }, [router]);
  return <p style={{ padding: 30 }} className="muted">As despesas agora ficam em Financeiro → Contas a Pagar. Redirecionando…</p>;
}
