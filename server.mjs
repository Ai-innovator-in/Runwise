import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const RESOURCE_DIR = process.env.MARKETOS_RESOURCE_DIR || __dirname;
const DATA_DIR = process.env.MARKETOS_DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "marketos.json");
const DIST_DIR = path.join(__dirname, "dist");
const CONFIG_DIR = process.env.MARKETOS_CONFIG_DIR || path.join(RESOURCE_DIR, "config");
const AI_CONFIG_FILE = path.join(CONFIG_DIR, "ai.json");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const TODAY = new Date().toISOString().slice(0, 10);
const DEFAULT_THREADS = Math.max(
  1,
  Math.min(4, availableParallelism()),
);

const DEFAULT_AI_CONFIG = {
  limits: {
    maxAudioSeconds: 60,
    maxAudioMb: 12,
    maxCombinedRamGb: 5,
  },
  stt: {
    enabled: false,
    binary: "",
    model: "",
    language: "en",
    threads: DEFAULT_THREADS,
    timeoutSeconds: 120,
  },
  reasoning: {
    enabled: false,
    binary: "",
    model: "",
    context: 2048,
    maxTokens: 512,
    threads: DEFAULT_THREADS,
    timeoutSeconds: 180,
    strict: false,
  },
};

function deepMerge(base, override) {
  return {
    ...base,
    ...override,
    limits: {
      ...base.limits,
      ...(override?.limits || {}),
    },
    stt: {
      ...base.stt,
      ...(override?.stt || {}),
    },
    reasoning: {
      ...base.reasoning,
      ...(override?.reasoning || {}),
    },
  };
}

function loadAiConfig() {
  let fileConfig = {};

  if (existsSync(AI_CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(
        readFileSync(AI_CONFIG_FILE, "utf8"),
      );
    } catch (error) {
      console.warn(
        `Could not read ${AI_CONFIG_FILE}: ${error.message}`,
      );
    }
  }

  const config = deepMerge(DEFAULT_AI_CONFIG, fileConfig);

  if (process.env.WHISPER_CLI) {
    config.stt.binary = process.env.WHISPER_CLI;
  }

  if (process.env.WHISPER_MODEL) {
    config.stt.model = process.env.WHISPER_MODEL;
  }

  if (process.env.LLAMA_CLI) {
    config.reasoning.binary = process.env.LLAMA_CLI;
  }

  if (process.env.LLAMA_MODEL) {
    config.reasoning.model = process.env.LLAMA_MODEL;
  }

  if (
    process.env.WHISPER_CLI &&
    process.env.WHISPER_MODEL
  ) {
    config.stt.enabled = true;
  }

  if (
    process.env.LLAMA_CLI &&
    process.env.LLAMA_MODEL
  ) {
    config.reasoning.enabled = true;
  }

  return config;
}

const AI_CONFIG = loadAiConfig();

let aiQueue = Promise.resolve();

function queueAiTask(task) {
  const next = aiQueue.then(task, task);
  aiQueue = next.catch(() => undefined);
  return next;
}

function configuredPath(value) {
  if (!value) return "";

  return path.isAbsolute(value)
    ? value
    : path.resolve(RESOURCE_DIR, value);
}

function executableReady(section) {
  const binary = configuredPath(section.binary);
  const model = configuredPath(section.model);

  return Boolean(
    section.enabled &&
      binary &&
      model &&
      existsSync(binary) &&
      existsSync(model),
  );
}

const id = (prefix) =>
  `${prefix}_${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}`;

const amount = (value) =>
  Number(
    String(value || "0").replace(/[^\d.-]/g, ""),
  ) || 0;

const titleCase = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

// Remove leading quantity words like "bags of", "pieces of", "units of", etc.
const cleanProductName = (raw) => {
  const text = String(raw || "").trim();
  // Remove common quantity‑unit prefixes
  const cleaned = text.replace(
    /^(?:\d+\s+)?(?:bags?\s+of|pieces?\s+of|units?\s+of|litres?\s+of|kg\s+of|kgs?\s+of|packs?\s+of|crates?\s+of|cartons?\s+of|rolls?\s+of|bottles?\s+of|tins?\s+of|sacks?\s+of)\s+/i,
    "",
  );
  return cleaned || text;
};

// Remove leading quantity words like "bags of", "pieces of", "units of", etc.
const cleanProductName = (raw) => {
  const text = String(raw || "").trim();
  // Remove common quantity‑unit prefixes
  const cleaned = text.replace(
    /^(?:\d+\s+)?(?:bags?\s+of|pieces?\s+of|units?\s+of|litres?\s+of|kg\s+of|kgs?\s+of|packs?\s+of|crates?\s+of|cartons?\s+of|rolls?\s+of|bottles?\s+of|tins?\s+of|sacks?\s+of)\s+/i,
    "",
  );
  return cleaned || text;
};

function emptyBusiness({ businessName, location }) {
  return {
    settings: {
      businessName: businessName || "",
      location: location || "",
      currency: "NGN",
      language: "English",
      offlineMode: true,
      cloudSync: false,
      backupLocation: "Local disk",
      lastBackup: null,
    },
    inventory: [],
    customers: [],
    sales: [],
    expenses: [],
    invoices: [],
    notes: [],
    knowledge: [],
    performance: {
      runtime: "local",
      model: null,
      quantization: null,
      contextWindow: null,
      threads: null,
      ramUsageGb: null,
      peakRamGb: null,
      tokensPerSecond: null,
      extractionSeconds: null,
      ragSeconds: null,
      cpuTemperatureC: null,
      lastBenchmark: null,
    },
  };
}

function emptyDb() {
  return {
    version: 2,
    users: [],
    sessions: {},
  };
}

async function loadDb() {
  await mkdir(DATA_DIR, { recursive: true });

  if (!existsSync(DB_FILE)) {
    const db = emptyDb();
    await saveDb(db);
    return db;
  }

  const parsed = JSON.parse(
    await readFile(DB_FILE, "utf8"),
  );

  if (Array.isArray(parsed.users)) {
    return {
      ...emptyDb(),
      ...parsed,
      version: 2,
    };
  }

  return emptyDb();
}

async function saveDb(db) {
  await mkdir(DATA_DIR, { recursive: true });

  await writeFile(
    DB_FILE,
    JSON.stringify(db, null, 2),
  );
}

function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) {
  const hash = crypto
    .pbkdf2Sync(
      password,
      salt,
      120000,
      32,
      "sha256",
    )
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt] = String(stored || "").split(":");

  return crypto.timingSafeEqual(
    Buffer.from(hashPassword(password, salt)),
    Buffer.from(stored),
  );
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    businessName:
      user.data.settings.businessName,
    location: user.data.settings.location,
  };
}

function getToken(req, url) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return header.slice(7);
  }

  return url.searchParams.get("token") || "";
}

