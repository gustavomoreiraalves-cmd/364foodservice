# 364 OS - Quick Start Guide

## ⚡ Primeira execução (5 minutos)

### Pré-requisito: PostgreSQL

Você precisa de uma instância PostgreSQL rodando. Escolha uma opção:

#### Opção A: Docker Desktop (Recomendado)
1. Instale [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Execute:
```bash
docker compose up postgres -d
```

#### Opção B: PostgreSQL Local
1. Instale [PostgreSQL](https://www.postgresql.org/download/)
2. Crie um banco:
```bash
createdb -U postgres -h localhost 364_os
```
3. Atualize `backend/.env`:
```
DATABASE_URL=postgresql://postgres:sua_senha@localhost:5432/364_os
```

#### Opção C: Usar SQLite (desenvolvimento rápido)
Se nenhuma das acima funcionar, podemos usar SQLite temporariamente.

---

## 🔧 Iniciar Backend

**Terminal 1:**

```bash
cd backend

# Criar ambiente virtual
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Instalar dependências
pip install -r requirements.txt

# Criar arquivo .env
cp .env.example .env

# Iniciar servidor
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

✅ Backend rodando em http://localhost:8000

---

## 🎨 Iniciar Frontend

**Terminal 2:**

```bash
cd frontend

# Instalar dependências
npm install

# Iniciar dev server
npm run dev
```

✅ Frontend rodando em http://localhost:3000

---

## 🧪 Testar o sistema

### 1. Abrir navegador
```
http://localhost:3000
```

### 2. Cadastro (primeira vez)
- Clique em "Cadastre-se"
- Email: `admin@364.local`
- Nome: `Administrador 364`
- Senha: `admin123`

### 3. Fazer login
- Use as credenciais acima
- Verá o dashboard

### 4. Criar estrutura (via API)

Abra http://localhost:8000/docs (Swagger)

**4.1. Login para pegar token**
- POST `/api/auth/login`
- Email: `admin@364.local`
- Senha: `admin123`
- Copie o `access_token` retornado

**4.2. Criar Grupo 364**
- POST `/api/organizations/grupos`
- Header: `Authorization: Bearer SEU_TOKEN`
- Body:
```json
{
  "nome": "Grupo 364",
  "descricao": "Grupo empresarial dos restaurantes 364"
}
```
- Salve o `id` retornado (ex: `1`)

**4.3. Criar Empresa**
- POST `/api/organizations/empresas`
- Body:
```json
{
  "grupo_id": 1,
  "nome": "364 Steakhouse",
  "cnpj": "12.345.678/0001-90",
  "descricao": "Restaurante de carnes"
}
```
- Salve o `id` retornado (ex: `1`)

**4.4. Criar Unidade**
- POST `/api/organizations/unidades`
- Body:
```json
{
  "empresa_id": 1,
  "nome": "Matriz",
  "tipo": "matriz",
  "descricao": "Unidade matriz"
}
```

### ✅ Pronto!
Agora você tem a estrutura completa do Grupo 364 no banco!

---

## 📊 Verificar dados no banco

Se quiser ver os dados criados:

```bash
# Conectar ao PostgreSQL
psql -U 364_user -h localhost -d 364_os

# Listar tabelas
\dt

# Ver grupos
SELECT * FROM grupos;

# Ver empresas
SELECT * FROM empresas;

# Ver unidades
SELECT * FROM unidades;

# Ver usuários
SELECT id, email, nome_completo, ativo FROM usuarios;

# Ver logs de auditoria
SELECT acao, tabela, timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT 10;
```

---

## 🛑 Parar os serviços

```bash
# Terminal 1 (Backend): Ctrl+C
# Terminal 2 (Frontend): Ctrl+C
# Docker: docker compose down
```

---

## 🚨 Troubleshooting

### "Connection refused" no backend
PostgreSQL não está rodando. Verifique a opção de instalação acima.

### "Module not found" no backend
```bash
cd backend
pip install -r requirements.txt
```

### "npm: command not found"
Node.js não está instalado. Instale em https://nodejs.org

### Preciso limpar tudo?
```bash
# Backend
cd backend && rm -rf venv && cd ..

# Frontend
cd frontend && rm -rf node_modules && cd ..

# Banco
docker compose down -v
# ou
dropdb -U postgres 364_os
```

---

## 📝 Próximos passos

- [ ] Testar fluxo completo (registro → login → dashboard)
- [ ] Explorar API em http://localhost:8000/docs
- [ ] Importar dados de faturamento 2025-2026
- [ ] Começar Release 1 (CRM)
- [ ] Integrar reconhecimento facial (Release 3)

---

**Desenvolvido com Claude Code + Agents do Grupo 364**
