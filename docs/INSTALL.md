# Instalação - 364 OS

## Pré-requisitos

- **Docker** + **Docker Compose** (https://www.docker.com)
- **Python 3.10+** (https://www.python.org)
- **Node.js 18+** (https://nodejs.org)
- **Git**

Verifique instalação:
```bash
docker --version
docker-compose --version
python --version
node --version
npm --version
```

## Passo 1: Clonar/entrar no repositório

```bash
cd "364 Steakhouse/2026/364 food services/Sistema de Gestão/Sistema Web"
```

## Passo 2: Subir banco de dados

```bash
# Inicia PostgreSQL em container
docker-compose up postgres -d

# Aguarde até que o container esteja saudável (~10 segundos)
docker-compose ps
```

Verif...

```bash
# Conectar ao PostgreSQL para validar
PGPASSWORD=364_secure_dev_password_change_in_prod psql -h localhost -U 364_user -d 364_os -c "\dt"
```

## Passo 3: Preparar e executar Backend

```bash
cd backend

# Criar e ativar virtual environment
python3 -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate

# Instalar dependências
pip install -r requirements.txt

# Criar arquivo .env (cópia do exemplo)
cp .env.example .env

# Executar migrações (criar tabelas)
# [Deixar para Alembic - por enquanto criamos via SQLAlchemy em startup]

# Iniciar servidor
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

O servidor estará disponível em:
- **API**: http://localhost:8000
- **Docs (Swagger)**: http://localhost:8000/docs
- **Redoc**: http://localhost:8000/redoc

Deixe esse terminal rodando.

## Passo 4: Preparar e executar Frontend

Em **outro terminal**:

```bash
cd frontend

# Instalar dependências
npm install

# Iniciar dev server
npm run dev
```

O frontend estará disponível em: http://localhost:3000

Deixe esse terminal rodando.

## Passo 5: Testar login

1. Abra http://localhost:3000 no navegador
2. Você verá a tela de login
3. Clique em "Cadastre-se" para criar primeiro usuário
4. Preencha os dados:
   - Email: `admin@364.local`
   - Nome: `Administrador`
   - Senha: `senha123`
5. Faça login
6. Você verá o dashboard

## Passo 6: Criar estrutura do Grupo 364

Com o usuário logado, você pode usar a API:

```bash
# Terminal novo - usar curl ou Postman

# 1. Login e pegar token
curl -X POST "http://localhost:8000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@364.local",
    "senha": "senha123"
  }'

# Salvar o "access_token" retornado

# 2. Criar Grupo
curl -X POST "http://localhost:8000/api/organizations/grupos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "nome": "Grupo 364",
    "descricao": "Grupo empresarial dos restaurantes 364"
  }'

# 3. Criar Empresa (use o grupo_id retornado acima)
curl -X POST "http://localhost:8000/api/organizations/empresas" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "grupo_id": 1,
    "nome": "364 Steakhouse",
    "cnpj": "12.345.678/0001-90",
    "descricao": "Restaurante de carnes"
  }'

# 4. Criar Unidade (use o empresa_id retornado)
curl -X POST "http://localhost:8000/api/organizations/unidades" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "empresa_id": 1,
    "nome": "Matriz",
    "tipo": "matriz",
    "descricao": "Unidade matriz do Steakhouse"
  }'
```

**Dica**: Use o Swagger em http://localhost:8000/docs para testar a API visualmente (mais fácil).

## Parar os serviços

```bash
# Terminal 1: Ctrl+C (backend)
# Terminal 2: Ctrl+C (frontend)
# Terminal 3 (se houver): Ctrl+C

# Parar PostgreSQL
docker-compose down
```

## Troubleshooting

### "Connection refused" no backend

```bash
# PostgreSQL não está rodando
docker-compose ps

# Se não estiver, inicie novamente
docker-compose up postgres -d
```

### "Port already in use"

Backend usando porta 8000:
```bash
# Mude para outra porta
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

Frontend usando porta 3000:
```bash
# Mude para outra porta (Next.js detecta automaticamente)
PORT=3001 npm run dev
```

### Limpar tudo e recomeçar

```bash
# Remover containers e volumes (⚠️ perderá dados)
docker-compose down -v

# Remover node_modules
cd frontend && rm -rf node_modules && cd ..

# Remover venv
cd backend && rm -rf venv && cd ..

# Recomeçar a partir do Passo 2
```

## Ambiente de produção

Em produção (Release 2+):
- Use variáveis de ambiente (.env com valores reais)
- HTTPS obrigatório
- JWT com expiração curta + refresh tokens
- Rate limiting
- WAF (Web Application Firewall)
- Banco em serviço gerenciado (RDS)
- Frontend em CDN

---

**Próximo passo**: Ler [ARCHITECTURE.md](./ARCHITECTURE.md)
