import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Loader2, CheckCircle2 } from "lucide-react";

type VoiceNoteRecorderProps = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  maxDurationSeconds?: number;
};

type RecorderState = "idle" | "recording" | "processing" | "success" | "error";

const TARGET_SAMPLE_RATE = 16_000;

function mergeSamples(chunks: Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resample(samples: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = sourcePosition - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }

  return output;
}

function encodeMonoPcmWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM format
  view.setUint16(22, 1, true);       // mono (1 channel)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);      // 16-bit
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function VoiceNoteRecorder({
  onTranscript,
  disabled = false,
  maxDurationSeconds = 60,
}: VoiceNoteRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(48_000);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseAudio = useCallback(async () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    processorRef.current = null;
    sourceRef.current = null;
    silentGainRef.current = null;
    streamRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    return () => {
      recordingRef.current = false;
      clearTimer();
      void releaseAudio();
    };
  }, [clearTimer, releaseAudio]);

  const startRecording = async () => {
    try {
      setState("recording");
      setErrorMessage("");
      setProgress(0);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone recording.");
      }
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) {
        throw new Error("This browser does not support the Web Audio API.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const context = new AudioContextClass();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;

      chunksRef.current = [];
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);

      audioContextRef.current = context;
      streamRef.current = stream;
      sourceRef.current = source;
      processorRef.current = processor;
      silentGainRef.current = silentGain;
      sampleRateRef.current = context.sampleRate;
      startedAtRef.current = Date.now();
      recordingRef.current = true;

      timerRef.current = setInterval(() => {
        const seconds = (Date.now() - startedAtRef.current) / 1000;
        setProgress(Math.min(100, (seconds / maxDurationSeconds) * 100));
        if (seconds >= maxDurationSeconds) {
          void stopRecording();
        }
      }, 250);
    } catch (err) {
      await releaseAudio();
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow microphone access in the browser and try again."
          : err instanceof Error
            ? err.message
            : "Could not start microphone recording.";
      setErrorMessage(message);
      setState("error");
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    clearTimer();
    setState("processing");
    setProgress(0);

    const sourceRate = sampleRateRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    await releaseAudio();

    try {
      const merged = mergeSamples(chunks);
      const durationSeconds = merged.length / sourceRate;
      if (durationSeconds < 0.35) {
        throw new Error("The recording was too short. Record at least one second of speech.");
      }

      const normalized = resample(merged, sourceRate, TARGET_SAMPLE_RATE);
      const wav = encodeMonoPcmWav(normalized, TARGET_SAMPLE_RATE);

      // Simulate progress while uploading
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 500);

      try {
        const token = localStorage.getItem("marketos_token");
        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": "audio/wav",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: wav,
        });

        const raw = await response.text();
        let payload: { text?: string; error?: string } = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          payload = { error: raw || "The transcription service returned an invalid response." };
        }

        if (!response.ok) {
          throw new Error(payload.error || "Voice transcription failed.");
        }

        const transcript = String(payload.text || "").trim();
        if (!transcript) {
          throw new Error("No speech was detected. Try again and speak closer to the microphone.");
        }

        clearInterval(progressInterval);
        setProgress(100);

        setTimeout(() => {
          setState("success");
          onTranscript(transcript);
          setTimeout(() => setState("idle"), 2000);
        }, 500);
      } catch (err) {
        clearInterval(progressInterval);
        throw err;
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Voice transcription failed.");
      setState("error");
    }
  };

  const buttonLabel = () => {
    switch (state) {
      case "recording":
        return "Recording...";
      case "processing":
        return "Transcribing...";
      case "success":
        return "Transcribed!";
      case "error":
        return "Try Again";
      default:
        return "Record Voice";
    }
  };

  const buttonIcon = () => {
    switch (state) {
      case "recording":
        return <Square size={14} className="text-red-500" />;
      case "processing":
        return <Loader2 size={14} className="animate-spin" />;
      case "success":
        return <CheckCircle2 size={14} className="text-[#005932]" />;
      case "error":
        return <Mic size={14} />;
      default:
        return <Mic size={14} />;
    }
  };

  const buttonStyles = () => {
    switch (state) {
      case "recording":
        return "bg-red-50 text-red-700 border-red-200 animate-pulse";
      case "processing":
        return "bg-[#005932]/10 text-[#005932] border-[#005932]/20";
      case "success":
        return "bg-[#005932]/10 text-[#005932] border-[#005932]/20";
      case "error":
        return "bg-red-50 text-red-700 border-red-200";
      default:
        return "bg-[#005932] text-white border-transparent hover:bg-[#004d2a]";
    }
  };

  return (
    <div className="inline-flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled || state === "processing"}
        onClick={state === "recording" ? () => void stopRecording() : () => void startRecording()}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${buttonStyles()}`}
      >
        {buttonIcon()}
        {buttonLabel()}
      </button>
      {(state === "processing" || state === "recording") && (
        <div className="w-full bg-[#1a1c1b]/5 rounded-full h-1 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              state === "recording" ? "bg-red-500" : "bg-[#005932]"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {state === "error" && errorMessage && (
        <p className="text-xs text-red-600">{errorMessage}</p>
      )}
    </div>
  );
}

export { VoiceNoteRecorder };
