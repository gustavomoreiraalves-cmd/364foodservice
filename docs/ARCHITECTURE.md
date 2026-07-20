# Arquitetura do 364 OS

## Visão geral

O 364 OS é construído em uma arquitetura de três camadas:

```
┌─────────────────────────────────────┐
│   Frontend (Next.js + React)        │
│   - Login, Dashboard                │
│   - Gerenciamento de Empresas       │
│   - CRM, Financeiro, RH (futuros)   │
└─────────────────────────────────────┘
              ↓ HTTP/REST API
┌─────────────────────────────────────┐
│   Backend (FastAPI)                 │
│   - Autenticação (JWT)              │
│   - Rotas de API                    │
│   - Lógica de negócio               │
│   - Auditoria                       │
└─────────────────────────────────────┘
              ↓ SQL
┌─────────────────────────────────────┐
│   Banco de Dados (PostgreSQL)       │
│   - Tabelas de organização          │
│   - Usuários e permissões           │
│   - Logs de auditoria               │
└─────────────────────────────────────┘
```

## Stack Técnico

### Frontend
- **Next.js 14+**: Framework React com SSR/SSG
- **React 18**: UI library
- **TypeScript**: Type safety
- **Axios**: HTTP client
- **Zustand**: State management (futuro)

### Backend
- **FastAPI**: Web framework Python
- **SQLAlchemy**: ORM para banco de dados
- **Pydantic**: Data validation
- **Python-Jose**: JWT tokens
- **Passlib + Bcrypt**: Password hashing
- **Alembic**: Database migrations

### Database
- **PostgreSQL 15**: Banco relacional
- **Migrations**: Versionadas com Alembic

### Deployment
- **Docker Compose**: Orquestração local
- **Ambiente**: Desenvolvimento com hot-reload

## Fluxo de autenticação

1. Usuário acessa `http://localhost:3000`
2. Faz login com email/senha
3. Backend (`/api/auth/login`) valida credenciais
4. Retorna JWT token
5. Frontend armazena token em localStorage
6. Todas as requisições subsequentes incluem token no header
7. Backend valida token com `get_current_user` dependency

## Modelo de dados - Release 0

### Organização
- **Grupo**: Entidade raiz (ex: Grupo 364)
- **Empresa**: Subdivisão do Grupo (ex: 364 Steakhouse)
- **Unidade**: Operação dentro da Empresa (ex: Filial, Matriz)

### Usuários
- **Usuario**: Login e dados pessoais
- **UsuarioPerfil**: Associação de usuário → perfil em empresa/unidade
- **Perfil**: Enum de roles (admin, diretor, financeiro, etc)

### Auditoria
- **AuditLog**: Registro de todas as ações críticas
  - Quem: usuario_id
  - O quê: acao, tabela, registro_id
  - Quando: timestamp
  - Valor anterior/novo: para updates

## Estrutura de diretórios

```
364-os/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app
│   │   ├── database.py             # Conexão DB
│   │   ├── core/
│   │   │   ├── config.py           # Configurações
│   │   │   └── security.py         # JWT, hashing
│   │   ├── models/                 # SQLAlchemy models
│   │   ├── schemas/                # Pydantic schemas
│   │   ├── api/                    # Rotas
│   │   │   ├── auth.py
│   │   │   ├── organizations.py
│   │   │   └── users.py
│   │   └── services/               # Lógica de negócio
│   ├── migrations/                 # Alembic
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            # Login
│   │   │   ├── register/
│   │   │   ├── dashboard/
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── components/             # Componentes reutilizáveis
│   │   ├── lib/                    # Utilitários
│   │   └── types/
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
├── docs/
│   ├── ARCHITECTURE.md             # Este arquivo
│   ├── API.md                      # Documentação de endpoints
│   └── INSTALL.md
└── docker-compose.yml

```

## Decisões arquiteturais (ADRs)

### ADR-001: FastAPI + PostgreSQL
- **Decisão**: Backend em FastAPI (Python), BD em PostgreSQL
- **Razão**: FastAPI é rápido, moderno, com suporte nativo a async. PostgreSQL é robusto e suporta JSON para auditoria. Escolha conservadora para produção local.
- **Implicações**: Requer Python 3.10+, mas fácil de containerizar.

### ADR-002: JWT + localStorage
- **Decisão**: Tokens JWT armazenados em localStorage do navegador
- **Razão**: Stateless, escalável, simples para MVP. Necessário HTTPS em produção.
- **Implicações**: Vulnerável a XSS; será migrado para cookie HTTP-only em Release 2.

### ADR-003: Multi-empresa obrigatória
- **Decisão**: Todo registro transacional exige `empresa_id` e `unidade_id`
- **Razão**: Prevenir mistura acidental de dados entre operações.
- **Implicações**: Validação em cada INSERT/UPDATE; índices compostos para performance.

### ADR-004: Auditoria em todas as ações
- **Decisão**: Toda alteração crítica registra quem, o quê, quando, antes/depois
- **Razão**: Rastreabilidade; requisito de governança e conformidade.
- **Implicações**: Overhead de storage; limpeza de logs antigos em Release 2.

## Segurança

### Release 0
- ✅ Senhas com bcrypt (hash forte)
- ✅ JWT com expiração
- ✅ RBAC por empresa/unidade
- ✅ Auditoria de logins
- ⚠️ CORS aberto (desenvolvimento apenas)
- ⚠️ Sem HTTPS (local development)

### Release 2
- [ ] Rate limiting em endpoints
- [ ] HTTPS obrigatório
- [ ] Cookies HTTP-only
- [ ] CSRF tokens
- [ ] Refresh tokens

## Performance

### Índices iniciais
- `usuarios(email)` - login rápido
- `empresas(grupo_id)` - listing
- `unidades(empresa_id)` - listing
- `usuarios_perfis(usuario_id, empresa_id)` - validação de acesso

### Cache (futuro)
- Redis para sessões
- Cache de permissões em memoria

## Observabilidade

### Logs
- FastAPI logs padrão em stdout
- Queries SQL com `echo=True` em dev

### Monitoramento (futuro)
- Prometheus para métricas
- Jaeger para tracing distribuído

## Próximos passos

1. ✅ Estrutura base (Release 0)
2. ⏳ Testes unitários (before Release 1)
3. ⏳ CRM (Release 1)
4. ⏳ Facial recognition (Release 3 RH)
5. ⏳ Migração para nuvem (Release 8+)

---

*Última atualização: 20 de julho de 2026*
