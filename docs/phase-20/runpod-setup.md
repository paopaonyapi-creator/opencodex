# RunPod Setup & Operations Guide

## 1. Obtaining Your RunPod API Key

1. Log in to [RunPod Console](https://www.runpod.io/console/user/settings).
2. Navigate to **User Settings** → **API Keys**.
3. Create a new API key with **Full Access** or read/write permissions for pods.
4. Add the key to your environment:
   ```bash
   PAO_RUNPOD_ENABLED=true
   PAO_RUNPOD_API_KEY=your_runpod_api_key_here
   ```

> [!IMPORTANT]
> Never commit your real RunPod API key to git. Always use `.env` (which is gitignored) or system environment variables.

## 2. Choosing a ComfyUI Pod Template

The system defaults to template ID `hs44di56w7`, a preconfigured RunPod ComfyUI template that launches:
- ComfyUI web interface on port `3000` (or `8188`).
- Pre-installed PyTorch and CUDA drivers.
- Jupyter Lab console on port `8888`.

You can configure a custom template ID via:
```bash
PAO_RUNPOD_DEFAULT_TEMPLATE_ID=your_custom_template_id
```

## 3. Supported GPU Profiles & Typical Rates

| GPU Model | VRAM | Typical Price/Hour | Ideal Workloads |
| :--- | :--- | :--- | :--- |
| **NVIDIA RTX 4090** | 24 GB | ~$0.74/hr | SDXL, SD1.5 high-batch, standard Flux dev |
| **NVIDIA RTX 5090** | 32 GB | ~$1.20/hr | Flux.1-dev, SD3.5 Large with multiple LoRAs |
| **NVIDIA RTX A6000** | 48 GB | ~$0.79/hr | Large video models (AnimateDiff, CogVideoX) |
| **NVIDIA A40** | 48 GB | ~$0.40/hr | High-throughput batch processing |
| **NVIDIA A100 SXM4** | 80 GB | ~$1.89/hr | Extreme resolution, massive LoRA stacking |

## 4. Secure vs. Community Cloud Tiers

- **SECURE**: Hosted in certified Tier 3/4 enterprise data centers. Guaranteed uptime, high reliability, and predictable network bandwidth. Recommended for client deliveries.
- **COMMUNITY**: Crowdsourced datacenter instances. Lower cost, best-effort availability. Excellent for cost-sensitive exploratory batches.
