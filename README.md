# MarketOS Offline

MarketOS Offline is a local-first AI business copilot for African microbusinesses. It turns typed or spoken business notes into reviewed records for sales, expenses, inventory, customer debt, invoices, reports, and recommendations.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A Chromium-based browser for microphone capture
- Optional local AI executables and models:
  - `whisper.cpp` for speech-to-text
  - `llama.cpp` for structured business-note extraction

## Run the application

```bash
npm install
npm run dev
```

`npm run dev` starts the backend on `http://127.0.0.1:8787`, waits for it to become healthy, then starts the Vite frontend. Vite proxies `/api` requests to the backend.

Other scripts:

```bash
npm run api
npm run dev:client
npm run build
npm run start
npm run desktop
npm run desktop:build
```

- `npm run api`: starts only the local backend.
- `npm run dev:client`: starts only Vite when the backend is already running.
- `npm run build`: creates the production frontend bundle in `dist/`.
- `npm run start`: serves the built frontend and API from the Node backend.
- `npm run desktop`: builds and launches the Windows desktop app for local testing.
- `npm run desktop:build`: creates a Windows installer and portable executable in `release/`.

The installed desktop app stores business records under the current Windows user's
MarketOS application-data directory, so upgrades do not overwrite them.

## Voice-note implementation

The Dashboard and Add Business Note screens now include a **Record Voice** button.

The browser:

1. Requests microphone permission.
2. Captures mono audio for up to 60 seconds.
3. Resamples it to 16 kHz.
4. Encodes it as 16-bit PCM WAV.
5. Sends the WAV file to `POST /api/transcribe`.
6. Appends the returned transcript to the Business Note text box.

The browser performs the WAV conversion directly, so FFmpeg and cloud speech APIs are not required.

## Configure local AI

Model binaries and model weights are not included in this repository.

Create the active configuration:

### Windows Command Prompt

```bat
copy config\ai.example.json config\ai.json
```

### PowerShell

```powershell
Copy-Item config\ai.example.json config\ai.json
```

Edit `config/ai.json` and point it to your local files. The example expects this layout:

```text
tools/
  whisper/
    whisper-cli.exe
  llama/
    llama-cli.exe
models/
  whisper/
    ggml-small-q5_1.bin
  reasoning/
    qwen3-1.7b-q4_k_m.gguf
```

Relative paths are resolved from the MarketOS project folder. Absolute Windows paths also work, but backslashes inside JSON must be escaped, for example:

```json
{
  "binary": "C:\\AI\\whisper.cpp\\build\\bin\\Release\\whisper-cli.exe"
}
```

Restart `npm run dev` after changing `config/ai.json` because the backend loads AI configuration at startup.

## Build the Windows desktop app

```powershell
npm run desktop:build
```

Use the generated `MarketOS Setup 1.0.0.exe` installer. The local AI executables and
model weights are large runtime resources and must remain in the installed app's stable
`resources` directory. A single-file portable build extracts those resources to a
temporary directory, which can be removed by Windows cleanup or security software while
MarketOS is still running and causes `spawn ... ENOENT` errors.

## AI endpoints

- `GET /api/models/status`: reports whether the STT and reasoning executables and model files were found.
- `POST /api/transcribe`: accepts authenticated `audio/wav` data and returns a transcript.
- `POST /api/notes/analyze`: uses the configured reasoning model and returns a structured draft.

If the reasoning model is not configured, MarketOS retains its deterministic extraction rules. If a configured reasoning model fails and `strict` is `false`, MarketOS falls back to those rules and displays a warning on the review screen.

Speech-to-text has no rules fallback. The Record Voice button therefore reports a configuration error until `whisper.cpp` is ready.

## Memory policy: maximum 5 GB RAM

The application enforces a low-memory architecture:

- Speech-to-text and reasoning requests share one serialized AI queue.
- Only one local AI subprocess is allowed to run at a time.
- Each model is launched for its request and exits afterward.
- Voice recordings are limited to 60 seconds and 12 MB.
- Reasoning context defaults to 2,048 tokens.
- Reasoning output defaults to 512 tokens.
- CPU threads default to a maximum of four.
- No PyTorch, Transformers, Docker, or cloud API is required.

Recommended starting models under this constraint:

- Quantized Whisper Small, with Whisper Base as the lower-memory fallback.
- Qwen3 1.7B in a Q4 GGUF quantization.

The exact peak RAM still depends on the selected model files and the build options used for `whisper.cpp` and `llama.cpp`; profile the final binaries on the target computer before deployment.

## Backend storage

The backend uses Node's standard library and persists application records to `data/marketos.json`. Business records remain local and are saved only after the user reviews and confirms the extracted draft.
