import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// We need to import the functions from server.mjs.
// Since server.mjs uses top-level await and side effects,
// we import it dynamically and extract the needed functions.
let normalizeSale, analyzeNoteWithRules, analyzeWithReasoningModel, EXTRACTION_SCHEMA;
let createKnowledgeItem, uploadKnowledgeItem, listKnowledgeItems, deleteKnowledgeItem, searchKnowledge;
let retrieveRelevantKnowledge, buildCoachContext, deterministicCoachAnswer, coachAnswer, COACH_SCHEMA;

before(async () => {
  const mod = await import("../server.mjs");
  normalizeSale = mod.normalizeSale;
  analyzeNoteWithRules = mod.analyzeNoteWithRules;
  analyzeWithReasoningModel = mod.analyzeWithReasoningModel;
  EXTRACTION_SCHEMA = mod.EXTRACTION_SCHEMA;
  createKnowledgeItem = mod.createKnowledgeItem;
  uploadKnowledgeItem = mod.uploadKnowledgeItem;
  listKnowledgeItems = mod.listKnowledgeItems;
  deleteKnowledgeItem = mod.deleteKnowledgeItem;
  searchKnowledge = mod.searchKnowledge;
  retrieveRelevantKnowledge = mod.retrieveRelevantKnowledge;
  buildCoachContext = mod.buildCoachContext;
  deterministicCoachAnswer = mod.deterministicCoachAnswer;
  coachAnswer = mod.coachAnswer;
  COACH_SCHEMA = mod.COACH_SCHEMA;
});

describe("normalizeSale", () => {
  it("should compute unitPrice from totalAmount when unitPrice is null", () => {
    const result = normalizeSale({
      product: "cement",
      quantity: 50,
      unitPrice: null,
      totalAmount: 5000,
      channel: "Cash",
      customer: "Musa",
    });
    assert.equal(result.product, "Cement");
    assert.equal(result.quantity, 50);
    assert.equal(result.unitPrice, 100); // 5000 / 50
    assert.equal(result.channel, "Cash");
    assert.equal(result.customer, "Musa");
  });

  it("should keep explicit unitPrice when provided", () => {
    const result = normalizeSale({
      product: "cement",
      quantity: 50,
      unitPrice: 5000,
      totalAmount: null,
      channel: "Cash",
      customer: "Musa",
    });
    assert.equal(result.unitPrice, 5000);
  });

  it("should handle sale without quantity (treat total as unit price)", () => {
    const result = normalizeSale({
      product: "cement",
      quantity: 0,
      unitPrice: null,
      totalAmount: 5000,
      channel: "Cash",
      customer: "Musa",
    });
    assert.equal(result.unitPrice, 5000);
  });

  it("should return null unitPrice when neither unitPrice nor totalAmount is provided", () => {
    const result = normalizeSale({
      product: "cement",
      quantity: 50,
      unitPrice: null,
      totalAmount: null,
      channel: "Cash",
      customer: "Musa",
    });
    assert.equal(result.unitPrice, null);
  });
});

