#!/bin/sh
# Downloads the MediaPipe Face Landmarker model bundle (Apache-2.0) into public/models.
# The file is committed to the repo; re-run only to refresh it.
set -eu
cd "$(dirname "$0")/.."
mkdir -p public/models
URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
curl -fL --progress-bar -o public/models/face_landmarker.task "$URL"
ls -la public/models/face_landmarker.task
