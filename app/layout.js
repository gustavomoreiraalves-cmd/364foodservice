import './globals.css';

export const metadata = {
  title: '364 Foodservices — Sistema de Gestão',
  description: 'Controle de fornecedores, produção, estoque e vendas',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
      </body>
    </html>
  );
}
