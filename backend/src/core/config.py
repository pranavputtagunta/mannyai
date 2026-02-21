import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv("../../../.env")

class Settings:
    ONSHAPE_ACCESS_KEY: str = os.getenv("ONSHAPE_ACCESS_KEY", "")
    ONSHAPE_SECRET_KEY: str = os.getenv("ONSHAPE_SECRET_KEY", "")
    ONSHAPE_BASE_URL: str = os.getenv("ONSHAPE_BASE_URL", "https://cad.onshape.com")

settings = Settings()
