"""Verify generated source/static ZIP entries and SHA-256 without extracting."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json

root = Path(__file__).resolve().parent.parent
reports = []
for name, source, prefix in [('AutoEllipso_V2.1.zip', root, 'AutoEllipso_V2.1/'), ('AutoEllipso_V2.1_static.zip', root/'dist', '')]:
    archive = root/name
    with ZipFile(archive) as zip_file:
        assert zip_file.testzip() is None
        names = zip_file.namelist()
        assert len(names) == len(set(names))
        for entry in names:
            assert entry.startswith(prefix)
            relative = entry[len(prefix):]
            assert not any(p in ['..', '.git', 'node_modules', '.qa', '.playwright', 'test-results'] for p in Path(relative).parts)
            assert not relative.endswith('.pem')
            assert zip_file.read(entry) == (source/relative).read_bytes(), relative
        if prefix:
            for required in ['src/solver/transferMatrix.ts', 'src/fitting/engine.ts', 'src/models/bspline.ts', 'pnpm-lock.yaml', '.github/workflows/ci.yml', '.env.example.txt']:
                assert prefix+required in names
        else:
            assert 'index.html' in names and '_headers' in names and 'version.json' in names
            assert any(p.startswith('assets/compute.worker-') and p.endswith('.js') for p in names)
        reports.append({'file': name, 'entriesVerified': len(names), 'allEntryBytesMatch': True, 'crcVerified': True, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
(root/'v21-zip-verification.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
print(json.dumps(reports, indent=2))
