'use client';
import AppShell from '../../../components/AppShell';

export default function VendasBuffetPage() {
  return (
    <AppShell modulo="pedidos" titulo="Vendas Buffet" desc="Lançamento manual das vendas da 364 Buffet">
      <div className="panel">
        <h3>Em construção</h3>
        <p className="muted">
          Esta tela vai receber o lançamento manual das vendas da 364 Buffet, com data, evento,
          itens vendidos e baixa de estoque. A empresa 364 Buffet ainda precisa ser cadastrada.
        </p>
      </div>
    </AppShell>
  );
}
