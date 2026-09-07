// MoneyPrinterTurbo (MPT) Upstream API and Manifest Types

export interface MptApiTaskRequest {
  video_subject: string;
  video_script?: string;
  video_aspect: "16:9" | "9:16" | "1:1";
  video_source: "metaso_minimax" | "ark_seedance" | "ofox" | "local" | "pexels" | "pixabay" | "coverr";
  voice_name?: string;
  enable_voice?: boolean;
  enable_subtitle?: boolean;
  bgm_type?: "none" | "random" | "custom";
  bgm_file?: string;
  video_duration?: number;
  video_resolution?: string;
}

export interface MptApiTaskResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    state: "queued" | "processing" | "success" | "failed";
    progress?: number;
    video_url?: string;
    error?: string;
  };
}

export interface MptTaskStatusResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    state: "queued" | "processing" | "success" | "failed";
    progress: number;
    video_url?: string;
    subtitles_url?: string;
    audio_url?: string;
    cost_estimate?: number;
    actual_cost?: number;
    error?: string;
  };
}
