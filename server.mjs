import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "fontkit";
import { initDatabase, closeDatabase, isDatabaseReady } from "./db/index.js";
import { migrateFromJson, isMigrationNeeded } from "./db/migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function logTiming(label, start) {
  console.log(`[TIMING] ${label}: ${Date.now() - start}ms`);
}
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

function emptyBusiness({ businessName, location, industry, businessType, targetCustomers, mainProducts, primaryGoal }) {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    plan: "free",
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnd.toISOString(),
    invoiceCountThisMonth: 0,
    invoiceMonth: "",
    settings: {
      businessName: businessName || "",
      location: location || "",
      currency: "NGN",
      language: "English",
      offlineMode: true,
      cloudSync: false,
      backupLocation: "Local disk",
      lastBackup: null,
      industry: industry || "",
      businessType: businessType || "",
      targetCustomers: targetCustomers || "",
      mainProducts: mainProducts || "",
      primaryGoal: primaryGoal || "",
    },
    inventory: [],
    customers: [],
    sales: [],
    expenses: [],
    invoices: [],
    notes: [],
    knowledge: [],
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

function hasPremiumAccess(data) {
  // Pro users always have premium access
  if (data.plan === "pro") return true;
  // Check if trial is active
  if (data.trialEndsAt) {
    const now = new Date();
    const trialEnd = new Date(data.trialEndsAt);
    if (now < trialEnd) return true;
  }
  return false;
}

function bootstrap(user) {
  const data = user.data;

  // Ensure plan fields exist for backward compatibility
  data.plan ??= "free";
  data.trialStartedAt ??= new Date().toISOString();
  data.trialEndsAt ??= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  data.invoiceCountThisMonth ??= 0;
  data.invoiceMonth ??= "";

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
    plan: data.plan,
    trialStartedAt: data.trialStartedAt,
    trialEndsAt: data.trialEndsAt,
    hasPremiumAccess: hasPremiumAccess(data),
    invoiceCountThisMonth: data.invoiceCountThisMonth,
    invoiceMonth: data.invoiceMonth,
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

// Stop words for keyword relevance scoring
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "can", "could", "should", "may", "might", "shall", "about",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "if", "while", "what", "which", "who", "whom",
  "this", "that", "these", "those", "it", "its", "my", "your", "our",
  "their", "his", "her", "its", "me", "you", "us", "them", "him", "she",
  "he", "we", "they", "i", "am", "are", "is", "was", "were", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "can", "could", "shall", "should", "may", "might", "need", "dare",
  "ought", "used", "to", "please", "help", "tell", "ask", "answer",
  "give", "get", "make", "take", "know", "think", "want", "need",
  "like", "use", "find", "try", "tell", "ask", "work", "seem", "feel",
  "try", "leave", "call", "good", "new", "first", "last", "long",
  "great", "little", "own", "other", "old", "right", "high", "small",
  "different", "large", "next", "early", "young", "important", "few",
  "same", "many", "much", "some", "any", "all", "both", "each", "every",
  "no", "most", "other", "such", "only", "own", "same", "so", "than",
  "too", "very", "just", "because", "if", "while", "what", "which",
  "who", "whom", "this", "that", "these", "those", "it", "its",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function retrieveRelevantKnowledge(data, question, options = {}) {
  const maxResults = options.maxResults || 3;
  const maxExcerptLength = options.maxExcerptLength || 500;
  const maxTotalContext = options.maxTotalContext || 1500;

  const questionTokens = tokenize(question);
  if (!questionTokens.length) return [];

  const scored = data.knowledge.map((item) => {
    const titleTokens = tokenize(item.title);
    const bodyTokens = tokenize(item.body);

    let score = 0;
    const matchedTokens = new Set();

    for (const token of questionTokens) {
      // Title match scores higher
      if (titleTokens.includes(token)) {
        score += 3;
        matchedTokens.add(token);
      }
      if (bodyTokens.includes(token)) {
        score += 1;
        matchedTokens.add(token);
      }
    }

    // Bonus for matching multiple tokens
    if (matchedTokens.size > 1) {
      score += matchedTokens.size * 0.5;
    }

    return { item, score, matchedTokens: [...matchedTokens] };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  // Generate excerpts centered around strongest matching keyword
  const results = [];
  let totalChars = 0;

  for (const entry of scored) {
    if (totalChars >= maxTotalContext) break;

    const { item, score, matchedTokens } = entry;
    const body = item.body || "";

    // Find the best matching keyword position
    let bestPos = 0;
    let bestToken = matchedTokens[0] || "";
    for (const token of matchedTokens) {
      const pos = body.toLowerCase().indexOf(token);
      if (pos !== -1 && (bestPos === 0 || pos < bestPos)) {
        bestPos = pos;
        bestToken = token;
      }
    }

    // Create excerpt centered around bestPos
    const halfLen = Math.floor(maxExcerptLength / 2);
    let start = Math.max(0, bestPos - halfLen);
    let end = Math.min(body.length, start + maxExcerptLength);
    // Adjust start if end is at body length
    if (end === body.length) {
      start = Math.max(0, body.length - maxExcerptLength);
    }

    let excerpt = body.slice(start, end).trim();
    if (start > 0) excerpt = "..." + excerpt;
    if (end < body.length) excerpt = excerpt + "...";

    const result = {
      id: item.id,
      title: item.title,
      source: item.source,
      excerpt,
      score,
    };

    results.push(result);
    totalChars += excerpt.length;
  }

  return results;
}

const COACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "actions", "confidence"],
  properties: {
    answer: { type: "string" },
    actions: {
      type: "array",
      items: { type: "string" },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

function buildCoachContext(data, question, classification) {
  const s = summary(data);
  const parts = [];

  // === BUSINESS PROFILE ===
  parts.push("=== BUSINESS PROFILE ===");
  parts.push(`Business name: ${data.settings.businessName || "Not set"}`);
  parts.push(`Location: ${data.settings.location || "Not set"}`);

  // Knowledge Base documents that describe the business itself
  const businessContextDocs = retrieveRelevantKnowledge(data, "business description goals target customers products services policies operating model");
  if (businessContextDocs.length) {
    parts.push("Knowledge Base context:");
    for (const doc of businessContextDocs) {
      parts.push(`- ${doc.title}: ${doc.excerpt}`);
    }
  }

  // === BUSINESS INSIGHTS ===
  parts.push("=== BUSINESS INSIGHTS ===");

  // Inventory insights
  const totalProducts = data.inventory.length;
  const lowStock = data.inventory.filter((p) => p.stock <= 10);
  const topSelling = [...data.inventory]
    .sort((a, b) => (b.sellPrice - b.costPrice) - (a.sellPrice - a.costPrice))
    .slice(0, 3);
  const slowMoving = data.inventory.filter((p) => p.stock > 50 && p.stock > 0).slice(0, 3);
  const highestMargin = [...data.inventory]
    .sort((a, b) => ((b.sellPrice - b.costPrice) / (b.sellPrice || 1)) - ((a.sellPrice - a.costPrice) / (a.sellPrice || 1)))
    .slice(0, 3);

  parts.push(`Inventory: ${totalProducts} products total`);
  if (lowStock.length) parts.push(`Low stock: ${lowStock.map(p => `${p.name} (${p.stock} left)`).join(", ")}`);
  if (topSelling.length) parts.push(`Top selling: ${topSelling.map(p => `${p.name} (₦${p.sellPrice})`).join(", ")}`);
  if (slowMoving.length) parts.push(`Slow moving: ${slowMoving.map(p => `${p.name} (${p.stock} units)`).join(", ")}`);
  if (highestMargin.length) parts.push(`Highest margin: ${highestMargin.map(p => `${p.name} (${Math.round(((p.sellPrice - p.costPrice) / (p.sellPrice || 1)) * 100)}%)`).join(", ")}`);

  // Customer insights
  const totalCustomers = data.customers.length;
  const customersOwing = data.customers.filter((c) => c.debt > 0);
  const repeatCustomers = data.customers.filter((c) => c.history.length > 1);
  const highestValueCustomers = [...data.customers]
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 3);

  parts.push(`Customers: ${totalCustomers} total`);
  if (customersOwing.length) parts.push(`Owing money: ${customersOwing.length} customers (₦${customersOwing.reduce((sum, c) => sum + c.debt, 0).toLocaleString()})`);
  if (repeatCustomers.length) parts.push(`Repeat customers: ${repeatCustomers.length}`);
  if (highestValueCustomers.length) parts.push(`Highest value: ${highestValueCustomers.map(c => `${c.name} (₦${c.debt.toLocaleString()})`).join(", ")}`);

  // Sales insights
  const recentSales = data.sales.slice(0, 10);
  const topProducts = [...new Set(data.sales.map(s => s.product))].slice(0, 5);
  const channels = [...new Set(data.sales.map(s => s.channel))];
  const revenueTrend = data.sales.length > 0
    ? `₦${data.sales.slice(0, 5).reduce((sum, s) => sum + s.quantity * s.unitPrice, 0).toLocaleString()} (last 5 sales)`
    : "No sales data";

  parts.push(`Sales: ${data.sales.length} total records`);
  if (recentSales.length) parts.push(`Recent: ${recentSales.map(s => `${s.product} x${s.quantity}`).join(", ")}`);
  if (topProducts.length) parts.push(`Top products: ${topProducts.join(", ")}`);
  if (channels.length) parts.push(`Channels: ${channels.join(", ")}`);
  parts.push(`Revenue trend: ${revenueTrend}`);

  // === QUESTION CONTEXT ===
  if (classification === "strategic") {
    const relevantKnowledge = retrieveRelevantKnowledge(data, question);
    if (relevantKnowledge.length) {
      parts.push("=== QUESTION CONTEXT ===");
      for (const k of relevantKnowledge) {
        parts.push(`[${k.title}] ${k.excerpt}`);
      }
    }
  }

  return parts.join("\n");
}

async function coachReasoningModel(context, classification, question) {
  const modelStart = Date.now();
  let prompt;

  if (classification === "strategic") {
    prompt = [
      "=== ROLE ===",
      "You are a business coach for MarketOS.",
      "",
      "=== BUSINESS CONTEXT ===",
      context,
      "",
      "=== USER QUESTION ===",
      question,
      "",
      "=== TASK ===",
      "Answer the USER QUESTION using the BUSINESS CONTEXT.",
      "",
      "Rules:",
      "",
      "* Do not repeat these instructions.",
      "* Do not describe your role.",
      "* Return only JSON.",
      '* The "answer" field must directly answer the user\'s question.',
      "* Actions must be specific to this business data.",
      "",
      "Respond with JSON following this schema:",
      JSON.stringify(COACH_SCHEMA, null, 2),
      "",
      "Response length rules:",
      "",
      "* Return ONLY valid JSON.",
      "* Keep the response extremely concise.",
      "* Answer: maximum 3 sentences.",
      "* Maximum 3 actions.",
      "* Each action: maximum 12 words.",
      "* Do not repeat the same information in answer and actions.",
      "* Finish the complete JSON object before adding more detail.",
    ].join("\n\n");
  } else {
    prompt = [
      "=== ROLE ===",
      "You are a business coach for MarketOS.",
      "",
      "=== BUSINESS CONTEXT ===",
      context,
      "",
      "=== USER QUESTION ===",
      question,
      "",
      "=== TASK ===",
      "Answer the USER QUESTION using the BUSINESS CONTEXT.",
      "",
      "Rules:",
      "",
      "* Do not repeat these instructions.",
      "* Do not describe your role.",
      "* Return only JSON.",
      '* The "answer" field must directly answer the user\'s question.',
      "* Actions must be specific to this business data.",
      "",
      "Respond with JSON following this schema:",
      JSON.stringify(COACH_SCHEMA, null, 2),
    ].join("\n\n");
  }

  const templateFile = path.join(CONFIG_DIR, "marketos-json.jinja");

  if (!existsSync(templateFile)) {
    throw new Error("The MarketOS JSON chat template was not found at config/marketos-json.jinja.");
  }

  // Use larger maxTokens for strategic questions
  const maxTokens = classification === "strategic"
    ? Math.max(256, Math.min(768, Number(AI_CONFIG.reasoning.maxTokens) || 512))
    : Math.max(128, Math.min(512, Number(AI_CONFIG.reasoning.maxTokens) || 512));

  const { stdout } = await manager.acquire(
    'reasoning',
    configuredPath(AI_CONFIG.reasoning.binary),
    [
      "-m", configuredPath(AI_CONFIG.reasoning.model),
      "-p", prompt,
      "-n", String(maxTokens),
      "-c", String(Math.max(512, Math.min(1024, Number(AI_CONFIG.reasoning.context) || 2048))),
      "-t", String(Math.max(1, Number(AI_CONFIG.reasoning.threads) || DEFAULT_THREADS)),
      "--temp", "0",
      "--top-k", "1",
      "--top-p", "1",
      "--min-p", "0",
      "--presence-penalty", "0",
      "--jinja",
      "--chat-template-file", templateFile,
      "--single-turn",
      "--no-display-prompt",
      "--no-show-timings",
      "--simple-io",
      "--no-warmup",
      "--json-schema", JSON.stringify(COACH_SCHEMA),
    ],
    { timeoutSeconds: AI_CONFIG.reasoning.timeoutSeconds },
  );

  console.log(`[TIMING] coach reasoning model: ${Date.now() - modelStart}ms`);
  console.log(`[TIMING] coach prompt chars: ${prompt.length}`);
  console.log("=== RAW COACH OUTPUT ===");
  console.log(stdout);
  console.log("=== END RAW COACH OUTPUT ===");
  return extractFirstJson(stdout);
}

function deterministicCoachAnswer(data, question, classification) {
  const s = summary(data);
  const knowledge = retrieveRelevantKnowledge(data, question);

  if (classification === "factual") {
    const normalized = normalizeQuestion(question).toLowerCase();
    const observations = [];
    const evidenceUsed = [];
    const dataLimitations = [];

    // Business name
    if (normalized.includes("business name") || normalized.includes("company name") || normalized.includes("what is my business called") || normalized.includes("what is my company called")) {
      const name = data.settings.businessName || "";
      if (name) {
        observations.push(`Your business name is "${name}".`);
        evidenceUsed.push({ type: "business-record", recordId: "settings", title: "Business name" });
      } else if (knowledge.length) {
        observations.push(`Based on your Knowledge Base documents, your business name is "${knowledge[0].title}".`);
        evidenceUsed.push({ type: "knowledge", recordId: knowledge[0].id, title: knowledge[0].title });
      } else {
        dataLimitations.push("No business name is set in your settings or Knowledge Base.");
      }
    }

    // Business location
    if (normalized.includes("business location") || normalized.includes("company location") || normalized.includes("where is my business") || normalized.includes("where is my company")) {
      const location = data.settings.location || "";
      if (location) {
        observations.push(`Your business location is "${location}".`);
        evidenceUsed.push({ type: "business-record", recordId: "settings", title: "Business location" });
      } else if (knowledge.length) {
        observations.push(`Based on your Knowledge Base documents, your business location is "${knowledge[0].title}".`);
        evidenceUsed.push({ type: "knowledge", recordId: knowledge[0].id, title: knowledge[0].title });
      } else {
        dataLimitations.push("No business location is set in your settings or Knowledge Base.");
      }
    }

    // Total sales
    if (normalized.includes("total sales") || normalized.includes("sales total") || normalized.includes("how much sales") || normalized.includes("sales amount")) {
      if (s.salesTotal > 0) {
        observations.push(`Today's total sales are ₦${Number(s.salesTotal).toLocaleString()}.`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Today's sales total" });
      } else {
        dataLimitations.push("No sales records exist yet.");
      }
    }

    // Total expenses
    if (normalized.includes("total expenses") || normalized.includes("expenses total") || normalized.includes("how much expenses") || normalized.includes("expenses amount")) {
      if (s.expensesTotal > 0) {
        observations.push(`Today's total expenses are ₦${Number(s.expensesTotal).toLocaleString()}.`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Today's expenses total" });
      } else {
        dataLimitations.push("No expense records exist yet.");
      }
    }

    // Customer debt
    if (normalized.includes("customer debt") || normalized.includes("outstanding debt") || normalized.includes("how much debt") || normalized.includes("debt amount")) {
      if (s.customerDebt > 0) {
        observations.push(`Outstanding customer debt is ₦${Number(s.customerDebt).toLocaleString()} across ${s.customersOwing} customer(s).`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Customer debt" });
      } else {
        dataLimitations.push("No customer debt records exist yet.");
      }
    }

    // Low stock
    if (normalized.includes("low stock") || normalized.includes("low inventory") || normalized.includes("stock out") || normalized.includes("restock")) {
      if (s.lowStockCount > 0) {
        observations.push(`${s.lowStockCount} product(s) are low on stock.`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Low stock count" });
      } else {
        dataLimitations.push("No products are low on stock.");
      }
    }

    // If no direct match, fall back to generic observations
    if (observations.length === 0) {
      if (s.salesTotal > 0) {
        observations.push(`Today's sales total is ₦${Number(s.salesTotal).toLocaleString()}.`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Today's sales total" });
      }
      if (s.expensesTotal > 0) {
        observations.push(`Today's expenses total is ₦${Number(s.expensesTotal).toLocaleString()}.`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Today's expenses total" });
      }
      if (s.customerDebt > 0) {
        observations.push(`Customer debt is ₦${Number(s.customerDebt).toLocaleString()} across ${s.customersOwing} customer(s).`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Customer debt" });
      }
      if (s.lowStockCount > 0) {
        observations.push(`${s.lowStockCount} product(s) are low on stock.`);
        evidenceUsed.push({ type: "business-record", recordId: "summary", title: "Low stock count" });
      }
    }

    // Observations from knowledge (only if not already answered)
    if (observations.length === 0) {
      for (const k of knowledge) {
        observations.push(`Knowledge document "${k.title}" mentions: ${k.excerpt.slice(0, 100)}...`);
        evidenceUsed.push({ type: "knowledge", recordId: k.id, title: k.title });
      }
    }

    const recommendations = [];
    if (s.customerDebt > 0) {
      recommendations.push({ action: "Send payment reminders to customers with outstanding debt.", reason: "Customer debt is ₦" + s.customerDebt.toLocaleString() });
    }
    if (s.lowStockCount > 0) {
      recommendations.push({ action: "Restock low inventory items to avoid stockouts.", reason: s.lowStockCount + " product(s) are low on stock." });
    }
    if (s.salesTotal === 0 && s.expensesTotal === 0) {
      recommendations.push({ action: "Start recording sales and expenses to get actionable insights.", reason: "No sales or expense records exist yet." });
    }
    if (!recommendations.length) {
      recommendations.push({ action: "Continue monitoring sales and expenses.", reason: "Your business data looks balanced." });
    }

    const dataLimitationsFinal = [];
    if (!data.sales.length && !data.expenses.length) {
      dataLimitationsFinal.push("No sales or expense records exist yet.");
    }
    if (!knowledge.length && observations.length === 0) {
      dataLimitationsFinal.push("No relevant Knowledge Base documents were found for this question.");
    }
    if (!dataLimitationsFinal.length) {
      dataLimitationsFinal.push("Data is sufficient for basic analysis.");
    }

    const confidence = observations.length > 0 ? (data.sales.length > 0 && data.expenses.length > 0 ? "medium" : "low") : "low";

    return {
      diagnosis: observations.length ? observations.join(" ") : "I don't have enough data to answer that question.",
      recommendations,
      nextSteps: [],
      confidence,
      dataLimitations: dataLimitationsFinal,
    };
  }

  // Strategic fallback
  const diagnosis = [];
  const recommendations = [];
  const nextSteps = [];
  const dataLimitations = [];

  if (s.salesTotal > 0) {
    diagnosis.push(`Today's sales total is ₦${Number(s.salesTotal).toLocaleString()}.`);
  }
  if (s.expensesTotal > 0) {
    diagnosis.push(`Today's expenses total is ₦${Number(s.expensesTotal).toLocaleString()}.`);
  }
  if (s.customerDebt > 0) {
    diagnosis.push(`Customer debt is ₦${Number(s.customerDebt).toLocaleString()} across ${s.customersOwing} customer(s).`);
  }
  if (s.lowStockCount > 0) {
    diagnosis.push(`${s.lowStockCount} product(s) are low on stock.`);
  }

  if (s.customerDebt > 0) {
    recommendations.push({
      action: "Send payment reminders to customers with outstanding debt.",
      reason: `Customer debt is ₦${s.customerDebt.toLocaleString()} across ${s.customersOwing} customer(s).`,
    });
  }
  if (s.lowStockCount > 0) {
    recommendations.push({
      action: "Restock low inventory items to avoid stockouts.",
      reason: `${s.lowStockCount} product(s) are low on stock.`,
    });
  }
  if (s.salesTotal === 0 && s.expensesTotal === 0) {
    recommendations.push({
      action: "Start recording sales and expenses to get actionable insights.",
      reason: "No sales or expense records exist yet.",
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      action: "Continue monitoring sales and expenses.",
      reason: "Your business data looks balanced.",
    });
  }

  if (!data.sales.length && !data.expenses.length) {
    dataLimitations.push("No sales or expense records exist yet.");
  }
  if (!knowledge.length) {
    dataLimitations.push("No relevant Knowledge Base documents were found for this question.");
  }
  if (!dataLimitations.length) {
    dataLimitations.push("Data is sufficient for basic analysis.");
  }

  const confidence = diagnosis.length > 0 ? (data.sales.length > 0 && data.expenses.length > 0 ? "medium" : "low") : "low";

  return {
    diagnosis: diagnosis.length ? diagnosis.join(" ") : "I don't have enough data to answer that question.",
    recommendations,
    nextSteps,
    confidence,
    dataLimitations,
  };
}

function normalizeQuestion(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bwhat's\b/g, "what is")
    .replace(/\bwhere's\b/g, "where is")
    .replace(/\bwho's\b/g, "who is")
    .replace(/\bcompany's\b/g, "company")
    .replace(/\bbusiness's\b/g, "business")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyCoachQuestion(question) {
  const normalized = normalizeQuestion(question).toLowerCase();

  // Factual keywords
  const factualKeywords = [
    "total", "how much", "what is", "how many", "when", "who",
    "business name", "company name", "business location", "company location",
    "sales total", "expenses total", "customer debt", "outstanding debt",
    "low stock", "low inventory", "stock out", "restock",
    "tell me my", "what are my", "how much do i",
  ];
  for (const keyword of factualKeywords) {
    if (normalized.includes(keyword)) {
      return "factual";
    }
  }

  // Operational keywords
  const operationalKeywords = [
    "how do i", "how to", "steps to", "process", "procedure",
    "what should i do to", "how can i", "explain",
  ];
  for (const keyword of operationalKeywords) {
    if (normalized.includes(keyword)) {
      return "operational";
    }
  }

  // Strategic keywords
  const strategicKeywords = [
    "improve", "grow", "increase", "better", "strategy", "recommend",
    "suggest", "advice", "next steps", "optimize", "expand",
    "how can i improve", "how can i grow", "what should i do",
    "business intelligence", "actionable", "opportunities",
  ];
  for (const keyword of strategicKeywords) {
    if (normalized.includes(keyword)) {
      return "strategic";
    }
  }

  // Default to strategic for business coach
  return "strategic";
}

function directFactualAnswer(data, question) {
  const normalized = normalizeQuestion(question).toLowerCase();

  // Business name questions
  const isBusinessNameQuestion =
    normalized.includes("business name") ||
    normalized.includes("company name") ||
    normalized.includes("what is my business called") ||
    normalized.includes("what is my company called") ||
    normalized.includes("tell me my business name") ||
    normalized.includes("tell me my company name") ||
    (normalized.includes("what") && normalized.includes("name") && (normalized.includes("business") || normalized.includes("company")));

  if (isBusinessNameQuestion) {
    const name = data.settings?.businessName || "";
    if (name) {
      return {
        diagnosis: `Your business name is ${name}.`,
        recommendations: [],
        nextSteps: [],
        confidence: "high",
        limitations: []
      };
    }

    // Search Knowledge Base for business name
    const knowledge = retrieveRelevantKnowledge(data, "business name");
    if (knowledge.length) {
      return {
        diagnosis: `Based on your Knowledge Base documents, your business name is "${knowledge[0].title}".`,
        recommendations: [],
        nextSteps: [],
        confidence: "medium",
        limitations: ["Business name was found in Knowledge Base, not in settings."]
      };
    }

    return {
      diagnosis: "I don't have your business name in MarketOS yet.",
      recommendations: [],
      nextSteps: [],
      confidence: "low",
      limitations: [
        "No business name is saved in settings or found in the Knowledge Base."
      ]
    };
  }

  // Business location questions
  const isBusinessLocationQuestion =
    normalized.includes("business location") ||
    normalized.includes("company location") ||
    normalized.includes("where is my business") ||
    normalized.includes("where is my company") ||
    (normalized.includes("where") && normalized.includes("located") && (normalized.includes("business") || normalized.includes("company")));

  if (isBusinessLocationQuestion) {
    const location = data.settings?.location || "";
    if (location) {
      return {
        diagnosis: `Your business location is ${location}.`,
        recommendations: [],
        nextSteps: [],
        confidence: "high",
        limitations: []
      };
    }

    const knowledge = retrieveRelevantKnowledge(data, "business location");
    if (knowledge.length) {
      return {
        diagnosis: `Based on your Knowledge Base documents, your business location is "${knowledge[0].title}".`,
        recommendations: [],
        nextSteps: [],
        confidence: "medium",
        limitations: ["Business location was found in Knowledge Base, not in settings."]
      };
    }

    return {
      diagnosis: "I don't have your business location in MarketOS yet.",
      recommendations: [],
      nextSteps: [],
      confidence: "low",
      limitations: [
        "No business location is saved in settings or found in the Knowledge Base."
      ]
    };
  }

  // Total sales questions
  const isTotalSalesQuestion =
    normalized.includes("total sales") ||
    normalized.includes("sales total") ||
    normalized.includes("how much sales") ||
    normalized.includes("sales amount") ||
    (normalized.includes("how much") && normalized.includes("sold") && normalized.includes("today"));

  if (isTotalSalesQuestion) {
    const s = summary(data);
    if (s.salesTotal > 0) {
      return {
        diagnosis: `Today's total sales are ₦${Number(s.salesTotal).toLocaleString()}.`,
        recommendations: [],
        nextSteps: [],
        confidence: "high",
        limitations: []
      };
    }

    return {
      diagnosis: "No sales records exist yet.",
      recommendations: [],
      nextSteps: [],
      confidence: "low",
      limitations: ["No sales records exist yet."]
    };
  }

  // Total expenses questions
  const isTotalExpensesQuestion =
    normalized.includes("total expenses") ||
    normalized.includes("expenses total") ||
    normalized.includes("how much expenses") ||
    normalized.includes("expenses amount") ||
    (normalized.includes("how much") && normalized.includes("spent") && normalized.includes("today"));

  if (isTotalExpensesQuestion) {
    const s = summary(data);
    if (s.expensesTotal > 0) {
      return {
        diagnosis: `Today's total expenses are ₦${Number(s.expensesTotal).toLocaleString()}.`,
        recommendations: [],
        nextSteps: [],
        confidence: "high",
        limitations: []
      };
    }

    return {
      diagnosis: "No expense records exist yet.",
      recommendations: [],
      nextSteps: [],
      confidence: "low",
      limitations: ["No expense records exist yet."]
    };
  }

  // Customer debt questions
  const isCustomerDebtQuestion =
    normalized.includes("customer debt") ||
    normalized.includes("outstanding debt") ||
    normalized.includes("how much debt") ||
    normalized.includes("debt amount") ||
    (normalized.includes("how much") && normalized.includes("owe") && normalized.includes("customer"));

  if (isCustomerDebtQuestion) {
    const s = summary(data);
    if (s.customerDebt > 0) {
      return {
        diagnosis: `Outstanding customer debt is ₦${Number(s.customerDebt).toLocaleString()} across ${s.customersOwing} customer(s).`,
        recommendations: [],
        nextSteps: [],
        confidence: "high",
        limitations: []
      };
    }

    return {
      diagnosis: "No customer debt records exist yet.",
      recommendations: [],
      nextSteps: [],
      confidence: "low",
      limitations: ["No customer debt records exist yet."]
    };
  }

  // Low stock questions
  const isLowStockQuestion =
    normalized.includes("low stock") ||
    normalized.includes("low inventory") ||
    normalized.includes("stock out") ||
    normalized.includes("restock") ||
    (normalized.includes("what") && normalized.includes("low") && normalized.includes("stock"));

  if (isLowStockQuestion) {
    const s = summary(data);
    if (s.lowStockCount > 0) {
      return {
        diagnosis: `${s.lowStockCount} product(s) are low on stock.`,
        recommendations: [],
        nextSteps: [],
        confidence: "high",
        limitations: []
      };
    }

    return {
      diagnosis: "No products are low on stock.",
      recommendations: [],
      nextSteps: [],
      confidence: "low",
      limitations: ["No products are low on stock."]
    };
  }

  // Not a direct factual question
  return null;
}

async function coachAnswer(data, question) {
  const classification = classifyCoachQuestion(question);

  // For factual questions, try direct answer first
  if (classification === "factual") {
    const direct = directFactualAnswer(data, question);
    if (direct) {
      return direct;
    }
  }

  const context = buildCoachContext(data, question, classification);

  if (executableReady(AI_CONFIG.reasoning)) {
    try {
      return await queueAiTask(() => coachReasoningModel(context, classification, question));
    } catch (error) {
      // Fallback to deterministic
      console.warn("Coach reasoning model failed, using deterministic fallback:", error.message);
    }
  }

  return deterministicCoachAnswer(data, question, classification);
}

function createKnowledgeItem(data, title, body) {
  const trimmedTitle = String(title || "").trim();
  const trimmedBody = String(body || "").trim();

  if (!trimmedTitle) {
    throw Object.assign(new Error("Title is required."), { status: 400 });
  }
  if (trimmedTitle.length > 200) {
    throw Object.assign(new Error("Title must be 200 characters or fewer."), { status: 400 });
  }
  if (!trimmedBody) {
    throw Object.assign(new Error("Body is required."), { status: 400 });
  }
  if (trimmedBody.length > 102400) {
    throw Object.assign(new Error("Body must be 100KB or fewer."), { status: 400 });
  }

  const duplicate = data.knowledge.find(
    (item) => item.title.toLowerCase() === trimmedTitle.toLowerCase()
  );
  if (duplicate) {
    throw Object.assign(new Error("A document with this title already exists."), { status: 409 });
  }

  const item = {
    id: id("knowledge"),
    title: trimmedTitle,
    source: "manual",
    body: trimmedBody,
    createdAt: new Date().toISOString(),
  };
  data.knowledge.unshift(item);
  return item;
}

function uploadKnowledgeItem(data, filename, content) {
  const trimmedFilename = String(filename || "").trim();
  const trimmedContent = String(content || "").trim();

  if (!trimmedFilename) {
    throw Object.assign(new Error("No file uploaded."), { status: 400 });
  }
  if (!trimmedContent) {
    throw Object.assign(new Error("No file uploaded."), { status: 400 });
  }

  const ext = path.extname(trimmedFilename).toLowerCase();
  if (ext !== ".txt" && ext !== ".md") {
    throw Object.assign(new Error("Unsupported file type. Only .txt and .md are allowed."), { status: 400 });
  }

  // Normalize whitespace for base64 validation
  const normalizedContent = trimmedContent.replace(/\s/g, "");
  // Strict base64 validation
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedContent)) {
    throw Object.assign(new Error("Uploaded content is not valid base64."), { status: 400 });
  }

  // Estimate decoded size: base64 length * 3/4
  const estimatedDecodedSize = Math.floor(normalizedContent.length * 3 / 4);
  if (estimatedDecodedSize > 1048576) {
    throw Object.assign(new Error("File must be 1MB or fewer."), { status: 400 });
  }

  let decoded;
  try {
    decoded = Buffer.from(normalizedContent, "base64");
  } catch {
    throw Object.assign(new Error("Uploaded content is not valid base64."), { status: 400 });
  }

  if (decoded.length > 1048576) {
    throw Object.assign(new Error("File must be 1MB or fewer."), { status: 400 });
  }

  // Verify valid UTF-8
  let text;
  try {
    text = decoded.toString("utf8");
    // Check for replacement characters indicating invalid UTF-8
    if (text.includes("\uFFFD")) {
      throw new Error("Invalid UTF-8");
    }
  } catch {
    throw Object.assign(new Error("Uploaded content is not valid UTF-8 text."), { status: 400 });
  }

  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // Normalize CRLF to LF
  text = text.replace(/\r\n/g, "\n");

  const trimmedText = text.trim();
  if (!trimmedText) {
    throw Object.assign(new Error("Uploaded file is empty."), { status: 400 });
  }

  const title = path.basename(trimmedFilename, ext);
  const duplicate = data.knowledge.find(
    (item) => item.title.toLowerCase() === title.toLowerCase()
  );
  if (duplicate) {
    throw Object.assign(new Error("A document with this filename already exists."), { status: 409 });
  }

  const item = {
    id: id("knowledge"),
    title,
    source: "upload",
    body: trimmedText,
    createdAt: new Date().toISOString(),
  };
  data.knowledge.unshift(item);
  return item;
}

function listKnowledgeItems(data) {
  return data.knowledge.map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    body: item.body.length > 200 ? item.body.slice(0, 200) + "..." : item.body,
    createdAt: item.createdAt,
  }));
}

function deleteKnowledgeItem(data, id) {
  const index = data.knowledge.findIndex((item) => item.id === id);
  if (index === -1) {
    throw Object.assign(new Error("Knowledge item not found."), { status: 404 });
  }
  data.knowledge.splice(index, 1);
  return true;
}

async function makeInvoicePdf(
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

  const total = invoice.quantity * invoice.unitPrice;
  const balance = total - invoice.amountPaid;

  const clean = (value) =>
    String(value).replace(/[\\()]/g, "");

  const businessName = clean(data.settings.businessName || "Business Name");
  const location = clean(data.settings.location || "");
  const invoiceNumber = clean(invoice.number);
  const invoiceDate = clean(invoice.date);
  const dueDate = clean(invoice.dueDate);
  const customerName = clean(invoice.customerName);
  const customerAddress = clean(invoice.customerAddress || "");
  const customerEmail = clean(invoice.customerEmail || "");
  const customerPhone = clean(invoice.customerPhone || "");
  const item = clean(invoice.item);
  const quantity = invoice.quantity;
  const unitPrice = invoice.unitPrice;
  const subtotal = total;
  const amountPaid = invoice.amountPaid;
  const balanceDue = balance;
  const notes = clean(invoice.notes || "");

  // Create PDF document
  const pdfDoc = await PDFDocument.create();

  // Register fontkit for custom font embedding
  pdfDoc.registerFontkit(fontkit);

  // Load Noto Sans TTF font (supports Unicode including ₦)
  const fontPath = path.join(__dirname, "fonts", "NotoSans-Regular.ttf");
  if (!existsSync(fontPath)) {
    throw Object.assign(
      new Error(
        "Font file not found: fonts/NotoSans-Regular.ttf. " +
        "Please download Noto Sans from https://fonts.google.com/noto/specimen/Noto+Sans " +
        "and place it in the fonts directory."
      ),
      { status: 500 },
    );
  }
  const fontBytes = readFileSync(fontPath);
  const customFont = await pdfDoc.embedFont(fontBytes);

  // Also load bold variant if available, otherwise use same font
  const boldFontPath = path.join(__dirname, "fonts", "NotoSans-Bold.ttf");
  let customBoldFont = customFont;
  if (existsSync(boldFontPath)) {
    const boldFontBytes = readFileSync(boldFontPath);
    customBoldFont = await pdfDoc.embedFont(boldFontBytes);
  }

  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();

  // ========== BRAND COLOR CONSTANTS ==========
  const PRIMARY_COLOR = rgb(0.1176, 0.2275, 0.5412); // #1E3A8A
  const PRIMARY_DARK = rgb(0.0784, 0.1569, 0.3922); // #14286A
  const LIGHT_BACKGROUND = rgb(0.98, 0.98, 0.98); // #FAFAFA
  const BORDER_COLOR = rgb(0.85, 0.85, 0.85); // #D9D9D9
  const TEXT_COLOR = rgb(0.1, 0.1, 0.1); // #1A1A1A
  const MUTED_TEXT_COLOR = rgb(0.5, 0.5, 0.5); // #808080
  const WHITE = rgb(1, 1, 1);
  const BLACK = rgb(0, 0, 0);
  const STATUS_PAID_BG = rgb(0.2, 0.6, 0.2); // green
  const STATUS_UNPAID_BG = rgb(0.8, 0.2, 0.2); // red
  const STATUS_PARTIAL_BG = rgb(0.8, 0.6, 0.1); // amber
  const STATUS_DRAFT_BG = rgb(0.5, 0.5, 0.5); // gray

  // ========== LAYOUT CONSTANTS ==========
  const MARGIN = 56; // ~0.75 inch
  const PAGE_WIDTH = width - 2 * MARGIN;
  const LEFT_X = MARGIN;
  const RIGHT_X = width - MARGIN;

  const SECTION_GAP = 20;
  const CELL_PADDING = 8;
  const ROW_HEIGHT = 30;
  const HEADER_HEIGHT = 90;
  const TOTAL_BOX_HEIGHT = 110;
  const TOTAL_BOX_WIDTH = 240;

  // ========== HELPER FUNCTIONS ==========
  const drawText = (text, x, y, size = 10, bold = false, color = TEXT_COLOR) => {
    const font = bold ? customBoldFont : customFont;
    page.drawText(text, { x, y, size, font, color });
  };

  const drawRightAlignedText = (text, rightX, y, size = 10, bold = false, color = TEXT_COLOR) => {
    const font = bold ? customBoldFont : customFont;
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: rightX - textWidth, y, size, font, color });
  };

  const drawCenteredText = (text, centerX, y, size = 10, bold = false, color = TEXT_COLOR) => {
    const font = bold ? customBoldFont : customFont;
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: centerX - textWidth / 2, y, size, font, color });
  };

  const drawRect = (x, y, w, h, fillColor = null, borderColor = null, borderWidth = 0) => {
    const options = { x, y, width: w, height: h };
    if (fillColor) options.color = fillColor;
    if (borderColor) {
      options.borderColor = borderColor;
      options.borderWidth = borderWidth || 1;
    }
    page.drawRectangle(options);
  };

  const drawLine = (x1, y1, x2, y2, color = BORDER_COLOR, thickness = 1) => {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness,
      color,
    });
  };

  const drawOptionalField = (label, value, x, y, labelSize = 8, valueSize = 10) => {
    if (!value) return y;
    drawText(label, x, y, labelSize, true, MUTED_TEXT_COLOR);
    drawText(value, x, y - 12, valueSize, false, TEXT_COLOR);
    return y - 28;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const month = months[monthIndex] || parts[1];
    const day = parseInt(parts[2], 10);
    const year = parts[0];
    return `${day} ${month} ${year}`;
  };

  const drawStatusBadge = (status, x, y, width) => {
    let bgColor, textColor, label;
    switch (status) {
      case "PAID":
        bgColor = STATUS_PAID_BG;
        textColor = WHITE;
        label = "PAID";
        break;
      case "UNPAID":
        bgColor = STATUS_UNPAID_BG;
        textColor = WHITE;
        label = "UNPAID";
        break;
      case "PARTIAL":
        bgColor = STATUS_PARTIAL_BG;
        textColor = WHITE;
        label = "PARTIAL";
        break;
      default:
        bgColor = STATUS_DRAFT_BG;
        textColor = WHITE;
        label = "DRAFT";
    }

    const fontSize = 12;
    const font = customBoldFont;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const badgePaddingX = 12;
    const badgePaddingY = 6;
    const badgeWidth = textWidth + badgePaddingX * 2;
    const badgeHeight = fontSize + badgePaddingY * 2;
    const badgeX = x + (width - badgeWidth) / 2;
    const badgeY = y - badgeHeight;

    drawRect(badgeX, badgeY, badgeWidth, badgeHeight, bgColor);
    drawCenteredText(label, badgeX + badgeWidth / 2, badgeY + (badgeHeight - fontSize) / 2, fontSize, true, textColor);

    return badgeY;
  };

  const truncateText = (text, maxWidth, fontSize) => {
    const font = customFont;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    if (textWidth <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0) {
      truncated = truncated.slice(0, -1);
      if (font.widthOfTextAtSize(truncated + "...", fontSize) <= maxWidth) {
        return truncated + "...";
      }
    }
    return "";
  };

  // ========== SEQUENTIAL LAYOUT ==========
  let currentY = height - MARGIN; // Start from top margin

  // ========== HEADER SECTION ==========
  const headerTop = currentY;
  const headerBottom = headerTop - HEADER_HEIGHT;

  // Draw header background
  drawRect(LEFT_X, headerBottom, PAGE_WIDTH, HEADER_HEIGHT, PRIMARY_COLOR);

  // Left side: Business info
  drawText(businessName, LEFT_X + 20, headerTop - 28, 22, true, WHITE);
  if (location) {
    drawText(location, LEFT_X + 20, headerTop - 50, 9, false, rgb(0.8, 0.8, 0.8));
  }

  // Right side: Invoice details
  const invoiceRightX = RIGHT_X - 20;
  const metadataStartY = headerTop - 28;
  const metadataSpacing = 14;

  drawRightAlignedText("INVOICE", invoiceRightX, metadataStartY, 24, true, WHITE);
  drawRightAlignedText(`Invoice #: ${invoiceNumber}`, invoiceRightX, metadataStartY - metadataSpacing - 4, 9, false, rgb(0.8, 0.8, 0.8));
  drawRightAlignedText(`Date: ${invoiceDate}`, invoiceRightX, metadataStartY - metadataSpacing * 2 - 4, 9, false, rgb(0.8, 0.8, 0.8));
  drawRightAlignedText(`Due Date: ${dueDate}`, invoiceRightX, metadataStartY - metadataSpacing * 3 - 4, 9, false, rgb(0.8, 0.8, 0.8));

  currentY = headerBottom - SECTION_GAP;

  // ========== CUSTOMER SECTION ==========
  const customerCardHeight = 80;
  const customerCardTop = currentY;
  const customerCardBottom = customerCardTop - customerCardHeight;

  // Left card: BILL TO
  const leftCardWidth = (PAGE_WIDTH - SECTION_GAP) / 2;
  drawRect(LEFT_X, customerCardBottom, leftCardWidth, customerCardHeight, null, BORDER_COLOR, 1);

  // BILL TO label
  drawText("BILL TO", LEFT_X + 14, customerCardTop - 16, 9, true, MUTED_TEXT_COLOR);

  // Customer info
  let customerInfoY = customerCardTop - 34;
  if (customerName) {
    drawText(customerName, LEFT_X + 14, customerInfoY, 11, false, TEXT_COLOR);
    customerInfoY -= 18;
  }
  if (customerAddress) {
    drawText(customerAddress, LEFT_X + 14, customerInfoY, 9, false, MUTED_TEXT_COLOR);
    customerInfoY -= 14;
  }
  if (customerEmail) {
    drawText(customerEmail, LEFT_X + 14, customerInfoY, 9, false, MUTED_TEXT_COLOR);
    customerInfoY -= 14;
  }
  if (customerPhone) {
    drawText(customerPhone, LEFT_X + 14, customerInfoY, 9, false, MUTED_TEXT_COLOR);
  }

  // Right card: STATUS
  const rightCardX = LEFT_X + leftCardWidth + SECTION_GAP;
  drawRect(rightCardX, customerCardBottom, leftCardWidth, customerCardHeight, null, BORDER_COLOR, 1);

  // STATUS label
  drawText("STATUS", rightCardX + 14, customerCardTop - 16, 9, true, MUTED_TEXT_COLOR);

  // Status badge
  const statusLabel = balanceDue > 0 ? "UNPAID" : "PAID";
  drawStatusBadge(statusLabel, rightCardX + 14, customerCardTop - 22, leftCardWidth - 28);

  currentY = customerCardBottom - SECTION_GAP;

  // ========== ITEMS TABLE ==========
  const tableTop = currentY;
  const tableLeft = LEFT_X;
  const tableWidth = PAGE_WIDTH;

  // Column definitions
  const colDefs = [
    { x: tableLeft, width: 240 },           // Description
    { x: tableLeft + 240, width: 60 },      // Qty
    { x: tableLeft + 300, width: 100 },     // Unit Price
    { x: tableLeft + 400, width: tableWidth - 400 }, // Amount
  ];

  const headers = ["DESCRIPTION", "QTY", "UNIT PRICE", "AMOUNT"];

  // Draw header row background
  const headerRowTop = tableTop;
  const headerRowBottom = headerRowTop - ROW_HEIGHT;
  drawRect(tableLeft, headerRowBottom, tableWidth, ROW_HEIGHT, PRIMARY_COLOR);

  // Draw header text
  headers.forEach((header, i) => {
    const col = colDefs[i];
    let textX;
    if (i === 0) {
      // Left-aligned
      textX = col.x + CELL_PADDING;
    } else {
      // Right-aligned
      const textWidth = customFont.widthOfTextAtSize(header, 10);
      textX = col.x + col.width - textWidth - CELL_PADDING;
    }
    drawText(header, textX, headerRowBottom + (ROW_HEIGHT - 10) / 2, 10, true, WHITE);
  });

  // Draw header cell borders
  colDefs.forEach((col) => {
    drawRect(col.x, headerRowBottom, col.width, ROW_HEIGHT, null, WHITE, 0.5);
  });

  // Draw data row
  const dataRowTop = headerRowBottom;
  const dataRowBottom = dataRowTop - ROW_HEIGHT;

  // Description (left-aligned, truncated if needed)
  const descMaxWidth = colDefs[0].width - CELL_PADDING * 2;
  const truncatedDesc = truncateText(item, descMaxWidth, 10);
  drawText(truncatedDesc, colDefs[0].x + CELL_PADDING, dataRowBottom + (ROW_HEIGHT - 10) / 2, 10, false, TEXT_COLOR);

  // Quantity (centered)
  const qtyText = String(quantity);
  const qtyWidth = customFont.widthOfTextAtSize(qtyText, 10);
  const qtyCenterX = colDefs[1].x + colDefs[1].width / 2;
  drawCenteredText(qtyText, qtyCenterX, dataRowBottom + (ROW_HEIGHT - 10) / 2, 10, false, TEXT_COLOR);

  // Unit Price (right-aligned)
  const unitPriceText = `₦${unitPrice.toLocaleString()}`;
  drawRightAlignedText(unitPriceText, colDefs[2].x + colDefs[2].width - CELL_PADDING, dataRowBottom + (ROW_HEIGHT - 10) / 2, 10, false, TEXT_COLOR);

  // Amount (right-aligned)
  const amountText = `₦${subtotal.toLocaleString()}`;
  drawRightAlignedText(amountText, colDefs[3].x + colDefs[3].width - CELL_PADDING, dataRowBottom + (ROW_HEIGHT - 10) / 2, 10, false, TEXT_COLOR);

  // Draw data row cell borders
  colDefs.forEach((col) => {
    drawRect(col.x, dataRowBottom, col.width, ROW_HEIGHT, null, BORDER_COLOR, 0.5);
  });

  // Draw bottom border of table
  drawLine(tableLeft, dataRowBottom, tableLeft + tableWidth, dataRowBottom, BORDER_COLOR, 1);

  currentY = dataRowBottom - SECTION_GAP;

  // ========== NOTES SECTION (optional) ==========
  let notesSectionBottom = currentY;
  if (notes) {
    const notesSectionHeight = 50;
    const notesSectionTop = currentY;
    notesSectionBottom = notesSectionTop - notesSectionHeight;

    drawText("NOTES", LEFT_X, notesSectionTop - 14, 9, true, MUTED_TEXT_COLOR);
    drawText(notes, LEFT_X, notesSectionTop - 30, 9, false, TEXT_COLOR);

    currentY = notesSectionBottom - SECTION_GAP;
  }

  // ========== TOTALS SECTION ==========
  const totalsCardTop = currentY;
  const totalsCardBottom = totalsCardTop - TOTAL_BOX_HEIGHT;
  const totalsCardLeft = RIGHT_X - TOTAL_BOX_WIDTH;

  // Draw totals card background
  drawRect(totalsCardLeft, totalsCardBottom, TOTAL_BOX_WIDTH, TOTAL_BOX_HEIGHT, null, BORDER_COLOR, 1);

  // Subtotal
  const subtotalY = totalsCardTop - 18;
  drawText("Subtotal:", totalsCardLeft + 14, subtotalY, 10, false, TEXT_COLOR);
  const subtotalText = `₦${subtotal.toLocaleString()}`;
  drawRightAlignedText(subtotalText, totalsCardLeft + TOTAL_BOX_WIDTH - 14, subtotalY, 10, false, TEXT_COLOR);

  // Amount Paid
  const paidY = totalsCardTop - 38;
  drawText("Amount Paid:", totalsCardLeft + 14, paidY, 10, false, TEXT_COLOR);
  const paidText = `₦${amountPaid.toLocaleString()}`;
  drawRightAlignedText(paidText, totalsCardLeft + TOTAL_BOX_WIDTH - 14, paidY, 10, false, TEXT_COLOR);

  // Separator line above Balance Due
  const separatorY = totalsCardTop - 52;
  drawLine(totalsCardLeft + 14, separatorY, totalsCardLeft + TOTAL_BOX_WIDTH - 14, separatorY, BORDER_COLOR, 0.5);

  // Balance Due (focal point)
  const balanceY = totalsCardTop - 66;
  const balanceBoxHeight = 30;
  const balanceBoxTop = balanceY + 4;
  const balanceBoxBottom = balanceBoxTop - balanceBoxHeight;

  // Draw accent background for balance due
  drawRect(totalsCardLeft + 8, balanceBoxBottom, TOTAL_BOX_WIDTH - 16, balanceBoxHeight, PRIMARY_COLOR);

  // Balance Due label
  drawText("BALANCE DUE:", totalsCardLeft + 16, balanceBoxBottom + (balanceBoxHeight - 14) / 2, 12, true, WHITE);

  // Balance Due amount
  const balanceText = `₦${balanceDue.toLocaleString()}`;
  drawRightAlignedText(balanceText, totalsCardLeft + TOTAL_BOX_WIDTH - 16, balanceBoxBottom + (balanceBoxHeight - 14) / 2, 14, true, WHITE);

  currentY = totalsCardBottom - SECTION_GAP;

  // ========== FOOTER SECTION ==========
  const footerTop = currentY;

  // Draw separator line
  drawLine(LEFT_X, footerTop, RIGHT_X, footerTop, BORDER_COLOR, 1);

  // Footer text
  drawText("Thank you for your business!", LEFT_X, footerTop - 18, 11, true, TEXT_COLOR);
  if (dueDate) {
    const formattedDueDate = formatDate(dueDate);
    drawText(`Payment due by ${formattedDueDate}`, LEFT_X, footerTop - 36, 9, false, MUTED_TEXT_COLOR);
  }
  drawText("Generated by MarketOS", LEFT_X, footerTop - 52, 8, false, MUTED_TEXT_COLOR);

  // Serialize PDF
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
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

  // Determine Content-Type: use custom header if provided, otherwise default
  const contentType =
    headers["Content-Type"] ||
    (typeof payload === "object" &&
    !Buffer.isBuffer(payload)
      ? "application/json"
      : "text/plain");

  // Build response headers
  const responseHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Access-Control-Allow-Methods":
      "GET,POST,PUT,OPTIONS",
    "Content-Type": contentType,
    ...headers,
  };

  // Add Content-Length for binary payloads
  if (Buffer.isBuffer(payload)) {
    responseHeaders["Content-Length"] = payload.length;
  }

  res.writeHead(status, responseHeaders);
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

    // Validate required fields
    const requiredFields = [
      { field: "name", label: "Name" },
      { field: "businessName", label: "Business name" },
      { field: "location", label: "Location" },
      { field: "industry", label: "Industry" },
      { field: "businessType", label: "Business type" },
      { field: "mainProducts", label: "Main products/services" },
    ];

    for (const { field, label } of requiredFields) {
      if (!String(body[field] || "").trim()) {
        throw Object.assign(
          new Error(`${label} is required.`),
          { status: 400 },
        );
      }
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
        industry: body.industry,
        businessType: body.businessType,
        targetCustomers: body.targetCustomers,
        mainProducts: body.mainProducts,
        primaryGoal: body.primaryGoal,
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
    req.method === "POST" &&
    url.pathname ===
      "/api/auth/delete-account"
  ) {
    const user = requireUser(req, url, db);

    if (!body.confirm) {
      throw Object.assign(
        new Error("Confirmation is required to delete your account."),
        { status: 400 },
      );
    }

    // Remove all sessions for this user
    for (const [token, session] of Object.entries(db.sessions)) {
      if (session.userId === user.id) {
        delete db.sessions[token];
      }
    }

    // Remove the user
    const userIndex = db.users.findIndex((u) => u.id === user.id);
    if (userIndex !== -1) {
      db.users.splice(userIndex, 1);
    }

    await saveDb(db);

    return send(res, 200, {
      ok: true,
      message: "Account deleted successfully.",
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
    // Monthly invoice tracking
    const currentMonth = TODAY.slice(0, 7); // "YYYY-MM"
    if (data.invoiceMonth !== currentMonth) {
      data.invoiceMonth = currentMonth;
      data.invoiceCountThisMonth = 0;
    }

    // Free plan limit check (only applies when user does NOT have premium access)
    if (!hasPremiumAccess(data) && data.invoiceCountThisMonth >= 15) {
      throw Object.assign(
        new Error(
          "Free plan monthly invoice limit reached (15 invoices). Upgrade to Pro for unlimited invoices."
        ),
        { status: 403 },
      );
    }

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
    data.invoiceCountThisMonth += 1;

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

    const pdf = await makeInvoicePdf(
      data,
      invoiceId,
    );

    // Debug logging
    console.log("=== PDF DEBUG ===");
    console.log("typeof pdf:", typeof pdf);
    console.log("pdf.length:", pdf.length);
    console.log("pdf is Buffer:", Buffer.isBuffer(pdf));
    console.log("First 20 bytes:", pdf.slice(0, 20).toString("utf8"));
    console.log("=== END PDF DEBUG ===");

    return send(
      res,
      200,
      pdf,
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
    // Business Coach is temporarily disabled while we build the business core.
    // The full AI-powered coach will be re-enabled in a future release.
    return send(res, 200, {
      answer: "Business Coach\n\nComing Soon\n\nMarketOS is building an AI assistant that understands your business and helps you make better decisions.\n\nFeatures coming:\n- Business improvement suggestions\n- Growth strategies\n- Operational insights\n- AI-powered recommendations",
      actions: [],
      confidence: "low",
      diagnosis: "Business Coach is temporarily unavailable while we focus on core business features.",
      recommendations: [],
      nextSteps: [],
      dataLimitations: ["Business Coach is being rebuilt for the new MarketOS platform."]
    });
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
    url.pathname === "/api/knowledge"
  ) {
    const item = createKnowledgeItem(data, body.title, body.body);
    await saveDb(db);
    return send(res, 201, item);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/knowledge/upload"
  ) {
    const item = uploadKnowledgeItem(data, body.filename, body.content);
    await saveDb(db);
    return send(res, 201, item);
  }

  if (
    req.method === "GET" &&
    url.pathname === "/api/knowledge"
  ) {
    return send(res, 200, { items: listKnowledgeItems(data) });
  }

  if (
    req.method === "DELETE" &&
    url.pathname.startsWith("/api/knowledge/")
  ) {
    const id = url.pathname.split("/")[3];
    deleteKnowledgeItem(data, id);
    await saveDb(db);
    return send(res, 200, { ok: true });
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
  // Initialize SQLite database (non-blocking, JSON remains source of truth)
  initDatabase()
    .then(() => {
      console.log('[DB] SQLite database initialized.');
      // Check if migration is needed (controlled by env flag)
      if (process.env.MARKETOS_MIGRATE === '1') {
        return loadDb().then(async (db) => {
          if (isMigrationNeeded(db)) {
            console.log('[DB] Starting JSON to SQLite migration...');
            await migrateFromJson(db);
            console.log('[DB] Migration completed.');
          } else {
            console.log('[DB] No migration needed.');
          }
        });
      }
    })
    .catch((err) => {
      console.warn('[DB] SQLite initialization skipped:', err.message);
    })
    .finally(() => {
      server.listen(PORT, () => {
        console.log(
          `MarketOS backend running on http://127.0.0.1:${PORT}`,
        );
      });
    });
}

export {
  normalizeSale,
  analyzeNoteWithRules,
  analyzeWithReasoningModel,
  EXTRACTION_SCHEMA,
  createKnowledgeItem,
  uploadKnowledgeItem,
  listKnowledgeItems,
  deleteKnowledgeItem,
  searchKnowledge,
  retrieveRelevantKnowledge,
  buildCoachContext,
  deterministicCoachAnswer,
  coachAnswer,
  COACH_SCHEMA,
  directFactualAnswer,
  normalizeQuestion,
  classifyCoachQuestion,
};

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  await manager.shutdown();
  closeDatabase();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