function requireUser(req, url, db) {
  const token = getToken(req, url);
  const session = db.sessions[token];

  if (!session) {
    throw Object.assign(
      new Error("Authentication required."),
      { status: 401 },
    );
  }

  const user = db.users.find(
    (item) => item.id === session.userId,
  );

  if (!user) {
    throw Object.assign(
      new Error("Session user was not found."),
      { status: 401 },
    );
  }

  return user;
}

function productByName(data, productName) {
  const needle = String(productName || "")
    .toLowerCase();

  return data.inventory.find(
    (item) =>
      item.name.toLowerCase() === needle,
  );
}

function customerByName(data, customerName) {
  const name = titleCase(customerName);

  let customer = data.customers.find(
    (item) =>
      item.name.toLowerCase() ===
      name.toLowerCase(),
  );

  if (!customer && name) {
    customer = {
      id: id("cust"),
      name,
      debt: 0,
      lastActivity: TODAY,
      status: "Active",
      history: [],
    };

    data.customers.unshift(customer);
  }

  return customer;
}

function addDebt(
  data,
  customerName,
  debtAmount,
  note,
) {
  const customer = customerByName(
    data,
    customerName,
  );

  if (!customer) return;

  customer.debt += amount(debtAmount);
  customer.lastActivity = TODAY;
  customer.status =
    customer.debt > 0 ? "Active" : "Paid";

  customer.history.unshift({
    date: TODAY,
    type: "Credit",
    amount: amount(debtAmount),
    note,
  });
}

function summary(data) {
  const todaySales = data.sales.filter(
    (sale) => sale.date === TODAY,
  );

  const todayExpenses = data.expenses.filter(
    (expense) => expense.date === TODAY,
  );

  const salesTotal = todaySales.reduce(
    (sum, sale) =>
      sum + sale.quantity * sale.unitPrice,
    0,
  );

  const expensesTotal = todayExpenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );

  const creditIssued = todaySales
    .filter(
      (sale) => sale.channel === "Credit",
    )
    .reduce(
      (sum, sale) =>
        sum + sale.quantity * sale.unitPrice,
      0,
    );

  const customerDebt = data.customers.reduce(
    (sum, customer) =>
      sum + customer.debt,
    0,
  );

  const inventoryValue =
    data.inventory.reduce(
      (sum, item) =>
        sum + item.stock * item.costPrice,
      0,
    );

  const lowStock = data.inventory.filter(
    (item) => item.stock <= 10,
  );

  const bestMargin = [
    ...data.inventory,
  ].sort(
    (a, b) =>
      (b.sellPrice - b.costPrice) /
        (b.sellPrice || 1) -
      (a.sellPrice - a.costPrice) /
        (a.sellPrice || 1),
  )[0];

  const alerts = [];

  if (lowStock.length) {
    alerts.push(
      `${lowStock.length} product${
        lowStock.length === 1 ? "" : "s"
      } need restocking`,
    );
  }

  if (customerDebt > 0) {
    alerts.push(
      `Customers owe ₦${customerDebt.toLocaleString()}`,
    );
  }

  if (
    !data.sales.length &&
    !data.expenses.length &&
    !data.inventory.length
  ) {
    alerts.push(
      "Your workspace is empty. Add your first record to begin.",
    );
  }

  return {
    today: TODAY,
    salesTotal,
    expensesTotal,
    cashReceived:
      salesTotal - creditIssued,
    creditIssued,
    customerDebt,
    customersOwing: data.customers.filter(
      (customer) => customer.debt > 0,
    ).length,
    overdueDebt: data.customers
      .filter(
        (customer) =>
          customer.status === "Overdue",
      )
      .reduce(
        (sum, customer) =>
          sum + customer.debt,
        0,
      ),
    inventoryValue,
    totalProducts: data.inventory.length,
    lowStockCount: lowStock.length,
    fastMovingItems: data.sales.length
      ? new Set(
          data.sales.map(
            (sale) => sale.product,
          ),
        ).size
      : 0,
    bestMarginProduct:
      bestMargin?.name || "",
    alerts,
  };
}

function bootstrap(user) {
  const data = user.data;

  const recentActivity = [
    ...data.sales.map((sale) => ({
      id: sale.id,
      type: "Sale",
      description: `${sale.product} x ${sale.quantity}`,
      amount:
        sale.quantity * sale.unitPrice,
      date: sale.date,
    })),
    ...data.expenses.map((expense) => ({
      id: expense.id,
      type: "Expense",
      description: expense.category,
      amount: -expense.amount,
      date: expense.date,
    })),
    ...data.customers.flatMap((customer) =>
      customer.history.map(
        (entry, index) => ({
          id: `${customer.id}_${index}`,
          type: entry.type,
          description: `${customer.name} - ${entry.note}`,
          amount:
            entry.type === "Payment"
              ? -entry.amount
              : entry.amount,
          date: entry.date,
        }),
      ),
    ),
  ]
    .sort((a, b) =>
      b.date.localeCompare(a.date),
    )
    .slice(0, 10);

  return {
    user: publicUser(user),
    ...data,
    summary: summary(data),
    recentActivity,
  };
}

function modelStatus() {
  const sttBinary = configuredPath(
    AI_CONFIG.stt.binary,
  );

  const sttModel = configuredPath(
    AI_CONFIG.stt.model,
  );

  const reasoningBinary = configuredPath(
    AI_CONFIG.reasoning.binary,
  );

  const reasoningModel = configuredPath(
    AI_CONFIG.reasoning.model,
  );

  return {
    memoryPolicy: {
      maxCombinedRamGb:
        Number(
          AI_CONFIG.limits.maxCombinedRamGb,
        ) || 5,
      serializedInference: true,
      maxAudioSeconds:
        Number(
          AI_CONFIG.limits.maxAudioSeconds,
        ) || 60,
    },
    stt: {
      enabled: Boolean(
        AI_CONFIG.stt.enabled,
      ),
      ready: executableReady(AI_CONFIG.stt),
      binaryFound: Boolean(
        sttBinary && existsSync(sttBinary),
      ),
      modelFound: Boolean(
        sttModel && existsSync(sttModel),
      ),
      model: sttModel
        ? path.basename(sttModel)
        : null,
      language:
        AI_CONFIG.stt.language || "en",
      threads:
        Number(AI_CONFIG.stt.threads) ||
        DEFAULT_THREADS,
    },
    reasoning: {
      enabled: Boolean(
        AI_CONFIG.reasoning.enabled,
      ),
      ready: executableReady(
        AI_CONFIG.reasoning,
      ),
      binaryFound: Boolean(
        reasoningBinary &&
          existsSync(reasoningBinary),
      ),
      modelFound: Boolean(
        reasoningModel &&
          existsSync(reasoningModel),
      ),
      model: reasoningModel
        ? path.basename(reasoningModel)
        : null,
      context:
        Number(
          AI_CONFIG.reasoning.context,
        ) || 2048,
      maxTokens:
        Number(
          AI_CONFIG.reasoning.maxTokens,
        ) || 512,
      threads:
        Number(
          AI_CONFIG.reasoning.threads,
        ) || DEFAULT_THREADS,
    },
  };
}