describe("analyzeNoteWithRules", () => {
  it('should parse "I sold 50 bags of cement to Musa for 5,000."', () => {
    const draft = analyzeNoteWithRules(
      "I sold 50 bags of cement to Musa for 5,000."
    );
    assert.equal(draft.sales.length, 1);
    const sale = draft.sales[0];
    assert.equal(sale.product, "Cement");
    assert.equal(sale.quantity, 50);
    assert.equal(sale.unitPrice, 100); // 5000 / 50
    assert.equal(sale.channel, "Cash");
    assert.equal(sale.customer, "Musa");
  });

  it('should parse "I sold 50 bags of cement to Musa at 5,000 each."', () => {
    const draft = analyzeNoteWithRules(
      "I sold 50 bags of cement to Musa at 5,000 each."
    );
    assert.equal(draft.sales.length, 1);
    const sale = draft.sales[0];
    assert.equal(sale.product, "Cement");
    assert.equal(sale.quantity, 50);
    assert.equal(sale.unitPrice, 5000);
    assert.equal(sale.channel, "Cash");
    assert.equal(sale.customer, "Musa");
  });

  it('should parse "I sold 50 bags of cement to Musa for a total of 5,000."', () => {
    const draft = analyzeNoteWithRules(
      "I sold 50 bags of cement to Musa for a total of 5,000."
    );
    assert.equal(draft.sales.length, 1);
    const sale = draft.sales[0];
    assert.equal(sale.product, "Cement");
    assert.equal(sale.quantity, 50);
    assert.equal(sale.unitPrice, 100); // 5000 / 50
    assert.equal(sale.channel, "Cash");
    assert.equal(sale.customer, "Musa");
  });

  it('should parse "I sold cement to Musa for 5,000."', () => {
    const draft = analyzeNoteWithRules(
      "I sold cement to Musa for 5,000."
    );
    assert.equal(draft.sales.length, 1);
    const sale = draft.sales[0];
    assert.equal(sale.product, "Cement");
    assert.equal(sale.quantity, 1); // default quantity
    assert.equal(sale.unitPrice, 5000); // total treated as unit price
    assert.equal(sale.channel, "Cash");
    assert.equal(sale.customer, "");
  });

  it('should parse "Musa took 50 bags of cement on credit for 5,000."', () => {
    const draft = analyzeNoteWithRules(
      "Musa took 50 bags of cement on credit for 5,000."
    );
    assert.equal(draft.sales.length, 1);
    const sale = draft.sales[0];
    assert.equal(sale.product, "Cement");
    assert.equal(sale.quantity, 50);
    assert.equal(sale.unitPrice, 100); // 5000 / 50
    assert.equal(sale.channel, "Credit");
    assert.equal(sale.customer, "Musa");
  });

  it('should parse "I paid 5,000 for transport."', () => {
    const draft = analyzeNoteWithRules(
      "I paid 5,000 for transport."
    );
    assert.equal(draft.sales.length, 0);
    assert.equal(draft.expenses.length, 1);
    const expense = draft.expenses[0];
    assert.equal(expense.category, "Transport");
    assert.equal(expense.amount, 5000);
    assert.equal(expense.status, "Paid");
  });
});

