import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Eye,
  Image as ImageIcon,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { Button, ModalDialog } from './ui';

export interface MeterCameraCaptureProps {
  photoUrl: string | null;
  onPhotoCaptured: (dataUrl: string) => void;
  onPhotoCleared: () => void;
  meterSerial?: string;
  premise?: string;
  title?: string;
}

function drawWatermarkAndCompress(
  source: HTMLVideoElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  meterSerial?: string
): string {
  const canvas = document.createElement('canvas');
  const maxDim = 640;
  let targetW = sourceWidth;
  let targetH = sourceHeight;

  if (targetW > maxDim || targetH > maxDim) {
    if (targetW > targetH) {
      targetH = Math.round((targetH * maxDim) / targetW);
      targetW = maxDim;
    } else {
      targetW = Math.round((targetW * maxDim) / targetH);
      targetH = maxDim;
    }
  }

  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas rendering context not available');
  }

  ctx.drawImage(source, 0, 0, targetW, targetH);

  // Add timestamp and meter serial watermark bar at bottom for verification
  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
  ctx.fillRect(0, targetH - 28, targetW, 28);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px monospace';
  const watermarkText = `MajiTrack · ${meterSerial || 'METER'} · ${new Date()
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')}`;
  ctx.fillText(watermarkText, 8, targetH - 10);

  return canvas.toDataURL('image/jpeg', 0.68);
}