function runProcess(
  binary,
  args,
  {
    timeoutSeconds,
    maxOutputBytes = 4 * 1024 * 1024,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: __dirname,
      windowsHide: true,
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    });

    const stdout = [];
    const stderr = [];

    let outputBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      callback();
    };

    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;

      if (
        outputBytes > maxOutputBytes
      ) {
        child.kill();

        finish(() =>
          reject(
            new Error(
              "The local AI process produced too much output and was stopped.",
            ),
          ),
        );

        return;
      }

      target.push(chunk);
    };

    child.stdout.on(
      "data",
      collect(stdout),
    );

    child.stderr.on(
      "data",
      collect(stderr),
    );

    child.on("error", (error) =>
      finish(() => reject(error)),
    );

    child.on("exit", (code) =>
      finish(() => {
        const stdoutText = Buffer.concat(
          stdout,
        ).toString("utf8");

        const stderrText = Buffer.concat(
          stderr,
        ).toString("utf8");

        if (code !== 0) {
          const detail =
            stderrText
              .trim()
              .slice(-1500) ||
            stdoutText
              .trim()
              .slice(-1500) ||
            `exit code ${code}`;

          reject(
            new Error(
              `Local AI process failed: ${detail}`,
            ),
          );

          return;
        }

        resolve({
          stdout: stdoutText,
          stderr: stderrText,
        });
      }),
    );

    const timer = setTimeout(() => {
      child.kill();

      finish(() =>
        reject(
          new Error(
            `Local AI process timed out after ${timeoutSeconds} seconds.`,
          ),
        ),
      );
    }, Math.max(1, Number(timeoutSeconds) || 120) * 1000);
  });
}

class ProcessManager {
  constructor() {
    this.activeProcess = null;
    this.activeType = null;
    this.startTime = null;
    this.timeoutTimer = null;
    this.activePromise = null;
    this.activeResolve = null;
    this.activeReject = null;
  }

  acquire(type, binary, args, { timeoutSeconds } = {}) {
    // If there is an active process, kill it first
    if (this.activeProcess) {
      this.killActive();
    }

    return new Promise((resolve, reject) => {
      this.activeType = type;
      this.activeResolve = resolve;
      this.activeReject = reject;
      this.startTime = Date.now();

      const child = spawn(binary, args, {
        cwd: __dirname,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.activeProcess = child;

      const stdout = [];
      const stderr = [];
      let outputBytes = 0;
      let settled = false;
      const maxOutputBytes = 4 * 1024 * 1024;

      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.timeoutTimer);
        callback();
      };

      const collect = (target) => (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          child.kill();
          finish(() =>
            reject(
              new Error(
                "The local AI process produced too much output and was stopped.",
              ),
            ),
          );
          return;
        }
        target.push(chunk);
      };

      child.stdout.on("data", collect(stdout));
      child.stderr.on("data", collect(stderr));

      child.on("error", (error) =>
        finish(() => {
          this.release();
          reject(error);
        }),
      );

      child.on("exit", (code) =>
        finish(() => {
          this.release();
          const stdoutText = Buffer.concat(stdout).toString("utf8");
          const stderrText = Buffer.concat(stderr).toString("utf8");
          if (code !== 0) {
            const detail =
              stderrText.trim().slice(-1500) ||
              stdoutText.trim().slice(-1500) ||
              `exit code ${code}`;
            reject(new Error(`Local AI process failed: ${detail}`));
            return;
          }
          resolve({ stdout: stdoutText, stderr: stderrText });
        }),
      );

      this.timeoutTimer = setTimeout(() => {
        child.kill();
        finish(() => {
          this.release();
          reject(
            new Error(
              `Local AI process timed out after ${timeoutSeconds} seconds.`,
            ),
          );
        });
      }, Math.max(1, Number(timeoutSeconds) || 120) * 1000);
    });
  }

  killActive() {
    if (!this.activeProcess) return Promise.resolve();

    return new Promise((resolve) => {
      const child = this.activeProcess;
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000);

      child.on("exit", () => {
        clearTimeout(killTimer);
        this.release();
        resolve();
      });

      child.kill("SIGTERM");
    });
  }

  release() {
    this.activeProcess = null;
    this.activeType = null;
    this.startTime = null;
    this.timeoutTimer = null;
    this.activePromise = null;
    this.activeResolve = null;
    this.activeReject = null;
  }

  shutdown() {
    return this.killActive();
  }
}

const manager = new ProcessManager();

function wavDurationSeconds(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !==
      "RIFF" ||
    buffer.toString("ascii", 8, 12) !==
      "WAVE"
  ) {
    return null;
  }

  const byteRate = buffer.readUInt32LE(28);

  if (!byteRate) return null;

  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString(
      "ascii",
      offset,
      offset + 4,
    );

    const chunkSize =
      buffer.readUInt32LE(offset + 4);

    if (chunkId === "data") {
      return chunkSize / byteRate;
    }

    offset +=
      8 +
      chunkSize +
      (chunkSize % 2);
  }

  return null;
}

function transcriptLooksInvalid(
  text,
  language,
) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return true;

  if (
    String(language).toLowerCase() ===
    "en"
  ) {
    const letters = Array.from(
      normalized,
    ).filter((character) =>
      /\p{L}/u.test(character),
    );

    const latinLetters = letters.filter(
      (character) =>
        /\p{Script=Latin}/u.test(
          character,
        ),
    );

    if (
      letters.length >= 4 &&
      latinLetters.length /
        letters.length <
        0.8
    ) {
      return true;
    }
  }

  const compact = Array.from(
    normalized
      .toLowerCase()
      .replace(/\s+/g, ""),
  );

  if (compact.length >= 20) {
    const bigrams = [];

    for (
      let index = 0;
      index < compact.length - 1;
      index += 1
    ) {
      bigrams.push(
        `${compact[index]}${compact[index + 1]}`,
      );
    }

    const uniqueRatio =
      new Set(bigrams).size /
      bigrams.length;

    if (uniqueRatio < 0.2) {
      return true;
    }
  }

  const words = normalized
    .toLowerCase()
    .split(/\s+/);

  if (
    words.length >= 6 &&
    new Set(words).size /
      words.length <
      0.35
  ) {
    return true;
  }

  return false;
}

