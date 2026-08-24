// Número e data chegam em três dialetos: OFX usa ponto decimal e data
// compactada (20260810120000[-3:BRT]), CSV de banco brasileiro usa vírgula
// decimal e dd/mm/aaaa, e a IA devolve ISO. Um lugar só resolve os três.

export function numeroBr(texto) {
  if (texto == null) return NaN;
  let t = String(texto).trim().replace(/\s|R\$| /g, '');
  if (!t) return NaN;
  // Negativo em parênteses, como alguns extratos escrevem: (1.234,56)
  let sinal = 1;
  if (/^\(.*\)$/.test(t)) { sinal = -1; t = t.slice(1, -1); }
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return sinal * Number(t);
}

export function dataIso(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);          // OFX: 20260810120000[-3:BRT]
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);      // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(t);     // dd/mm/aa
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
