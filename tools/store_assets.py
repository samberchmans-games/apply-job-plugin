#!/usr/bin/env python3
"""Store screenshots and promo images, rendered from the real extension pages (the video scenes, without captions).

  python3 tools/store_assets.py   -> docs/store/screenshots/*.png (1280x800) + promo tiles (440x280, 1400x560)

Uses the same scene pages, sample data and headless Chrome as video/build.py.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'video'))
import build  # noqa: E402  (video/build.py: scene_html, serve, CHROME, PORT)
from parts import PARTS  # noqa: E402

OUT = os.path.join(ROOT, 'docs', 'store', 'screenshots')
SHOTS = [  # (part, step, file name, caption for the listing)
    (2, 3, '1-match-and-gaps', 'Match % and skill gaps on any job post'),
    (2, 5, '2-experience-level', 'Years of experience, level and similar skills'),
    (3, 3, '3-tailoring-evidence', 'Honest resume tailoring: every change backed by your resume'),
    (4, 2, '4-autofill', 'Autofill from your profile; you review and submit'),
    (4, 10, '5-applications', 'Track every application, with follow-up reminders'),
    (6, 3, '6-career-tracks', 'One score per career track; the best fit is starred'),
]


def shoot(rel, png, w, h, budget):
    subprocess.run([build.CHROME, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
                    f'--user-data-dir={os.path.join(build.BUILD, "chrome-profile")}', f'--window-size={w},{h}',
                    '--force-device-scale-factor=1', f'--virtual-time-budget={budget}', f'--screenshot={png}',
                    f'http://127.0.0.1:{build.PORT}/{rel}'], capture_output=True, timeout=120)


PROMO = '''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}}
.w{{display:flex;align-items:center;gap:{gap}px;width:{W}px;height:{H}px;padding:0 {pad}px;box-sizing:border-box;overflow:hidden}}
img{{width:{icon}px;height:{icon}px;border-radius:{rad}px;background:#fff;flex:none}} .w>div{{flex:1;min-width:0}} h1{{font-size:{h1}px;margin:0 0 {mb}px}} p{{font-size:{p}px;margin:0;opacity:.9;line-height:1.35}}
</style></head><body><div class="w"><img src="/icons/icon-128.png"><div><h1>Apply Job Assistant</h1><p>{tag}</p></div></div></body></html>'''


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(build.BUILD, exist_ok=True)
    srv = build.serve()
    try:
        for part, step, name, caption in SHOTS:
            sc = PARTS[part - 1]['scenes'][step - 1]
            cfg = {k: sc[k] for k in ('actions', 'seed', 'settle', 'wdPage', 'atsSite') if k in sc}  # no caption/highlight
            rel = f'video/build/store-{name}.html'
            with open(os.path.join(ROOT, rel), 'w') as f:
                f.write(build.scene_html(sc['kind'], cfg))
            if sc.get('hash'):
                rel += '#' + sc['hash']
            png = os.path.join(OUT, name + '.png')
            shoot(rel, png, 1280, 800, sc.get('budget', 6000))
            print('screenshot', os.path.relpath(png, ROOT), '-', caption)
        for name, (w, h), style in [
            ('promo-small-440x280', (440, 280), dict(gap=16, pad=22, icon=72, rad=16, h1=26, mb=6, p=14, tag='Match %, honest tailoring, autofill. Your data stays on your computer.')),
            ('promo-marquee-1400x560', (1400, 560), dict(gap=48, pad=110, icon=200, rad=40, h1=72, mb=16, p=32, tag='Match % and skill gaps for any job post, honest resume tailoring, and autofill that learns. Free AI options; all data stays on your computer.')),
        ]:
            rel = f'video/build/store-{name}.html'
            with open(os.path.join(ROOT, rel), 'w') as f:
                f.write(PROMO.format(W=w, H=h, **style))
            png = os.path.join(OUT, name + '.png')
            shoot(rel, png, w, h, 1500)
            print('promo', os.path.relpath(png, ROOT))
    finally:
        srv.shutdown()


if __name__ == '__main__':
    main()