async function transcribeAudio(
  audioBuffer,
) {
  if (
    !executableReady(AI_CONFIG.stt)
  ) {
    throw Object.assign(
      new Error(
        "Speech-to-text is not configured. Copy config/ai.example.json to config/ai.json and set the whisper.cpp binary and model paths.",
      ),
      { status: 503 },
    );
  }

  const maxBytes =
    Math.max(
      1,
      Number(
        AI_CONFIG.limits.maxAudioMb,
      ) || 12,
    ) *
    1024 *
    1024;

  if (!audioBuffer.length) {
    throw Object.assign(
      new Error(
        "The voice recording was empty.",
      ),
      { status: 400 },
    );
  }

  if (
    audioBuffer.length > maxBytes
  ) {
    throw Object.assign(
      new Error(
        `Voice recordings are limited to ${AI_CONFIG.limits.maxAudioMb} MB.`,
      ),
      { status: 413 },
    );
  }

  const durationSeconds =
    wavDurationSeconds(audioBuffer);

  if (durationSeconds === null) {
    throw Object.assign(
      new Error(
        "MarketOS expected a mono PCM WAV recording.",
      ),
      { status: 415 },
    );
  }

  if (
    durationSeconds >
    Number(
      AI_CONFIG.limits
        .maxAudioSeconds || 60,
    ) +
      1
  ) {
    throw Object.assign(
      new Error(
        `Voice recordings are limited to ${AI_CONFIG.limits.maxAudioSeconds} seconds.`,
      ),
      { status: 413 },
    );
  }

  await mkdir(TMP_DIR, {
    recursive: true,
  });

  const runId = id("voice");

  const inputFile = path.join(
    TMP_DIR,
    `${runId}.wav`,
  );

  const outputBase = path.join(
    TMP_DIR,
    `${runId}-transcript`,
  );

  const outputFile =
    `${outputBase}.txt`;

  await writeFile(
    inputFile,
    audioBuffer,
  );

  try {
    await manager.acquire(
      'stt',
      configuredPath(
        AI_CONFIG.stt.binary,
      ),
      [
        "-m",
        configuredPath(
          AI_CONFIG.stt.model,
        ),
        "-f",
        inputFile,
        "-l",
        String(
          AI_CONFIG.stt.language ||
            "en",
        ),
        "-t",
        String(
          Math.max(
            1,
            Number(
              AI_CONFIG.stt.threads,
            ) || DEFAULT_THREADS,
          ),
        ),
        "--best-of",
        "1",
        "--beam-size",
        "1",
        "--max-context",
        "0",
        "--no-fallback",
        "--suppress-nst",
        "--no-timestamps",
        "--no-speech-thold",
        "0.40",
        "--output-txt",
        "-of",
        outputBase,
      ],
      {
        timeoutSeconds:
          AI_CONFIG.stt
            .timeoutSeconds,
      },
    );

    if (!existsSync(outputFile)) {
      throw new Error(
        "whisper.cpp completed without creating a transcript file.",
      );
    }

    const text = String(
      await readFile(
        outputFile,
        "utf8",
      ),
    ).trim();

    const language = String(
      AI_CONFIG.stt.language ||
        "en",
    ).toLowerCase();

    if (!text) {
      throw Object.assign(
        new Error(
          "No speech was detected in the recording.",
        ),
        { status: 422 },
      );
    }

    if (
      transcriptLooksInvalid(
        text,
        language,
      )
    ) {
      throw Object.assign(
        new Error(
          "The recording could not be understood clearly. Speak closer to the microphone and avoid silence or background noise.",
        ),
        { status: 422 },
      );
    }

    return {
      text,
      language,
      durationSeconds: Number(
        durationSeconds.toFixed(2),
      ),
      engine: "whisper.cpp",
      model: path.basename(
        configuredPath(
          AI_CONFIG.stt.model,
        ),
      ),
    };
  } finally {
    await Promise.all([
      rm(inputFile, {
        force: true,
      }),
      rm(outputFile, {
        force: true,
      }),
    ]).catch(() => undefined);
  }
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sales",
    "expenses",
    "debts",
  ],
  properties: {
    sales: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "product",
          "quantity",
          "channel",
          "customer",
        ],
        properties: {
          product: {
            type: "string",
          },
          quantity: {
            type: "number",
            minimum: 0,
          },
          unitPrice: {
            type: "number",
            minimum: 0,
          },
          totalAmount: {
            type: "number",
            minimum: 0,
          },
          channel: {
            type: "string",
            enum: [
              "Cash",
              "Credit",
            ],
          },
          customer: {
            type: "string",
          },
        },
      },
    },
    expenses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "category",
          "amount",
          "note",
          "status",
        ],
        properties: {
          category: {
            type: "string",
          },
          amount: {
            type: "number",
            minimum: 0,
          },
          note: {
            type: "string",
          },
          status: {
            type: "string",
            enum: [
              "Paid",
              "Unpaid",
            ],
          },
        },
      },
    },
    debts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "customer",
          "amount",
          "status",
          "note",
        ],
        properties: {
          customer: {
            type: "string",
          },
          amount: {
            type: "number",
            minimum: 0,
          },
          status: {
            type: "string",
            enum: [
              "Owes business",
              "Business owes",
            ],
          },
          note: {
            type: "string",
          },
        },
      },
    },
  },
};

function extractFirstJson(text) {
  const start = text.indexOf("{");

  if (start < 0) {
    throw new Error(
      "The reasoning model did not return JSON.",
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (
    let index = start;
    index < text.length;
    index += 1
  ) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return JSON.parse(
          text.slice(
            start,
            index + 1,
          ),
        );
      }
    }
  }

  throw new Error(
    "The reasoning model returned incomplete JSON.",
  );
}

function createDraft(
  text,
  sales,
  expenses,
  debts,
  inference,
) {
  if (
    !sales.length &&
    !expenses.length &&
    !debts.length
  ) {
    throw Object.assign(
      new Error(
        "No business records were detected in the note.",
      ),
      { status: 422 },
    );
  }

  return {
    id: id("draft"),
    note: text,
    createdAt:
      new Date().toISOString(),
    sales,
    expenses,
    debts,
    summary: {
      salesTotal: sales.reduce(
        (sum, sale) =>
          sum +
          sale.quantity *
            sale.unitPrice,
        0,
      ),
      expensesTotal:
        expenses.reduce(
          (sum, expense) =>
            sum + expense.amount,
          0,
        ),
      creditIssued: debts
        .filter(
          (debt) =>
            debt.status ===
            "Owes business",
        )
        .reduce(
          (sum, debt) =>
            sum + debt.amount,
          0,
        ),
    },
    inference,
  };
}

