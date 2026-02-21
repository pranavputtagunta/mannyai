import requests
import json
from core.config import settings

class OnshapeAPI:
    def __init__(self):
        self.base_url = settings.ONSHAPE_BASE_URL
        self.access_key = settings.ONSHAPE_ACCESS_KEY
        self.secret_key = settings.ONSHAPE_SECRET_KEY
        self.auth = (self.access_key, self.secret_key)  # ← Basic auth, that's it

    def export_gltf(self, document_id: str, wvm: str, wvmid: str, element_id: str):
        path = f"/api/partstudios/d/{document_id}/{wvm}/{wvmid}/e/{element_id}/gltf"
        url = f"{self.base_url}{path}"
        
        headers = {
            "Accept": "model/gltf+json",
            "Content-Type": "application/json"
        }
        print(f"auth: {self.auth}")  # Debug print to verify auth tuple
        
        response = requests.get(
            url,
            auth=self.auth,   # ← just this
            headers=headers,
            params={"rollbackBarIndex": -1}
        )
        response.raise_for_status()
        return response.json()

    def execute_featurescript(self, did: str, wvm: str, wid: str, eid: str, script: str):
        path = f"/api/partstudios/d/{did}/{wvm}/{wid}/e/{eid}/featurescript"
        url = self.base_url + path
        
        payload = {"script": script, "queries": []}
        
        headers = {
            "Accept": "application/vnd.onshape.v1+json",
            "Content-Type": "application/json"
        }
        
        response = requests.post(
            url,
            auth=self.auth,   # ← just this
            headers=headers,
            json=payload
        )
        response.raise_for_status()
        return response.json()

onshape_client = OnshapeAPI()