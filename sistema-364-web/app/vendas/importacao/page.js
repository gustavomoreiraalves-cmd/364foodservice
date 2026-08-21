'use client';
import AppShell from '../../../components/AppShell';

export default function ImportacaoVendasPage() {
  return (
    <AppShell modulo="pedidos" titulo="Importação de vendas" desc="364 Steakhouse e 364 Foodtruck/Afya">
      <div className="panel">
        <h3>Em construção</h3>
        <p className="muted">
          Esta tela vai importar as vendas da 364 Steakhouse e da 364 Foodtruck/Afya a partir
          do arquivo exportado pelo PDV, casando cada item com o catálogo de produtos e dando
          baixa no estoque.
        </p>
      </div>
    </AppShell>
  );
}
