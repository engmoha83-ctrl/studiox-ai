"""
End-to-end test of the real StudioX AI desktop application (Tauri + WebKitGTK)
driven through tauri-driver / WebDriver.

  Xvfb :99 &  DISPLAY=:99 tauri-driver &  python3 tests/app/e2e_app.py

Covers: project creation, media import (+ automatic proxy), timeline editing
(add, split, undo/redo, trim, move, ripple delete), Arabic text, transitions,
playback, real FFmpeg export (verified with ffprobe + frame grabs),
save/reopen, missing-media relink detection, Arabic RTL UI.
"""
import json
import threading, os, shutil, subprocess, sys, time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.options import ArgOptions

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP = os.environ.get("STUDIOX_APP", os.path.join(ROOT, "src-tauri/target/debug/studiox-ai"))
MEDIA = os.environ.get("SX_MEDIA", "/tmp/sx-media")
OUT = os.environ.get("SX_OUT", "/tmp/sx-e2e")
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    return cond


def shot(d, name):
    d.save_screenshot(os.path.join(OUT, name + ".png"))


def wait(fn, timeout=30, interval=0.25):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception as e:  # noqa
            last = e
        time.sleep(interval)
    return None


def js(d, code, *args):
    return d.execute_script(code, *args)


def xclick(d, text, tag="button"):
    el = wait(lambda: [e for e in d.find_elements(By.XPATH, f"//{tag}[contains(normalize-space(.), '{text}')]") if e.is_displayed()], 15)
    if not el:
        raise RuntimeError(f"element with text {text!r} not found")
    el[0].click()
    return el[0]


def project(d):
    return js(d, "return window.__studiox && window.__studiox.project()")


def clip_count(d):
    p = project(d)
    return len(p["clips"]) if p else -1


MODS = {Keys.CONTROL, Keys.SHIFT, Keys.ALT}


def press(d, *keys):
    """Send a key or a modifier combination (modifiers are pressed and released explicitly)."""
    mods = [k for k in keys if k in MODS]
    rest = [k for k in keys if k not in MODS]
    a = ActionChains(d)
    for m in mods:
        a.key_down(m)
    a.send_keys(*rest)
    for m in reversed(mods):
        a.key_up(m)
    a.perform()
    time.sleep(0.35)


class FakeOllama(threading.Thread):
    """Minimal stand-in for a local Ollama server (127.0.0.1:11434) – checks the app's request/response path."""
    requests = []

    def run(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer

        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, obj):
                body = json.dumps(obj).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                self.reply({"models": [{"name": "mock-llm"}]})

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append(req)
                ops_ = {"operations": [{"op": "color", "preset": "warm"}, {"op": "format_disk"}]}
                self.reply({"message": {"role": "assistant", "content": json.dumps(ops_)}})

        self.server = HTTPServer(("127.0.0.1", 11434), H)
        self.server.serve_forever()


def main():
    caps = ArgOptions()
    caps.set_capability("tauri:options", {"application": APP})
    caps.set_capability("browserName", "wry")
    d = webdriver.Remote(command_executor="http://127.0.0.1:4444", options=caps)
    d.set_window_size(1600, 1000)
    try:
        run(d)
    finally:
        try:
            shot(d, "zz-final")
        except Exception:
            pass
        d.quit()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    with open(os.path.join(OUT, "results.json"), "w") as f:
        json.dump([{"name": n, "pass": p, "detail": de} for n, p, de in results], f, indent=1, ensure_ascii=False)
    sys.exit(1 if failed else 0)


