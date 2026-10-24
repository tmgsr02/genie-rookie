#!/usr/bin/env python3
"""Build an allowlisted, self-contained Xcode judge ZIP from staged dependencies.

Operator command: .venv/bin/python scripts/package_geniusrookie_judge.py --check-only
Then omit --check-only to create the ZIP. No downloads, compilation or credentials
are performed by this script. Judges use Xcode and its system Python only.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    'GeniusRookie.xcodeproj', 'apps/GeniusRookie/src',
    'apps/GeniusRookie/app.json', 'apps/GeniusRookie/THIRD_PARTY_NOTICES.md',
    'Vendor/Python.xcframework', '.build/python-packages', '.build/pipecat-ai',
    '.build/mobile-package-manifest.json',
    '.build/rust/aarch64-apple-ios/release/libphonon_ffi.a',
    '.build/rust/aarch64-apple-ios/release/lib_pydantic_core.dylib',
    '.build/rust/aarch64-apple-ios-sim/release/libphonon_ffi.a',
    '.build/rust/aarch64-apple-ios-sim/release/lib_pydantic_core.dylib',
    'models/audience', 'models/phonon/config.json', 'models/phonon/model.q8.gguf',
    'models/phonon/tokenizer.json', 'apps/GeniusRookie/src/voices',
    'native/phonon-ffi/include', 'patches/pipecat-ai-1.12.0.patch',
    'scripts/bundle_runtime.py', 'scripts/build_native.py', 'scripts/stage_python.py',
    'scripts/audience_package.py', 'scripts/phonon_package.py', 'scripts/pipecat_package.py',
    'scripts/judge_pipecat_manifest.py', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
)
OPTIONAL = ('Vendor/Python.xcframework/LICENSE', 'models/README.txt')
DENIED = {'.git', '.venv', 'node_modules', '__pycache__', 'xcuserdata', '.DS_Store',
          '.wrangler', '.ssh', '.aws', '.npmrc', '.pypirc', 'credentials', 'secrets'}
TEXT_SUFFIXES = {'.swift','.py','.json','.plist','.pbxproj','.md','.txt','.xml','.sh','.h','.m','.toml','.yaml','.yml'}
CREDENTIAL = re.compile(rb'(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')


def denied(path):
    return any(part in DENIED or part == '.env' or part.startswith('.env.')
               or part.endswith(('.pyc','.p12','.pfx','.mobileprovision','.xcuserstate'))
               for part in path.parts)


def collect_files(root, required=REQUIRED, optional=OPTIONAL):
    root = root.resolve()
    result = set()
    for relative in (*required, *optional):
        source = root / relative
        if not source.exists():
            if relative in required:
                raise ValueError('Missing judge build input: ' + relative)
            continue
        candidates = sorted(source.rglob('*')) if source.is_dir() else [source]
        boundary = source.resolve() if source.is_dir() else source.parent.resolve()
        for path in candidates:
            rel = path.relative_to(root)
            if denied(rel):
                continue
            if path.is_symlink() and not path.resolve().is_relative_to(boundary):
                raise ValueError('Unsafe symlink in judge inputs: ' + str(rel))
            if path.is_file():
                result.add(path)
    return sorted(result)


def audit_text(path):
    if path.suffix in TEXT_SUFFIXES or path.name in {'LICENSE','METADATA','RECORD'}:
        if CREDENTIAL.search(path.read_bytes()):
            # Report a location only; never echo a matched credential.
            raise ValueError('Possible embedded credential in judge input: ' + path.name)


def prepare(root):
    from bundle_runtime import validate_staged_packages, pipecat_modules
    from judge_pipecat_manifest import build_manifest
    from phonon_package import validate_phonon
    from audience_package import validate_audience
    from pipecat_package import validate_pipecat
    from generate_project import service_plist_entries

    validate_staged_packages(root=root)
    validate_phonon(root)
    validate_audience(root)
    source = validate_pipecat(root)
    config = json.loads((root/'apps/GeniusRookie/app.json').read_text())
    service_plist_entries(config, require_hosted=True)
    if config.get('services',{}).get('managed_access') is not True:
        raise ValueError('Judge package requires managed access.')
    project = (root/'GeniusRookie.xcodeproj/project.pbxproj').read_text()
    if '/usr/bin/python3' not in project or 'judge-pipecat-modules.json' not in project:
        raise ValueError('Regenerate GeniusRookie.xcodeproj with the judge build-phase fallback.')
    files = collect_files(root)
    for path in files:
        audit_text(path)
    app = root/'apps/GeniusRookie/src/python'
    pipecat = source/'pipecat'
    try:
        modules = pipecat_modules(app,pipecat)
    except SyntaxError as error:
        raise ValueError('Package preparation needs the existing modern .venv Python; judges do not.') from error
    dependency_manifest = build_manifest(app,pipecat,modules)
    return files, dependency_manifest


JUDGE_README = '''# Genie & Rookie — prepared Xcode package

Open GeniusRookie.xcodeproj at this folder's root, select GeniusRookie, choose
an iOS 27 Simulator or supported device, and Build/Run. Use an Apple-silicon Mac,
macOS 27 and Xcode 27. Select your own signing team for a physical device.

All staged Python, native device/simulator libraries, models and app assets are
included. Do not run setup.py, uv, cargo, download models, or create a .venv.
The build uses Xcode's /usr/bin/python3 with a precomputed validated dependency
manifest; the app embeds its own CPython 3.13. Xcode may compile the included
Core ML models as part of its ordinary build. Keep the hidden .build directory.

Tutoring and Boson use the bundled HTTPS Cloudflare service with automatic,
short-lived access. No service URL, token, login, provider key or local server
is required. An internet connection is needed for tutoring and Boson speech.
Use text input in Simulator; microphone recognition requires a supported device.

The shared demo has daily capacity limits. Xcode compilation, signing and
physical-device audio remain separate from backend readiness.

THIRD_PARTY_NOTICES.md and apps/GeniusRookie/THIRD_PARTY_NOTICES.md retain the
runtime/model notices. The existing Angel_F01 and Devil_01 custom Phonon voices
remain subject to the upstream Gradium terms; redistribution permission for
those exact assets has not been independently established. This package is not
an assertion of public-release or App Store clearance. The operator must retain
that unresolved review item; packaging does not accept new license terms.

JUDGE-PACKAGE-MANIFEST.json records input sizes and SHA-256 hashes. This package
contains no backend source, .env, developer .venv, account config, provisioning
profiles or signing private keys. It is a prepared package, not a source-only
checkout; source-only checkouts still require upstream dependency setup.
'''


def create_archive(root, output, files, dependency_manifest):
    output.parent.mkdir(parents=True,exist_ok=True)
    manifest = {'version':1,'app':'GeniusRookie','redistribution_review':'custom_phonon_voices_unresolved',
                'files':{path.relative_to(root).as_posix():{'bytes':path.stat().st_size,
                         'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in files}}
    descriptor, temporary = tempfile.mkstemp(prefix=output.name+'.',suffix='.partial',dir=output.parent)
    os.close(descriptor)
    try:
        with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
            for path in files:
                # Symlinks inside the allowlisted framework are materialized; none
                # can resolve into credential files or outside that selected tree.
                name='GenieRookieJudge/'+path.relative_to(root).as_posix()
                archive.write(path,name)
            archive.writestr('GenieRookieJudge/.build/judge-pipecat-modules.json',json.dumps(dependency_manifest,sort_keys=True))
            archive.writestr('GenieRookieJudge/JUDGE-README.md',JUDGE_README)
            archive.writestr('GenieRookieJudge/JUDGE-PACKAGE-MANIFEST.json',json.dumps(manifest,indent=2,sort_keys=True))
        os.replace(temporary,output)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only',action='store_true')
    parser.add_argument('--output',type=Path,default=ROOT/'.build/judge/GenieRookieJudge.zip')
    args=parser.parse_args()
    try:
        files, manifest=prepare(ROOT)
        summary={'files':len(files),'input_bytes':sum(path.stat().st_size for path in files),
                 'pipecat_modules':len(manifest['modules']),
                 'redistribution_review':'custom_phonon_voices_unresolved'}
        if not args.check_only:
            create_archive(ROOT,args.output,files,manifest)
            summary.update(output=str(args.output),zip_bytes=args.output.stat().st_size)
        print(json.dumps(summary,indent=2))
    except (ValueError,RuntimeError) as error:
        parser.exit(1,str(error)+'\n')

if __name__=='__main__':main()
