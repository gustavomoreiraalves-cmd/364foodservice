import { Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Manrope carrega a interface; a mono carrega tudo que é medido — código de
// produto, quantidade, dinheiro, alíquota. Servidas pelo próprio app, sem
// chamada a CDN em tempo de execução.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-jet',
  display: 'swap',
});

export const metadata = {
  title: '364 Foodservices — Sistema de Gestão',
  description: 'Controle de fornecedores, produção, estoque e vendas',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${mono.variable}`}>
      <body>
        {/*
          THESIS: uma superfície de trabalho onde painéis persistem e o conteúdo troca dentro deles.
          Recusa o ERP de cartões arredondados flutuando sobre cinza-azulado.
          OWN-WORLD: papel branco sobre chão cinza-claro, costura de 1px no lugar de sombra,
          Manrope na interface e mono tabular em tudo que é medido. Verde-menta é a marca e
          a ação, sempre como preenchimento com letra preta; azul é conferido, âmbar é
          pendente, vermelho é destrutivo e fica isolado.
          STORY: quem cadastra vê a lista inteira à esquerda, abre a ficha, e sabe a cada
          instante o que ainda falta para o registro poder virar nota.
          FIRST VIEWPORT: barra fixa com título; à esquerda a lista densa de produtos com
          código, nome e valores alinhados; à direita a ficha em abas, com o painel de
          pendências no topo e o botão de liberar preso ao rodapé.
          FORM: console de trabalho em superfície clara, candidato 7 da lista fundamentada,
          seed a279112f (o usuário escolheu a carta do console e pediu o chão claro).
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
