'use client';
import { useState } from 'react';

// Substitui window.prompt() — bloqueado em contextos de iframe/preview
// (aparece como "prompt() is not supported"). Uso:
// <PromptDialog titulo="..." label="..." aoConfirmar={v => ...} aoCancelar={() => ...} />
export default function PromptDialog({ titulo, label, placeholder, tipo = 'text', valorInicial = '', aoConfirmar, aoCancelar }) {
  const [valor, setValor] = useState(valorInicial);

  function confirmar() {
    if (!valor.trim()) return;
    aoConfirmar(valor.trim());
  }

  return (
    <div className="modal-backdrop" onClick={aoCancelar}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <p><b>{titulo}</b></p>
        {label && <label>{label}</label>}
        <input
          autoFocus
          type={tipo}
          value={valor}
          placeholder={placeholder}
          onChange={e => setValor(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') aoCancelar(); }}
        />
        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn" type="button" onClick={confirmar}>Confirmar</button>
          <button className="btn secondary" type="button" onClick={aoCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
