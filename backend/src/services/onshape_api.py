import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from core.config import settings

class OnshapeAPI:
    def __init__(self):
        self.base_url = settings.ONSHAPE_BASE_URL
        self.access_key = settings.ONSHAPE_ACCESS_KEY
        self.secret_key = settings.ONSHAPE_SECRET_KEY

    def _sign_headers(self, method: str, url: str, content_type: str) -> dict[str, str]:
        nonce = secrets.token_hex(12)
        auth_date = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")

        parsed = urlparse(url)
        url_path = parsed.path
        url_query = parsed.query or ""

        signature_payload = (
            f"{method}\n{nonce}\n{auth_date}\n{content_type}\n{url_path}\n{url_query}\n"
        ).lower()

        digest = hmac.new(
            self.secret_key.encode("utf-8"),
            signature_payload.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        signature = base64.b64encode(digest).decode("utf-8")

        return {
            "Date": auth_date,
            "On-Nonce": nonce,
            "Authorization": f"On {self.access_key}:HmacSHA256:{signature}",
            "Accept": "application/json;charset=UTF-8; qs=0.09",
            "Content-Type": content_type,
        }

    def export_gltf(self, document_id: str, wvm: str, wvmid: str, element_id: str):
        path = f"/api/partstudios/d/{document_id}/{wvm}/{wvmid}/e/{element_id}/gltf"
        url = f"{self.base_url}{path}"
        headers = self._sign_headers("GET", url + "?rollbackBarIndex=-1", "application/json")
        headers["Accept"] = "model/gltf+json"
        
        response = requests.get(
            url,
            headers=headers,
            params={"rollbackBarIndex": -1},
            allow_redirects=False,
        )
        response.raise_for_status()
        return response.json()

    def execute_featurescript(self, did: str, wvm: str, wid: str, eid: str, script: str):
        path = f"/api/partstudios/d/{did}/{wvm}/{wid}/e/{eid}/featurescript"
        url = self.base_url + path
        
        payload = {"script": script, "queries": []}
        
        headers = self._sign_headers("POST", url, "application/json")
        headers["Accept"] = "application/vnd.onshape.v1+json"
        
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            allow_redirects=False,
        )
        response.raise_for_status()
        data = response.json()

        notices = data.get("notices", []) if isinstance(data, dict) else []
        errors: list[str] = []
        for notice in notices:
            message = notice.get("message") if isinstance(notice, dict) else None
            if not isinstance(message, dict):
                continue
            level = str(message.get("level", "")).upper()
            if level != "ERROR":
                continue
            text = message.get("message")
            if isinstance(text, str) and text.strip():
                errors.append(text.strip())

        if errors:
            raise RuntimeError(f"FeatureScript error: {errors[0]}")

        return data

    def add_cube_feature(self, did: str, wvm: str, wvmid: str, eid: str, size_mm: float):
        return self.add_primitive_feature(did, wvm, wvmid, eid, shape="box", size_mm=size_mm)

    def add_primitive_feature(self, did: str, wvm: str, wvmid: str, eid: str, shape: str, size_mm: float):
        path = f"/api/v9/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/features"
        url = self.base_url + path

        shape_norm = shape.lower().strip()
        if shape_norm in {"box", "cube"}:
            feature_type = "cube"
            parameter_id = "sideLength"
            expression = f"{max(0.1, float(size_mm))} mm"
            feature_name = "AgentFix Box"
        elif shape_norm in {"sphere", "ball"}:
            feature_type = "sphere"
            parameter_id = "radius"
            radius_mm = max(0.1, float(size_mm) * 0.5)
            expression = f"{radius_mm} mm"
            feature_name = "AgentFix Sphere"
        else:
            raise ValueError(f"Unsupported primitive shape: {shape}")

        payload = {
            "btType": "BTFeatureDefinitionCall-1406",
            "feature": {
                "btType": "BTMFeature-134",
                "featureType": feature_type,
                "name": feature_name,
                "parameters": [
                    {
                        "btType": "BTMParameterQuantity-147",
                        "isInteger": False,
                        "expression": expression,
                        "parameterId": parameter_id,
                    }
                ],
                "returnAfterSubfeatures": False,
                "suppressed": False,
            },
        }

        headers = self._sign_headers("POST", url, "application/json;charset=UTF-8; qs=0.09")

        response = requests.post(
            url,
            headers=headers,
            json=payload,
            allow_redirects=False,
        )
        response.raise_for_status()
        if response.text:
            return response.json()
        return {"status": "ok"}

    def add_transform_feature(
        self,
        did: str,
        wvm: str,
        wvmid: str,
        eid: str,
        source_feature_id: str,
        dx_mm: float,
        dy_mm: float,
        dz_mm: float,
    ):
        path = f"/api/v9/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/features"
        url = self.base_url + path

        query = f'query=qCreatedBy(makeId("{source_feature_id}"), EntityType.BODY);'
        payload = {
            "btType": "BTFeatureDefinitionCall-1406",
            "feature": {
                "btType": "BTMFeature-134",
                "featureType": "transform",
                "name": "AgentFix Transform",
                "parameters": [
                    {
                        "btType": "BTMParameterQueryList-148",
                        "parameterId": "entities",
                        "queries": [
                            {
                                "btType": "BTMIndividualQuery-138",
                                "queryString": query,
                            }
                        ],
                    },
                    {
                        "btType": "BTMParameterEnum-145",
                        "enumName": "TransformType",
                        "value": "TRANSLATION_3D",
                        "parameterId": "transformType",
                    },
                    {
                        "btType": "BTMParameterQuantity-147",
                        "isInteger": False,
                        "expression": f"{float(dx_mm)} mm",
                        "parameterId": "dx",
                    },
                    {
                        "btType": "BTMParameterQuantity-147",
                        "isInteger": False,
                        "expression": f"{float(dy_mm)} mm",
                        "parameterId": "dy",
                    },
                    {
                        "btType": "BTMParameterQuantity-147",
                        "isInteger": False,
                        "expression": f"{float(dz_mm)} mm",
                        "parameterId": "dz",
                    },
                    {
                        "btType": "BTMParameterBoolean-144",
                        "value": False,
                        "parameterId": "makeCopy",
                    },
                ],
                "returnAfterSubfeatures": False,
                "suppressed": False,
            },
        }

        headers = self._sign_headers("POST", url, "application/json;charset=UTF-8; qs=0.09")
        response = requests.post(url, headers=headers, json=payload, allow_redirects=False)
        response.raise_for_status()
        return response.json() if response.text else {"status": "ok"}

    def update_primitive_feature_size(
        self,
        did: str,
        wvmid: str,
        eid: str,
        feature_id: str,
        shape: str,
        size_mm: float,
    ):
        path = f"/api/v9/partstudios/d/{did}/w/{wvmid}/e/{eid}/features/featureid/{feature_id}"
        url = self.base_url + path

        shape_norm = shape.lower().strip()
        if shape_norm in {"box", "cube"}:
            feature_type = "cube"
            parameter_id = "sideLength"
            expression = f"{max(0.1, float(size_mm))} mm"
            feature_name = "AgentFix Box"
        elif shape_norm in {"sphere", "ball"}:
            feature_type = "sphere"
            parameter_id = "radius"
            radius_mm = max(0.1, float(size_mm) * 0.5)
            expression = f"{radius_mm} mm"
            feature_name = "AgentFix Sphere"
        else:
            raise ValueError(f"Unsupported primitive shape: {shape}")

        payload = {
            "btType": "BTFeatureDefinitionCall-1406",
            "feature": {
                "btType": "BTMFeature-134",
                "featureId": feature_id,
                "featureType": feature_type,
                "name": feature_name,
                "parameters": [
                    {
                        "btType": "BTMParameterQuantity-147",
                        "isInteger": False,
                        "expression": expression,
                        "parameterId": parameter_id,
                    }
                ],
                "returnAfterSubfeatures": False,
                "suppressed": False,
            },
        }

        headers = self._sign_headers("POST", url, "application/json;charset=UTF-8; qs=0.09")
        response = requests.post(url, headers=headers, json=payload, allow_redirects=False)
        response.raise_for_status()
        return response.json() if response.text else {"status": "ok"}

    def delete_feature(
        self,
        did: str,
        wvm: str,
        wvmid: str,
        eid: str,
        feature_id: str,
    ):
        path = f"/api/v9/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/features/featureid/{feature_id}"
        url = self.base_url + path
        headers = self._sign_headers("DELETE", url, "application/json;charset=UTF-8; qs=0.09")

        response = requests.delete(url, headers=headers, allow_redirects=False)
        response.raise_for_status()
        return response.json() if response.text else {"status": "ok"}

    def get_partstudio_bounding_box(self, did: str, wvm: str, wvmid: str, eid: str) -> dict:
        path = f"/api/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/boundingboxes"
        url = self.base_url + path
        headers = self._sign_headers("GET", url, "application/json")
        response = requests.get(url, headers=headers, timeout=30, allow_redirects=False)
        response.raise_for_status()
        return response.json() if response.text else {}

    def add_cube_at_position(
        self,
        did: str,
        wvm: str,
        wvmid: str,
        eid: str,
        size_mm: float,
        center_x_m: float,
        center_y_m: float,
        center_z_m: float,
        shape: str = "box",
    ):
        primitive_resp = self.add_primitive_feature(did, wvm, wvmid, eid, shape=shape, size_mm=size_mm)
        primitive_feature_id = (
            primitive_resp.get("feature", {}).get("featureId")
            if isinstance(primitive_resp, dict)
            else None
        )
        if not primitive_feature_id:
            raise RuntimeError("Primitive feature creation did not return a featureId")

        half_mm = float(size_mm) * 0.5
        target_mm = (
            float(center_x_m) * 1000.0,
            float(center_y_m) * 1000.0,
            float(center_z_m) * 1000.0,
        )
        dx_mm = target_mm[0]
        dy_mm = target_mm[1]
        dz_mm = target_mm[2]

        transform_resp = self.add_transform_feature(
            did,
            wvm,
            wvmid,
            eid,
            primitive_feature_id,
            dx_mm,
            dy_mm,
            dz_mm,
        )
        transform_feature_id = (
            transform_resp.get("feature", {}).get("featureId")
            if isinstance(transform_resp, dict)
            else None
        )
        return {
            "primitive": primitive_resp,
            "transform": transform_resp,
            "primitive_feature_id": primitive_feature_id,
            "transform_feature_id": transform_feature_id,
            "shape": shape,
            "size_mm": float(size_mm),
            "center_m": [float(center_x_m), float(center_y_m), float(center_z_m)],
        }

onshape_client = OnshapeAPI()