'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ABAS = [
  { href: '/ponto/colaboradores', label: 'Colaboradores' },
  { href: '/ponto/escalas', label: 'Escalas' },
  { href: '/ponto/marcacoes', label: 'Marcações' },
  { href: '/ponto/unidades', label: 'Unidades e empregadores' },
  { href: '/ponto/dispositivos', label: 'Dispositivos' },
];

export default function PontoTabs() {
  const pathname = usePathname();
  return (
    <div className="ponto-tabs">
      {ABAS.map(a => (
        <Link key={a.href} href={a.href}
          className={'ponto-tab' + (pathname.startsWith(a.href) ? ' ativo' : '')}>
          {a.label}
        </Link>
      ))}
    </div>
  );
}
