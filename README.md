# 364 OS - ERP/CRM do Grupo 364

Sistema integrado de gestão empresarial (ERP) + Customer Relationship Management (CRM) para o Grupo 364.

**Status**: Release 0 - Fundação técnica  
**Data de início**: 20 de julho de 2026

## Visão geral

O 364 OS é um sistema modular, auditável e escalável que centraliza dados de:
- 364 Steakhouse
- 364 Food Service
- 364 Burguer
- 364 Foodtruck / Afya

Começando pequeno (CRM + núcleo ERP) e evoluindo sem perder controle.

## Stack técnico

- **Backend**: FastAPI (Python 3.10+)
- **Frontend**: Next.js 14+ (React + TypeScript)
- **Banco**: PostgreSQL 15
- **Execução**: Docker Compose (local)
- **Auth**: JWT + RBAC (Role-Based Access Control)
- **Armazenamento**: Local compatível com S3

## Primeiros passos

### Pré-requisitos
- Docker e Docker Compose instalados
- Python 3.10+ (para rodar backend fora de container)
- Node.js 18+ (para rodar frontend)
- Git

### Instalação local

```bash
# 1. Clone/entre no repositório
cd "364 Steakhouse/2026/364 food services/Sistema de Gestão/Sistema Web"

# 2. Suba o PostgreSQL
docker-compose up postgres -d

# 3. Em um terminal, suba o backend
cd backend
python -m venv venv
source venv/bin/activate  # ou `venv\Scripts\activate` no Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 4. Em outro terminal, suba o frontend
cd frontend
npm install
npm run dev

# Backend disponível em: http://localhost:8000
# API docs: http://localhost:8000/docs
# Frontend disponível em: http://localhost:3000
```

## Estrutura do projeto

```
.
├── backend/              # FastAPI + SQLAlchemy
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── core/
│   ├── migrations/       # Alembic (versionamento DB)
│   ├── tests/
│   └── requirements.txt
├── frontend/             # Next.js
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── pages/
│   │   └── lib/
│   └── package.json
├── docs/                 # Documentação
│   ├── ADRs/             # Architecture Decision Records
│   ├── API.md
│   └── INSTALL.md
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Release 0 - Fundação

Objetivo: colocar no ar localmente a fundação segura do 364 OS.

### Entregas esperadas
- [x] Repositório e Git workflow
- [ ] Docker Compose (PostgreSQL + aplicação)
- [ ] Tela de login
- [ ] Cadastro de Grupo, empresas, unidades
- [ ] Cadastro de usuários e perfis
- [ ] Permissões básicas (RBAC)
- [ ] Log de login e auditoria
- [ ] Backup local
- [ ] Testes de instalação

## Documentação

- [Especificação de Requisitos](../364 OS/Especificacao_ERP_CRM_364_OS_v1.pdf)
- [Arquitetura](./docs/ARCHITECTURE.md)
- [API](./docs/API.md)
- [Instalação detalhada](./docs/INSTALL.md)

## Governança

- **Product Owner**: Gustavo Moreira Alves (decisões finais)
- **Revisão obrigatória**: Todo código deve ser revisado antes de merge
- **Testes**: Funcionalidades críticas exigem testes automatizados
- **Auditoria**: Todas as ações relevantes são registradas
- **IA**: Agentes recomendam; humanos aprovam e executam

## Próximos passos

1. Implementar banco de dados (schema Release 0)
2. Implementar autenticação JWT
3. Criar telas de administração
4. Testar instalação em máquina limpa
5. Documentar procedimentos de backup/restore

## Contato

**Responsável de negócio**: Gustavo Moreira Alves (gustavomoreiraalves@gmail.com)

---

*Desenvolvido com Claude Code + Agents do Grupo 364*
