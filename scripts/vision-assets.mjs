// Pinned upstream versions; build verifies every byte before publishing.
export const assets = [
  {
    "path": "vision/vision_bundle.mjs",
    "url": "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs",
    "sha256": "40f4123dfcd75cfa58add046919cc6f52fde66f009ff582997c09ba54c6ba27c"
  },
  {
    "path": "vision/model.tflite",
    "url": "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite",
    "sha256": "0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb"
  },
  {
    "path": "vision/wasm/vision_wasm_internal.js",
    "url": "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.js",
    "sha256": "4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb"
  },
  {
    "path": "vision/wasm/vision_wasm_internal.wasm",
    "url": "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.wasm",
    "sha256": "f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7"
  },
  {
    "path": "vision/wasm/vision_wasm_nosimd_internal.js",
    "url": "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.js",
    "sha256": "927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f"
  },
  {
    "path": "vision/wasm/vision_wasm_nosimd_internal.wasm",
    "url": "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.wasm",
    "sha256": "3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4"
  }
];
