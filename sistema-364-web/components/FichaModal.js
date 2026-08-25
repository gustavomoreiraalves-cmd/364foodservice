'use client';
import { useEffect } from 'react';
import Icone from './Icone';

// A ficha aberta sobre a lista: começo, meio e fim. Fecha no Esc, no ✕ e no
// clique fora — as três saídas que um pop-up precisa ter para não prender
// quem entrou nele.

export default function FichaModal({ titulo, subtitulo, onFechar, rodape, children }) {
  useEffect(() => {
    function aoTeclar(e) { if (e.key === 'Escape') onFechar(); }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal-box wide" role="dialog" aria-modal="true" aria-labelledby="ficha-modal-titulo">
        <div className="modal-head">
          <div>
            <h3 id="ficha-modal-titulo">{titulo}</h3>
            {subtitulo && <span className="muted mono" style={{ fontSize: 11.5 }}>{subtitulo}</span>}
          </div>
          <button className="btn secondary small" type="button" onClick={onFechar} aria-label="Fechar ficha">
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>
        {children}
        {rodape && <div className="modal-foot">{rodape}</div>}
      </div>
    </div>
  );
}
