from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.api import endpoints_cad

app = FastAPI(
    title="AgentFix API",
    description="Backend for the AgentFix multimodal AI agent",
    version="1.0.0"
)

# Configure CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(endpoints_cad.router, prefix="/api/cad", tags=["CAD"])

@app.get("/")
def read_root():
    return {"message": "AgentFix API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
