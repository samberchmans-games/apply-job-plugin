#!/usr/bin/env python3
"""Quick tester walkthrough videos: real extension screens (headless Chrome) + captions + macOS voice-over.

  python3 video/build.py            # all parts -> video/out/part-N-*.mp4
  python3 video/build.py 3          # one part

Needs: Google Chrome, ffmpeg, macOS `say`. Scenes run the REAL extension pages with the test browser mock.
"""
import json, os, re, subprocess, sys, time, shutil, threading, http.server, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'video', 'build')
OUT = os.path.join(ROOT, 'video', 'out')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
VOICE = os.environ.get('VOICE', 'Samantha')
PORT = 8790

sys.path.insert(0, os.path.join(ROOT, 'video'))
from parts import PARTS  # noqa: E402

LIBS = ['core', 'logger', 'errors', 'storage', 'skills-dictionary', 'matcher', 'ai', 'docx', 'tracker', 'resume-engine', 'diagnostics']
CONTENT = ['jd-extractor.js', 'form-filler.js', 'apply-detector.js', 'panel.js', 'content.js']


def scene_html(kind, cfg):
    cfg_js = '<script>window.__SCENE__=%s</script>' % json.dumps(cfg)
    stage = '<script src="/video/stage.js"></script>'
    mock = '<script src="/tests/mocks/browser-mock.js"></script>'
    if kind == 'admin':
        html = open(os.path.join(ROOT, 'src/admin/admin.html')).read()
        html = html.replace('<head>', '<head><base href="/src/admin/">' + cfg_js, 1)
        html = html.replace('<script src="../lib/core.js"></script>', mock + stage + '<script src="../lib/core.js"></script>', 1)
        html = html.replace('<script src="tracker-view.js"></script>', '<script src="../background/background.js"></script>\n<script src="tracker-view.js"></script>', 1)
        return html
    if kind == 'popup':
        html = open(os.path.join(ROOT, 'src/popup/popup.html')).read()
        html = html.replace('<head>', '<head><base href="/src/popup/">' + cfg_js + '<style>html{background:#e2e8f0;min-height:100vh}body{margin:90px auto!important;zoom:2;box-shadow:0 10px 40px rgba(0,0,0,.25);border-radius:10px}</style>', 1)
        html = html.replace('<script src="../lib/core.js"></script>', mock + stage + '<script src="../lib/core.js"></script>', 1)
        return html
    if kind == 'job':
        body = open(os.path.join(ROOT, 'tests/fixtures/sample-job.html')).read()
        head, rest = body.split('</head>', 1)
        libs = ''.join('<script src="/src/lib/%s.js"></script>' % l for l in LIBS)
        content = ''.join('<script src="/src/content/%s"></script>' % c for c in CONTENT)
        scripts = mock + stage + libs + '<script src="/src/background/background.js"></script>' + content
        head = head.replace('<head>', '<head>' + cfg_js, 1)
        rest = rest.replace('<p>Local test page:', '<p hidden>Local test page:')
        return head + scripts + '</head>' + rest
    if kind == 'card':
        items = ''.join('<li>%s</li>' % i for i in cfg.get('items', []))
        return f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
.w{{display:flex;flex-direction:column;justify-content:center;height:100%;padding:0 120px;box-sizing:border-box}}
.k{{font-size:26px;opacity:.85;letter-spacing:.06em;text-transform:uppercase}} h1{{font-size:68px;margin:14px 0 18px}}
p{{font-size:30px;opacity:.9;max-width:1300px;line-height:1.4}} ol{{font-size:30px;line-height:1.7;max-width:1400px}}
</style></head><body><div class="w"><div class="k">{cfg.get("kicker","")}</div><h1>{cfg["title"]}</h1>
<p>{cfg.get("text","")}</p><ol>{items}</ol></div></body></html>'''
    raise ValueError(kind)


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    class Quiet(handler.func):
        def log_message(self, *a):
            pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()
    http.server.ThreadingHTTPServer.request_queue_size = 128
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def shoot(rel_html, png, budget):
    prof = os.path.join(BUILD, 'chrome-profile')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', f'--user-data-dir={prof}',
                    '--window-size=1600,900', '--force-device-scale-factor=1.2', f'--virtual-time-budget={budget}',
                    f'--screenshot={png}', f'http://127.0.0.1:{PORT}/{rel_html}'], capture_output=True, timeout=120)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def build_part(n, part):
    slug = f"part-{n}-{re.sub(r'[^a-z0-9]+', '-', part['title'].lower()).strip('-')}"
    d = os.path.join(BUILD, slug)
    os.makedirs(d, exist_ok=True)
    scenes = part['scenes']
    clips = []
    for i, sc in enumerate(scenes, 1):
        cfg = dict(sc.get('cfg', {}))
        cfg.update(part=n, partTitle=part['title'], step=i, total=len(scenes))
        for k in ('caption', 'check', 'highlight', 'actions', 'seed', 'settle'):
            if k in sc:
                cfg[k] = sc[k]
        rel = f"video/build/{slug}/s{i}.html"
        with open(os.path.join(ROOT, rel), 'w') as f:
            f.write(scene_html(sc['kind'], cfg if sc['kind'] != 'card' else sc))
        if sc['kind'] != 'card' and sc.get('hash'):
            rel += '#' + sc['hash']
        png = os.path.join(d, f's{i}.png')
        shoot(rel, png, sc.get('budget', 6000))
        aiff = os.path.join(d, f's{i}.aiff')
        subprocess.run(['say', '-v', VOICE, '-r', '178', '-o', aiff, sc['say']], check=True)
        dur = duration(aiff) + 0.9
        clip = os.path.join(d, f's{i}.mp4')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-t', f'{dur:.2f}', '-i', png, '-i', aiff,
                        '-vf', f'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,fade=in:0:d=0.25,fade=out:st={dur-0.25:.2f}:d=0.25,format=yuv420p',
                        '-af', 'adelay=300|300,apad', '-t', f'{dur:.2f}', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
                        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', clip], check=True)
        clips.append(clip)
        print(f'  scene {i}/{len(scenes)} ({dur:.1f}s)', flush=True)
    listf = os.path.join(d, 'list.txt')
    with open(listf, 'w') as f:
        f.writelines(f"file '{c}'\n" for c in clips)
    os.makedirs(OUT, exist_ok=True)
    mp4 = os.path.join(OUT, slug + '.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listf, '-c', 'copy', '-movflags', '+faststart', mp4], check=True)
    print(f'{mp4}  ({duration(mp4):.0f}s)', flush=True)
    return mp4


def main():
    for tool in ('ffmpeg', 'ffprobe', 'say'):
        if not shutil.which(tool):
            sys.exit(f'{tool} not found')
    os.makedirs(BUILD, exist_ok=True)
    srv = serve()
    only = [int(a) for a in sys.argv[1:]]
    try:
        for n, part in enumerate(PARTS, 1):
            if not only or n in only:
                print(f"Part {n}: {part['title']}", flush=True)
                build_part(n, part)
    finally:
        srv.shutdown()


if __name__ == '__main__':
    main()
