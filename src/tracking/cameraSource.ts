import type { CameraConfig } from '../config/schema';

export interface CameraFrame {
  bitmap: ImageBitmap;
  /** Capture time on the performance.now() clock (falls back to presentation time). */
  captureMs: number;
  /** When the frame callback fired. */
  callbackMs: number;
  width: number;
  height: number;
}

export type FrameListener = (frame: CameraFrame) => void;

export interface CameraSettings {
  label: string;
  width: number;
  height: number;
  frameRate: number;
  /** Digital zoom in effect (1 when the camera has no zoom control). */
  zoom: number;
  zoomRange?: { min: number; max: number };
}

interface ZoomCapabilities {
  zoom?: { min: number; max: number };
}
interface ZoomSettings {
  zoom?: number;
}

/**
 * Opens a webcam selected by label substring and pumps frames via requestVideoFrameCallback,
 * which fires once per *new* camera frame (never for stale ones) and reports capture timestamps.
 */
export class CameraSource {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | undefined;
  private track: MediaStreamTrack | undefined;
  private listener: FrameListener | undefined;
  private running = false;

  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    // Safari only delivers frames to a video that is being rendered; keep it in the DOM, tiny.
    Object.assign(this.video.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '2px',
      height: '2px',
      opacity: '0.01',
      pointerEvents: 'none',
    });
  }

  static async findDeviceId(labelMatch: string): Promise<string | undefined> {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.every((d) => d.label === '')) {
      // Labels are hidden until permission is granted: open any camera once to unlock them.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const needle = labelMatch.toLowerCase();
    return devices.find((d) => d.kind === 'videoinput' && d.label.toLowerCase().includes(needle))
      ?.deviceId;
  }

  async start(cam: CameraConfig): Promise<CameraSettings> {
    const deviceId = await CameraSource.findDeviceId(cam.label_match);
    const video: MediaTrackConstraints = {
      width: { ideal: cam.capture.width_px },
      height: { ideal: cam.capture.height_px },
      frameRate: { ideal: cam.capture.frame_rate },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    else if (cam.capture.facing_mode) video.facingMode = cam.capture.facing_mode;
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const track = this.stream.getVideoTracks()[0];
    if (!track) throw new Error('camera stream has no video track');
    this.track = track;
    const range = (track.getCapabilities() as ZoomCapabilities).zoom;
    if (range && cam.capture.zoom !== undefined) {
      const target = cam.capture.zoom === 'widest' ? range.min : cam.capture.zoom;
      await this.setZoom(target);
    }
    const s = track.getSettings() as MediaTrackSettings & ZoomSettings;
    this.video.srcObject = this.stream;
    document.body.appendChild(this.video);
    await this.video.play();
    this.running = true;
    this.pump();
    return {
      label: track.label,
      width: s.width ?? this.video.videoWidth,
      height: s.height ?? this.video.videoHeight,
      frameRate: s.frameRate ?? 0,
      zoom: s.zoom ?? 1,
      ...(range ? { zoomRange: range } : {}),
    };
  }

  /** Apply a digital zoom (clamped to the camera's range). Returns the zoom in effect. */
  async setZoom(zoom: number): Promise<number> {
    const track = this.track;
    if (!track) return 1;
    const range = (track.getCapabilities() as ZoomCapabilities).zoom;
    if (!range) return 1;
    const z = Math.min(range.max, Math.max(range.min, zoom));
    await track.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] });
    return (track.getSettings() as ZoomSettings).zoom ?? z;
  }

  onFrame(listener: FrameListener): void {
    this.listener = listener;
  }

  stop(): void {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video.remove();
  }

  private pump(): void {
    if (!this.running) return;
    this.video.requestVideoFrameCallback((now, meta) => {
      const captureMs = meta.captureTime ?? meta.presentationTime;
      if (this.listener) {
        const listener = this.listener;
        createImageBitmap(this.video)
          .then((bitmap) => {
            listener({
              bitmap,
              captureMs,
              callbackMs: now,
              width: meta.width,
              height: meta.height,
            });
          })
          .catch((err: unknown) => {
            console.warn('[camera] createImageBitmap failed', err);
          });
      }
      this.pump();
    });
  }
}
