'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ABAS = [
  { href: '/producoes', label: 'Visão Geral', exato: true },
  { href: '/producoes/nova', label: 'Nova Produção' },
  { href: '/producoes/completa', label: 'Defumação' },
  { href: '/producoes/internas', label: 'Produções Internas' },
  { href: '/producoes/validades', label: 'Validades' },
  { href: '/producoes/historico', label: 'Histórico' },
];

export default function ProducaoTabs() {
  const pathname = usePathname();
  return (
    <div className="ponto-tabs">
      {ABAS.map(a => (
        <Link key={a.href} href={a.href}
          className={'ponto-tab' + ((a.exato ? pathname === a.href : pathname.startsWith(a.href)) ? ' ativo' : '')}>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