describe("knowledge operations", () => {
  // Create a minimal data object for testing
  const makeData = () => ({
    knowledge: [],
  });

  it("should create a knowledge item from text", () => {
    const data = makeData();
    const item = createKnowledgeItem(data, "Test Title", "Test body content");
    assert.equal(item.title, "Test Title");
    assert.equal(item.body, "Test body content");
    assert.equal(item.source, "manual");
    assert.ok(item.id.startsWith("knowledge_"));
    assert.equal(data.knowledge.length, 1);
  });

  it("should reject duplicate title", () => {
    const data = makeData();
    createKnowledgeItem(data, "Duplicate Title", "First body");
    assert.throws(
      () => createKnowledgeItem(data, "duplicate title", "Second body"),
      { status: 409 },
    );
  });

  it("should reject empty title", () => {
    const data = makeData();
    assert.throws(
      () => createKnowledgeItem(data, "", "body"),
      { status: 400 },
    );
  });

  it("should reject empty body", () => {
    const data = makeData();
    assert.throws(
      () => createKnowledgeItem(data, "Title", ""),
      { status: 400 },
    );
  });

  it("should reject title longer than 200 characters", () => {
    const data = makeData();
    assert.throws(
      () => createKnowledgeItem(data, "x".repeat(201), "body"),
      { status: 400 },
    );
  });

  it("should reject body larger than 100KB", () => {
    const data = makeData();
    assert.throws(
      () => createKnowledgeItem(data, "Title", "x".repeat(102401)),
      { status: 400 },
    );
  });

  it("should upload a valid .txt file", () => {
    const data = makeData();
    const content = Buffer.from("Hello, world!").toString("base64");
    const item = uploadKnowledgeItem(data, "test.txt", content);
    assert.equal(item.title, "test");
    assert.equal(item.body, "Hello, world!");
    assert.equal(item.source, "upload");
    assert.equal(data.knowledge.length, 1);
  });

  it("should upload a valid .md file", () => {
    const data = makeData();
    const content = Buffer.from("# Markdown content").toString("base64");
    const item = uploadKnowledgeItem(data, "readme.md", content);
    assert.equal(item.title, "readme");
    assert.equal(item.body, "# Markdown content");
    assert.equal(data.knowledge.length, 1);
  });

  it("should reject malformed base64", () => {
    const data = makeData();
    assert.throws(
      () => uploadKnowledgeItem(data, "test.txt", "!!!invalid base64!!!"),
      { status: 400 },
    );
  });

  it("should reject unsupported extension", () => {
    const data = makeData();
    assert.throws(
      () => uploadKnowledgeItem(data, "test.pdf", Buffer.from("content").toString("base64")),
      { status: 400 },
    );
  });

  it("should reject decoded file larger than 1 MB", () => {
    const data = makeData();
    // Create a base64 string that decodes to > 1 MB
    const largeContent = "x".repeat(1400000); // ~1.05 MB when decoded
    const base64 = Buffer.from(largeContent).toString("base64");
    assert.throws(
      () => uploadKnowledgeItem(data, "large.txt", base64),
      { status: 400 },
    );
  });

  it("should reject empty decoded content", () => {
    const data = makeData();
    const content = Buffer.from("").toString("base64");
    assert.throws(
      () => uploadKnowledgeItem(data, "empty.txt", content),
      { status: 400 },
    );
  });

  it("should reject duplicate filename", () => {
    const data = makeData();
    const content = Buffer.from("First file").toString("base64");
    uploadKnowledgeItem(data, "test.txt", content);
    assert.throws(
      () => uploadKnowledgeItem(data, "test.txt", content),
      { status: 409 },
    );
  });

  it("should handle UTF-8 text", () => {
    const data = makeData();
    const utf8Content = "Hello, 世界!";
    const content = Buffer.from(utf8Content, "utf8").toString("base64");
    const item = uploadKnowledgeItem(data, "utf8.txt", content);
    assert.equal(item.body, utf8Content);
  });

  it("should remove UTF-8 BOM", () => {
    const data = makeData();
    const bomContent = "\uFEFFHello with BOM";
    const content = Buffer.from(bomContent, "utf8").toString("base64");
    const item = uploadKnowledgeItem(data, "bom.txt", content);
    assert.equal(item.body, "Hello with BOM");
  });

  it("should normalize CRLF to LF", () => {
    const data = makeData();
    const crlfContent = "Line1\r\nLine2\r\nLine3";
    const content = Buffer.from(crlfContent, "utf8").toString("base64");
    const item = uploadKnowledgeItem(data, "crlf.txt", content);
    assert.equal(item.body, "Line1\nLine2\nLine3");
  });

  it("should list knowledge items", () => {
    const data = makeData();
    createKnowledgeItem(data, "Item 1", "Body 1");
    createKnowledgeItem(data, "Item 2", "Body 2");
    const items = listKnowledgeItems(data);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "Item 2"); // most recent first
    assert.equal(items[1].title, "Item 1");
  });

  it("should delete a knowledge item", () => {
    const data = makeData();
    const item = createKnowledgeItem(data, "To Delete", "Body");
    assert.equal(data.knowledge.length, 1);
    deleteKnowledgeItem(data, item.id);
    assert.equal(data.knowledge.length, 0);
  });

  it("should throw 404 when deleting non-existent item", () => {
    const data = makeData();
    assert.throws(
      () => deleteKnowledgeItem(data, "nonexistent"),
      { status: 404 },
    );
  });

  it("should search knowledge items", () => {
    const data = makeData();
    createKnowledgeItem(data, "Cement Pricing", "Cement costs 5000 per bag");
    createKnowledgeItem(data, "Transport Costs", "Transport costs 2000 per trip");
    const result = searchKnowledge(data, "cement");
    assert.ok(result.answer.includes("Cement costs"));
    assert.equal(result.sources.length, 1);
  });

  it("should return empty result for no match", () => {
    const data = makeData();
    createKnowledgeItem(data, "Test", "Some content");
    const result = searchKnowledge(data, "nonexistent");
    assert.ok(result.answer.includes("No matching"));
    assert.equal(result.sources.length, 0);
  });
});

