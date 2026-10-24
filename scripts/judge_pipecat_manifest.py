"""Validated offline import closure for Xcode's older, stdlib-only host Python.

The embedded app still runs CPython 3.13. This avoids parsing Pipecat's newer
Python syntax with the Python 3.9 interpreter supplied by Xcode.
"""
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def app_sources(app):
    return {path.relative_to(app).as_posix(): digest(path)
            for path in sorted(app.rglob('*.py')) if '__pycache__' not in path.parts}


def build_manifest(app, pipecat, modules):
    return {'version': 1, 'app': 'GeniusRookie', 'sources': app_sources(app),
            'modules': {path.relative_to(pipecat).as_posix(): digest(path)
                        for path in sorted(modules)}}


def load_manifest(path, app, pipecat):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise RuntimeError('Invalid judge dependency manifest; rebuild the judge package.') from error
    if value.get('version') != 1 or value.get('app') != 'GeniusRookie':
        raise RuntimeError('Invalid judge dependency manifest; rebuild the judge package.')
    if value.get('sources') != app_sources(app):
        raise RuntimeError('App Python source changed; rebuild the judge dependency manifest.')
    recorded = value.get('modules')
    if not isinstance(recorded, dict) or not recorded:
        raise RuntimeError('Empty judge dependency manifest; rebuild the judge package.')
    result = set()
    for name, expected in recorded.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or relative.suffix != '.py':
            raise RuntimeError('Invalid judge dependency path.')
        module = pipecat / relative
        if not module.resolve().is_relative_to(pipecat.resolve()):
            raise RuntimeError('Invalid judge dependency path.')
        if not module.is_file() or digest(module) != expected:
            raise RuntimeError('Pipecat Python source changed; rebuild the judge dependency manifest.')
        result.add(module)
    return result
