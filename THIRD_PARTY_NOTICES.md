# Third-party software

Runtime dependencies are pinned in package-lock.json. The build copies the installed runtime files into public/runtime; those generated copies are not committed.

| Component | Version | License | Source |
|---|---|---|---|
| MediaPipe Tasks Vision | 1.1.0 | Apache-2.0 | https://github.com/google-ai-edge/mediapipe |
| MediaPipe Pose Landmarker Lite task | float16, version 1 | Apache-2.0 | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task |
| OpenCV.js package | 5.0.0-release.1 | Apache-2.0 | https://github.com/TechStark/opencv-js |
| OpenCV | 5.0.0 | Apache-2.0 | https://github.com/opencv/opencv |
| MP4Box.js | 2.3.0 | BSD-3-Clause | https://github.com/gpac/mp4box.js |
| fflate | 0.8.2 | MIT | https://github.com/101arrowz/fflate |
| Vite (build) | 8.3.4 | MIT | https://github.com/vitejs/vite |
| Playwright (test) | 1.64.0 | Apache-2.0 | https://github.com/microsoft/playwright |

Original license texts are in licenses/. The build downloads the unmodified public Pose Landmarker Lite task from Google's official URL above. Model binaries and generated runtime files are not committed. No user videos, manifests or analysis results are redistributed with this repository. Interface fonts use installed system fonts.