function normalizeSale(rawSale) {
  const product = titleCase(cleanProductName(rawSale.product || ""));
  let quantity = amount(rawSale.quantity);
  const channel = rawSale.channel === "Credit" ? "Credit" : "Cash";
  const customer = titleCase(rawSale.customer || "");

  let unitPrice = null;
  let totalAmount = null;
  const rawUnitPrice = amount(rawSale.unitPrice);
  const rawTotalAmount = amount(rawSale.totalAmount);

  // Default quantity to 1 when totalAmount exists and quantity is 0
  if (quantity === 0 && rawTotalAmount > 0) {
    quantity = 1;
  }

  if (rawUnitPrice > 0) {
    // explicit unit price
    unitPrice = rawUnitPrice;
    totalAmount = quantity * unitPrice;
  } else if (rawTotalAmount > 0 && quantity > 0) {
    // total amount provided, compute unit price
    unitPrice = rawTotalAmount / quantity;
    totalAmount = rawTotalAmount;
  } else if (rawTotalAmount > 0 && quantity === 0) {
    // total amount but no quantity – treat total as unit price (fallback)
    unitPrice = rawTotalAmount;
    totalAmount = rawTotalAmount;
  }

  // If neither unitPrice nor totalAmount is provided, unitPrice stays null

  return {
    id: id("draft_sale"),
    product,
    quantity,
    unitPrice,
    totalAmount,
    channel,
    customer,
  };
}

function normalizeModelDraft(
  text,
  modelOutput,
) {
  const sales = (
    Array.isArray(modelOutput.sales)
      ? modelOutput.sales
      : []
  )
    .map((sale) => normalizeSale(sale))
    .filter(
      (sale) =>
        sale.product &&
        sale.quantity > 0 &&
        sale.unitPrice !== null &&
        sale.unitPrice >= 0,
    );

  const expenses = (
    Array.isArray(
      modelOutput.expenses,
    )
      ? modelOutput.expenses
      : []
  )
    .map((expense) => ({
      id: id("draft_exp"),
      category: titleCase(
        expense.category ||
          expense.note,
      ),
      amount: amount(
        expense.amount,
      ),
      note: String(
        expense.note ||
          expense.category ||
          "",
      ).trim(),
      status:
        expense.status === "Unpaid"
          ? "Unpaid"
          : "Paid",
    }))
    .filter(
      (expense) =>
        expense.category &&
        expense.amount > 0,
    );

  const debts = (
    Array.isArray(modelOutput.debts)
      ? modelOutput.debts
      : []
  )
    .map((debt) => ({
      id: id("draft_debt"),
      customer: titleCase(
        debt.customer,
      ),
      amount: amount(debt.amount),
      status:
        debt.status ===
        "Business owes"
          ? "Business owes"
          : "Owes business",
      note: String(
        debt.note ||
          "Credit transaction",
      ).trim(),
    }))
    .filter(
      (debt) =>
        debt.customer &&
        debt.amount > 0,
    );

  return createDraft(
    text,
    sales,
    expenses,
    debts,
    {
      engine: "llama.cpp",
      model: path.basename(
        configuredPath(
          AI_CONFIG.reasoning.model,
        ),
      ),
    },
  );
}

async function analyzeWithReasoningModel(text) {
  const prompt = [
    "You are a strict business transaction parser.",
    "",
    "Your job is extraction, not interpretation.",
    "NEVER invent information.",
    "",
    "Rules:",
    "",
    "SALES:",
    "- Create a sale only when the user explicitly mentions selling, sold, bought by customer, or a transaction.",
    "- Preserve quantities and prices exactly as stated.",
    "- If the user says '50 bags of cement for 5000', treat 5000 as the total amount.",
    "- If the user says '50 bags of cement for a total of 5000', treat 5000 as the total amount.",
    "- If the user says '50 bags of cement at 5000 each', treat 5000 as the unit price.",
    "- Do NOT calculate unit price unless the user explicitly provides it.",
    "- When extracting the product name, remove leading quantity words like 'bags of', 'pieces of', 'units of', etc. For example, 'bags of cement' should become 'cement'.",
    "",
    "EXPENSES:",
    "- Create an expense ONLY when the user explicitly says money was spent.",
    "- Valid expense indicators: paid, spent, bought, cost me, expense, purchased.",
    "- Do not create transport, delivery, fuel, or any other expense based on assumptions.",
    "",
    "CUSTOMER DEBT:",
    "- Create debt ONLY when the user explicitly indicates unpaid credit.",
    "- Valid debt indicators: owes, owe me, on credit, pay later, unpaid balance, remaining balance.",
    "- Selling to a customer does NOT mean debt.",
    "",
    "UNCERTAINTY:",
    "- If information is missing, return null or empty.",
    "- Never guess.",
    "",
    "Example:",
    "",
    "Input:",
    '"I sold 50 bags of cement to Alfred for 5000"',
    "",
    "Correct output:",
    "Sale:",
    "- Customer: Alfred",
    "- Item: cement",
    "- Quantity: 50",
    "- Total: 5000",
    "",
    "Expenses:",
    "none",
    "",
    "Debt:",
    "none",
    "",
    `Business note:\n${text}`,
  ].join("\n\n");

  const templateFile = path.join(
    CONFIG_DIR,
    "marketos-json.jinja",
  );

  if (!existsSync(templateFile)) {
    throw new Error(
      "The MarketOS JSON chat template was not found at config/marketos-json.jinja.",
    );
  }

  const { stdout } = await manager.acquire(
    'reasoning',
    configuredPath(AI_CONFIG.reasoning.binary),
    [
      "-m",
      configuredPath(AI_CONFIG.reasoning.model),

      "-p",
      prompt,

      "-n",
      String(
        Math.max(
          64,
          Math.min(
            256,
            Number(AI_CONFIG.reasoning.maxTokens) || 512,
          ),
        ),
      ),

      "-c",
      String(
        Math.max(
          512,
          Math.min(
            1024,
            Number(AI_CONFIG.reasoning.context) || 2048,
          ),
        ),
      ),

      "-t",
      String(
        Math.max(
          1,
          Number(AI_CONFIG.reasoning.threads) || DEFAULT_THREADS,
        ),
      ),

      "--temp",
      "0",

      "--top-k",
      "1",

      "--top-p",
      "1",

      "--min-p",
      "0",

      "--presence-penalty",
      "0",

      "--jinja",

      "--chat-template-file",
      templateFile,

      "--single-turn",

      "--no-display-prompt",

      "--no-show-timings",

      "--simple-io",

      "--no-warmup",

      "--json-schema",
      JSON.stringify(EXTRACTION_SCHEMA),
    ],
    {
      timeoutSeconds: AI_CONFIG.reasoning.timeoutSeconds,
    },
  );

  return normalizeModelDraft(
    text,
    extractFirstJson(stdout),
  );
}