export function MeterCameraCapture({
  photoUrl,
  onPhotoCaptured,
  onPhotoCleared,
  meterSerial,
  premise,
  title = 'Meter Dial Photo Verification',
}: MeterCameraCaptureProps) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isFullPhotoOpen, setIsFullPhotoOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore cleanup errors
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActiveStream(null);
    setIsVideoReady(false);
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  // Bind active MediaStream once <video> mounts into the DOM
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!isCameraActive || !activeStream || !videoEl) return;

    if (videoEl.srcObject !== activeStream) {
      videoEl.srcObject = activeStream;
    }

    const handleReady = () => {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setIsVideoReady(true);
      }
    };

    videoEl.addEventListener('loadedmetadata', handleReady);
    videoEl.addEventListener('canplay', handleReady);

    void videoEl.play().catch(() => {
      // Autoplay might be deferred until metadata resolves
    });

    if (videoEl.readyState >= 1 && videoEl.videoWidth > 0) {
      setIsVideoReady(true);
    }

    return () => {
      videoEl.removeEventListener('loadedmetadata', handleReady);
      videoEl.removeEventListener('canplay', handleReady);
    };
  }, [isCameraActive, activeStream]);

  const startCamera = async (requestedFacing: 'environment' | 'user' = facingMode) => {
    stopStream();
    setCameraError(null);
    setIsStartingCamera(true);
    setIsCameraActive(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Direct camera access is not supported in this browser or context.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: requestedFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      setActiveStream(stream);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to open camera. Verify camera permissions or use Upload Dial Image.';
      setCameraError(msg);
      setIsCameraActive(false);
      stopStream();
    } finally {
      setIsStartingCamera(false);
    }
  };

  const handleCloseCamera = () => {
    setIsCameraActive(false);
    setCameraError(null);
    stopStream();
  };

  const toggleCameraFacing = async () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    await startCamera(nextFacing);
  };

  const handleCaptureSnapshot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera viewfinder is still initializing. Please wait a moment and try again.');
      return;
    }

    try {
      const dataUrl = drawWatermarkAndCompress(
        video,
        video.videoWidth,
        video.videoHeight,
        meterSerial
      );
      onPhotoCaptured(dataUrl);
      handleCloseCamera();
    } catch {
      setCameraError('Failed to capture frame from camera.');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvt) => {
      const rawDataUrl = loadEvt.target?.result as string;
      if (!rawDataUrl) return;

      const img = new Image();
      img.onload = () => {
        try {
          const compressed = drawWatermarkAndCompress(img, img.width, img.height, meterSerial);
          onPhotoCaptured(compressed);
        } catch {
          onPhotoCaptured(rawDataUrl);
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-label font-medium text-foreground">
          <Camera className="size-4 text-primary" />
          <span>{title}</span>
        </label>
        {photoUrl ? (
          <span className="inline-flex items-center gap-1 rounded-control bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
            <CheckCircle2 className="size-3" />
            Photo Attached
          </span>
        ) : (
          <span className="text-caption text-muted">Visual register proof</span>
        )}
      </div>

      {/* Native camera / device image file fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Attached Photo Preview */}
      {photoUrl && !isCameraActive ? (
        <div className="relative overflow-hidden rounded-control border border-border/45 bg-background/60 p-2.5">
          <div className="flex items-start gap-3">
            <div
              className="group relative size-24 shrink-0 cursor-pointer overflow-hidden rounded-control border border-border/60 bg-black"
              onClick={() => setIsFullPhotoOpen(true)}
              title="Click to view full photo"
            >
              <img
                src={photoUrl}
                alt={`Meter dial for ${meterSerial || 'connection'}`}
                className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Eye className="size-5" />
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-1 text-caption">
              <div className="font-medium text-foreground">Meter Dial Proof Attached</div>
              <div className="text-[11px] text-muted">
                {meterSerial ? `Meter: ${meterSerial}` : 'Registered dial snapshot'}
                {premise ? ` · ${premise}` : ''}
              </div>
              <p className="text-[11px] text-accent">
                Stored with this meter reading record.
              </p>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setIsFullPhotoOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <Eye className="size-3" />
                  View Dial
                </button>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-foreground hover:text-primary"
                >
                  <RefreshCw className="size-3" />
                  Retake Photo
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted hover:text-foreground"
                >
                  <ImageIcon className="size-3" />
                  Replace File
                </button>
                <button
                  type="button"
                  onClick={onPhotoCleared}
                  className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-danger hover:underline"
                >
                  <Trash2 className="size-3" />
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Live Camera Viewfinder Overlay */}
      {isCameraActive ? (
        <div className="space-y-3 overflow-hidden rounded-control border-2 border-primary/60 bg-black p-3 text-white">
          <div className="flex items-center justify-between border-b border-white/15 pb-2 text-caption">
            <span className="flex items-center gap-1.5 font-semibold text-white">
              <span className="size-2 animate-pulse rounded-full bg-danger" />
              {isStartingCamera ? 'Starting Camera…' : 'Live Camera Viewfinder'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleCameraFacing()}
                className="cursor-pointer rounded-control bg-white/10 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/20"
                title="Switch front/rear camera"
              >
                Flip
              </button>
              <button
                type="button"
                onClick={handleCloseCamera}
                className="cursor-pointer rounded-control bg-white/10 p-1 text-white transition-colors hover:bg-white/20"
                title="Cancel camera"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="relative flex aspect-4/3 w-full items-center justify-center overflow-hidden rounded-control bg-neutral-900">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="size-full object-cover"
            />

            {!isVideoReady ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-caption font-medium text-white">
                Connecting camera stream…
              </div>
            ) : null}

            {/* Viewfinder Alignment Target Frame */}
            <div className="pointer-events-none absolute inset-5 flex flex-col justify-between rounded-control border-2 border-dashed border-white/60 p-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <div className="rounded-xs bg-black/50 py-0.5 text-center font-mono text-[10px] font-bold tracking-widest text-white/85 uppercase">
                Align Meter Dial Here
              </div>
              <div className="flex justify-between font-mono text-[9px] text-white/70">
                <span>{meterSerial || 'SERIAL'}</span>
                <span>0.1 m³ RES</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              tone="quiet"
              size="sm"
              onClick={handleCloseCamera}
              className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              Cancel
            </Button>

            <button
              type="button"
              onClick={handleCaptureSnapshot}
              disabled={!isVideoReady}
              className="inline-flex cursor-pointer items-center gap-2 rounded-control bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-md transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white"
            >
              <Camera className="size-4" />
              <span>{isVideoReady ? 'Capture Photo' : 'Initializing…'}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Capture / Upload Actions when idle without a photo */}
      {!isCameraActive && !photoUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            tone="primary"
            size="sm"
            onClick={() => void startCamera()}
            className="flex-1 sm:flex-initial"
          >
            <Camera className="size-4" />
            <span>Take Meter Photo</span>
          </Button>

          <Button
            type="button"
            tone="quiet"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 sm:flex-initial"
          >
            <ImageIcon className="size-4" />
            <span>Upload Dial Image</span>
          </Button>
        </div>
      ) : null}

      {/* Camera Error Notice */}
      {cameraError ? (
        <div className="flex items-start gap-2 rounded-control border border-warning/40 bg-warning/10 p-2.5 text-caption text-warning">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{cameraError}</p>
            <p className="mt-1 text-[11px] text-muted">
              You can use <strong>Upload Dial Image</strong> to capture or choose a photo with your device camera.
            </p>
          </div>
        </div>
      ) : null}

      {/* Full Photo Inspection Modal */}
      {photoUrl && isFullPhotoOpen ? (
        <ModalDialog
          open={isFullPhotoOpen}
          onClose={() => setIsFullPhotoOpen(false)}
          title="Verified Meter Dial Photo"
          subtitle={meterSerial ? `Meter Serial ${meterSerial}` : 'Cumulative Register'}
          maxWidthClass="max-w-2xl"
        >
          <div className="space-y-4">
            <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-control border border-border/50 bg-black">
              <img
                src={photoUrl}
                alt="Meter Dial"
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-caption text-muted">
              <span>Attached to meter reading record</span>
              <Button tone="quiet" size="sm" onClick={() => setIsFullPhotoOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
