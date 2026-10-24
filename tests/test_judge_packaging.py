"""The judge bundle carries staged inputs, never developer state or credentials."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import package_geniusrookie_judge as package
from judge_pipecat_manifest import build_manifest, load_manifest

class JudgePackageTests(unittest.TestCase):
    def test_allowlist_excludes_secrets_caches_and_xcode_user_state(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            for name in ['app/source.swift','app/.env','app/__pycache__/x.pyc','app/xcuserdata/user.plist','unrelated/secret.txt']:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('example')
            result=package.collect_files(root,required=('app',),optional=())
            self.assertEqual([str(p.relative_to(root)) for p in result],['app/source.swift'])

    def test_symlink_cannot_smuggle_a_file_outside_its_allowlisted_tree(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();(root/'app').mkdir();(root/'secret').write_text('private')
            (root/'app/link').symlink_to(root/'secret')
            with self.assertRaisesRegex(ValueError,'symlink'):
                package.collect_files(root,required=('app',),optional=())

    def test_missing_inputs_and_embedded_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            with self.assertRaisesRegex(ValueError,'Missing'):
                package.collect_files(root,required=('missing',),optional=())
            source=root/'source.swift';source.write_text('let key = "sk-proj-'+'a'*40+'"')
            with self.assertRaisesRegex(ValueError,'credential'):
                package.audit_text(source)

    def test_archive_contains_only_selected_inputs_and_generated_handoff_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();source=root/'app.py';source.write_text('print("ok")\n')
            (root/'.env').write_text('SECRET=never-package-me')
            output=root/'judge.zip'
            package.create_archive(root,output,[source],{'version':1})
            with zipfile.ZipFile(output) as archive:
                names=set(archive.namelist())
                self.assertEqual(names,{'GenieRookieJudge/app.py','GenieRookieJudge/.build/judge-pipecat-modules.json','GenieRookieJudge/JUDGE-README.md','GenieRookieJudge/JUDGE-PACKAGE-MANIFEST.json'})
                self.assertNotIn(b'never-package-me',b''.join(archive.read(name) for name in names))

    def test_precomputed_module_manifest_rejects_source_changes_and_path_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();app=root/'app';pipecat=root/'pipecat';app.mkdir();pipecat.mkdir()
            (app/'main.py').write_text('import pipecat\n');module=pipecat/'__init__.py';module.write_text('match x:\n    case 1: pass\n')
            data=build_manifest(app,pipecat,{module});manifest=root/'manifest.json';manifest.write_text(json.dumps(data))
            self.assertEqual(load_manifest(manifest,app,pipecat),{module})
            (app/'main.py').write_text('import changed\n')
            with self.assertRaisesRegex(RuntimeError,'changed'):
                load_manifest(manifest,app,pipecat)
            (app/'main.py').write_text('import pipecat\n');data['modules']['../secret.py']='abc';manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(RuntimeError,'path'):
                load_manifest(manifest,app,pipecat)

if __name__=='__main__':unittest.main()