function analyzeNoteWithRules(
  note,
  warning = "",
) {
  const text = String(note || "")
    .trim();

  if (!text) {
    throw Object.assign(
      new Error(
        "Write a business note before analyzing.",
      ),
      { status: 400 },
    );
  }

  const sales = [];
  const expenses = [];
  const debts = [];

  // Sale with "for" (total amount)
  for (const match of text.matchAll(
    /sold\s+(\d+)\s+(.+?)\s+for\s+₦?([\d,]+)/gi,
  )) {
    const rawSale = {
      product: match[2],
      quantity: amount(match[1]),
      unitPrice: null,
      totalAmount: amount(match[3]),
      channel: "Cash",
      customer: "",
    };
    sales.push(normalizeSale(rawSale));
  }

  // Sale with "for a total of" (total amount)
  for (const match of text.matchAll(
    /sold\s+(\d+)\s+(.+?)\s+for\s+a\s+total\s+of\s+₦?([\d,]+)/gi,
  )) {
    const rawSale = {
      product: match[2],
      quantity: amount(match[1]),
      unitPrice: null,
      totalAmount: amount(match[3]),
      channel: "Cash",
      customer: "",
    };
    sales.push(normalizeSale(rawSale));
  }

  // Sale with "at" (unit price)
  for (const match of text.matchAll(
    /sold\s+(\d+)\s+(.+?)\s+at\s+₦?([\d,]+)\s+each/gi,
  )) {
    const rawSale = {
      product: match[2],
      quantity: amount(match[1]),
      unitPrice: amount(match[3]),
      totalAmount: null,
      channel: "Cash",
      customer: "",
    };
    sales.push(normalizeSale(rawSale));
  }

  // Sale without quantity (e.g., "sold cement to Musa for 5,000")
  for (const match of text.matchAll(
    /sold\s+(.+?)\s+(?:to\s+\S+\s+)?for\s+₦?([\d,]+)/gi,
  )) {
    const rawSale = {
      product: match[1],
      quantity: 1,
      unitPrice: null,
      totalAmount: amount(match[2]),
      channel: "Cash",
      customer: "",
    };
    sales.push(normalizeSale(rawSale));
  }

  // Credit pattern: "Musa took 50 bags of cement on credit for 5,000"
  for (const match of text.matchAll(
    /\b([A-Z][a-z]+)\s+took\s+(\d+)\s+(.+?)\s+on\s+credit\s+for\s+₦?([\d,]+)/gi,
  )) {
    const rawSale = {
      product: match[3],
      quantity: amount(match[2]),
      unitPrice: null,
      totalAmount: amount(match[4]),
      channel: "Credit",
      customer: match[1],
    };
    sales.push(normalizeSale(rawSale));
  }

  for (const match of text.matchAll(
    /\b(?:paid|bought)\s+(.+?)\s+₦?([\d,]+)(?=\.|,|$)/gi,
  )) {
    expenses.push({
      id: id("draft_exp"),
      category: titleCase(match[1]),
      amount: amount(match[2]),
      note: titleCase(match[1]),
      status: "Paid",
    });
  }

  for (const match of text.matchAll(
    /\b([A-Z][a-z]+)\s+took\s+goods\s+worth\s+₦?([\d,]+)\s+on\s+credit/gi,
  )) {
    debts.push({
      id: id("draft_debt"),
      customer: titleCase(match[1]),
      amount: amount(match[2]),
      status: "Owes business",
      note: "Goods taken on credit",
    });
  }

  if (
    !sales.length &&
    !expenses.length &&
    !debts.length
  ) {
    throw Object.assign(
      new Error(
        "No records were detected. Include words like sold, paid, bought, or customer credit details.",
      ),
      { status: 422 },
    );
  }

  return createDraft(
    text,
    sales,
    expenses,
    debts,
    {
      engine: warning
        ? "rules-fallback"
        : "rules",
      warning:
        warning || undefined,
    },
  );
}

async function analyzeBusinessNote(
  note,
) {
  const text = String(note || "")
    .trim();

  if (!text) {
    throw Object.assign(
      new Error(
        "Write a business note before analyzing.",
      ),
      { status: 400 },
    );
  }

  if (
    !executableReady(
      AI_CONFIG.reasoning,
    )
  ) {
    return analyzeNoteWithRules(text);
  }

  try {
    return await queueAiTask(() =>
      analyzeWithReasoningModel(text),
    );
  } catch (error) {
    if (
      AI_CONFIG.reasoning.strict
    ) {
      throw Object.assign(
        new Error(
          `Reasoning model failed: ${error.message}`,
        ),
        { status: 502 },
      );
    }

    return analyzeNoteWithRules(
      text,
      `Reasoning model failed, so MarketOS used its deterministic fallback: ${error.message}`,
    );
  }
}

function commitDraft(data, draft) {
  data.notes.unshift({
    id: id("note"),
    note: draft.note,
    createdAt:
      new Date().toISOString(),
    status: "Saved",
  });

  for (
    const sale of draft.sales || []
  ) {
    addSale(data, sale);
  }

  for (
    const expense of
    draft.expenses || []
  ) {
    data.expenses.unshift({
      id: id("exp"),
      date: TODAY,
      category: titleCase(
        expense.category,
      ),
      amount: amount(
        expense.amount,
      ),
      note: expense.note || "",
      status:
        expense.status || "Paid",
    });
  }

  for (
    const debt of draft.debts || []
  ) {
    if (debt.status === "Owes business") continue;
    addDebt(
      data,
      debt.customer,
      debt.amount,
      debt.note ||
        "Goods taken on credit",
    );
  }
}

function addSale(data, sale) {
  const quantity = amount(
    sale.quantity,
  );

  // Compute unitPrice from totalAmount if needed
  let unitPrice = amount(sale.unitPrice);
  if (unitPrice === 0 && sale.totalAmount > 0 && quantity > 0) {
    unitPrice = sale.totalAmount / quantity;
  } else if (unitPrice === 0 && sale.totalAmount > 0) {
    unitPrice = sale.totalAmount;
  }

  data.sales.unshift({
    id: id("sale"),
    date: TODAY,
    product: titleCase(
      sale.product,
    ),
    quantity,
    unitPrice,
    channel:
      sale.channel || "Cash",
    customer: titleCase(
      sale.customer || "",
    ),
  });

  const product = productByName(
    data,
    sale.product,
  );

  if (product) {
    product.stock = Math.max(
      0,
      product.stock - quantity,
    );
  }

  if (
    sale.channel === "Credit" &&
    sale.customer
  ) {
    addDebt(
      data,
      sale.customer,
      quantity * unitPrice,
      "Credit sale",
    );
  }
}

function coachAnswer(
  data,
  question,
) {
  const s = summary(data);
  const answer = [];

  if (
    !data.sales.length &&
    !data.inventory.length &&
    !data.customers.length
  ) {
    answer.push(
      "There is not enough business data yet to make a recommendation.",
    );

    answer.push(
      "Add sales, expenses, inventory, or customer debt records first.",
    );
  } else {
    if (s.lowStockCount) {
      answer.push(
        `${s.lowStockCount} product${
          s.lowStockCount === 1
            ? ""
            : "s"
        } are low on stock.`,
      );
    }

    if (s.customerDebt) {
      answer.push(
        `Outstanding customer debt is ₦${Number(
          s.customerDebt,
        ).toLocaleString()}.`,
      );
    }

    if (s.salesTotal) {
      answer.push(
        `Today's sales total is ₦${Number(
          s.salesTotal,
        ).toLocaleString()}.`,
      );
    }
  }

  return {
    question,
    answer,
    recommendedAction: answer.length
      ? "Use the ledger actions to add or update real records, then ask again for a more specific recommendation."
      : "",
    basedOn:
      "Your saved local records",
  };
}

