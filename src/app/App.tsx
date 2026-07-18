import { useEffect, useMemo, useState, type ReactNode } from "react";
import { VoiceNoteRecorder } from "./components/VoiceNoteRecorder";
import {
  AlertTriangle,
  BarChart2,
  Bell,
  BookOpen,
  CheckCircle,
  ChevronRight,
  Cpu,
  Download,
  FileText,
  LayoutDashboard,
  Package,
  PlusSquare,
  Receipt,
  Search,
  Send,
  Settings,
  ShoppingCart,
  Trash2,
  Users,
  Wifi,
  X,
  Zap,
} from "lucide-react";

type ScreenId =
  | "dashboard"
  | "add-note"
  | "review"
  | "sales"
  | "expenses"
  | "inventory"
  | "customers"
  | "invoices"
  | "reports"
  | "coach"
  | "knowledge"
  | "performance"
  | "settings";

type Product = { id: string; name: string; stock: number; costPrice: number; sellPrice: number; damaged: number };
type Sale = { id: string; date: string; product: string; quantity: number; unitPrice: number; channel: string; customer?: string };
type Expense = { id: string; date: string; category: string; amount: number; note: string; status: string };
type Customer = { id: string; name: string; debt: number; lastActivity: string; status: string; history: CustomerHistory[] };
type CustomerHistory = { date: string; type: string; amount: number; note: string };
type Invoice = {
  id: string;
  number: string;
  date: string;
  customerName: string;
  dueDate: string;
  item: string;
  quantity: number;
  unitPrice: number;
  amountPaid: number;
  status: string;
};
type Draft = {
  id: string;
  note: string;
  createdAt: string;
  sales: Array<{ id: string; product: string; quantity: number; unitPrice: number; channel: string; customer?: string }>;
  expenses: Array<{ id: string; category: string; amount: number; note: string; status: string }>;
  debts: Array<{ id: string; customer: string; amount: number; status: string; note: string }>;
  summary: { salesTotal: number; expensesTotal: number; creditIssued: number };
  inference?: { engine: string; model?: string; warning?: string };
};
type AppData = {
  user: { id: string; name: string; email: string; businessName: string; location: string };
  settings: Record<string, string | boolean>;
  inventory: Product[];
  customers: Customer[];
  sales: Sale[];
  expenses: Expense[];
  invoices: Invoice[];
  knowledge: Array<{ id: string; title: string; source: string; body: string }>;
  performance: Record<string, string | number | null>;
  summary: Record<string, string | number | string[]>;
  recentActivity: Array<{ id: string; type: string; description: string; amount: number; date: string }>;
};

