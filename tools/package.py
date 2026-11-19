#!/usr/bin/env python3
"""Build the store packages: one zip per store, each with the manifest that store expects, then verify them.

  python3 tools/package.py            -> dist/apply-job-assistant-<version>-{chrome,edge,firefox}.zip
  python3 tools/package.py --check    -> build into a temp dir, verify, print the summary (used by CI)

Differences per store (one source tree, no build step):
  chrome / edge   MV3 service worker only ("background.scripts" and Firefox settings removed)
  firefox         background "scripts" only (Firefox runs MV3 background pages, not service workers),
                  browser_specific_settings.gecko: id, minimum version, data collection declaration
Only what the extension needs is packed: manifest.json, src/, icons/, LICENSE. Never tests, docs, video,
.github or dotfiles. Zips are reproducible (fixed timestamps, sorted entries).
"""
import json, os, re, sys, tempfile, zipfile, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE_DIRS = ['src', 'icons']
INCLUDE_FILES = ['LICENSE']
NEVER = re.compile(r'(^|/)(\.|tests/|docs/|video/|dist/|tools/|node_modules/)|\.(md|map|py|sh)$|(^|/)README')
GECKO_ID = 'apply-job-assistant@samberchmans-games.github.io'
MAX_MB = {'chrome': 128, 'edge': 128, 'firefox': 200, 'safari': 200}  # store limits are far above this; we warn at 10 MB
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def manifest_for(store, m):
    m = json.loads(json.dumps(m))
    bg = m.get('background', {})
    if store in ('chrome', 'edge'):
        m['background'] = {'service_worker': bg['service_worker']}
        m.pop('browser_specific_settings', None)
    elif store == 'safari':
        # Safari 16.4+ runs MV3 service workers; the Xcode converter reads this manifest (tools/safari.sh).
        m['background'] = {'service_worker': bg['service_worker']}
        m['browser_specific_settings'] = {'safari': {'strict_min_version': '16.4'}}
    elif store == 'firefox':
        m['background'] = {'scripts': bg['scripts']}
        m['browser_specific_settings'] = {'gecko': {
            'id': GECKO_ID,
            'strict_min_version': '121.0',
            # Nothing is sent to the developer. Text goes to an AI provider only when the user sets one up with
            # their own key and clicks an AI button (see docs/store/LISTING.md, "Data use").
            'data_collection_permissions': {'required': ['none']},
        }}
    return m


def files_to_pack():
    out = []
    for d in INCLUDE_DIRS:
        for base, _, names in os.walk(os.path.join(ROOT, d)):
            for n in names:
                rel = os.path.relpath(os.path.join(base, n), ROOT).replace(os.sep, '/')
                if not NEVER.search(rel):
                    out.append(rel)
    out += [f for f in INCLUDE_FILES if os.path.exists(os.path.join(ROOT, f))]
    return sorted(out)


