# mannyai

## Backend model-edit setup (native features)

This app lets users modify a Part Studio by URL only, while the backend appends native Onshape features via `POST /features`.

Required backend env vars in `.env`:

- `ONSHAPE_ACCESS_KEY`
- `ONSHAPE_SECRET_KEY`
- `ONSHAPE_BASE_URL` (default `https://cad.onshape.com`)
- `GEMINI_API_KEY`

No `ONSHAPE_SOURCE_*` variables are required in this mode.
The frontend user only provides the target Part Studio link.
