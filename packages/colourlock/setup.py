"""Bundles the repo's config/*.toml into a built (non-editable) colourlock as colourlock/_config.

An installed package can't see the repo, so a deployment that installs colourlock as a
dependency (Vercel installs it for the API from packages/colourlock) would otherwise have
no QC threshold or model revisions to read. config/ stays the single source: the copy is
made at build time, and colourlock.config.config_dir() prefers the repo's config/ whenever
it exists. Editable installs (local development) copy nothing.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from setuptools import setup
from setuptools.command.build_py import build_py

CONFIG = Path(__file__).resolve().parent.parent.parent / "config"


class BuildWithConfig(build_py):
    def run(self) -> None:
        super().run()
        if self.editable_mode or not CONFIG.is_dir():
            return
        out = Path(self.build_lib) / "colourlock" / "_config"
        out.mkdir(parents=True, exist_ok=True)
        for f in CONFIG.glob("*.toml"):
            shutil.copy2(f, out / f.name)


setup(cmdclass={"build_py": BuildWithConfig})
