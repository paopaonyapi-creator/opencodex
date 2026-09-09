# Adobe Stock Automated Quality Control (QC) Engine

## 1. Purpose
The Stock QC Engine evaluates AI-generated and operator-submitted video clips against Adobe Stock commercial submission requirements to prevent rejected uploads and accounts penalties.

## 2. Technical Standards
- **Resolution**: Minimum 720p; 1080p (Full HD) or 4K UHD recommended.
- **Duration**: Minimum 4-5 seconds; maximum recommended 60 seconds (flags warnings if > 120s).
- **Aspect Ratio**: Standard 16:9 landscape or 9:16 vertical preferred; non-standard aspect ratios receive review flags.
- **Codec**: Clean H.264, H.265/HEVC, or ProRes without compression banding or macroblocking.

## 3. Commercial & Visual Defect Checks
- **Watermark & Logo Detection**: Identifies third-party marks, stock preview text, or platform watermarks (`Shutterstock`, `Getty`, `TikTok`).
- **AI Visual Artifacts**: Detects temporal warping, hand/finger deformations, face distortion, and object flicker.

## 4. Verdicts & Scoring
- **`PASS`** (Score 85–100): Asset meets all technical and commercial baselines.
- **`REVIEW`** (Score 65–84): Manual operator check advised (e.g. 720p resolution or non-standard duration).
- **`FAIL`** (Score < 65 or High Severity Defect): Do not submit to Adobe Stock.
