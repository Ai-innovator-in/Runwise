import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Loader2, CheckCircle2 } from "lucide-react";

type VoiceNoteRecorderProps = {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  maxDurationSeconds?: number;
};

type RecorderState = "idle" | "recording" | "processing" | "success" | "error";

function VoiceNoteRecorder({
  onTranscript,
  disabled = false,
  maxDurationSeconds = 60,
}: VoiceNoteRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startRecording = async () => {
    try {
      setState("recording");
      setErrorMessage("");
      setProgress(0);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        if (blob.size === 0) {
          setState("error");
          setErrorMessage("No audio recorded.");
          return;
        }

        setState("processing");
        setProgress(0);

        // Simulate progress while processing
        const progressInterval = setInterval(() => {
          setProgress((prev) => Math.min(prev + 10, 90));
        }, 500);

        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");

          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("marketos_token")}`,
            },
            body: blob,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || "Transcription failed.");
          }

          const data = await response.json();
          clearInterval(progressInterval);
          setProgress(100);

          setTimeout(() => {
            setState("success");
            onTranscript(data.text || "");
            setTimeout(() => setState("idle"), 2000);
          }, 500);
        } catch (err) {
          clearInterval(progressInterval);
          setState("error");
          setErrorMessage(err instanceof Error ? err.message : "Transcription failed.");
        }
      };

      mediaRecorder.start();

      // Auto-stop after maxDurationSeconds
      timerRef.current = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + (100 / maxDurationSeconds);
          if (newProgress >= 100) {
            if (mediaRecorderRef.current?.state === "recording") {
              mediaRecorderRef.current.stop();
            }
            return 100;
          }
          return newProgress;
        });
      }, 1000);
    } catch (err) {
      setState("error");
      setErrorMessage(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone permissions."
          : "Could not start recording."
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
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
        onClick={state === "recording" ? stopRecording : startRecording}
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
