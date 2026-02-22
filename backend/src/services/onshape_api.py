import requests
import json
from core.config import settings

JSON_CONTENT_TYPE = "application/json"
ONSHAPE_V1_JSON = "application/vnd.onshape.v1+json"

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
            "Content-Type": JSON_CONTENT_TYPE
        }  # Debug print to verify auth tuple
        
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
            "Accept": ONSHAPE_V1_JSON,
            "Content-Type": JSON_CONTENT_TYPE
        } # Debug print to verify auth tuple
        
        response = requests.post(
            url,
            auth=self.auth,   # ← just this
            headers=headers,
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def get_features(self, did: str, wvm: str, wvmid: str, eid: str):
        """
        Retrieves the list of features in the part studio.
        Useful for giving the LLM context about the current model state.
        """
        path = f"/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/features"
        url = self.base_url + path
        
        headers = {
            "Accept": ONSHAPE_V1_JSON,
            "Content-Type": JSON_CONTENT_TYPE
        }
        
        response = requests.get(
            url,
            auth=self.auth,
            headers=headers
        )
        response.raise_for_status()
        return response.json()

    def get_parts(self, did: str, wvm: str, wvmid: str, eid: str):
        """
        Retrieves part list/metadata for the active part studio.
        Useful to provide model semantics (part names) to the LLM.
        """
        path = f"/api/parts/d/{did}/{wvm}/{wvmid}/e/{eid}"
        url = self.base_url + path

        headers = {
            "Accept": ONSHAPE_V1_JSON,
            "Content-Type": JSON_CONTENT_TYPE
        }

        response = requests.get(
            url,
            auth=self.auth,
            headers=headers
        )
        response.raise_for_status()
        return response.json()

    def add_feature(self, did: str, wid: str, eid: str, feature_payload: dict):
        """
        Adds a new feature to the part studio to modify the model.
        Note: Modifications can only be made to a workspace ('w'), not a version or microversion.
        """
        path = f"/api/partstudios/d/{did}/w/{wid}/e/{eid}/features"
        url = self.base_url + path
        
        headers = {
            "Accept": ONSHAPE_V1_JSON,
            "Content-Type": JSON_CONTENT_TYPE
        }
        
        body = feature_payload if "feature" in feature_payload else {"feature": feature_payload}

        response = requests.post(
            url,
            auth=self.auth,
            headers=headers,
            json=body
        )
        response.raise_for_status()
        return response.json()

    def check_connectivity(self):
        """
        Lightweight credential and reachability check against Onshape.
        """
        url = f"{self.base_url}/api/users/sessioninfo"
        try:
            response = requests.get(url, auth=self.auth, timeout=8)
            if response.ok:
                return {"ok": True, "status_code": response.status_code}
            return {
                "ok": False,
                "status_code": response.status_code,
                "error": response.text[:300]
            }
        except requests.RequestException as exc:
            return {
                "ok": False,
                "status_code": None,
                "error": str(exc)
            }

onshape_client = OnshapeAPI()