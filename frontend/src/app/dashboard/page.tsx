"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

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
        <h1 style={{ margin: 0 }}>364 OS</h1>
        <div>
          <span style={{ marginRight: "1rem" }}>
            {user.nome} ({user.email})
          </span>
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
        <div
          style={{
            backgroundColor: "white",
            padding: "2rem",
            borderRadius: "8px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
          }}
        >
          <h2>Bem-vindo ao 364 OS!</h2>
          <p>
            Este é o painel inicial do sistema. Aqui você terá acesso aos
            principais módulos:
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
              marginTop: "2rem",
            }}
          >
            <div
              style={{
                backgroundColor: "#f8f9fa",
                padding: "1rem",
                borderRadius: "4px",
                borderLeft: "4px solid #007bff",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0" }}>CRM</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
                Gerenciar clientes e oportunidades
              </p>
            </div>

            <div
              style={{
                backgroundColor: "#f8f9fa",
                padding: "1rem",
                borderRadius: "4px",
                borderLeft: "4px solid #28a745",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Financeiro</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
                Contas a pagar/receber e fluxo de caixa
              </p>
            </div>

            <div
              style={{
                backgroundColor: "#f8f9fa",
                padding: "1rem",
                borderRadius: "4px",
                borderLeft: "4px solid #ffc107",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0" }}>RH + Ponto</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
                Colaboradores e controle de ponto
              </p>
            </div>

            <div
              style={{
                backgroundColor: "#f8f9fa",
                padding: "1rem",
                borderRadius: "4px",
                borderLeft: "4px solid #17a2b8",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem 0" }}>Admin</h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
                Empresas, unidades e permissões
              </p>
            </div>
          </div>

          <div
            style={{
              marginTop: "2rem",
              padding: "1rem",
              backgroundColor: "#e7f3ff",
              borderRadius: "4px",
              borderLeft: "4px solid #007bff",
            }}
          >
            <p style={{ margin: 0 }}>
              📌 <strong>Release 0 - Fundação Técnica</strong>
            </p>
            <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
              Sistema base com autenticação, empresas, usuários e auditoria.
              Próximas releases trarão CRM, Financeiro e RH com reconhecimento
              facial.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
