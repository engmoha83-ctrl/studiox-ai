#!/usr/bin/env bash
# Generates the sample media used by the application E2E test.
set -e
D="${1:-/tmp/sx-media}"
mkdir -p "$D"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
ff -f lavfi -i "testsrc2=s=1280x720:r=30:d=12" -f lavfi -i "sine=f=440:d=12" -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -shortest "$D/clip_a.mp4"
ff -f lavfi -i "smptehdbars=s=1280x720:r=30:d=8" -f lavfi -i "sine=f=660:d=8" -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -shortest "$D/clip_b.mp4"
# ProRes MOV: not decodable by the WebView -> must get an automatic proxy
ff -f lavfi -i "mandelbrot=s=640x360:r=25" -t 5 -c:v prores_ks -profile:v 1 "$D/prores.mov"
# speech-like audio with silences for silence detection
ff -f lavfi -i "sine=f=300:d=2" -f lavfi -i "anullsrc=r=44100:cl=mono:d=1.5" -f lavfi -i "sine=f=500:d=2" -f lavfi -i "anullsrc=r=44100:cl=mono:d=1.5" -f lavfi -i "sine=f=400:d=2" \
   -filter_complex "[0][1][2][3][4]concat=n=5:v=0:a=1" "$D/voice.wav"
ff -f lavfi -i "sine=f=220:d=20" -af "volume=0.3" -c:a libmp3lame "$D/music.mp3"
ff -f lavfi -i "color=c=0x14b8a6:s=800x800" -vf "drawbox=x=100:y=100:w=600:h=600:color=white@1:t=40" -frames:v 1 "$D/logo.png"
echo "$D"
