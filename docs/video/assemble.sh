#!/usr/bin/env bash
# Assembles the Devpost demo video from per-scene takes + TTS voiceovers.
# Usage: ./docs/video/assemble.sh            → build carte-blanche-demo.mp4
# Requires: ffmpeg in PATH; takes in docs/video/, VOs in docs/video/vo/.
set -euo pipefail
cd "$(dirname "$0")"

OUT=carte-blanche-demo.mp4
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# scene → take (video) + voiceover pair. Update as new takes land:
#   scene4 (two-phase wallet) waits for the buyer's one approval click, then:
#   ./docs/video/assemble.sh again.
pair() { # pair <scene> <take.webm> <vo.m4a>
  local n="$1" take="$2" vo="$3"
  local vd v
  v="$WORK/vo-$n.m4a"; cp "vo/$vo" "$v"
  vd=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "vo/$vo")
  # scale take to VO length (hold the last frame), 1440x900@30
  ffmpeg -y -v error -stream_loop -1 -i "$take" -i "$v" \
    -map 0:v -map 1:a -t "$vd" \
    -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,fps=30" \
    -c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 128k "$WORK/scene-$n.mp4"
  echo "scene $n: ${vd}s"
}

pair 2 scene2-3-take2.webm scene-2.m4a
pair 3 scene2-3-take2.webm scene-3.m4a
pair 5 scene5-verify.webm   scene-5.m4a
pair 6 scene6-cockpit-live.webm scene-6.m4a
pair 7 scene7-close.webm    scene-7.m4a

printf "file '%s/scene-2.mp4'\nfile '%s/scene-3.mp4'\nfile '%s/scene-5.mp4'\nfile '%s/scene-6.mp4'\nfile '%s/scene-7.mp4'\n" \
  "$WORK" "$WORK" "$WORK" "$WORK" "$WORK" > "$WORK/list.txt"
ffmpeg -y -v error -f concat -safe 0 -i "$WORK/list.txt" -c copy "$OUT"
echo "→ $OUT ($(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUT")s)"
