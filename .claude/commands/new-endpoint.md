Add a new API endpoint: $ARGUMENTS

1. Read `claude/specs.md` §7 and `claude/architecture.md` first. If the endpoint isn't in specs.md, add it there before writing code.
2. Create the Pydantic schemas in `backend/api/app/schemas/`, the router in `backend/api/app/routers/`, and any logic in `services/`.
3. Metric computation must call the `colourlock` package; never reimplement a metric in the API.
4. Add tests with `httpx.AsyncClient`; use the mock generator backend where generation is involved.
5. Use problem+json errors, and don't log secrets.
