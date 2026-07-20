"""Organization management routes"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models.organization import Grupo, Empresa, Unidade
from app.models.audit import AuditLog
from app.api.dependencies import get_current_user
from app.models.user import Usuario

router = APIRouter()


class GrupoCreate(BaseModel):
    nome: str
    descricao: str = None


class GrupoResponse(BaseModel):
    id: int
    nome: str
    descricao: str = None
    ativo: bool

    class Config:
        from_attributes = True


class EmpresaCreate(BaseModel):
    grupo_id: int
    nome: str
    cnpj: str = None
    descricao: str = None


class EmpresaResponse(BaseModel):
    id: int
    grupo_id: int
    nome: str
    cnpj: str = None
    descricao: str = None
    ativo: bool

    class Config:
        from_attributes = True


class UnidadeCreate(BaseModel):
    empresa_id: int
    nome: str
    descricao: str = None
    tipo: str = None


class UnidadeResponse(BaseModel):
    id: int
    empresa_id: int
    nome: str
    descricao: str = None
    tipo: str = None
    ativo: bool

    class Config:
        from_attributes = True


# Grupos
@router.post("/grupos", response_model=GrupoResponse, status_code=status.HTTP_201_CREATED)
async def create_grupo(
    grupo_data: GrupoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Criar novo Grupo (admin only)"""
    # Check if grupo already exists
    existing = db.query(Grupo).filter(Grupo.nome == grupo_data.nome).first()
    if existing:
        raise HTTPException(status_code=400, detail="Grupo já existe")

    novo_grupo = Grupo(
        nome=grupo_data.nome,
        descricao=grupo_data.descricao,
    )

    db.add(novo_grupo)
    db.commit()
    db.refresh(novo_grupo)

    # Log auditoria
    audit = AuditLog(
        usuario_id=current_user.id,
        acao="create",
        tabela="grupos",
        registro_id=novo_grupo.id,
        descricao=f"Grupo criado: {novo_grupo.nome}",
        valor_novo={"id": novo_grupo.id, "nome": novo_grupo.nome},
    )
    db.add(audit)
    db.commit()

    return novo_grupo


@router.get("/grupos", response_model=list[GrupoResponse])
async def list_grupos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Listar todos os Grupos"""
    grupos = db.query(Grupo).filter(Grupo.ativo == True).all()
    return grupos


# Empresas
@router.post("/empresas", response_model=EmpresaResponse, status_code=status.HTTP_201_CREATED)
async def create_empresa(
    empresa_data: EmpresaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Criar nova Empresa"""
    # Verify grupo exists
    grupo = db.query(Grupo).filter(Grupo.id == empresa_data.grupo_id).first()
    if not grupo:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    nova_empresa = Empresa(
        grupo_id=empresa_data.grupo_id,
        nome=empresa_data.nome,
        cnpj=empresa_data.cnpj,
        descricao=empresa_data.descricao,
    )

    db.add(nova_empresa)
    db.commit()
    db.refresh(nova_empresa)

    audit = AuditLog(
        usuario_id=current_user.id,
        acao="create",
        tabela="empresas",
        registro_id=nova_empresa.id,
        descricao=f"Empresa criada: {nova_empresa.nome}",
    )
    db.add(audit)
    db.commit()

    return nova_empresa


@router.get("/empresas", response_model=list[EmpresaResponse])
async def list_empresas(
    grupo_id: int = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Listar empresas"""
    query = db.query(Empresa).filter(Empresa.ativo == True)
    if grupo_id:
        query = query.filter(Empresa.grupo_id == grupo_id)
    return query.all()


# Unidades
@router.post("/unidades", response_model=UnidadeResponse, status_code=status.HTTP_201_CREATED)
async def create_unidade(
    unidade_data: UnidadeCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Criar nova Unidade"""
    # Verify empresa exists
    empresa = db.query(Empresa).filter(Empresa.id == unidade_data.empresa_id).first()
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    nova_unidade = Unidade(
        empresa_id=unidade_data.empresa_id,
        nome=unidade_data.nome,
        descricao=unidade_data.descricao,
        tipo=unidade_data.tipo,
    )

    db.add(nova_unidade)
    db.commit()
    db.refresh(nova_unidade)

    audit = AuditLog(
        usuario_id=current_user.id,
        acao="create",
        tabela="unidades",
        registro_id=nova_unidade.id,
        descricao=f"Unidade criada: {nova_unidade.nome}",
    )
    db.add(audit)
    db.commit()

    return nova_unidade


@router.get("/unidades", response_model=list[UnidadeResponse])
async def list_unidades(
    empresa_id: int = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Listar unidades"""
    query = db.query(Unidade).filter(Unidade.ativo == True)
    if empresa_id:
        query = query.filter(Unidade.empresa_id == empresa_id)
    return query.all()
