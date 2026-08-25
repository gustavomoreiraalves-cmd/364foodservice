// Ícones do sistema, desenhados aqui e não pegados de uma fonte de símbolos.
//
// Um traço só: 1.5px numa grade de 24, cantos e junções arredondados, sem
// preenchimento. Glifo unicode como ícone quebra alinhamento e muda de forma
// conforme o sistema operacional — o mesmo caractere que é um losango no Mac
// vira um quadrado no Windows.

const TRACOS = {
  // Navegação
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  cadastros: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  producao: <><path d="M3 20h18" /><path d="M5 20V9l4 3 3-5 3 5 4-3v11" /></>,
  vendas: <><path d="M4 6h16l-1.5 9.5a2 2 0 0 1-2 1.7H7.5a2 2 0 0 1-2-1.7L4 6Z" /><path d="M9 6V4.5a3 3 0 0 1 6 0V6" /></>,
  financeiro: <><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></>,
  fiscal: <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 16h4" /></>,
  rh: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 11.5a3 3 0 0 0 0-6" /><path d="M17.5 20a5.5 5.5 0 0 0-2.2-4.4" /></>,
  relatorios: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,

  // Ações
  mais: <path d="M12 5v14M5 12h14" />,
  lapis: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="M14.5 6.5 17.5 9.5" /></>,
  lixeira: <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  seta: <path d="M9 5l7 7-7 7" />,
  busca: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></>,
  conferido: <path d="M4 12.5 9.5 18 20 6.5" />,
  alerta: <><path d="M12 3.5 21.5 20H2.5L12 3.5Z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.5" r=".6" fill="currentColor" /></>,
  etiqueta: <><path d="M3 11V4a1 1 0 0 1 1-1h7l9.5 9.5a1.6 1.6 0 0 1 0 2.3l-6.7 6.7a1.6 1.6 0 0 1-2.3 0L3 11Z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  copiar: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
};

export default function Icone({ nome, tamanho = 16, className = 'ic', titulo }) {
  const traco = TRACOS[nome];
  if (!traco) return null;
  return (
    <svg
      className={className}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={titulo ? 'img' : undefined}
      aria-hidden={titulo ? undefined : 'true'}
      aria-label={titulo}
    >
      {titulo && <title>{titulo}</title>}
      {traco}
    </svg>
  );
}

export const ICONES_DISPONIVEIS = Object.keys(TRACOS);
