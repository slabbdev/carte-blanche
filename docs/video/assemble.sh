#!/usr/bin/env bash
# Assembles the Devpost demo video (v2, React back-office) from per-scene takes
# recorded by scripts/record-video.ts + `say` voiceovers in vo2/.
#   npx tsx scripts/record-video.ts && ./docs/video/assemble.sh
set -euo pipefail
cd "$(dirname "$0")"
OUT=carte-blanche-demo.mp4
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

card() { # card <name> <seconds> — cards/<name>.png rendered by the browser (this ffmpeg has no drawtext)
  ffmpeg -y -v error -loop 1 -framerate 30 -i "cards/$1.png" -f lavfi -i "anullsrc=r=48000:cl=stereo" -t "$2" -shortest \
    -vf "scale=1440:900,format=yuv420p" -c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 128k -ar 48000 "$WORK/$1.mp4"
}
pair() { # pair <n> <take.webm> <vo.m4a> — video runs for the VO's length (last frame held if shorter)
  local n="$1" take="takes/$2" vo="vo2/$3" vd
  vd=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$vo")
  ffmpeg -y -v error -stream_loop -1 -i "$take" -i "$vo" -map 0:v -map 1:a -t "$vd" \
    -vf "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p" \
    -c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 128k -ar 48000 "$WORK/scene-$n.mp4"
  echo "scene $n: ${vd}s"
}

card title 2.8
pair 1 scene1-hook-refusal.webm     scene-1.m4a
pair 2 scene2-grant.webm            scene-2.m4a
pair 3 scene3-autopilot-sealed.webm scene-3.m4a
pair 4 scene4-seller.webm           scene-4.m4a
pair 5 scene5-analytics.webm        scene-5.m4a
pair 6 scene6-verify.webm           scene-6.m4a
pair 7 scene7-close.webm            scene-7.m4a
card end 3.4

: > "$WORK/list.txt"
for f in title scene-1 scene-2 scene-3 scene-4 scene-5 scene-6 scene-7 end; do echo "file '$WORK/$f.mp4'" >> "$WORK/list.txt"; done
ffmpeg -y -v error -f concat -safe 0 -i "$WORK/list.txt" -c copy "$OUT"
echo "→ $OUT ($(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUT")s)"