const NAV_ITEMS: { id: ScreenId; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
  { id: "add-note", label: "Add Business Note", icon: <PlusSquare size={16} /> },
  { id: "sales", label: "Sales", icon: <ShoppingCart size={16} /> },
  { id: "expenses", label: "Expenses", icon: <Receipt size={16} /> },
  { id: "inventory", label: "Inventory", icon: <Package size={16} /> },
  { id: "customers", label: "Customers & Debt", icon: <Users size={16} /> },
  { id: "invoices", label: "Invoices", icon: <FileText size={16} /> },
  { id: "reports", label: "Reports", icon: <BarChart2 size={16} /> },
  { id: "coach", label: "Business Coach", icon: <Zap size={16} /> },
  { id: "knowledge", label: "Knowledge Base", icon: <BookOpen size={16} /> },
  { id: "performance", label: "Performance", icon: <Cpu size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("marketos_token");
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload as T;
}

const formatMoney = (value: number) => `₦${Math.round(value || 0).toLocaleString()}`;
const margin = (item: Product) => Math.round(((item.sellPrice - item.costPrice) / item.sellPrice) * 100);

function Badge({ label, variant = "neutral" }: { label: string; variant?: string }) {
  const styles: Record<string, string> = {
    neutral: "bg-[#f9f9f6] text-[#1a1c1b]/60 border border-[#1a1c1b]/10",
    local: "bg-[#005932]/10 text-[#005932] border border-[#005932]/20",
    review: "bg-[#795900]/10 text-[#795900] border border-[#795900]/20",
    saved: "bg-[#005932]/10 text-[#005932] border border-[#005932]/20",
    low: "bg-red-50 text-red-700 border border-red-200",
    warning: "bg-amber-50 text-amber-800 border border-amber-200",
    danger: "bg-red-50 text-red-800 border border-red-200",
    success: "bg-[#005932]/10 text-[#005932] border border-[#005932]/20",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${styles[variant] || styles.neutral}`}>{label}</span>;
}

function Btn({
  children,
  variant = "primary",
  onClick,
  icon,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onClick?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-[#005932] text-white border-transparent hover:bg-[#004d2a] shadow-sm",
    secondary: "bg-white text-[#1a1c1b] border-[#1a1c1b]/20 hover:bg-[#f9f9f6]",
    ghost: "bg-transparent text-[#1a1c1b]/60 border-transparent hover:bg-[#005932]/5",
    danger: "bg-red-600 text-white border-transparent hover:bg-red-700 shadow-sm",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
      <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold font-mono tracking-tight mt-1 ${color || "text-[#1a1c1b]"}`}>{value}</p>
      {sub && <p className="text-xs text-[#1a1c1b]/40 mt-1">{sub}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#1a1c1b]/50 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full border border-[#1a1c1b]/10 rounded-xl px-3 py-2 text-sm text-[#1a1c1b] bg-white focus:outline-none focus:ring-2 focus:ring-[#005932]/30";

function DashboardScreen({
  data,
  note,
  setNote,
  onAnalyze,
  onNavigate,
}: {
  data: AppData;
  note: string;
  setNote: (value: string) => void;
  onAnalyze: () => void;
  onNavigate: (screen: ScreenId) => void;
}) {
  const summary = data.summary;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1a1c1b]">Dashboard</h1>
          <p className="text-sm text-[#1a1c1b]/50 mt-0.5">Live data from the local MarketOS backend</p>
        </div>
        <div className="flex gap-2">
          <Badge label="Offline" variant="success" />
          <Badge label="Backend Connected" variant="local" />
        </div>
      </div>

      {/* AI Capability Cards */}
      <div className="grid grid-cols-3 gap-4">
        <button onClick={() => onNavigate("add-note")} className="bg-white rounded-xl border border-[#005932]/20 p-5 text-left hover:shadow-md transition-shadow group">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#005932]/10 flex items-center justify-center">
              <Zap size={16} className="text-[#005932]" />
            </div>
            <span className="text-sm font-semibold text-[#1a1c1b]">Voice Recording</span>
          </div>
          <p className="text-xs text-[#1a1c1b]/50 leading-relaxed">Speak your business note. AI transcribes and extracts records automatically.</p>
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-[#005932] group-hover:gap-2 transition-all">
            Try it <ChevronRight size={12} />
          </div>
        </button>
        <button onClick={() => onNavigate("add-note")} className="bg-white rounded-xl border border-[#005932]/20 p-5 text-left hover:shadow-md transition-shadow group">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#005932]/10 flex items-center justify-center">
              <FileText size={16} className="text-[#005932]" />
            </div>
            <span className="text-sm font-semibold text-[#1a1c1b]">Note Analysis</span>
          </div>
          <p className="text-xs text-[#1a1c1b]/50 leading-relaxed">Type what happened. AI extracts sales, expenses, and customer data.</p>
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-[#005932] group-hover:gap-2 transition-all">
            Try it <ChevronRight size={12} />
          </div>
        </button>
        <button onClick={() => onNavigate("coach")} className="bg-white rounded-xl border border-[#005932]/20 p-5 text-left hover:shadow-md transition-shadow group">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#005932]/10 flex items-center justify-center">
              <BarChart2 size={16} className="text-[#005932]" />
            </div>
            <span className="text-sm font-semibold text-[#1a1c1b]">Business Coach</span>
          </div>
          <p className="text-xs text-[#1a1c1b]/50 leading-relaxed">Get AI-powered recommendations based on your business data.</p>
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-[#005932] group-hover:gap-2 transition-all">
            Try it <ChevronRight size={12} />
          </div>
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Today's Sales" value={formatMoney(Number(summary.salesTotal))} sub={`${data.sales.length} total sale records`} />
        <StatCard label="Expenses Today" value={formatMoney(Number(summary.expensesTotal))} color="text-red-600" />
        <StatCard label="Cash Received" value={formatMoney(Number(summary.cashReceived))} color="text-[#005932]" />
        <StatCard label="Customer Debt" value={formatMoney(Number(summary.customerDebt))} color="text-[#795900]" />
      </div>

      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
        <h3 className="font-semibold text-[#1a1c1b] mb-1">What happened in your business today?</h3>
        <p className="text-sm text-[#1a1c1b]/50 mb-3">The backend extracts records, then you review and save them to the ledger.</p>
        <textarea
          className={`${inputClass} h-28 resize-none`}
          placeholder="Type what happened, or record a voice note..."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="flex flex-wrap gap-2 mt-3">
          <VoiceNoteRecorder
            onTranscript={(transcript) => setNote(note.trim() ? `${note.trim()} ${transcript}` : transcript)}
          />
          <Btn onClick={onAnalyze} icon={<Zap size={14} />}>Analyze Note</Btn>
          <Btn variant="secondary" onClick={() => setNote("")} icon={<X size={14} />}>Clear</Btn>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Alerts</h2>
          <div className="space-y-2">
            {(summary.alerts as string[]).map((alert) => (
              <button key={alert} onClick={() => onNavigate(alert.includes("owes") ? "customers" : "inventory")} className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl bg-[#f9f9f6] border border-[#1a1c1b]/5">
                <AlertTriangle size={14} className="text-[#795900] mt-0.5" />
                <span className="text-sm text-[#1a1c1b]">{alert}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 col-span-2 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider">Recent Activity</h2>
            <Btn variant="ghost" onClick={() => onNavigate("reports")}>Open reports</Btn>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a1c1b]/5">
                <th className="text-left text-xs font-medium text-[#1a1c1b]/40 uppercase pb-2">Type</th>
                <th className="text-left text-xs font-medium text-[#1a1c1b]/40 uppercase pb-2">Description</th>
                <th className="text-right text-xs font-medium text-[#1a1c1b]/40 uppercase pb-2">Amount</th>
                <th className="text-left text-xs font-medium text-[#1a1c1b]/40 uppercase pb-2 pl-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1c1b]/5">
              {data.recentActivity.map((row) => (
                <tr key={row.id}>
                  <td className="py-2.5 pr-4"><Badge label={row.type} variant={row.type === "Expense" ? "danger" : row.type === "Sale" ? "success" : "warning"} /></td>
                  <td className="py-2.5 text-[#1a1c1b]">{row.description}</td>
                  <td className={`py-2.5 text-right font-mono font-medium ${row.amount < 0 ? "text-red-600" : "text-[#005932]"}`}>{formatMoney(row.amount)}</td>
                  <td className="py-2.5 pl-4 text-[#1a1c1b]/40 text-xs">{row.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AddNoteScreen({ note, setNote, onAnalyze }: { note: string; setNote: (value: string) => void; onAnalyze: () => void }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#1a1c1b]">Add Business Note</h1>
        <p className="text-sm text-[#1a1c1b]/50 mt-0.5">This sends your note to the local backend extractor. Nothing is saved until you approve the review screen.</p>
      </div>
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 space-y-4 shadow-sm">
        <textarea
          className={`${inputClass} h-44 resize-none`}
          placeholder="Type what happened, or use Record Voice below..."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <VoiceNoteRecorder
            onTranscript={(transcript) => setNote(note.trim() ? `${note.trim()} ${transcript}` : transcript)}
          />
          <Btn onClick={onAnalyze} icon={<Zap size={14} />}>Analyze Note</Btn>
          <Btn variant="secondary" onClick={() => setNote("")} icon={<Trash2 size={14} />}>Clear</Btn>
        </div>
      </div>
    </div>
  );
}

function ReviewScreen({ draft, setDraft, onCommit, onNavigate }: { draft: Draft | null; setDraft: (draft: Draft) => void; onCommit: () => void; onNavigate: (screen: ScreenId) => void }) {
  if (!draft) {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-xl border border-[#1a1c1b]/8 p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-[#1a1c1b]">Review Extracted Records</h1>
        <p className="text-sm text-[#1a1c1b]/50 mt-2 mb-4">Analyze a business note first. The backend will return a draft for review here.</p>
        <Btn onClick={() => onNavigate("add-note")} icon={<PlusSquare size={14} />}>Add Business Note</Btn>
      </div>
    );
  }

  const updateSale = (index: number, key: string, value: string) => {
    const sales = [...draft.sales];
    sales[index] = { ...sales[index], [key]: key === "quantity" || key === "unitPrice" ? Number(value) : value };
    setDraft({ ...draft, sales });
  };
  const updateExpense = (index: number, key: string, value: string) => {
    const expenses = [...draft.expenses];
    expenses[index] = { ...expenses[index], [key]: key === "amount" ? Number(value) : value };
    setDraft({ ...draft, expenses });
  };
  const updateDebt = (index: number, key: string, value: string) => {
    const debts = [...draft.debts];
    debts[index] = { ...debts[index], [key]: key === "amount" ? Number(value) : value };
    setDraft({ ...draft, debts });
  };
  const salesTotal = draft.sales.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0);
  const expensesTotal = draft.expenses.reduce((sum, row) => sum + row.amount, 0);
  const creditIssued = draft.debts.reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1a1c1b]">Review Extracted Records</h1>
          <p className="text-sm text-[#1a1c1b]/50 mt-0.5">Edit any backend-extracted value before saving to the ledger.</p>
        </div>
        <Badge label="Needs Review" variant="review" />
      </div>

      {draft.inference && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${draft.inference.warning ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-[#005932]/5 border-[#005932]/20 text-[#005932]"}`}>
          <span className="font-medium">Extraction engine:</span> {draft.inference.engine}
          {draft.inference.model ? ` · ${draft.inference.model}` : ""}
          {draft.inference.warning && <p className="text-xs mt-1 leading-relaxed">{draft.inference.warning}</p>}
        </div>
      )}

      <EditableTable
        title="Sales"
        columns={["Product", "Quantity", "Unit Price", "Channel"]}
        rows={draft.sales.map((row, index) => [
          <input className={inputClass} value={row.product} onChange={(event) => updateSale(index, "product", event.target.value)} />,
          <input className={inputClass} type="number" value={row.quantity} onChange={(event) => updateSale(index, "quantity", event.target.value)} />,
          <input className={inputClass} type="number" value={row.unitPrice} onChange={(event) => updateSale(index, "unitPrice", event.target.value)} />,
          <select className={inputClass} value={row.channel} onChange={(event) => updateSale(index, "channel", event.target.value)}>
            <option>Cash</option>
            <option>Transfer</option>
            <option>Credit</option>
          </select>,
        ])}
      />
      <EditableTable
        title="Expenses"
        columns={["Category", "Amount", "Note", "Status"]}
        rows={draft.expenses.map((row, index) => [
          <input className={inputClass} value={row.category} onChange={(event) => updateExpense(index, "category", event.target.value)} />,
          <input className={inputClass} type="number" value={row.amount} onChange={(event) => updateExpense(index, "amount", event.target.value)} />,
          <input className={inputClass} value={row.note} onChange={(event) => updateExpense(index, "note", event.target.value)} />,
          <input className={inputClass} value={row.status} onChange={(event) => updateExpense(index, "status", event.target.value)} />,
        ])}
      />
      <EditableTable
        title="Customer Debt"
        columns={["Customer", "Amount", "Status", "Note"]}
        rows={draft.debts.map((row, index) => [
          <input className={inputClass} value={row.customer} onChange={(event) => updateDebt(index, "customer", event.target.value)} />,
          <input className={inputClass} type="number" value={row.amount} onChange={(event) => updateDebt(index, "amount", event.target.value)} />,
          <input className={inputClass} value={row.status} onChange={(event) => updateDebt(index, "status", event.target.value)} />,
          <input className={inputClass} value={row.note} onChange={(event) => updateDebt(index, "note", event.target.value)} />,
        ])}
      />

      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 flex items-center justify-between shadow-sm">
        <div className="grid grid-cols-4 gap-6 text-sm">
          <SummaryItem label="Total Sales" value={formatMoney(salesTotal)} />
          <SummaryItem label="Expenses" value={formatMoney(expensesTotal)} />
          <SummaryItem label="Credit Issued" value={formatMoney(creditIssued)} />
          <SummaryItem label="Expected Cash" value={formatMoney(salesTotal - creditIssued)} />
        </div>
        <Btn onClick={onCommit} icon={<CheckCircle size={14} />}>Save to Ledger</Btn>
      </div>
    </div>
  );
}

function EditableTable({ title, columns, rows }: { title: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="bg-white rounded-xl border border-[#1a1c1b]/8 overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-[#1a1c1b]/5"><h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider">{title}</h2></div>
      <table className="w-full text-sm">
        <thead className="bg-[#f9f9f6] border-b border-[#1a1c1b]/5">
          <tr>{columns.map((column) => <th key={column} className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">{column}</th>)}</tr>
        </thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-b border-[#1a1c1b]/5">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-2.5">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[#1a1c1b]/50 uppercase tracking-wider">{label}</p>
      <p className="font-mono font-semibold text-[#1a1c1b] mt-1">{value}</p>
    </div>
  );
}

function SalesScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [form, setForm] = useState({ product: "", quantity: 1, unitPrice: 0, channel: "Cash", customer: "" });
  const submit = async () => refresh(await api<AppData>("/api/sales", { method: "POST", body: JSON.stringify(form) }));
  return (
    <LedgerScreen title="Sales" action={<Btn onClick={submit} icon={<ShoppingCart size={14} />}>Record Sale</Btn>}>
      <div className="grid grid-cols-5 gap-3 bg-white rounded-xl border border-[#1a1c1b]/8 p-4 shadow-sm">
        <Field label="Product"><input className={inputClass} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field>
        <Field label="Quantity"><input className={inputClass} type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></Field>
        <Field label="Unit Price"><input className={inputClass} type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} /></Field>
        <Field label="Channel"><select className={inputClass} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}><option>Cash</option><option>Transfer</option><option>Credit</option></select></Field>
        <Field label="Customer"><input className={inputClass} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></Field>
      </div>
      <DataTable columns={["Date", "Product", "Qty", "Unit", "Total", "Channel"]} rows={data.sales.map((sale) => [sale.date, sale.product, sale.quantity, formatMoney(sale.unitPrice), formatMoney(sale.quantity * sale.unitPrice), sale.channel])} />
    </LedgerScreen>
  );
}

function ExpensesScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [form, setForm] = useState({ category: "", amount: 0, note: "", status: "Paid" });
  const submit = async () => refresh(await api<AppData>("/api/expenses", { method: "POST", body: JSON.stringify(form) }));
  return (
    <LedgerScreen title="Expenses" action={<Btn onClick={submit} icon={<Receipt size={14} />}>Record Expense</Btn>}>
      <div className="grid grid-cols-4 gap-3 bg-white rounded-xl border border-[#1a1c1b]/8 p-4 shadow-sm">
        <Field label="Category"><input className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
        <Field label="Amount"><input className={inputClass} type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
        <Field label="Note"><input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <Field label="Status"><select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Paid</option><option>Due Soon</option></select></Field>
      </div>
      <DataTable columns={["Date", "Category", "Amount", "Note", "Status"]} rows={data.expenses.map((expense) => [expense.date, expense.category, formatMoney(expense.amount), expense.note, expense.status])} />
    </LedgerScreen>
  );
}

function InventoryScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [form, setForm] = useState({ product: "", quantity: 1, costPrice: 0 });
  const [newProduct, setNewProduct] = useState({ name: "", stock: 0, costPrice: 0, sellPrice: 0 });
  const mutate = async (url: string) => refresh(await api<AppData>(url, { method: "POST", body: JSON.stringify(form) }));
  const createProduct = async () => refresh(await api<AppData>("/api/inventory/products", { method: "POST", body: JSON.stringify(newProduct) }));
  return (
    <div className="space-y-5">
      <Header title="Inventory" subtitle="Stock changes are saved through the backend and reflected across reports." />
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Products" value={String(data.summary.totalProducts)} />
        <StatCard label="Low Stock Items" value={String(data.summary.lowStockCount)} color="text-red-600" />
        <StatCard label="Fast Moving Items" value={String(data.summary.fastMovingItems)} />
        <StatCard label="Stock Value" value={formatMoney(Number(data.summary.inventoryValue))} />
      </div>
      <div className="grid grid-cols-5 gap-3 bg-white rounded-xl border border-[#1a1c1b]/8 p-4 shadow-sm">
        <Field label="Product"><select className={inputClass} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}><option value="">Select product</option>{data.inventory.map((item) => <option key={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Quantity"><input className={inputClass} type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></Field>
        <Field label="New Cost Price"><input className={inputClass} type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })} /></Field>
        <div className="flex items-end"><Btn onClick={() => mutate("/api/inventory/stock")}>Add Stock</Btn></div>
        <div className="flex items-end"><Btn variant="danger" onClick={() => mutate("/api/inventory/damaged")}>Record Damaged</Btn></div>
      </div>
      <div className="grid grid-cols-5 gap-3 bg-white rounded-xl border border-[#1a1c1b]/8 p-4 shadow-sm">
        <Field label="New Product"><input className={inputClass} value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} /></Field>
        <Field label="Opening Stock"><input className={inputClass} type="number" value={newProduct.stock} onChange={(e) => setNewProduct({ ...newProduct, stock: Number(e.target.value) })} /></Field>
        <Field label="Cost Price"><input className={inputClass} type="number" value={newProduct.costPrice} onChange={(e) => setNewProduct({ ...newProduct, costPrice: Number(e.target.value) })} /></Field>
        <Field label="Sell Price"><input className={inputClass} type="number" value={newProduct.sellPrice} onChange={(e) => setNewProduct({ ...newProduct, sellPrice: Number(e.target.value) })} /></Field>
        <div className="flex items-end"><Btn onClick={createProduct}>Create Product</Btn></div>
      </div>
      <DataTable columns={["Product", "In Stock", "Cost", "Sell", "Margin", "Status"]} rows={data.inventory.map((item) => [item.name, item.stock, formatMoney(item.costPrice), formatMoney(item.sellPrice), `${margin(item)}%`, item.stock <= 10 ? "Low Stock" : "Healthy"])} />
    </div>
  );
}

function CustomersScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [customerId, setCustomerId] = useState(data.customers[0]?.id || "");
  const [amount, setAmount] = useState(0);
  const [reminder, setReminder] = useState("");
  const customer = data.customers.find((item) => item.id === customerId) || data.customers[0];
  const recordPayment = async () => refresh(await api<AppData>("/api/customers/payment", { method: "POST", body: JSON.stringify({ customerId, amount, note: "Payment recorded from app" }) }));
  const generateReminder = async () => setReminder((await api<{ message: string }>("/api/customers/reminder", { method: "POST", body: JSON.stringify({ customerId }) })).message);
  return (
    <div className="space-y-5">
      <Header title="Customers & Debt" subtitle="Payments and reminders are generated by the backend from current customer balances." />
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Outstanding" value={formatMoney(Number(data.summary.customerDebt))} color="text-red-600" />
        <StatCard label="Overdue Debt" value={formatMoney(Number(data.summary.overdueDebt))} color="text-[#795900]" />
        <StatCard label="Customers Owing" value={String(data.summary.customersOwing)} />
      </div>
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2"><DataTable columns={["Customer", "Amount Owed", "Last Activity", "Status"]} rows={data.customers.map((row) => [row.name, formatMoney(row.debt), row.lastActivity, row.status])} /></div>
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 space-y-3 shadow-sm">
          <Field label="Customer"><select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Select customer</option>{data.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Payment Amount"><input className={inputClass} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
          <div className="flex gap-2"><Btn disabled={!customerId} onClick={recordPayment}>Record Payment</Btn><Btn disabled={!customerId} variant="secondary" onClick={generateReminder} icon={<Send size={14} />}>Reminder</Btn></div>
          {!data.customers.length && <div className="p-3 bg-[#f9f9f6] border border-[#1a1c1b]/5 rounded-xl text-sm text-[#1a1c1b]/60">No customers yet. Customer debt records will appear after you save a credit sale or credit note.</div>}
          {reminder && <div className="p-3 bg-[#005932]/5 border border-[#005932]/20 rounded-xl text-sm text-[#005932]">{reminder}</div>}
          {customer && <div className="pt-3 border-t border-[#1a1c1b]/5"><p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase mb-2">History</p>{customer.history.map((item, index) => <p key={index} className="text-xs text-[#1a1c1b]/60 mb-1">{item.date}: {item.type} {formatMoney(item.amount)} - {item.note}</p>)}</div>}
        </div>
      </div>
    </div>
  );
}

function InvoicesScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [form, setForm] = useState({ customerName: "", dueDate: "", item: "", quantity: 1, unitPrice: 0, amountPaid: 0 });
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(data.invoices[0] || null);
  const subtotal = form.quantity * form.unitPrice;
  const save = async () => {
    const response = await api<{ invoice: Invoice; data: AppData }>("/api/invoices", { method: "POST", body: JSON.stringify(form) });
    setSavedInvoice(response.invoice);
    refresh(response.data);
  };
  return (
    <div className="space-y-5">
      <Header title="Invoice Generator" subtitle="Invoices are saved by the backend and export as a PDF file." />
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 space-y-3 shadow-sm">
          {Object.entries(form).map(([key, value]) => (
            <Field key={key} label={key.replace(/([A-Z])/g, " $1")}>
              <input className={inputClass} type={typeof value === "number" ? "number" : key === "dueDate" ? "date" : "text"} value={value} onChange={(e) => setForm({ ...form, [key]: typeof value === "number" ? Number(e.target.value) : e.target.value })} />
            </Field>
          ))}
          <div className="flex gap-2 pt-2">
            <Btn onClick={save}>Save Invoice</Btn>
            <Btn variant="secondary" disabled={!savedInvoice} onClick={() => savedInvoice && window.open(`/api/invoices/${savedInvoice.id}/pdf`, "_blank")} icon={<Download size={14} />}>Export PDF</Btn>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 shadow-sm">
          <div className="border-b border-[#1a1c1b]/5 pb-4 mb-4 flex justify-between">
            <div><h2 className="text-lg font-bold text-[#1a1c1b]">{String(data.settings.businessName)}</h2><p className="text-xs text-[#1a1c1b]/40">{String(data.settings.location)}</p></div>
            <div className="text-right"><p className="text-xs text-[#1a1c1b]/40 font-mono">{savedInvoice?.number || "Unsaved invoice"}</p><p className="text-xs text-[#795900]">Due: {form.dueDate}</p></div>
          </div>
          <p className="text-xs text-[#1a1c1b]/50 mb-1">Bill To</p>
          <p className="font-semibold text-[#1a1c1b] mb-4">{form.customerName}</p>
          <DataTable compact columns={["Item", "Qty", "Unit", "Total"]} rows={[[form.item, form.quantity, formatMoney(form.unitPrice), formatMoney(subtotal)]]} />
          <div className="border-t border-[#1a1c1b]/5 pt-3 mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{formatMoney(subtotal)}</span></div>
            <div className="flex justify-between text-[#005932]"><span>Amount Paid</span><span className="font-mono">-{formatMoney(form.amountPaid)}</span></div>
            <div className="flex justify-between font-bold text-[#1a1c1b] text-base pt-1 border-t border-[#1a1c1b]/10"><span>Balance Due</span><span className="font-mono text-red-600">{formatMoney(subtotal - form.amountPaid)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportsScreen({ data }: { data: AppData }) {
  const grossSales = data.sales.reduce((sum, sale) => sum + sale.quantity * sale.unitPrice, 0);
  const totalExpenses = data.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const net = grossSales - totalExpenses;
  const debtRatio = grossSales ? (Number(data.summary.customerDebt) / grossSales) * 100 : 0;
  return (
    <div className="space-y-5">
      <Header title="Reports" subtitle="Every number is calculated from the backend ledger." />
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Gross Sales" value={formatMoney(grossSales)} />
        <StatCard label="Expenses" value={formatMoney(totalExpenses)} color="text-red-600" />
        <StatCard label="Estimated Net" value={formatMoney(net)} color="text-[#005932]" />
        <StatCard label="Debt Ratio" value={`${debtRatio.toFixed(1)}%`} color="text-[#795900]" />
      </div>
      <DataTable columns={["Metric", "Value", "Source"]} rows={[["Gross Sales", formatMoney(grossSales), "Sales ledger"], ["Expenses", formatMoney(totalExpenses), "Expense ledger"], ["Customer Debt", formatMoney(Number(data.summary.customerDebt)), "Customer balances"], ["Inventory Value", formatMoney(Number(data.summary.inventoryValue)), "Inventory stock x cost"]]} />
    </div>
  );
}

function CoachScreen() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string[]; recommendedAction: string; basedOn: string } | null>(null);
  const ask = async () => setAnswer(await api("/api/coach", { method: "POST", body: JSON.stringify({ question }) }));
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Header title="Business Coach" subtitle="Answers are generated from backend ledger, inventory, and debt records." />
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 space-y-3 shadow-sm">
        <Field label="Ask about your business"><input className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        <Btn onClick={ask} icon={<Zap size={14} />}>Ask AI Coach</Btn>
      </div>
      {answer && <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 text-sm text-[#1a1c1b] shadow-sm"><Badge label={answer.basedOn} variant="local" /><ol className="list-decimal ml-5 mt-3 space-y-2">{answer.answer.map((item) => <li key={item}>{item}</li>)}</ol><div className="mt-4 p-3 bg-[#005932]/5 border border-[#005932]/20 rounded-xl text-[#005932]">{answer.recommendedAction}</div></div>}
    </div>
  );
}

function KnowledgeScreen({ data }: { data: AppData }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ answer: string; sources: string[]; offline: boolean } | null>(null);
  const search = async () => setResult(await api("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query }) }));
  return (
    <div className="space-y-5">
      <Header title="Knowledge Base" subtitle="Search runs against local backend knowledge records." />
      <div className="grid grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm"><h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Local Guides</h2>{data.knowledge.map((item) => <p key={item.id} className="text-sm text-[#1a1c1b] py-2 border-b border-[#1a1c1b]/5">{item.title}</p>)}</div>
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 flex gap-2 shadow-sm"><input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} /><Btn onClick={search} icon={<Search size={14} />}>Search</Btn></div>
          {result && <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm"><Badge label="Offline Knowledge" variant="local" /><p className="text-sm text-[#1a1c1b] leading-relaxed mt-3">{result.answer}</p><div className="flex gap-2 mt-4">{result.sources.map((source) => <Badge key={source} label={source} variant="saved" />)}</div></div>}
        </div>
      </div>
    </div>
  );
}

function PerformanceScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const run = async () => refresh(await api<AppData>("/api/performance/benchmark", { method: "POST", body: "{}" }));
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data.performance, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "marketos-benchmark.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const rows = Object.entries(data.performance).map(([key, value]) => [key, String(value ?? "Not run")]);
  return (
    <div className="space-y-5">
      <Header title="Performance Dashboard" subtitle="Benchmark metrics are stored and updated by the backend." />
      <div className="flex gap-2"><Btn onClick={run} icon={<Cpu size={14} />}>Run Local Benchmark</Btn><Btn variant="secondary" onClick={exportJson} icon={<Download size={14} />}>Export Benchmark Report</Btn></div>
      <DataTable columns={["Metric", "Value"]} rows={rows} />
    </div>
  );
}

function SettingsScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [form, setForm] = useState(data.settings);
  const save = async () => refresh(await api<AppData>("/api/settings", { method: "POST", body: JSON.stringify(form) }));
  return (
    <div className="space-y-5">
      <Header title="Settings" subtitle="Saved settings are persisted in the backend JSON database." />
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 grid grid-cols-2 gap-4 shadow-sm">
        {["businessName", "location", "currency", "language", "backupLocation"].map((key) => (
          <Field key={key} label={key.replace(/([A-Z])/g, " $1")}><input className={inputClass} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>
        ))}
        <div className="col-span-2 flex gap-2"><Btn onClick={save}>Save Settings</Btn><Badge label="Offline Mode Active" variant="success" /><Badge label="Cloud Sync Disabled" variant="neutral" /></div>
      </div>
    </div>
  );
}

function LedgerScreen({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><Header title={title} subtitle={`${title} records are created and loaded through the backend API.`} />{action}</div>
      {children}
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-[#1a1c1b]">{title}</h1>
      <p className="text-sm text-[#1a1c1b]/50 mt-0.5">{subtitle}</p>
    </div>
  );
}

function DataTable({ columns, rows, compact }: { columns: string[]; rows: Array<Array<ReactNode>>; compact?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-[#1a1c1b]/8 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-[#f9f9f6] border-b border-[#1a1c1b]/5">
          <tr>{columns.map((column) => <th key={column} className={`${compact ? "px-3 py-2" : "px-5 py-3"} text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider`}>{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[#1a1c1b]/5">
          {rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className={`${compact ? "px-3 py-2" : "px-5 py-3.5"} text-[#1a1c1b]`}>{cell}</td>)}</tr>) : (
            <tr><td colSpan={columns.length} className={`${compact ? "px-3 py-3" : "px-5 py-6"} text-center text-sm text-[#1a1c1b]/40`}>No records yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Sidebar({ active, onNavigate }: { active: ScreenId; onNavigate: (screen: ScreenId) => void }) {
  return (
    <aside className="w-60 shrink-0 flex flex-col h-full overflow-y-auto bg-[#1a1c1b]">
      <div className="px-4 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 mb-0.5"><div className="w-6 h-6 rounded bg-[#005932] flex items-center justify-center"><Zap size={13} className="text-white" /></div><span className="text-sm font-bold text-white">MarketOS</span></div>
        <span className="text-xs text-white/40 ml-8">Intelligent Precision</span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button key={item.id} onClick={() => onNavigate(item.id)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-colors ${active === item.id ? "bg-[#005932] text-white font-medium" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 text-xs text-white/40">
          <div className="w-1.5 h-1.5 rounded-full bg-[#005932]" />
          AI Ready
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40 mt-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Backend API connected
        </div>
      </div>
    </aside>
  );
}

function TopBar({ data, onSignOut }: { data: AppData; onSignOut: () => void }) {
  const businessName = String(data.settings.businessName || "Untitled Business");
  const location = String(data.settings.location || "No location set");
  return (
    <header className="h-14 bg-white border-b border-[#1a1c1b]/8 flex items-center justify-between px-5 shrink-0">
      <div><p className="text-xs font-semibold text-[#005932]">MarketOS Offline</p><p className="text-xs text-[#1a1c1b]/40">{businessName} · {location}</p></div>
      <div className="flex items-center gap-3"><Badge label="Offline Mode Active" variant="success" /><Badge label="Local API Running" variant="local" /><Bell size={16} className="text-[#1a1c1b]/40" /><Btn variant="ghost" onClick={onSignOut}>Sign out</Btn></div>
    </header>
  );
}

function AIPanel({ screen, data, onNavigate }: { screen: ScreenId; data: AppData; onNavigate: (screen: ScreenId) => void }) {
  const body = useMemo(() => {
    if (screen === "inventory") return `${data.summary.bestMarginProduct} has the strongest margin. ${data.summary.lowStockCount} item(s) need restocking.`;
    if (screen === "customers") return `${data.summary.customersOwing} customer(s) owe ${formatMoney(Number(data.summary.customerDebt))}.`;
    if (screen === "performance") return `Backend benchmark is local. Last run: ${String(data.performance.lastBenchmark || "not yet run")}.`;
    return `Today: ${formatMoney(Number(data.summary.salesTotal))} sales, ${formatMoney(Number(data.summary.expensesTotal))} expenses, ${formatMoney(Number(data.summary.cashReceived))} cash received.`;
  }, [data, screen]);
  return (
    <aside className="w-64 shrink-0 border-l border-[#1a1c1b]/8 bg-white flex flex-col">
      <div className="px-4 py-3.5 border-b border-[#1a1c1b]/5 flex items-center gap-2"><Zap size={14} className="text-[#005932]" /><span className="text-xs font-semibold text-[#1a1c1b]">Backend Assistant</span><Badge label="Local" variant="local" /></div>
      <div className="flex-1 px-4 py-4 space-y-4 overflow-y-auto">
        <div className="p-3.5 rounded-xl bg-[#005932]/5 border border-[#005932]/20"><p className="text-xs text-[#005932] leading-relaxed">{body}</p></div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Quick Actions</p>
          {[["Add note", "add-note"], ["Customers", "customers"], ["Inventory", "inventory"]].map(([label, target]) => (
            <button key={target} onClick={() => onNavigate(target as ScreenId)} className="w-full text-left px-3 py-2 rounded-xl border border-[#1a1c1b]/10 text-xs text-[#1a1c1b]/60 hover:bg-[#f9f9f6] flex items-center justify-between">{label}<ChevronRight size={11} /></button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string) => Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [form, setForm] = useState({ name: "", email: "", password: "", businessName: "", location: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api<{ token: string; user: unknown }>(mode === "signup" ? "/api/auth/signup" : "/api/auth/signin", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem("marketos_token", response.token);
      await onAuthenticated(response.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9f9f6] grid place-items-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-[#1a1c1b]/8 p-6 shadow-sm">
        <div className="mb-6">
          <div className="w-9 h-9 rounded bg-[#005932] flex items-center justify-center mb-3"><Zap size={18} className="text-white" /></div>
          <h1 className="text-xl font-semibold text-[#1a1c1b]">MarketOS Offline</h1>
          <p className="text-sm text-[#1a1c1b]/50 mt-1">Create an account or sign in to your local business workspace.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button className={`rounded-xl border px-3 py-2 text-sm ${mode === "signup" ? "bg-[#005932] text-white border-[#005932]" : "bg-white text-[#1a1c1b] border-[#1a1c1b]/20"}`} onClick={() => setMode("signup")}>Sign up</button>
          <button className={`rounded-xl border px-3 py-2 text-sm ${mode === "signin" ? "bg-[#005932] text-white border-[#005932]" : "bg-white text-[#1a1c1b] border-[#1a1c1b]/20"}`} onClick={() => setMode("signin")}>Sign in</button>
        </div>

        <div className="space-y-3">
          {mode === "signup" && (
            <>
              <Field label="Your Name"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Business Name"><input className={inputClass} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></Field>
              <Field label="Location"><input className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            </>
          )}
          <Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Password"><input className={inputClass} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          <Btn disabled={loading} onClick={submit}>{mode === "signup" ? "Create Account" : "Sign In"}</Btn>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [data, setData] = useState<AppData | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const refresh = async (payload?: AppData) => {
    const next = payload || (await api<AppData>("/api/bootstrap"));
    setData(next);
  };

  useEffect(() => {
    if (!localStorage.getItem("marketos_token")) {
      setAuthReady(true);
      return;
    }
    refresh()
      .catch((err) => {
        localStorage.removeItem("marketos_token");
        setError(err.message);
      })
      .finally(() => setAuthReady(true));
  }, []);

  const run = async (action: () => Promise<void>, success: string) => {
    try {
      setError("");
      await action();
      setToast(success);
      setTimeout(() => setToast(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  };

  const analyze = () => run(async () => {
    const nextDraft = await api<Draft>("/api/notes/analyze", { method: "POST", body: JSON.stringify({ note }) });
    setDraft(nextDraft);
    setScreen("review");
  }, "Note analyzed by backend.");

  const commit = () => run(async () => {
    const response = await api<{ saved: unknown; data: AppData }>("/api/ledger/commit", { method: "POST", body: JSON.stringify({ draft }) });
    setDraft(null);
    setData(response.data);
    setScreen("dashboard");
  }, "Records saved to backend ledger.");

  const signOut = () => run(async () => {
    await api("/api/auth/signout", { method: "POST", body: "{}" });
    localStorage.removeItem("marketos_token");
    setData(null);
    setDraft(null);
    setNote("");
  }, "Signed out.");

  if (!authReady) {
    return <div className="h-screen grid place-items-center bg-[#f9f9f6] text-sm text-[#1a1c1b]/60">Starting MarketOS...</div>;
  }

  if (!data) {
    return <AuthScreen onAuthenticated={async () => refresh()} />;
  }

  const render = () => {
    switch (screen) {
      case "dashboard": return <DashboardScreen data={data} note={note} setNote={setNote} onAnalyze={analyze} onNavigate={setScreen} />;
      case "add-note": return <AddNoteScreen note={note} setNote={setNote} onAnalyze={analyze} />;
      case "review": return <ReviewScreen draft={draft} setDraft={setDraft} onCommit={commit} onNavigate={setScreen} />;
      case "sales": return <SalesScreen data={data} refresh={(payload) => run(() => refresh(payload), "Sale saved.")} />;
      case "expenses": return <ExpensesScreen data={data} refresh={(payload) => run(() => refresh(payload), "Expense saved.")} />;
      case "inventory": return <InventoryScreen data={data} refresh={(payload) => run(() => refresh(payload), "Inventory updated.")} />;
      case "customers": return <CustomersScreen data={data} refresh={(payload) => run(() => refresh(payload), "Customer updated.")} />;
      case "invoices": return <InvoicesScreen data={data} refresh={(payload) => run(() => refresh(payload), "Invoice saved.")} />;
      case "reports": return <ReportsScreen data={data} />;
      case "coach": return <CoachScreen />;
      case "knowledge": return <KnowledgeScreen data={data} />;
      case "performance": return <PerformanceScreen data={data} refresh={(payload) => run(() => refresh(payload), "Benchmark updated.")} />;
      case "settings": return <SettingsScreen data={data} refresh={(payload) => run(() => refresh(payload), "Settings saved.")} />;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f9f9f6]" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <Sidebar active={screen} onNavigate={setScreen} />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar data={data} onSignOut={signOut} />
        {(toast || error) && <div className={`px-5 py-2 text-sm border-b ${error ? "bg-red-50 text-red-700 border-red-200" : "bg-[#005932]/5 text-[#005932] border-[#005932]/20"}`}>{error || toast}</div>}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-6 min-w-0">{render()}</main>
          <AIPanel screen={screen} data={data} onNavigate={setScreen} />
        </div>
      </div>
    </div>
  );
}
