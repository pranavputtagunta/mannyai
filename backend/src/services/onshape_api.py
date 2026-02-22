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

    def execute_featurescript(self, did: str, wvm: str, wvmid: str, eid: str, script: str, variables: dict | None = None):
        path = f"/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/featurescript"
        url = self.base_url + path

        payload = {
            "script": script,
            "queries": [],
            "variables": variables or {}
        }

        headers = self._make_auth_headers("POST", path, content_type="application/json")
        headers["Accept"] = "application/vnd.onshape.v1+json"

        resp = requests.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()

    def get_parts_in_element(self, did: str, wvm: str, wvmid: str, eid: str):
        path = f"/api/parts/d/{did}/{wvm}/{wvmid}/e/{eid}"
        url = self.base_url + path
        headers = self._make_auth_headers("GET", path, content_type="")
        headers["Accept"] = "application/json"
        r = requests.get(url, headers=headers)
        r.raise_for_status()
        return r.json()

    def export_part_gltf_face_nodes(
        self,
        did: str,
        wvm: str,
        wvmid: str,
        eid: str,
        partid: str,
        *,
        angle_tolerance: float = 0.35,
        chord_tolerance: float = 0.2,
        max_facet_width: float = 0.0,
        output_face_appearances: bool = True,
        output_separate_face_nodes: bool = True,
    ):
        path = f"/api/parts/d/{did}/{wvm}/{wvmid}/e/{eid}/partid/{partid}/gltf"
        url = self.base_url + path

        # These are query params supported by the part glTF export. :contentReference[oaicite:2]{index=2}
        params = {
            "angleTolerance": angle_tolerance,
            "chordTolerance": chord_tolerance,
            "maxFacetWidth": max_facet_width,
            "outputFaceAppearances": str(output_face_appearances).lower(),
            "outputSeparateFaceNodes": str(output_separate_face_nodes).lower(),
        }

        query = urllib.parse.urlencode(params)
        headers = self._make_auth_headers("GET", path, query=query, content_type="")
        headers["Accept"] = "model/gltf+json"

        r = requests.get(url, headers=headers, params=params)
        r.raise_for_status()
        return r.json()
    
onshape_client = OnshapeAPI()