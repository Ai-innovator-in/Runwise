import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// We need to import the functions from server.mjs.
// Since server.mjs uses top-level await and side effects,
// we import it dynamically and extract the needed functions.
let normalizeSale, analyzeNoteWithRules, analyzeWithReasoningModel, EXTRACTION_SCHEMA;

before(async () => {
  const mod = await import("../server.mjs");
  normalizeSale = mod.normalizeSale;
  analyzeNoteWithRules = mod.analyzeNoteWithRules;
  analyzeWithReasoningModel = mod.analyzeWithReasoningModel;
  EXTRACTION_SCHEMA = mod.EXTRACTION_SCHEMA;
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
