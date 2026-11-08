# Application end-to-end test (Linux)

Drives the real StudioX AI binary through WebDriver.

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev webkit2gtk-driver xvfb ffmpeg \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
cargo install tauri-driver --locked
pip install selenium

npx tauri build --debug --no-bundle          # builds src-tauri/target/debug/studiox-ai
tests/app/make_media.sh /tmp/sx-media         # sample media
Xvfb :99 -screen 0 1600x1000x24 &
DISPLAY=:99 tauri-driver &
DISPLAY=:99 python3 tests/app/e2e_app.py      # screenshots + results.json in /tmp/sx-e2e
```
The test enables automation hooks by setting `localStorage["studiox:e2e"] = "1"` (see `src/testHooks.ts`).
