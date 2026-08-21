'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { menuVisivel, itemAtivo, grupoDaRota } from '../lib/menu';

const LS_KEY = 'menuGruposAbertos';

export default function SidebarNav({ permissoes, isAdmin }) {
  const pathname = usePathname();
  const [abertos, setAbertos] = useState([]);

  // localStorage só depois da hidratação: se lêssemos durante a renderização,
  // o HTML do servidor e o do cliente divergiriam.
  useEffect(() => {
    let salvos = [];
    try { salvos = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { salvos = []; }
    if (!Array.isArray(salvos)) salvos = [];
    const atual = grupoDaRota(pathname);
    setAbertos(atual && !salvos.includes(atual) ? [...salvos, atual] : salvos);
  }, [pathname]);

  // O novo estado é calculado fora do setAbertos de propósito: gravar no
  // localStorage dentro do updater seria efeito colateral em função que precisa
  // ser pura, e o StrictMode do React a invoca duas vezes.
  function alternar(id) {
    const novo = abertos.includes(id) ? abertos.filter(x => x !== id) : [...abertos, id];
    setAbertos(novo);
    localStorage.setItem(LS_KEY, JSON.stringify(novo));
  }

  return (
    <nav>
      {menuVisivel(permissoes, isAdmin).map(entrada => {
        if (entrada.tipo === 'link') {
          return (
            <a key={entrada.id} href={entrada.href} className={itemAtivo(entrada, pathname) ? 'active' : ''}>
              <span className="ic" aria-hidden="true">{entrada.ic}</span>{entrada.label}
            </a>
          );
        }
        const aberto = abertos.includes(entrada.id);
        const temAtivo = entrada.itens.some(i => itemAtivo(i, pathname));
        return (
          <div key={entrada.id} className="nav-grupo">
            <button
              type="button"
              className={'nav-grupo-toggle' + (!aberto && temAtivo ? ' tem-ativo' : '')}
              aria-expanded={aberto}
              aria-controls={`nav-sub-${entrada.id}`}
              onClick={() => alternar(entrada.id)}
            >
              <span className="ic" aria-hidden="true">{entrada.ic}</span>
              <span className="nav-grupo-label">{entrada.label}</span>
              <span className="chevron" aria-hidden="true">▸</span>
            </button>
            {/* Sempre renderizado, só escondido: assim o aria-controls do botão
                aponta para um elemento que existe mesmo com o grupo fechado. */}
            <div className="nav-sub" id={`nav-sub-${entrada.id}`} hidden={!aberto}>
              {entrada.itens.map(item => (
                <a key={item.href} href={item.href} className={itemAtivo(item, pathname) ? 'active' : ''}>
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