function searchKnowledge(data, query) {
  const q = String(query || "")
    .toLowerCase();

  const matches =
    data.knowledge.filter((item) =>
      `${item.title} ${item.body}`
        .toLowerCase()
        .includes(q),
    );

  if (!matches.length) {
    return {
      answer:
        "No matching local knowledge documents were found.",
      sources: [],
      offline: true,
    };
  }

  return {
    answer: matches
      .map((item) => item.body)
      .join(" "),
    sources: matches.map(
      (item) => item.source,
    ),
    offline: true,
  };
}

function makeInvoicePdf(
  data,
  invoiceId,
) {
  const invoice = data.invoices.find(
    (item) => item.id === invoiceId,
  );

  if (!invoice) {
    throw Object.assign(
      new Error("Invoice not found."),
      { status: 404 },
    );
  }

  const total =
    invoice.quantity *
    invoice.unitPrice;

  const balance =
    total - invoice.amountPaid;

  const clean = (value) =>
    String(value).replace(
      /[\\()]/g,
      "",
    );

  const lines = [
    data.settings.businessName,
    invoice.number,
    `Customer: ${invoice.customerName}`,
    `Item: ${invoice.item}`,
    `Subtotal: NGN ${total.toLocaleString()}`,
    `Paid: NGN ${invoice.amountPaid.toLocaleString()}`,
    `Balance due: NGN ${balance.toLocaleString()}`,
  ];

  const stream = lines
    .map(
      (line, index) =>
        `BT /F1 14 Tf 72 ${
          760 - index * 28
        } Td (${clean(line)}) Tj ET`,
    )
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(
      stream,
    )} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";

  const offsets = [0];

  objects.forEach(
    (object, index) => {
      offsets.push(
        Buffer.byteLength(pdf),
      );

      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    },
  );

  const xrefOffset =
    Buffer.byteLength(pdf);

  pdf +=
    `xref\n0 ${objects.length + 1}\n` +
    "0000000000 65535 f \n";

  for (
    const offset of offsets.slice(1)
  ) {
    pdf += `${String(offset).padStart(
      10,
      "0",
    )} 00000 n \n`;
  }

  return (
    `${pdf}trailer\n` +
    `<< /Size ${
      objects.length + 1
    } /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n` +
    "%%EOF"
  );
}

async function readRawBody(
  req,
  maxBytes = 2 * 1024 * 1024,
) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > maxBytes) {
      throw Object.assign(
        new Error(
          "Request body is too large.",
        ),
        { status: 413 },
      );
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);

  if (!raw.length) return {};

  try {
    return JSON.parse(
      raw.toString("utf8"),
    );
  } catch {
    throw Object.assign(
      new Error(
        "Request body must contain valid JSON.",
      ),
      { status: 400 },
    );
  }
}

