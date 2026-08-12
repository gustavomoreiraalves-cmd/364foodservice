"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RelatóriosPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [mes, setMes] = useState<number>(new Date().getMonth() + 1);
  const [ano, setAno] = useState<number>(new Date().getFullYear());
  const [aba, setAba] = useState<"dre" | "fluxo" | "margem">("dre");

  useEffect(() => {
    const userName = localStorage.getItem("user_name");
    if (!userName) {
      router.push("/");
      return;
    }
    setUser({
      nome: userName,
      email: localStorage.getItem("user_email"),
    });
  }, [router]);

  const handleLogout = () => {
    localStorage.clear();
    router.push("/");
  };

  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const anosDisponiveis = Array.from({ length: 3 }, (_, i) => ano - i);

  if (!user) return <div>Carregando...</div>;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      {/* Header */}
      <header
        style={{
          backgroundColor: "#333",
          color: "white",
          padding: "1rem 2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0 }}>364 OS - Relatórios</h1>
        <div>
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              marginRight: "1rem",
            }}
          >
            Voltar
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#dc3545",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Sair
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ padding: "2rem" }}>
        {/* Seletor de Período */}
        <div
          style={{
            backgroundColor: "white",
            padding: "1.5rem",
            borderRadius: "8px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
            marginBottom: "2rem",
          }}
        >
          <h2 style={{ margin: "0 0 1rem 0" }}>Selecione o Período</h2>
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "flex-end",
            }}
          >
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
                Mês
              </label>
              <select
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "1rem",
                }}
              >
                {meses.map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
                Ano
              </label>
              <select
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                style={{
                  padding: "0.5rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "1rem",
                }}
              >
                {anosDisponiveis.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <button
              style={{
                padding: "0.5rem 1.5rem",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "1rem",
                fontWeight: "500",
              }}
            >
              Atualizar
            </button>
          </div>
        </div>

        {/* Abas */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "2rem",
            borderBottom: "2px solid #ddd",
          }}
        >
          {(["dre", "fluxo", "margem"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setAba(tab)}
              style={{
                padding: "1rem 1.5rem",
                backgroundColor: aba === tab ? "#007bff" : "transparent",
                color: aba === tab ? "white" : "#333",
                border: "none",
                borderRadius: "4px 4px 0 0",
                cursor: "pointer",
                fontSize: "1rem",
                fontWeight: "500",
              }}
            >
              {tab === "dre"
                ? "DRE Mensal"
                : tab === "fluxo"
                ? "Fluxo de Caixa"
                : "Margem por Produto"}
            </button>
          ))}
        </div>

        {/* Conteúdo das Abas */}
        {aba === "dre" && <DRETab mes={mes} ano={ano} />}
        {aba === "fluxo" && <FluxoCaixaTab mes={mes} ano={ano} />}
        {aba === "margem" && <MargemProdutoTab mes={mes} ano={ano} />}
      </main>
    </div>
  );
}

function DRETab({ mes, ano }: { mes: number; ano: number }) {
  return (
    <div
      style={{
        backgroundColor: "white",
        padding: "2rem",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
      }}
    >
      <h3>Demonstração de Resultado do Exercício - {mes.toString().padStart(2, "0")}/{ano}</h3>
      <p style={{ color: "#999" }}>
        🔄 Carregando dados... (API ainda não implementada)
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd" }}>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Descrição</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Valor</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>% Receita</th>
          </tr>
        </thead>
        <tbody>
          {[
            { desc: "Receita Bruta", valor: 0, percent: "0%" },
            { desc: "(-) Devoluções", valor: 0, percent: "0%" },
            { desc: "Receita Líquida", valor: 0, percent: "100%" },
            { desc: "(-) CMV (Custo de MP)", valor: 0, percent: "0%" },
            { desc: "(-) Custo de Embalagem", valor: 0, percent: "0%" },
            { desc: "Lucro Bruto", valor: 0, percent: "0%" },
            { desc: "(-) Despesas Operacionais", valor: 0, percent: "0%" },
            { desc: "Lucro Operacional", valor: 0, percent: "0%" },
            { desc: "Lucro Líquido", valor: 0, percent: "0%" },
          ].map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #eee",
                backgroundColor: i % 2 === 0 ? "#f9f9f9" : "white",
              }}
            >
              <td style={{ padding: "0.75rem", fontWeight: i === 2 || i === 5 || i === 8 ? "bold" : "normal" }}>
                {row.desc}
              </td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>R$ 0,00</td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>{row.percent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FluxoCaixaTab({ mes, ano }: { mes: number; ano: number }) {
  return (
    <div
      style={{
        backgroundColor: "white",
        padding: "2rem",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
      }}
    >
      <h3>Fluxo de Caixa - {mes.toString().padStart(2, "0")}/{ano}</h3>
      <p style={{ color: "#999" }}>
        🔄 Carregando dados... (API ainda não implementada)
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd" }}>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Descrição</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {[
            { desc: "Saldo Inicial", valor: 0 },
            { desc: "(+) Entradas de Vendas", valor: 0 },
            { desc: "(-) Saídas MP/Fornecedores", valor: 0 },
            { desc: "(-) Despesas Operacionais", valor: 0 },
            { desc: "(-) Impostos e Encargos", valor: 0 },
            { desc: "Saldo Final", valor: 0 },
          ].map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #eee",
                backgroundColor: i === 0 || i === 5 ? "#f0f0f0" : "white",
              }}
            >
              <td style={{ padding: "0.75rem", fontWeight: i === 0 || i === 5 ? "bold" : "normal" }}>
                {row.desc}
              </td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>R$ 0,00</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MargemProdutoTab({ mes, ano }: { mes: number; ano: number }) {
  return (
    <div
      style={{
        backgroundColor: "white",
        padding: "2rem",
        borderRadius: "8px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
      }}
    >
      <h3>Margem por Produto - {mes.toString().padStart(2, "0")}/{ano}</h3>
      <p style={{ color: "#999" }}>
        🔄 Carregando dados... (API ainda não implementada)
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd" }}>
            <th style={{ textAlign: "left", padding: "0.75rem" }}>Produto</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Qtd</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Preço Médio</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Custo Médio</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Margem R$</th>
            <th style={{ textAlign: "right", padding: "0.75rem" }}>Margem %</th>
          </tr>
        </thead>
        <tbody>
          {[
            { prod: "Exemplo Produto 1", qtd: 0, preco: 0, custo: 0 },
            { prod: "Exemplo Produto 2", qtd: 0, preco: 0, custo: 0 },
          ].map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #eee",
                backgroundColor: i % 2 === 0 ? "#f9f9f9" : "white",
              }}
            >
              <td style={{ padding: "0.75rem" }}>{row.prod}</td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>0</td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>R$ 0,00</td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>R$ 0,00</td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>R$ 0,00</td>
              <td style={{ textAlign: "right", padding: "0.75rem" }}>0%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
