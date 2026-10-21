# Third-party components

The build downloads and republishes unmodified, version-pinned detection assets.
Every asset is verified against its SHA-256 in scripts/vision-assets.mjs.
The deployed browser loads these assets from the same GitHub Pages site.

- MediaPipe Tasks Vision 0.10.21: Copyright The MediaPipe Authors, Apache License 2.0. Source: https://github.com/google-ai-edge/mediapipe/tree/v0.10.21. Package: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.21.
- EfficientDet Lite0 int8 v1: Google / TensorFlow object-detection model, Apache License 2.0. Official asset: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite. Model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector.

The complete upstream MediaPipe license and included notices are in
licenses/mediapipe-LICENSE.txt. Original copyright/license comments in the JavaScript
assets are preserved. These components are used for on-device person detection;
they do not provide the snowboard technique analysis.