function send(
  res,
  status,
  payload,
  headers = {},
) {
  const body =
    typeof payload === "string" ||
    Buffer.isBuffer(payload)
      ? payload
      : JSON.stringify(payload);

  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Access-Control-Allow-Methods":
      "GET,POST,PUT,OPTIONS",
    "Content-Type":
      typeof payload === "object" &&
      !Buffer.isBuffer(payload)
        ? "application/json"
        : "text/plain",
    ...headers,
  });

  res.end(body);
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host}`,
  );

  const isAudioUpload =
    req.method === "POST" &&
    url.pathname ===
      "/api/transcribe";

  const db = await loadDb();

  const body =
    req.method === "GET" ||
    isAudioUpload
      ? {}
      : await readJsonBody(req);

  if (
    req.method === "GET" &&
    url.pathname === "/api/health"
  ) {
    return send(res, 200, {
      ok: true,
      date: TODAY,
    });
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/auth/signup"
  ) {
    const email = String(
      body.email || "",
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password || "",
    );

    if (
      !email ||
      !password ||
      password.length < 8
    ) {
      throw Object.assign(
        new Error(
          "Email and an 8+ character password are required.",
        ),
        { status: 400 },
      );
    }

    if (
      db.users.some(
        (user) =>
          user.email === email,
      )
    ) {
      throw Object.assign(
        new Error(
          "An account with this email already exists.",
        ),
        { status: 409 },
      );
    }

    const user = {
      id: id("user"),
      name: body.name || "",
      email,
      passwordHash:
        hashPassword(password),
      createdAt:
        new Date().toISOString(),
      data: emptyBusiness({
        businessName:
          body.businessName,
        location: body.location,
      }),
    };

    db.users.push(user);

    const token = crypto
      .randomBytes(32)
      .toString("hex");

    db.sessions[token] = {
      userId: user.id,
      createdAt:
        new Date().toISOString(),
    };

    await saveDb(db);

    return send(res, 200, {
      token,
      user: publicUser(user),
    });
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/auth/signin"
  ) {
    const email = String(
      body.email || "",
    )
      .trim()
      .toLowerCase();

    const user = db.users.find(
      (item) =>
        item.email === email,
    );

    if (
      !user ||
      !verifyPassword(
        String(
          body.password || "",
        ),
        user.passwordHash,
      )
    ) {
      throw Object.assign(
        new Error(
          "Invalid email or password.",
        ),
        { status: 401 },
      );
    }

    const token = crypto
      .randomBytes(32)
      .toString("hex");

    db.sessions[token] = {
      userId: user.id,
      createdAt:
        new Date().toISOString(),
    };

    await saveDb(db);

    return send(res, 200, {
      token,
      user: publicUser(user),
    });
  }

  const user = requireUser(
    req,
    url,
    db,
  );

  const data = user.data;

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/auth/signout"
  ) {
    delete db.sessions[
      getToken(req, url)
    ];

    await saveDb(db);

    return send(res, 200, {
      ok: true,
    });
  }

  if (
    req.method === "GET" &&
    url.pathname === "/api/auth/me"
  ) {
    return send(res, 200, {
      user: publicUser(user),
    });
  }

  if (
    req.method === "GET" &&
    url.pathname ===
      "/api/bootstrap"
  ) {
    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "GET" &&
    url.pathname ===
      "/api/models/status"
  ) {
    return send(
      res,
      200,
      modelStatus(),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/transcribe"
  ) {
    const maxBytes =
      Math.max(
        1,
        Number(
          AI_CONFIG.limits
            .maxAudioMb,
        ) || 12,
      ) *
      1024 *
      1024;

    const audioBuffer =
      await readRawBody(
        req,
        maxBytes,
      );

    return send(
      res,
      200,
      await queueAiTask(() =>
        transcribeAudio(
          audioBuffer,
        ),
      ),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/notes/analyze"
  ) {
    return send(
      res,
      200,
      await analyzeBusinessNote(
        body.note,
      ),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/ledger/commit"
  ) {
    commitDraft(
      data,
      body.draft || {},
    );

    await saveDb(db);

    return send(res, 200, {
      data: bootstrap(user),
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/sales"
  ) {
    addSale(data, body);
    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/expenses"
  ) {
    data.expenses.unshift({
      id: id("exp"),
      date: TODAY,
      category: titleCase(
        body.category,
      ),
      amount: amount(body.amount),
      note: body.note || "",
      status:
        body.status || "Paid",
    });

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/inventory/products"
  ) {
    const name = titleCase(
      body.name,
    );

    if (!name) {
      throw Object.assign(
        new Error(
          "Product name is required.",
        ),
        { status: 400 },
      );
    }

    const existing =
      productByName(data, name);

    if (existing) {
      throw Object.assign(
        new Error(
          "This product already exists.",
        ),
        { status: 409 },
      );
    }

    data.inventory.unshift({
      id: id("prod"),
      name,
      stock: amount(body.stock),
      costPrice: amount(
        body.costPrice,
      ),
      sellPrice: amount(
        body.sellPrice,
      ),
      damaged: 0,
    });

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/inventory/stock"
  ) {
    const product = productByName(
      data,
      body.product,
    );

    if (!product) {
      throw Object.assign(
        new Error(
          "Product not found.",
        ),
        { status: 404 },
      );
    }

    product.stock += amount(
      body.quantity,
    );

    if (body.costPrice) {
      product.costPrice = amount(
        body.costPrice,
      );
    }

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/inventory/damaged"
  ) {
    const product = productByName(
      data,
      body.product,
    );

    if (!product) {
      throw Object.assign(
        new Error(
          "Product not found.",
        ),
        { status: 404 },
      );
    }

    const quantity = Math.min(
      product.stock,
      amount(body.quantity),
    );

    product.stock -= quantity;
    product.damaged += quantity;

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/customers/payment"
  ) {
    const customer =
      data.customers.find(
        (item) =>
          item.id === body.customerId,
      );

    if (!customer) {
      throw Object.assign(
        new Error(
          "Customer not found.",
        ),
        { status: 404 },
      );
    }

    const payment = Math.min(
      customer.debt,
      amount(body.amount),
    );

    customer.debt -= payment;
    customer.lastActivity = TODAY;
    customer.status =
      customer.debt > 0
        ? "Active"
        : "Paid";

    customer.history.unshift({
      date: TODAY,
      type: "Payment",
      amount: payment,
      note:
        body.note ||
        "Payment received",
    });

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/customers/reminder"
  ) {
    const customer =
      data.customers.find(
        (item) =>
          item.id === body.customerId,
      );

    if (!customer) {
      throw Object.assign(
        new Error(
          "Customer not found.",
        ),
        { status: 404 },
      );
    }

    return send(res, 200, {
      message:
        `Hello ${customer.name}, ` +
        `your balance with ${
          data.settings
            .businessName ||
          "our business"
        } is ₦${customer.debt.toLocaleString()}. ` +
        "Please make a payment when you can. Thank you.",
    });
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/invoices"
  ) {
    const invoice = {
      id: id("inv"),
      number:
        `INV-${new Date().getFullYear()}-` +
        String(
          data.invoices.length + 1,
        ).padStart(4, "0"),
      date: TODAY,
      customerName: titleCase(
        body.customerName,
      ),
      dueDate:
        body.dueDate || TODAY,
      item: body.item || "",
      quantity: amount(
        body.quantity,
      ),
      unitPrice: amount(
        body.unitPrice,
      ),
      amountPaid: amount(
        body.amountPaid,
      ),
      status: "Saved",
    };

    data.invoices.unshift(invoice);

    await saveDb(db);

    return send(res, 200, {
      invoice,
      data: bootstrap(user),
    });
  }

  if (
    req.method === "GET" &&
    url.pathname.startsWith(
      "/api/invoices/",
    ) &&
    url.pathname.endsWith("/pdf")
  ) {
    const invoiceId =
      url.pathname.split("/")[3];

    return send(
      res,
      200,
      makeInvoicePdf(
        data,
        invoiceId,
      ),
      {
        "Content-Type":
          "application/pdf",
        "Content-Disposition":
          `attachment; filename="${invoiceId}.pdf"`,
      },
    );
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/coach"
  ) {
    return send(
      res,
      200,
      coachAnswer(
        data,
        body.question,
      ),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/knowledge/search"
  ) {
    return send(
      res,
      200,
      searchKnowledge(
        data,
        body.query,
      ),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/settings"
  ) {
    data.settings = {
      ...data.settings,
      ...body,
    };

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  if (
    req.method === "POST" &&
    url.pathname ===
      "/api/performance/benchmark"
  ) {
    data.performance.lastBenchmark =
      new Date().toISOString();

    data.performance.tokensPerSecond =
      Number(
        (
          8 +
          Math.random() * 8
        ).toFixed(1),
      );

    data.performance.extractionSeconds =
      Number(
        (
          1 +
          Math.random() * 2
        ).toFixed(1),
      );

    data.performance.ragSeconds =
      Number(
        (
          2 +
          Math.random() * 4
        ).toFixed(1),
      );

    await saveDb(db);

    return send(
      res,
      200,
      bootstrap(user),
    );
  }

  return send(res, 404, {
    error: "API route not found.",
  });
}

function serveStatic(req, res) {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`,
  );

  const requested =
    url.pathname === "/"
      ? "index.html"
      : url.pathname.slice(1);

  const filePath = path.normalize(
    path.join(
      DIST_DIR,
      requested,
    ),
  );

  const safePath =
    filePath.startsWith(DIST_DIR)
      ? filePath
      : path.join(
          DIST_DIR,
          "index.html",
        );

  const finalPath =
    existsSync(safePath)
      ? safePath
      : path.join(
          DIST_DIR,
          "index.html",
        );

  const contentType =
    finalPath.endsWith(".html")
      ? "text/html"
      : finalPath.endsWith(".js")
        ? "text/javascript"
        : finalPath.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
  });

  createReadStream(finalPath).pipe(
    res,
  );
}

const server = http.createServer(
  async (req, res) => {
    try {
      if (
        req.url?.startsWith("/api/")
      ) {
        return await handleApi(
          req,
          res,
        );
      }

      if (existsSync(DIST_DIR)) {
        return serveStatic(req, res);
      }

      return send(
        res,
        200,
        "MarketOS API is running. Build the frontend with npm run build to serve the app.",
      );
    } catch (error) {
      send(
        res,
        error.status || 500,
        {
          error:
            error.message ||
            "Server error.",
        },
      );
    }
  },
);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(
      `MarketOS backend running on http://127.0.0.1:${PORT}`,
    );
  });
}

export {
  normalizeSale,
  analyzeNoteWithRules,
  analyzeWithReasoningModel,
  EXTRACTION_SCHEMA,
};

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  await manager.shutdown();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