describe("retrieveRelevantKnowledge", () => {
  const makeData = () => ({
    knowledge: [],
    sales: [],
    expenses: [],
    customers: [],
    inventory: [],
  });

  it("should return empty array when no knowledge exists", () => {
    const data = makeData();
    const results = retrieveRelevantKnowledge(data, "cement");
    assert.equal(results.length, 0);
  });

  it("should find matching documents by keyword", () => {
    const data = makeData();
    createKnowledgeItem(data, "Cement Pricing", "Our business sells cement at 5000 per bag");
    const results = retrieveRelevantKnowledge(data, "cement");
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Cement Pricing");
    assert.ok(results[0].score > 0);
  });

  it("should rank title matches above body matches", () => {
    const data = makeData();
    createKnowledgeItem(data, "Cement Guide", "How to sell cement effectively");
    createKnowledgeItem(data, "General Tips", "Cement is a common building material");
    const results = retrieveRelevantKnowledge(data, "cement");
    assert.equal(results.length, 2);
    // Title match should have higher score
    assert.ok(results[0].score > results[1].score);
    assert.equal(results[0].title, "Cement Guide");
  });

  it("should limit results to top 3", () => {
    const data = makeData();
    for (let i = 0; i < 5; i++) {
      createKnowledgeItem(data, `Doc ${i}`, `Content about cement ${i}`);
    }
    const results = retrieveRelevantKnowledge(data, "cement");
    assert.equal(results.length, 3);
  });

  it("should limit excerpt length", () => {
    const data = makeData();
    const longBody = "Cement " + "x".repeat(1000);
    createKnowledgeItem(data, "Long Doc", longBody);
    const results = retrieveRelevantKnowledge(data, "cement");
    assert.ok(results[0].excerpt.length <= 500);
  });

  it("should return empty array when no relevant match", () => {
    const data = makeData();
    createKnowledgeItem(data, "Transport", "Transport costs 2000 per trip");
    const results = retrieveRelevantKnowledge(data, "cement");
    assert.equal(results.length, 0);
  });
});