def build(store, m, outdir):
    path = os.path.join(outdir, f"apply-job-assistant-{m['version']}-{store}.zip")
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        info = zipfile.ZipInfo('manifest.json', FIXED_TIME)
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, json.dumps(manifest_for(store, m), indent=2) + '\n')
        for rel in files_to_pack():
            info = zipfile.ZipInfo(rel, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(os.path.join(ROOT, rel), 'rb') as f:
                z.writestr(info, f.read())
    return path


def referenced(m, bgsrc):
    refs = set()
    bg = m.get('background', {})
    if bg.get('service_worker'):
        refs.add(bg['service_worker'])
    refs.update(bg.get('scripts', []))
    for cs in m.get('content_scripts', []):
        refs.update(cs.get('js', []) + cs.get('css', []))
    for k in ('options_ui', 'options_page'):
        v = m.get(k)
        refs.add(v['page'] if isinstance(v, dict) else v) if v else None
    act = m.get('action', {})
    if act.get('default_popup'):
        refs.add(act['default_popup'])
    refs.update((m.get('icons') or {}).values())
    refs.update((act.get('default_icon') or {}).values())
    refs.update('src/' + f for f in re.findall(r"'\.\./([^']+\.js)'", bgsrc))
    refs.update(re.findall(r"'(src/[^']+\.js)'", bgsrc))
    return {r for r in refs if r}


def html_refs(z, names):
    """Scripts / styles referenced by packed HTML pages must be packed too."""
    missing = []
    for n in names:
        if not n.endswith('.html'):
            continue
        html = z.read(n).decode('utf-8', 'replace')
        base = os.path.dirname(n)
        for ref in re.findall(r'<(?:script|link)[^>]+(?:src|href)="([^"#?]+)"', html):
            if re.match(r'^(https?:|data:|//)', ref):
                missing.append(f'{n}: remote resource {ref} (not allowed in MV3 packages)')
                continue
            p = os.path.normpath(os.path.join(base, ref)).replace(os.sep, '/')
            if p not in names:
                missing.append(f'{n}: {ref}')
    return missing


def verify(store, path, bgsrc):
    problems = []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        m = json.loads(z.read('manifest.json'))
        for r in sorted(referenced(m, bgsrc)):
            if r not in names:
                problems.append(f'missing file referenced by the manifest/background: {r}')
        problems += [f'missing file referenced by a page: {x}' for x in html_refs(z, names)]
        bad = [n for n in names if NEVER.search(n) and n != 'manifest.json']
        problems += [f'file that must not ship: {n}' for n in bad]
        bg = m.get('background', {})
        if store == 'firefox':
            if 'service_worker' in bg or not bg.get('scripts'):
                problems.append('firefox: background must be "scripts" only')
            g = m.get('browser_specific_settings', {}).get('gecko', {})
            if not g.get('id') or not g.get('data_collection_permissions'):
                problems.append('firefox: gecko id and data_collection_permissions required')
        elif store == 'safari':
            if set(bg) != {'service_worker'}:
                problems.append('safari: background must be "service_worker" only')
        else:
            if set(bg) != {'service_worker'}:
                problems.append(f'{store}: background must be "service_worker" only')
            if 'browser_specific_settings' in m:
                problems.append(f'{store}: browser_specific_settings must be removed')
        if len(m.get('description', '')) > 132:
            problems.append('description longer than 132 characters (Chrome Web Store limit)')
        size = os.path.getsize(path)
        if size > MAX_MB[store] * 1024 * 1024:
            problems.append(f'zip too large: {size} bytes')
        sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    return problems, len(names), size, sha


def unpack(store, outdir):
    """Write the store's files as a folder (for the Safari converter)."""
    m = json.load(open(os.path.join(ROOT, 'manifest.json')))
    dest = os.path.join(outdir, store)
    import shutil
    shutil.rmtree(dest, ignore_errors=True)
    for rel in files_to_pack():
        os.makedirs(os.path.dirname(os.path.join(dest, rel)), exist_ok=True)
        shutil.copyfile(os.path.join(ROOT, rel), os.path.join(dest, rel))
    with open(os.path.join(dest, 'manifest.json'), 'w') as f:
        json.dump(manifest_for(store, m), f, indent=2)
    return dest


def main():
    if '--unpack' in sys.argv:
        store = sys.argv[sys.argv.index('--unpack') + 1]
        print(unpack(store, os.path.join(ROOT, 'dist')))
        return
    check = '--check' in sys.argv
    m = json.load(open(os.path.join(ROOT, 'manifest.json')))
    bgsrc = open(os.path.join(ROOT, m['background']['service_worker'])).read()
    # The Firefox background list must load the same libraries the service worker imports.
    imported = ['src/' + f for f in re.findall(r"'\.\./([^']+\.js)'", bgsrc.split('importScripts(')[1].split(');')[0])]
    scripts = m['background'].get('scripts', [])
    missing_bg = [f for f in imported if f not in scripts]
    if missing_bg:
        sys.exit(f'background.scripts is missing libraries the service worker imports: {missing_bg}')
    outdir = tempfile.mkdtemp() if check else os.path.join(ROOT, 'dist')
    os.makedirs(outdir, exist_ok=True)
    failed = False
    for store in ('chrome', 'edge', 'firefox', 'safari'):
        path = build(store, m, outdir)
        problems, count, size, sha = verify(store, path, bgsrc)
        status = 'ok' if not problems else 'FAILED'
        print(f"{store:8s} {status:6s} {count:4d} files  {size / 1024 / 1024:5.2f} MB  {os.path.relpath(path, ROOT) if not check else os.path.basename(path)}  sha256 {sha[:16]}")
        if size > 10 * 1024 * 1024:
            print(f'         note: over 10 MB')
        for p in problems:
            print('         ' + p)
        failed |= bool(problems)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
