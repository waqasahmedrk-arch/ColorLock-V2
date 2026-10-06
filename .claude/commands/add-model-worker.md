Work on the GPU worker: $ARGUMENTS

Before any change, re-read `claude/architecture.md` §4 and `claude/decisions.md` (D-06, D-07, D-10, D-11).
Check the change against these rules:
- `from_pretrained` always has `revision=` from `config/models.toml`
- one pipeline per process; no forking per job
- the startup checks stay in place (import smoke, auth_check, revision, warm-up)
- the generation parameters still match specs.md §4, or the result is marked `off_study`
- the image is scored from the same PNG bytes that are uploaded
- no token in logs or images