describe("deterministicCoachAnswer", () => {
  const makeData = () => ({
    knowledge: [],
    sales: [],
    expenses: [],
    customers: [],
    inventory: [],
  });

  it("should return the correct response shape", () => {
    const data = makeData();
    const result = deterministicCoachAnswer(data, "How is my business doing?");
    assert.ok(typeof result.answer === "string");
    assert.ok(Array.isArray(result.observations));
    assert.ok(Array.isArray(result.recommendations));
    assert.ok(Array.isArray(result.evidenceUsed));
    assert.ok(["high", "medium", "low"].includes(result.confidence));
    assert.ok(Array.isArray(result.dataLimitations));
  });

  it("should include knowledge evidence when relevant", () => {
    const data = makeData();
    createKnowledgeItem(data, "Cement Pricing", "Our business sells cement at 5000 per bag");
    const result = deterministicCoachAnswer(data, "cement");
    const knowledgeEvidence = result.evidenceUsed.filter((e) => e.type === "knowledge");
    assert.ok(knowledgeEvidence.length > 0);
    assert.equal(knowledgeEvidence[0].title, "Cement Pricing");
  });

  it("should exclude unrelated documents", () => {
    const data = makeData();
    createKnowledgeItem(data, "Transport", "Transport costs 2000 per trip");
    const result = deterministicCoachAnswer(data, "cement");
    const knowledgeEvidence = result.evidenceUsed.filter((e) => e.type === "knowledge");
    assert.equal(knowledgeEvidence.length, 0);
  });

  it("should set confidence to low when no sales or expenses", () => {
    const data = makeData();
    const result = deterministicCoachAnswer(data, "How is my business?");
    assert.equal(result.confidence, "low");
  });

  it("should set confidence to medium when sales and expenses exist", () => {
    const data = makeData();
    data.sales.push({ id: "s1", date: "2026-07-19", product: "Cement", quantity: 10, unitPrice: 5000, channel: "Cash", customer: "Musa" });
    data.expenses.push({ id: "e1", date: "2026-07-19", category: "Transport", amount: 2000, note: "Delivery", status: "Paid" });
    const result = deterministicCoachAnswer(data, "How is my business?");
    assert.equal(result.confidence, "medium");
  });

  it("should not expose internal engine details", () => {
    const data = makeData();
    const result = deterministicCoachAnswer(data, "test");
    assert.ok(!result.answer.includes("llama"));
    assert.ok(!result.answer.includes("fallback"));
    assert.ok(!result.answer.includes("engine"));
  });

  it("should answer business name question from settings", () => {
    const data = makeData();
    data.settings = { businessName: "My Test Business", location: "" };
    const result = deterministicCoachAnswer(data, "What's my business name?");
    assert.ok(result.answer.includes("My Test Business"));
    assert.equal(result.evidenceUsed[0].title, "Business name");
  });

  it("should answer business name question from Knowledge Base when settings empty", () => {
    const data = makeData();
    data.settings = { businessName: "", location: "" };
    createKnowledgeItem(data, "My KB Business", "This document describes our business");
    const result = deterministicCoachAnswer(data, "What's my business name?");
    assert.ok(result.answer.includes("My KB Business"));
    assert.equal(result.evidenceUsed[0].type, "knowledge");
  });

  it("should indicate insufficient data when business name not found", () => {
    const data = makeData();
    data.settings = { businessName: "", location: "" };
    const result = deterministicCoachAnswer(data, "What's my business name?");
    assert.ok(result.dataLimitations.some((lim) => lim.includes("No business name")));
  });

  it("should not return unrelated low-stock advice for business name question", () => {
    const data = makeData();
    data.settings = { businessName: "TestCo", location: "" };
    data.inventory = [{ id: "p1", name: "Cement", stock: 5, costPrice: 100, sellPrice: 200, damaged: 0 }];
    const result = deterministicCoachAnswer(data, "What's my business name?");
    assert.ok(result.answer.includes("TestCo"));
    assert.ok(!result.answer.includes("low on stock"));
  });

  it("should answer business location question", () => {
    const data = makeData();
    data.settings = { businessName: "", location: "Lagos" };
    const result = deterministicCoachAnswer(data, "Where is my business located?");
    assert.ok(result.answer.includes("Lagos"));
  });

  it("should answer total sales question", () => {
    const data = makeData();
    data.sales = [{ id: "s1", date: "2026-07-19", product: "Cement", quantity: 10, unitPrice: 5000, channel: "Cash", customer: "Musa" }];
    const result = deterministicCoachAnswer(data, "What are my total sales?");
    assert.ok(result.answer.includes("50,000"));
  });

  it("should answer customer debt question", () => {
    const data = makeData();
    data.customers = [{ id: "c1", name: "Musa", debt: 50000, lastActivity: "2026-07-19", status: "Active", history: [] }];
    const result = deterministicCoachAnswer(data, "How much customer debt do I have?");
    assert.ok(result.answer.includes("50,000"));
  });

  it("should answer low stock question", () => {
    const data = makeData();
    data.inventory = [{ id: "p1", name: "Cement", stock: 5, costPrice: 100, sellPrice: 200, damaged: 0 }];
    const result = deterministicCoachAnswer(data, "What products are low on stock?");
    assert.ok(result.answer.includes("1 product"));
  });
});

describe("directFactualAnswer", () => {
  const makeData = () => ({
    knowledge: [],
    sales: [],
    expenses: [],
    customers: [],
    inventory: [],
    settings: { businessName: "", location: "" },
  });

  it("should return null for non-factual question", () => {
    const data = makeData();
    const result = directFactualAnswer(data, "How can I improve my business?");
    assert.equal(result, null);
  });

  it("should return business name from settings", () => {
    const data = makeData();
    data.settings.businessName = "TestCo";
    const result = directFactualAnswer(data, "What's my business name?");
    assert.ok(result);
    assert.ok(result.answer.includes("TestCo"));
    assert.equal(result.confidence, "high");
  });
