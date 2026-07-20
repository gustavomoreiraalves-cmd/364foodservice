"""Authentication routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from app.database import get_db
from app.models.user import Usuario
from app.models.audit import AuditLog
from app.core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
)

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    senha: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    email: str
    nome_completo: str


class CreateUserRequest(BaseModel):
    email: EmailStr
    nome_completo: str
    senha: str


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """Autenticar usuário e gerar token JWT"""
    user = db.query(Usuario).filter(Usuario.email == request.email).first()

    if not user or not verify_password(request.senha, user.senha_hash):
        # Log de tentativa falhada
        db.add(
            AuditLog(
                acao="login_falhou",
                tabela="usuarios",
                descricao=f"Tentativa de login com {request.email}",
            )
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha inválidos",
        )

    if not user.ativo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuário inativo",
        )

    # Update last login
    user.ultimo_login = datetime.utcnow()

    # Log successful login
    audit = AuditLog(
        usuario_id=user.id,
        acao="login",
        tabela="usuarios",
        registro_id=user.id,
        descricao=f"Login bem-sucedido: {user.email}",
    )

    db.add(user)
    db.add(audit)
    db.commit()

    # Generate token
    access_token = create_access_token(data={"sub": str(user.id)})

    return LoginResponse(
        access_token=access_token,
        user_id=user.id,
        email=user.email,
        nome_completo=user.nome_completo,
    )


@router.post("/register", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def register(request: CreateUserRequest, db: Session = Depends(get_db)):
    """Registrar novo usuário (apenas admin pode fazer isso em produção)"""
    # Check if user already exists
    existing_user = db.query(Usuario).filter(Usuario.email == request.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email já cadastrado",
        )

    # Create new user
    new_user = Usuario(
        email=request.email,
        nome_completo=request.nome_completo,
        senha_hash=get_password_hash(request.senha),
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Log user creation
    audit = AuditLog(
        usuario_id=None,  # Pode ser nulo se auto-registro
        acao="create",
        tabela="usuarios",
        registro_id=new_user.id,
        descricao=f"Novo usuário registrado: {new_user.email}",
    )
    db.add(audit)
    db.commit()

    access_token = create_access_token(data={"sub": str(new_user.id)})

    return LoginResponse(
        access_token=access_token,
        user_id=new_user.id,
        email=new_user.email,
        nome_completo=new_user.nome_completo,
    )
