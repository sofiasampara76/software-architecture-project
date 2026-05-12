from fastapi import FastAPI, Depends, HTTPException, Header
import redis
from sqlalchemy.orm import Session
import time
from sqlalchemy.exc import OperationalError
from fastapi.security import OAuth2PasswordBearer

from . import auth_utils, models, schemas, database

app = FastAPI(
    title="Auth Service",
    root_path="/auth",
    docs_url="/docs", 
    openapi_url="/openapi.json"
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

cache = redis.Redis(host='auth-redis', port=6379, decode_responses=True)

for i in range(10):
    try:
        models.Base.metadata.create_all(bind=database.engine)
        print("Database connected and tables created!")
        break
    except OperationalError:
        print(f"Database not ready yet... (attempt {i+1}/10)")
        time.sleep(2)

@app.post("/register")
def register(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    hashed = auth_utils.hash_password(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed)
    db.add(db_user)
    db.commit()
    return {"message": "User created"}

@app.post("/login")
def login(user: schemas.UserLogin, db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if not db_user or not auth_utils.verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Wrong credentials")
    
    token = auth_utils.create_access_token({"sub": db_user.email})
    cache.set(f"active_{token}", "true", ex=3600)
    return {"access_token": token}

@app.post("/logout")
def logout(authorization: str = Header(None)):
    token = authorization.replace("Bearer ", "")
    cache.delete(f"active_{token}")
    cache.set(f"bl_{token}", "true", ex=3600)
    return {"message": "Logged out"}

@app.get("/validate")
def validate(token: str):
    if cache.get(f"bl_{token}"):
        raise HTTPException(status_code=401, detail="Token blacklisted")
    
    try:
        payload = auth_utils.jwt.decode(token, auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
        return {"status": "valid", "user": payload.get("sub")}
    except auth_utils.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
