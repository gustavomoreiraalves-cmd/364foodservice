import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "364 OS - ERP/CRM",
  description: "Sistema integrado de gestão do Grupo 364",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
