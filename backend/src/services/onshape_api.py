import os
import hmac
import hashlib
import base64
import urllib.parse
import requests
import string
import random
from datetime import datetime
from src.core.config import settings

class OnshapeAPI:
    def __init__(self):
        self.base_url = settings.ONSHAPE_BASE_URL
        self.access_key = settings.ONSHAPE_ACCESS_KEY
        self.secret_key = settings.ONSHAPE_SECRET_KEY

    def _make_nonce(self):
        chars = string.ascii_letters + string.digits
        return ''.join(random.choice(chars) for _ in range(25))

    def _make_auth_headers(self, method: str, path: str, query: str = ""):
        nonce = self._make_nonce()
        date = datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S GMT')
        
        # The Onshape HMAC signature requires specific formatting
        method = method.lower()
        path = urllib.parse.unquote(path)
        
        hmac_str = (method + '\n' + 
                    nonce + '\n' + 
                    date + '\n' + 
                    'application/json' + '\n' + 
                    path + '\n' + 
                    query + '\n').encode('utf-8')

        signature = base64.b64encode(
            hmac.new(self.secret_key.encode('utf-8'), hmac_str, digestmod=hashlib.sha256).digest()
        ).decode('utf-8')

        auth = 'On ' + self.access_key + ':HmacSHA256:' + signature

        return {
            'Content-Type': 'application/json',
            'Date': date,
            'On-Nonce': nonce,
            'Authorization': auth,
            'Accept': 'application/vnd.onshape.v1+json'
        }

    def export_gltf(self, did: str, wid: str, eid: str):
        """
        Export a Part Studio as a GLTF file.
        This is the best format for displaying in a React Three Fiber viewer.
        """
        path = f"/api/partstudios/d/{did}/w/{wid}/e/{eid}/gltf"
        url = self.base_url + path
        
        headers = self._make_auth_headers('GET', path)
        # For GLTF export, we might want to accept the specific format
        headers['Accept'] = 'application/vnd.onshape.v1+json'
        
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    def execute_featurescript(self, did: str, wid: str, eid: str, script: str):
        """
        Execute a custom FeatureScript in the context of a Part Studio.
        """
        path = f"/api/partstudios/d/{did}/w/{wid}/e/{eid}/featurescript"
        url = self.base_url + path
        
        payload = {
            "script": script,
            "queries": []
        }
        
        headers = self._make_auth_headers('POST', path)
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()

onshape_client = OnshapeAPI()