def run(d):
    # ---------------------------------------------------------------- M1: home + project
    wait(lambda: d.find_element(By.XPATH, "//*[contains(text(),'STUDIOX')]"), 30)
    js(d, "localStorage.setItem('studiox:e2e','1'); location.reload();")
    wait(lambda: js(d, "return !!window.__studiox"), 30)
    check("app boots and shows home screen", wait(lambda: d.find_elements(By.XPATH, "//*[contains(text(),'New project')]"), 20))
    shot(d, "01-home")
    xclick(d, "New project")
    name_in = wait(lambda: d.find_element(By.CSS_SELECTOR, ".fixed input[dir=auto]"))
    js(d, "arguments[0].select()", name_in)
    name_in.send_keys("E2E مشروع اختبار")
    xclick(d, "Create project")
    check("project created and editor opened", wait(lambda: project(d), 20))
    shot(d, "02-editor-empty")

    # ---------------------------------------------------------------- import
    files = [os.path.join(MEDIA, f) for f in ["clip_a.mp4", "clip_b.mp4", "prores.mov", "voice.wav", "music.mp3", "logo.png"]]
    js(d, "return window.__studiox.importFiles(arguments[0])", files)
    ok = wait(lambda: len(project(d)["media"]) == 6, 30)
    check("6 media files imported with metadata", ok, str([(m["name"], m["kind"], round(m["duration"], 2), m["width"]) for m in project(d)["media"]]))
    ok = wait(lambda: all(m.get("thumbnail") for m in project(d)["media"]), 60)
    check("thumbnails generated for every asset", ok)
    prores = lambda: next(m for m in project(d)["media"] if m["name"] == "prores.mov")
    check("ProRes media flagged for proxy", prores().get("proxyState") in ("pending", "ready"), prores().get("proxyState"))
    ok = wait(lambda: prores().get("proxyState") == "ready", 120)
    check("proxy generated for ProRes", ok, str(prores().get("proxyPath")))
    js(d, "return window.__studiox.importFiles(arguments[0])", [files[0]])
    time.sleep(1)
    check("duplicate import is detected (no second copy)", len(project(d)["media"]) == 6)
    shot(d, "03-media-imported")

    # ---------------------------------------------------------------- M2: timeline
    cards = d.find_elements(By.CSS_SELECTOR, "[data-media='clip_a.mp4']")
    ActionChains(d).double_click(cards[0]).perform()
    ok = wait(lambda: clip_count(d) == 1, 10)
    check("double-click adds clip to the timeline", ok)
    js(d, "window.__studiox.seek(12)")
    cards = d.find_elements(By.CSS_SELECTOR, "[data-media='clip_b.mp4']")
    ActionChains(d).double_click(cards[0]).perform()
    wait(lambda: clip_count(d) == 2, 10)
    p = project(d)
    clips = sorted(p["clips"].values(), key=lambda c: c["start"])
    check("second clip placed after the first on the main track", len(clips) == 2 and abs(clips[1]["start"] - 12) < 0.05 and clips[0]["trackId"] == clips[1]["trackId"],
          str([(c["start"], c["duration"]) for c in clips]))
    check("video clip shows on timeline", len(d.find_elements(By.CSS_SELECTOR, "[data-clip]")) == 2)

    # split at playhead (S) on clip a
    js(d, "window.__studiox.select([])")
    js(d, "window.__studiox.seek(5)")
    d.find_element(By.TAG_NAME, "body").click()
    press(d, "s")
    check("split with S creates two clips", wait(lambda: clip_count(d) == 3, 5))
    press(d, Keys.CONTROL, "z")
    check("undo restores", wait(lambda: clip_count(d) == 2, 5))
    press(d, Keys.CONTROL, "y")
    check("redo re-applies", wait(lambda: clip_count(d) == 3, 5))

    # select middle piece and ripple delete it
    p = project(d)
    clips = sorted(p["clips"].values(), key=lambda c: c["start"])
    second = clips[1]["id"]
    el = d.find_element(By.CSS_SELECTOR, f"[data-clip='{second}']")
    ActionChains(d).move_to_element_with_offset(el, 0, 0).click().perform()
    wait(lambda: js(d, "return window.__studiox.ui().selection")[0] == second, 5)
    press(d, Keys.SHIFT, Keys.DELETE)
    p = project(d)
    clips = sorted(p["clips"].values(), key=lambda c: c["start"])
    check("ripple delete removes clip and closes the gap", len(clips) == 2 and abs(clips[1]["start"] - 5) < 0.05, str([(round(c["start"], 2), round(c["duration"], 2)) for c in clips]))

    # drag-move the last clip right by ~ 2 s with the mouse
    zoom = js(d, "return window.__studiox.ui().zoom")
    last = clips[1]["id"]
    el = d.find_element(By.CSS_SELECTOR, f"[data-clip='{last}']")
    ActionChains(d).move_to_element(el).click_and_hold().move_by_offset(int(2 * zoom / 2), 0).move_by_offset(int(2 * zoom / 2), 0).release().perform()
    time.sleep(0.6)
    moved = project(d)["clips"][last]
    check("mouse drag moves a clip on the timeline", abs(moved["start"] - 7) < 0.25, f"start={moved['start']:.2f}")
    press(d, Keys.CONTROL, "z")

    # trim the end of the first clip with the mouse
    first = clips[0]["id"]
    el = d.find_element(By.CSS_SELECTOR, f"[data-clip='{first}']")
    w = el.size["width"]
    ActionChains(d).move_to_element_with_offset(el, w // 2 - 2, 5).click_and_hold().move_by_offset(-int(zoom), 0).release().perform()
    time.sleep(0.6)
    tr = project(d)["clips"][first]
    check("mouse trim shortens a clip", tr["duration"] < 4.6, f"duration={tr['duration']:.2f}")
    press(d, Keys.CONTROL, "z")

    # ---------------------------------------------------------------- M3: text, transitions, properties
    js(d, "window.__studiox.seek(1)")
    d.find_element(By.XPATH, "//button[.//span[text()='Text']]").click()
    time.sleep(0.5)
    xclick(d, "عنوان رئيسي")
    text_clip = wait(lambda: [c for c in project(d)["clips"].values() if c["type"] == "text"], 5)
    check("Arabic title template added", text_clip)
    ta = wait(lambda: d.find_element(By.TAG_NAME, "textarea"))
    js(d, "arguments[0].select()", ta)
    ta.send_keys("مرحبا بالعالم – Hello ٢٠٢٦")
    time.sleep(0.6)
    tc = [c for c in project(d)["clips"].values() if c["type"] == "text"][0]
    check("text edited from the inspector", tc["text"].startswith("مرحبا"), tc["text"])
    shot(d, "04-arabic-text-preview")

    # drag a template from the Text panel onto the timeline (pointer-based DnD, works on WebView2)
    n_text = len([c for c in project(d)["clips"].values() if c["type"] == "text"])
    src = d.find_element(By.XPATH, "//button[contains(., 'BIG NEWS')]")
    vclip = [c for c in project(d)["clips"].values() if c["type"] == "media"][0]
    lane = d.find_element(By.CSS_SELECTOR, f"[data-clip='{vclip['id']}']")
    ActionChains(d).move_to_element(src).click_and_hold().move_by_offset(30, 30).move_to_element(lane).move_by_offset(5, 0).release().perform()
    time.sleep(0.8)
    check("drag & drop of a text template onto the timeline", len([c for c in project(d)["clips"].values() if c["type"] == "text"]) == n_text + 1)
    press(d, Keys.CONTROL, "z")

    # transition: select second video clip, apply cross dissolve from the Transitions panel
    p = project(d)
    vids = sorted([c for c in p["clips"].values() if c["type"] == "media"], key=lambda c: c["start"])
    js(d, "window.__studiox.select([arguments[0]])", vids[1]["id"])
    d.find_element(By.XPATH, "//button[.//span[text()='Transitions']]").click()
    time.sleep(0.4)
    xclick(d, "Cross dissolve")
    tin = project(d)["clips"][vids[1]["id"]].get("transitionIn")
    check("cross dissolve applied", tin and tin["type"] == "dissolve", str(tin))
    # drag "Slide left" onto the OUT edge of the first clip
    src = d.find_element(By.XPATH, "//button[.//div[text()='Slide left']]")
    tgt = d.find_element(By.CSS_SELECTOR, f"[data-clip='{vids[0]['id']}']")
    ActionChains(d).move_to_element(src).click_and_hold().move_by_offset(20, 20).move_to_element_with_offset(tgt, tgt.size["width"] // 2 - 8, 0).move_by_offset(2, 0).release().perform()
    time.sleep(0.6)
    tout = project(d)["clips"][vids[0]["id"]].get("transitionOut")
    check("transition dragged onto a clip edge", tout and tout["type"] == "slide-left", str(tout))

    # add music on an audio track + logo overlay
    d.find_element(By.XPATH, "//button[.//span[text()='Media']]").click()
    time.sleep(0.4)
    js(d, "window.__studiox.seek(0)")
    ActionChains(d).double_click(d.find_elements(By.CSS_SELECTOR, "[data-media='music.mp3']")[0]).perform()
    time.sleep(0.4)
    js(d, "window.__studiox.seek(2)")
    ActionChains(d).double_click(d.find_elements(By.CSS_SELECTOR, "[data-media='logo.png']")[0]).perform()
    time.sleep(0.6)
    p = project(d)
    logo = next(c for c in p["clips"].values() if c["type"] == "media" and next(m for m in p["media"] if m["id"] == c["mediaId"])["kind"] == "image")
    music = next(c for c in p["clips"].values() if c["type"] == "media" and next(m for m in p["media"] if m["id"] == c["mediaId"])["kind"] == "audio")
    lt = next(t for t in p["tracks"] if t["id"] == logo["trackId"])
    mt = next(t for t in p["tracks"] if t["id"] == music["trackId"])
    check("image goes to a free video track above main", lt["kind"] == "video" and logo["trackId"] != vids[0]["trackId"], lt["name"])
    check("music goes to an audio track", mt["kind"] == "audio", mt["name"])
    # set logo transform via inspector number fields
    js(d, "window.__studiox.select([arguments[0]])", logo["id"])
    time.sleep(0.5)
    fields = [e for e in d.find_elements(By.CSS_SELECTOR, "input[dir=ltr]:not([type=range])") if e.is_displayed()]
    # Position X, Position Y, Scale%, ...
    def set_field(i, v):
        fields[i].click()
        js(d, "arguments[0].select()", fields[i])
        fields[i].send_keys(str(v), Keys.ENTER)
        time.sleep(0.3)
    set_field(0, 650)
    set_field(1, -300)
    set_field(2, 25)
    lc = project(d)["clips"][logo["id"]]
    check("inspector edits transform", abs(lc["transform"]["x"] - 650) < 1 and abs(lc["transform"]["scale"] - 0.25) < 0.01, str(lc["transform"]))
    js(d, "window.__studiox.seek(4)")
    time.sleep(1.5)
    shot(d, "05-composite-preview")

    # the preview must really decode video frames (not the placeholder)
    js(d, "window.__studiox.seek(1)")
    time.sleep(2)
    px = js(d, """const c=document.querySelector('canvas'); const x=c.getContext('2d'); const w=c.width,h=c.height;
      const d=x.getImageData(Math.round(w*0.1),Math.round(h*0.9),1,1).data; return [d[0],d[1],d[2]];""")
    check("preview decodes real video frames (testsrc colours)", px and (max(px) - min(px) > 30 or max(px) > 90), str(px))
    shot(d, "05b-video-frame")

    # ---------------------------------------------------------------- M4: colour, keyframes (preview)
    pa = project(d)
    vid_a = next(m["id"] for m in pa["media"] if m["name"] == "clip_a.mp4")
    first_id = next(c["id"] for c in pa["clips"].values() if c["type"] == "media" and c["mediaId"] == vid_a and c["start"] < 0.01)
    js(d, "window.__studiox.select([arguments[0]])", first_id)
    time.sleep(0.4)
    xclick(d, "Colour")
    time.sleep(0.3)
    xclick(d, "Black & white")
    time.sleep(1.2)
    px2 = js(d, """const c=document.querySelector('canvas'); const x=c.getContext('2d'); const w=c.width,h=c.height;
      const d=x.getImageData(Math.round(w*0.1),Math.round(h*0.9),1,1).data; return [d[0],d[1],d[2]];""")
    check("colour preset (B&W) applied in the preview via WebGL LUT", px2 and max(px2) - min(px2) < 16, str(px2))
    shot(d, "05c-bw-preview")
    xclick(d, "Video")
    time.sleep(0.3)
    js(d, "window.__studiox.seek(1)")
    time.sleep(0.3)
    d.find_element(By.XPATH, "//div[contains(@class,'text-muted')][contains(.,'Position X')]/following-sibling::div//button[@title='Add keyframe at playhead']").click()
    time.sleep(0.4)
    kf = project(d)["clips"][first_id].get("keyframes", {})
    check("keyframe button adds a position keyframe", kf and len(kf.get("x", [])) == 1, str(kf))
    press(d, Keys.CONTROL, "z")

    # preview quality really changes the render resolution
    from selenium.webdriver.support.ui import Select as UiSelect
    qsel = [e for e in d.find_elements(By.TAG_NAME, "select") if "Quarter" in e.text][0]
    w_before = js(d, "return document.querySelector('canvas').width")
    UiSelect(qsel).select_by_index(2)
    time.sleep(0.6)
    w_quarter = js(d, "return document.querySelector('canvas').width")
    UiSelect(qsel).select_by_index(0)
    time.sleep(0.6)
    w_full = js(d, "return document.querySelector('canvas').width")
    check("Full / Quarter preview quality changes the canvas resolution", w_full == 1920 and w_quarter == 480, f"{w_before}->{w_quarter}->{w_full}")

    # seek bar under the preview
    bar = d.find_element(By.CSS_SELECTOR, "[data-seekbar]")
    ActionChains(d).move_to_element(bar).click().perform()
    time.sleep(0.4)
    dur = max(c["start"] + c["duration"] for c in project(d)["clips"].values())
    ph = js(d, "return window.__studiox.ui().playhead")
    check("clicking the preview seek bar seeks to the middle", abs(ph - dur / 2) < dur * 0.06, f"{ph:.2f} of {dur:.2f}")

    # playback
    js(d, "window.__studiox.seek(0)")
    d.find_element(By.TAG_NAME, "body").click()
    press(d, Keys.SPACE)
    time.sleep(2.5)
    press(d, Keys.SPACE)
    ph = js(d, "return window.__studiox.ui().playhead")
    check("playback advances the playhead", 1.2 < ph < 4.5, f"{ph:.2f}s")

    # fast clip playback (8x) must not flash the "Loading…" placeholder
    js(d, "window.__studiox.seek(0)")
    pa = project(d)
    ca = next(c for c in pa["clips"].values() if c["type"] == "media" and c["start"] < 0.01 and next(m for m in pa["media"] if m["id"] == c["mediaId"])["name"] == "clip_a.mp4")
    js(d, "window.__studiox.setSpeed(arguments[0], 4)", ca["id"])
    time.sleep(0.8)
    d.find_element(By.TAG_NAME, "body").click()
    press(d, Keys.SPACE)
    samples = []
    for _ in range(8):
        time.sleep(0.03)
        samples.append(js(d, """const c=document.querySelector('canvas'); const x=c.getContext('2d');
          const d=x.getImageData(Math.round(c.width*0.1),Math.round(c.height*0.9),1,1).data; return [d[0],d[1],d[2]];"""))
    press(d, Keys.SPACE)
    placeholder = [px for px in samples if px and abs(px[0] - 17) < 6 and abs(px[1] - 24) < 6 and abs(px[2] - 39) < 6]
    check("4x speed playback shows real frames, never the loading placeholder", not placeholder and all(max(px) > 30 for px in samples[:3]), str(samples))
    press(d, Keys.CONTROL, "z")

    # ---------------------------------------------------------------- M5: subtitles (SRT import → batched export)
    srt = "1\n00:00:00,500 --> 00:00:03,000\nأهلاً بكم في ستوديو إكس\n\n2\n00:00:03,500 --> 00:00:06,000\nWelcome to StudioX\n\n3\n00:00:12,000 --> 00:00:14,000\nشكراً للمشاهدة\n"
    js(d, "window.__studiox.importSubtitles(arguments[0])", srt)
    time.sleep(0.6)
    subs = [c for c in project(d)["clips"].values() if c["type"] == "text" and c.get("name") == "subtitle"]
    check("SRT subtitles imported onto their own track", len(subs) == 3 and len({c["trackId"] for c in subs}) == 1, str([round(c["start"], 2) for c in subs]))
    st = js(d, "return window.__studiox.aiStatus()")
    check("AI status reports the local models folder", st and "modelsDir" in st, json.dumps(st)[:200])

    # ---------------------------------------------------------------- export
    os.makedirs(os.path.expanduser("~/Videos"), exist_ok=True)
    out_file = os.path.expanduser("~/Videos/e2e_export.mp4")
    if os.path.exists(out_file):
        os.remove(out_file)
    press(d, Keys.CONTROL, "e")
    wait(lambda: d.find_element(By.XPATH, "//*[contains(text(),'Export video')]"), 10)
    time.sleep(2)  # encoder detection
    name_in = [e for e in d.find_elements(By.CSS_SELECTOR, ".fixed input[dir=auto]") if e.is_displayed()][0]
    js(d, "arguments[0].select()", name_in)
    name_in.send_keys("e2e_export")
    folder = wait(lambda: js(d, "const e=[...document.querySelectorAll('.fixed div[title]')].find(x=>x.title.startsWith('/')); return e && e.title"), 10)
    out_file = os.path.join(folder, "e2e_export.mp4")
    if os.path.exists(out_file):
        os.remove(out_file)
    shot(d, "06-export-dialog")
    btns = [b for b in d.find_elements(By.XPATH, "//button[normalize-space(.)='Export']") if b.is_displayed()]
    btns[-1].click()
    ok = wait(lambda: any(j["status"] in ("done", "error") for j in js(d, "return window.__studiox.app().exports")), 300, 1)
    jobs = js(d, "return window.__studiox.app().exports")
    shot(d, "07-export-queue")
    check("export job finished", ok and jobs and jobs[-1]["status"] == "done", json.dumps(jobs[-1].get("message") if jobs else "no job", ensure_ascii=False)[:600])
    if os.path.exists(out_file):
        pr = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", out_file]))
        dur = float(pr["format"]["duration"])
        exp = max(c["start"] + c["duration"] for c in project(d)["clips"].values())
        check("exported file duration matches the timeline", abs(dur - exp) < 0.15, f"{dur:.2f} vs {exp:.2f}")
        check("exported file has H.264 video + AAC audio", sorted(s["codec_name"] for s in pr["streams"]) == ["aac", "h264"])
        grey = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", "2.5", "-i", out_file, "-frames:v", "1", "-vf", "crop=1:1:192:972,format=rgb24", "-f", "rawvideo", "-"])
        check("exported file carries the colour grade (B&W)", max(grey) - min(grey) < 16, str(list(grey)))
        for t in (1.5, 4.0, 12.3, 13.0):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", out_file, "-frames:v", "1", os.path.join(OUT, f"export-frame-{t}.png")])

    # ---------------------------------------------------------------- M5: AI assistant + smart reframe
    js(d, "window.__studiox.ui().set({ leftTab: 'ai' })")
    bw = lambda: len([c for c in project(d)["clips"].values() if c["type"] == "media" and c.get("color") and c["color"]["saturation"] == -1])
    bw_before = bw()
    box = wait(lambda: d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-input]"), 10)
    box.send_keys("خليه أبيض وأسود وحوّله لتيك توك")
    d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-ask]").click()
    plan_el = wait(lambda: d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-plan]"), 10)
    items = plan_el.find_elements(By.CSS_SELECTOR, "li") if plan_el else []
    check("assistant proposes 2 steps for an Arabic request (nothing applied yet)", len(items) == 2 and project(d)["settings"]["width"] == 1920, plan_el.text if plan_el else "")
    shot(d, "07b-assistant-plan")
    d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-apply]").click()
    ok = wait(lambda: d.find_elements(By.CSS_SELECTOR, "[data-testid=assistant-results]"), 120, 0.5)
    s_ = project(d)["settings"]
    main = [c for c in project(d)["clips"].values() if c["type"] == "media" and c["transform"]["scale"] > 1.5]
    logo_after = [c for c in project(d)["clips"].values() if c["type"] == "media" and abs(c["transform"]["scale"] - 0.25) < 0.01]
    check("assistant applied: canvas 1080×1920, footage fills the frame, positioned logo untouched", ok and s_["width"] == 1080 and s_["height"] == 1920 and main and logo_after,
          f'{s_["width"]}x{s_["height"]} main={len(main)} logo={len(logo_after)}')
    check("assistant applied the B&W look to the video clips", bw() > bw_before, f"{bw_before} -> {bw()}")
    shot(d, "07c-assistant-applied")
    js(d, "document.activeElement && document.activeElement.blur()")  # WebKit keeps focus in the textarea after a button click
    press(d, Keys.CONTROL, "z")
    time.sleep(0.4)
    # (the export queue panel is still open here: shortcuts must keep working with it)
    check("assistant steps undo one by one (reframe first)", project(d)["settings"]["width"] == 1920 and bw() > bw_before)
    press(d, Keys.CONTROL, "z")
    time.sleep(0.4)
    check("second undo removes the colour step", bw() == bw_before)
    js(d, "window.__studiox.ui().set({ leftTab: 'media' })")

    # optional local LLM path (fake Ollama server): free-form request → validated operations
    fake = FakeOllama(daemon=True)
    fake.start()
    time.sleep(0.5)
    js(d, "window.__studiox.ui().set({ leftTab: 'ai' })")
    st = js(d, "return window.__studiox.aiStatus()")
    sel = wait(lambda: [e for e in d.find_elements(By.CSS_SELECTOR, "select") if "mock-llm" in e.get_attribute("innerHTML")], 10)
    if sel:
        js(d, "const s=arguments[0]; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'mock-llm'); s.dispatchEvent(new Event('change',{bubbles:true}));", sel[0])
    box = d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-input]")
    js(d, "arguments[0].select()", box)
    box.send_keys("give it a cozy feeling")
    d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-ask]").click()
    plan_el = wait(lambda: d.find_element(By.CSS_SELECTOR, "[data-testid=assistant-plan]"), 15)
    txt = plan_el.text if plan_el else ""
    check("Ollama model listed and its proposal validated (unknown ops dropped)", st and st.get("ollama") == ["mock-llm"] and "mock-llm" in txt and "Warm" in txt and len(plan_el.find_elements(By.CSS_SELECTOR, "li")) == 1
          and fake.requests and fake.requests[-1]["format"] == "json" and "removeSilence" in fake.requests[-1]["messages"][0]["content"], txt.replace("\n", " | "))
    shot(d, "07d-assistant-ollama")
    xclick(d, "Discard")
    fake.server.shutdown()
    js(d, "window.__studiox.ui().set({ leftTab: 'media' })")

    # ---------------------------------------------------------------- persistence
    pid = project(d)["id"]
    nclips = clip_count(d)
    xclick(d, "", "button[@aria-label='Projects']")
    wait(lambda: d.find_elements(By.XPATH, "//*[contains(text(),'E2E')]"), 10)
    shot(d, "08-home-with-project")
    d.find_element(By.XPATH, "//*[contains(text(),'E2E')]").click()
    ok = wait(lambda: project(d) and project(d)["id"] == pid and clip_count(d) == nclips, 15)
    check("project reopens with the full timeline", ok)

    # missing media detection
    xclick(d, "", "button[@aria-label='Projects']")
    time.sleep(1)
    shutil.move(os.path.join(MEDIA, "clip_b.mp4"), os.path.join(MEDIA, "clip_b_moved.mp4"))
    try:
        wait(lambda: d.find_element(By.XPATH, "//*[contains(text(),'E2E')]"), 15).click()
        ok = wait(lambda: d.find_elements(By.XPATH, "//*[contains(text(),'Missing media')]"), 10)
        check("missing media detected and relink dialog shown", ok)
        shot(d, "09-relink")
    finally:
        shutil.move(os.path.join(MEDIA, "clip_b_moved.mp4"), os.path.join(MEDIA, "clip_b.mp4"))
    press(d, Keys.ESCAPE)

    # ---------------------------------------------------------------- Arabic UI
    lang_btn = d.find_element(By.CSS_SELECTOR, "button[aria-label='العربية']")
    lang_btn.click()
    time.sleep(1)
    check("Arabic UI switches the document to RTL", js(d, "return document.documentElement.dir") == "rtl")
    shot(d, "10-arabic-ui")
    d.find_element(By.CSS_SELECTOR, "button[aria-label='English']").click()
    time.sleep(0.5)


if __name__ == "__main__":
    main()
