Run the parity check between the `colourlock` package and the notebook manifest.

1. Run `make parity` (or `pytest packages/colourlock/tests/parity -m slow -q`).
2. If it fails, report the first 10 mismatching image ids, the metric, the notebook value, the package value and the absolute difference.
3. Find the cause by comparing the package function with the matching notebook cell. Do not change tolerances to make the test pass.
4. Propose a fix. If the notebook itself is the thing in question, stop and ask.
