"""User management routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from app.database import get_db
from app.models.user import Usuario, UsuarioPerfil, Perfil
from app.models.audit import AuditLog
from app.api.dependencies import get_current_user
from app.core.security import get_password_hash

router = APIRouter()


class UsuarioCreate(BaseModel):
    email: EmailStr
    nome_completo: str
    senha: str


class UsuarioPerfiiAssign(BaseModel):
    usuario_id: int
    empresa_id: int
    unidade_id: int = None
    perfil: str


class UsuarioResponse(BaseModel):
    id: int
    email: str
    nome_completo: str
    ativo: bool
    ultimo_login: str = None

    class Config:
        from_attributes = True


@router.post("/", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
async def create_usuario(
    usuario_data: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Criar novo usuário"""
    existing = db.query(Usuario).filter(Usuario.email == usuario_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email já cadastrado")

    novo_usuario = Usuario(
        email=usuario_data.email,
        nome_completo=usuario_data.nome_completo,
        senha_hash=get_password_hash(usuario_data.senha),
    )

    db.add(novo_usuario)
    db.commit()
    db.refresh(novo_usuario)

    audit = AuditLog(
        usuario_id=current_user.id,
        acao="create",
        tabela="usuarios",
        registro_id=novo_usuario.id,
        descricao=f"Usuário criado: {novo_usuario.email}",
    )
    db.add(audit)
    db.commit()

    return novo_usuario


@router.get("/{usuario_id}", response_model=UsuarioResponse)
async def get_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Obter dados do usuário"""
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return usuario


@router.get("/", response_model=list[UsuarioResponse])
async def list_usuarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Listar usuários ativos"""
    usuarios = db.query(Usuario).filter(Usuario.ativo == True).all()
    return usuarios


@router.post("/perfil/assign", status_code=status.HTTP_201_CREATED)
async def assign_perfil(
    assign_data: UsuarioPerfiiAssign,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Atribuir perfil a um usuário em uma empresa/unidade"""
    # Validate inputs
    if assign_data.perfil not in Perfil.ALL:
        raise HTTPException(status_code=400, detail="Perfil inválido")

    # Check if user exists
    usuario = db.query(Usuario).filter(Usuario.id == assign_data.usuario_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Create perfil assignment
    novo_perfil = UsuarioPerfil(
        usuario_id=assign_data.usuario_id,
        empresa_id=assign_data.empresa_id,
        unidade_id=assign_data.unidade_id,
        perfil=assign_data.perfil,
    )

    db.add(novo_perfil)
    db.commit()
    db.refresh(novo_perfil)

    audit = AuditLog(
        usuario_id=current_user.id,
        acao="create",
        tabela="usuarios_perfis",
        registro_id=novo_perfil.id,
        descricao=f"Perfil {assign_data.perfil} atribuído a {usuario.email}",
    )
    db.add(audit)
    db.commit()

    return {"message": "Perfil atribuído com sucesso", "perfil_id": novo_perfil.id}
