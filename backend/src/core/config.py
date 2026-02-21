import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Settings:
    ONSHAPE_ACCESS_KEY: str = ""
    ONSHAPE_SECRET_KEY: str = ""
    ONSHAPE_BASE_URL: str = os.getenv("ONSHAPE_BASE_URL", "https://cad.onshape.com")


settings = Settings()
