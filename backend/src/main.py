from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.endpoints_cad import router as cad_router
from api.endpoints_chat import router as chat_router

app = FastAPI(title="AgentFix", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cad_router, prefix="/api/cad", tags=["CAD"])
app.include_router(chat_router, prefix="/api/chat", tags=["Chat"])  # /api/chat/prompt lives here

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
    
print('running')