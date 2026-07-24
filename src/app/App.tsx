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
  Lock,
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
  plan: "free" | "pro";
  trialStartedAt: string;
  trialEndsAt: string;
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  licenseActivationId: string | null;
  hasPremiumAccess: boolean;
  invoiceCountThisMonth: number;
  invoiceMonth: string;
  settings: Record<string, string | boolean>;
  inventory: Product[];
  customers: Customer[];
  sales: Sale[];
  expenses: Expense[];
  invoices: Invoice[];
  knowledge: Array<{ id: string; title: string; source: string; body: string }>;
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
          <p className="text-sm text-[#1a1c1b]/50 mt-0.5">Live data from your business records</p>
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
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(data.invoices[0] || null);
  const [saveError, setSaveError] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "2-days" | "3-days" | "7-days">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const subtotal = form.quantity * form.unitPrice;

  const hasPremium = data.hasPremiumAccess;
  const isFreePlan = data.plan === "free";
  const invoiceLimit = 15;
  const invoicesUsed = data.invoiceCountThisMonth;
  const invoicesRemaining = Math.max(0, invoiceLimit - invoicesUsed);
  const limitReached = !hasPremium && invoicesUsed >= invoiceLimit;

  // Calculate trial days remaining
  const trialDaysRemaining = (() => {
    if (!hasPremium || data.plan === "pro") return 0;
    const now = new Date();
    const trialEnd = new Date(data.trialEndsAt);
    const diffMs = trialEnd.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  })();

  // Date filter logic
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateFilteredInvoices = useMemo(() => {
    if (dateFilter === "all") return data.invoices;
    const now = new Date();
    const startDate = new Date(now);
    if (dateFilter === "today") {
      // keep startDate = now (today)
    } else if (dateFilter === "2-days") {
      startDate.setDate(startDate.getDate() - 1);
    } else if (dateFilter === "3-days") {
      startDate.setDate(startDate.getDate() - 2);
    } else if (dateFilter === "7-days") {
      startDate.setDate(startDate.getDate() - 6);
    }
    const startStr = startDate.toISOString().slice(0, 10);
    return data.invoices.filter((inv) => {
      if (!inv.date) return false;
      return inv.date >= startStr && inv.date <= todayStr;
    });
  }, [data.invoices, dateFilter, todayStr]);

  // Search filter
  const searchFilteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return dateFilteredInvoices;
    return dateFilteredInvoices.filter((inv) => {
      const number = (inv.number || "").toLowerCase();
      const customer = (inv.customerName || "").toLowerCase();
      const item = (inv.item || "").toLowerCase();
      return number.includes(q) || customer.includes(q) || item.includes(q);
    });
  }, [dateFilteredInvoices, searchQuery]);

  // Status filter
  const finalFilteredInvoices = useMemo(() => {
    if (statusFilter === "all") return searchFilteredInvoices;
    return searchFilteredInvoices.filter((inv) => inv.status === statusFilter);
  }, [searchFilteredInvoices, statusFilter]);

  const hasActiveFilters = dateFilter !== "all" || searchQuery.trim() !== "" || statusFilter !== "all";

  const save = async () => {
    try {
      setSaveError("");
      const response = await api<{ invoice: Invoice; data: AppData }>("/api/invoices", { method: "POST", body: JSON.stringify(form) });
      setSelectedInvoice(response.invoice);
      refresh(response.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save invoice.";
      setSaveError(message);
    }
  };

  const activeInvoice = selectedInvoice;

  const invoiceTotal = activeInvoice
    ? activeInvoice.quantity * activeInvoice.unitPrice
    : 0;

  const invoiceBalance = activeInvoice
    ? invoiceTotal - activeInvoice.amountPaid
    : 0;

  return (
    <div className="space-y-5">
      <Header title="Invoice Generator" subtitle="Invoices are saved by the backend and export as a PDF file." />

      {/* Invoice Usage Display */}
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-1">Invoices this month</p>
            {hasPremium ? (
              <div>
                <p className="text-lg font-semibold text-[#005932]">Unlimited</p>
                {data.plan === "pro" ? (
                  <p className="text-sm text-[#005932]/60 mt-0.5">MarketOS Pro</p>
                ) : (
                  <p className="text-sm text-[#005932]/60 mt-0.5">
                    Premium trial · {trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""} remaining
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-lg font-semibold text-[#1a1c1b]">
                  {invoicesUsed} / {invoiceLimit} used
                </p>
                <p className="text-sm text-[#1a1c1b]/60 mt-0.5">
                  {invoicesRemaining} invoice{invoicesRemaining !== 1 ? "s" : ""} remaining
                </p>
                <p className="text-xs text-[#1a1c1b]/40 mt-1">Free plan</p>
              </div>
            )}
          </div>
          {limitReached && (
            <div className="text-right">
              <p className="text-sm text-red-600 font-medium mb-1">
                You've reached your monthly limit of {invoiceLimit} invoices.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border bg-[#005932] text-white border-transparent hover:bg-[#004d2a] shadow-sm opacity-50 cursor-not-allowed"
                disabled
              >
                Upgrade to Pro
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Invoice History */}
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider">Invoice History</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#1a1c1b]/40">
              {finalFilteredInvoices.length} invoice{finalFilteredInvoices.length !== 1 ? "s" : ""}
            </span>
            <input
              className={`${inputClass} w-36 text-xs`}
              placeholder="Search invoice number or customer"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className={`${inputClass} w-28 text-xs`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="Saved">Saved</option>
              <option value="Paid">Paid</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Overdue">Overdue</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <select
              className={`${inputClass} w-28 text-xs`}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
            >
              <option value="all">All dates</option>
              <option value="today">Today</option>
              <option value="2-days">Last 2 days</option>
              <option value="3-days">Last 3 days</option>
              <option value="7-days">Last 7 days</option>
            </select>
            {hasActiveFilters && (
              <Btn
                variant="ghost"
                onClick={() => {
                  setSearchQuery("");
                  setDateFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </Btn>
            )}
          </div>
        </div>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-[#1a1c1b]/40">No invoices yet. Create one using the form below.</p>
        ) : finalFilteredInvoices.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-[#1a1c1b]/40 mb-3">No invoices match your filters.</p>
            <Btn variant="secondary" onClick={() => {
              setSearchQuery("");
              setDateFilter("all");
              setStatusFilter("all");
            }}>
              Clear filters
            </Btn>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#f9f9f6] border-b border-[#1a1c1b]/5">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Invoice #</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Customer</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Date</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Amount</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1c1b]/5">
              {finalFilteredInvoices.map((inv) => {
                const total = inv.quantity * inv.unitPrice;
                return (
                  <tr
                    key={inv.id}
                    onClick={() => setSelectedInvoice(inv)}
                    className={`cursor-pointer transition-colors ${
                      activeInvoice?.id === inv.id
                        ? "bg-[#005932]/5"
                        : "hover:bg-[#f9f9f6]"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-[#1a1c1b]">{inv.number}</td>
                    <td className="px-4 py-2.5 text-[#1a1c1b]">{inv.customerName}</td>
                    <td className="px-4 py-2.5 text-[#1a1c1b]/60">{inv.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[#1a1c1b]">{formatMoney(total)}</td>
                    <td className="px-4 py-2.5">
                      <Badge label={inv.status} variant={inv.status === "Saved" ? "saved" : "neutral"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Invoice Form */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 space-y-3 shadow-sm">
          <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">New Invoice</h2>
          {Object.entries(form).map(([key, value]) => (
            <Field key={key} label={key.replace(/([A-Z])/g, " $1")}>
              <input className={inputClass} type={typeof value === "number" ? "number" : key === "dueDate" ? "date" : "text"} value={value} onChange={(e) => setForm({ ...form, [key]: typeof value === "number" ? Number(e.target.value) : e.target.value })} />
            </Field>
          ))}
          {saveError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              {saveError}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Btn onClick={save} disabled={limitReached}>
              {limitReached ? "Limit Reached" : "Save Invoice"}
            </Btn>
          </div>
        </div>

        {/* Invoice Preview */}
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">
            {activeInvoice ? "Invoice Preview" : "Preview"}
          </h2>
          {activeInvoice ? (
            <>
              <div className="border-b border-[#1a1c1b]/5 pb-4 mb-4 flex justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#1a1c1b]">{String(data.settings.businessName)}</h2>
                  <p className="text-xs text-[#1a1c1b]/40">{String(data.settings.location)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#1a1c1b]/40 font-mono">{activeInvoice.number}</p>
                  <p className="text-xs text-[#795900]">Due: {activeInvoice.dueDate}</p>
                </div>
              </div>
              <p className="text-xs text-[#1a1c1b]/50 mb-1">Bill To</p>
              <p className="font-semibold text-[#1a1c1b] mb-4">{activeInvoice.customerName}</p>
              <DataTable compact columns={["Item", "Qty", "Unit", "Total"]} rows={[[activeInvoice.item, activeInvoice.quantity, formatMoney(activeInvoice.unitPrice), formatMoney(invoiceTotal)]]} />
              <div className="border-t border-[#1a1c1b]/5 pt-3 mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{formatMoney(invoiceTotal)}</span></div>
                <div className="flex justify-between text-[#005932]"><span>Amount Paid</span><span className="font-mono">-{formatMoney(activeInvoice.amountPaid)}</span></div>
                <div className="flex justify-between font-bold text-[#1a1c1b] text-base pt-1 border-t border-[#1a1c1b]/10"><span>Balance Due</span><span className="font-mono text-red-600">{formatMoney(invoiceBalance)}</span></div>
              </div>
              <div className="mt-4 flex gap-2">
                <Btn
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const token = localStorage.getItem("marketos_token");
                      const response = await fetch(`/api/invoices/${activeInvoice.id}/pdf`, {
                        headers: {
                          Authorization: `Bearer ${token}`,
                        },
                      });
                      if (!response.ok) {
                        const text = await response.text();
                        const payload = text ? JSON.parse(text) : {};
                        throw new Error(payload.error || "Failed to download PDF.");
                      }
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${activeInvoice.number}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : "Download failed.");
                    }
                  }}
                  icon={<Download size={14} />}
                >
                  Download PDF
                </Btn>
                <Badge label={activeInvoice.status} variant={activeInvoice.status === "Saved" ? "saved" : "neutral"} />
              </div>
            </>
          ) : (
            <p className="text-sm text-[#1a1c1b]/40">Select an invoice from the history or create a new one.</p>
          )}
        </div>
      </div>
    </div>
  );
}

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";

function ReportsScreen({ data }: { data: AppData }) {
  const [selectedReport, setSelectedReport] = useState<string>("overview");

  // ========== CALCULATIONS ==========
  const grossSales = data.sales.reduce((sum, sale) => sum + sale.quantity * sale.unitPrice, 0);
  const totalExpenses = data.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const netProfit = grossSales - totalExpenses;
  const customerDebt = data.customers.reduce((sum, c) => sum + c.debt, 0);
  const inventoryValue = data.inventory.reduce((sum, p) => sum + p.stock * p.costPrice, 0);
  const debtRatio = grossSales ? (customerDebt / grossSales) * 100 : 0;
  const profitMargin = grossSales ? (netProfit / grossSales) * 100 : 0;
  const expenseRatio = grossSales ? (totalExpenses / grossSales) * 100 : 0;

  // Sales analytics
  const totalSalesCount = data.sales.length;
  const avgSaleValue = totalSalesCount ? grossSales / totalSalesCount : 0;
  const highestSale = data.sales.length
    ? Math.max(...data.sales.map((s) => s.quantity * s.unitPrice))
    : 0;

  // Sales over time (group by date)
  const salesByDateMap = new Map<string, number>();
  for (const sale of data.sales) {
    const existing = salesByDateMap.get(sale.date) || 0;
    salesByDateMap.set(sale.date, existing + sale.quantity * sale.unitPrice);
  }
  const salesOverTime = [...salesByDateMap.entries()]
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top selling products (by revenue)
  const productRevenueMap = new Map<string, { qty: number; revenue: number }>();
  for (const sale of data.sales) {
    const existing = productRevenueMap.get(sale.product) || { qty: 0, revenue: 0 };
    existing.qty += sale.quantity;
    existing.revenue += sale.quantity * sale.unitPrice;
    productRevenueMap.set(sale.product, existing);
  }
  const topProducts = [...productRevenueMap.entries()]
    .map(([product, stats]) => ({ product, ...stats }))
    .sort((a, b) => b.revenue - a.revenue);

  // Top 5 products for chart
  const top5Products = topProducts.slice(0, 5);

  // Expense analytics
  const totalExpenseCount = data.expenses.length;
  const avgExpense = totalExpenseCount ? totalExpenses / totalExpenseCount : 0;
  const largestExpense = data.expenses.length
    ? Math.max(...data.expenses.map((e) => e.amount))
    : 0;

  // Expenses by category
  const categoryMap = new Map<string, { count: number; total: number }>();
  for (const expense of data.expenses) {
    const existing = categoryMap.get(expense.category) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += expense.amount;
    categoryMap.set(expense.category, existing);
  }
  const expensesByCategory = [...categoryMap.entries()]
    .map(([category, stats]) => ({ category, ...stats }))
    .sort((a, b) => b.total - a.total);

  // Expenses over time (group by date)
  const expensesByDateMap = new Map<string, number>();
  for (const expense of data.expenses) {
    const existing = expensesByDateMap.get(expense.date) || 0;
    expensesByDateMap.set(expense.date, existing + expense.amount);
  }
  const expensesOverTime = [...expensesByDateMap.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Inventory analytics
  const lowStockProducts = data.inventory.filter((p) => p.stock > 0 && p.stock <= 10);
  const outOfStockProducts = data.inventory.filter((p) => p.stock === 0);
  const productsNeedingAttention = [...lowStockProducts, ...outOfStockProducts].sort(
    (a, b) => a.stock - b.stock
  );

  // Inventory stock status for donut chart
  const inStockCount = data.inventory.filter((p) => p.stock > 10).length;
  const lowStockCount = lowStockProducts.length;
  const outOfStockCount = outOfStockProducts.length;
  const stockStatusData = [
    { name: "In Stock", value: inStockCount, color: "#005932" },
    { name: "Low Stock", value: lowStockCount, color: "#795900" },
    { name: "Out of Stock", value: outOfStockCount, color: "#dc2626" },
  ].filter((d) => d.value > 0);

  // Highest value inventory products
  const inventoryByValue = [...data.inventory]
    .map((p) => ({ name: p.name, value: p.stock * p.costPrice }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Customer analytics
  const customersWithDebt = data.customers.filter((c) => c.debt > 0);
  const largestCustomerDebt = customersWithDebt.length
    ? Math.max(...customersWithDebt.map((c) => c.debt))
    : 0;
  const sortedCustomersByDebt = [...customersWithDebt].sort((a, b) => b.debt - a.debt);

  // Top debt customers for chart
  const topDebtCustomers = sortedCustomersByDebt.slice(0, 10);

  // Chart colors  const CHART_COLORS = ["#005932", "#795900", "#dc2626", "#2563eb", "#7c3aed", "#0891b2", "#d97706", "#059669", "#9333ea", "#0d9488"];

  // Custom tooltip formatter
  const currencyFormatter = (value: number) => formatMoney(value);

  const reportOptions = [
    { value: "overview", label: "Business Overview" },
    { value: "sales", label: "Sales Analytics" },
    { value: "expenses", label: "Expense Analytics" },
    { value: "inventory", label: "Inventory Analytics" },
    { value: "customers", label: "Customer Analytics" },
    { value: "health", label: "Financial Health" },
    { value: "exports", label: "Export Reports" },
  ];

  const isOverview = selectedReport === "overview";
  const isLocked = !isOverview && !data.hasPremiumAccess;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Header
          title="Reports & Analytics"
          subtitle="Select a report to view detailed insights."
        />
        <div className="relative">
          <select
            className={inputClass + " w-56"}
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value)}
          >
            {reportOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {isLocked && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <Lock size={14} className="text-[#795900]" />
            </span>
          )}
        </div>
      </div>

      {isLocked ? (
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-8 text-center shadow-sm max-w-lg mx-auto">
          <div className="w-12 h-12 rounded-full bg-[#005932]/10 flex items-center justify-center mx-auto mb-4">
            <Lock size={24} className="text-[#005932]" />
          </div>
          <h2 className="text-lg font-semibold text-[#1a1c1b] mb-2">Advanced Reports</h2>
          <p className="text-sm text-[#1a1c1b]/60 mb-4">
            This report is available in MarketOS Pro.
          </p>
          <div className="text-left bg-[#f9f9f6] rounded-xl p-4 mb-5">
            <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Unlock:</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2 text-sm text-[#1a1c1b]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#005932]" />
                Profit &amp; Loss
              </li>
              <li className="flex items-center gap-2 text-sm text-[#1a1c1b]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#005932]" />
                Sales Analytics
              </li>
              <li className="flex items-center gap-2 text-sm text-[#1a1c1b]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#005932]" />
                Inventory Analysis
              </li>
              <li className="flex items-center gap-2 text-sm text-[#1a1c1b]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#005932]" />
                Customer Insights
              </li>
              <li className="flex items-center gap-2 text-sm text-[#1a1c1b]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#005932]" />
                Cash Flow
              </li>
            </ul>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-medium border bg-[#005932] text-white border-transparent hover:bg-[#004d2a] shadow-sm cursor-not-allowed opacity-70"
            disabled
          >
            Upgrade to Pro
          </button>
          <p className="text-xs text-[#1a1c1b]/40 mt-2">Coming soon</p>
        </div>
      ) : (
        <>
          {/* ========== BUSINESS OVERVIEW ========== */}
          {selectedReport === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Gross Sales" value={formatMoney(grossSales)} />
                <StatCard
                  label="Estimated Net Profit"
                  value={formatMoney(netProfit)}
                  color={netProfit >= 0 ? "text-[#005932]" : "text-red-600"}
                />
                <StatCard label="Customer Debt" value={formatMoney(customerDebt)} color="text-[#795900]" />
                <StatCard label="Inventory Value" value={formatMoney(inventoryValue)} />
              </div>

              {salesOverTime.length > 0 ? (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">
                    Sales Over Time
                  </h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={salesOverTime}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <Tooltip formatter={currencyFormatter} />
                      <Line type="monotone" dataKey="revenue" stroke="#005932" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                  <p className="text-sm text-[#1a1c1b]/40">No sales records yet. Record your first sale to see analytics.</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Profit Margin</p>
                  <p className={`text-2xl font-semibold font-mono ${profitMargin >= 0 ? "text-[#005932]" : "text-red-600"}`}>
                    {profitMargin.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Expense Ratio</p>
                  <p className={`text-2xl font-semibold font-mono ${expenseRatio <= 50 ? "text-[#005932]" : "text-red-600"}`}>
                    {expenseRatio.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Debt Ratio</p>
                  <p className={`text-2xl font-semibold font-mono ${debtRatio <= 30 ? "text-[#005932]" : "text-red-600"}`}>
                    {debtRatio.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========== SALES ANALYTICS ========== */}
          {selectedReport === "sales" && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-4 text-sm text-[#1a1c1b]/70">
                <span><strong className="text-[#1a1c1b]">{totalSalesCount}</strong> sales</span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Avg <strong className="text-[#1a1c1b]">{formatMoney(avgSaleValue)}</strong></span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Highest <strong className="text-[#1a1c1b]">{formatMoney(highestSale)}</strong></span>
              </div>

              {salesOverTime.length > 0 ? (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Sales Over Time</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={salesOverTime}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <Tooltip formatter={currencyFormatter} />
                      <Line type="monotone" dataKey="revenue" stroke="#005932" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                  <p className="text-sm text-[#1a1c1b]/40">No sales records yet. Record your first sale to see analytics.</p>
                </div>
              )}

              {top5Products.length > 0 && (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Top Products by Revenue</h3>
                  <ResponsiveContainer width="100%" height={Math.max(200, top5Products.length * 50)}>
                    <BarChart data={top5Products} layout="vertical" margin={{ left: 100 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tickFormatter={currencyFormatter} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis dataKey="product" type="category" tick={{ fontSize: 11 }} stroke="#9ca3af" width={90} />
                      <Tooltip formatter={currencyFormatter} />
                      <Bar dataKey="revenue" fill="#005932" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {topProducts.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">All Products</h3>
                  <DataTable
                    columns={["Product", "Quantity Sold", "Revenue"]}
                    rows={topProducts.map((p) => [p.product, p.qty, formatMoney(p.revenue)])}
                  />
                </div>
              )}
            </div>
          )}

          {/* ========== EXPENSE ANALYTICS ========== */}
          {selectedReport === "expenses" && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-4 text-sm text-[#1a1c1b]/70">
                <span>Total <strong className="text-[#1a1c1b]">{formatMoney(totalExpenses)}</strong></span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span><strong className="text-[#1a1c1b]">{totalExpenseCount}</strong> expenses</span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Avg <strong className="text-[#1a1c1b]">{formatMoney(avgExpense)}</strong></span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Largest <strong className="text-[#1a1c1b]">{formatMoney(largestExpense)}</strong></span>
              </div>

              {expensesByCategory.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                    <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Expenses by Category</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={expensesByCategory}
                          dataKey="total"
                          nameKey="category"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ category, percent }) => `${category} ${(percent * 100).toFixed(0)}%`}
                        >
                          {expensesByCategory.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={currencyFormatter} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {expensesOverTime.length > 0 && (
                    <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                      <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Expenses Over Time</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={expensesOverTime}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                          <YAxis tickFormatter={currencyFormatter} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                          <Tooltip formatter={currencyFormatter} />
                          <Bar dataKey="amount" fill="#dc2626" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                  <p className="text-sm text-[#1a1c1b]/40">No expense records yet. Record your first expense to see analytics.</p>
                </div>
              )}

              {expensesByCategory.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Expenses by Category (Detailed)</h3>
                  <DataTable
                    columns={["Category", "Transactions", "Total Amount"]}
                    rows={expensesByCategory.map((c) => [c.category, c.count, formatMoney(c.total)])}
                  />
                </div>
              )}
            </div>
          )}

          {/* ========== INVENTORY ANALYTICS ========== */}
          {selectedReport === "inventory" && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-4 text-sm text-[#1a1c1b]/70">
                <span><strong className="text-[#1a1c1b]">{data.inventory.length}</strong> products</span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Value <strong className="text-[#1a1c1b]">{formatMoney(inventoryValue)}</strong></span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span><strong className="text-[#1a1c1b]">{lowStockCount}</strong> low stock</span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span><strong className="text-[#1a1c1b]">{outOfStockCount}</strong> out of stock</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stockStatusData.length > 0 ? (
                  <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                    <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Stock Status</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={stockStatusData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {stockStatusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                    <p className="text-sm text-[#1a1c1b]/40">No products in inventory yet.</p>
                  </div>
                )}
                {inventoryByValue.length > 0 && (
                  <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                    <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Highest Value Products</h3>
                    <ResponsiveContainer width="100%" height={Math.max(200, inventoryByValue.length * 40)}>
                      <BarChart data={inventoryByValue} layout="vertical" margin={{ left: 100 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" tickFormatter={currencyFormatter} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="#9ca3af" width={90} />
                        <Tooltip formatter={currencyFormatter} />
                        <Bar dataKey="value" fill="#005932" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {productsNeedingAttention.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Products Needing Attention</h3>
                  <DataTable
                    columns={["Product", "Stock", "Cost Price", "Sell Price", "Margin", "Status"]}
                    rows={productsNeedingAttention.map((p) => [
                      p.name,
                      p.stock,
                      formatMoney(p.costPrice),
                      formatMoney(p.sellPrice),
                      `${margin(p)}%`,
                      p.stock === 0 ? <Badge label="Out of Stock" variant="danger" /> : <Badge label="Low Stock" variant="warning" />,
                    ])}
                  />
                </div>
              ) : data.inventory.length > 0 ? (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                  <p className="text-sm text-[#1a1c1b]/40">All products are well stocked.</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                  <p className="text-sm text-[#1a1c1b]/40">No products in inventory yet. Add products to see analytics.</p>
                </div>
              )}
            </div>
          )}

          {/* ========== CUSTOMER ANALYTICS ========== */}
          {selectedReport === "customers" && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-4 text-sm text-[#1a1c1b]/70">
                <span><strong className="text-[#1a1c1b]">{data.customers.length}</strong> customers</span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span><strong className="text-[#1a1c1b]">{customersWithDebt.length}</strong> with debt</span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Total debt <strong className="text-[#1a1c1b]">{formatMoney(customerDebt)}</strong></span>
                <span className="text-[#1a1c1b]/30">·</span>
                <span>Largest <strong className="text-[#1a1c1b]">{formatMoney(largestCustomerDebt)}</strong></span>
              </div>

              {topDebtCustomers.length > 0 && (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Customers with Highest Debt</h3>
                  <ResponsiveContainer width="100%" height={Math.max(200, topDebtCustomers.length * 50)}>
                    <BarChart data={topDebtCustomers} layout="vertical" margin={{ left: 100 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" tickFormatter={currencyFormatter} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="#9ca3af" width={90} />
                      <Tooltip formatter={currencyFormatter} />
                      <Bar dataKey="debt" fill="#795900" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {sortedCustomersByDebt.length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Customer Debt Overview</h3>
                  <DataTable
                    columns={["Customer", "Outstanding Balance", "Last Activity"]}
                    rows={sortedCustomersByDebt.map((c) => [c.name, formatMoney(c.debt), c.lastActivity])}
                  />
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-6 text-center shadow-sm">
                  <p className="text-sm text-[#1a1c1b]/40">No customers with debt yet.</p>
                </div>
              )}
            </div>
          )}

          {/* ========== FINANCIAL HEALTH ========== */}
          {selectedReport === "health" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Profit Margin</p>
                  <p className={`text-3xl font-semibold font-mono ${profitMargin >= 0 ? "text-[#005932]" : "text-red-600"}`}>
                    {profitMargin.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Expense Ratio</p>
                  <p className={`text-3xl font-semibold font-mono ${expenseRatio <= 50 ? "text-[#005932]" : "text-red-600"}`}>
                    {expenseRatio.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Debt Ratio</p>
                  <p className={`text-3xl font-semibold font-mono ${debtRatio <= 30 ? "text-[#005932]" : "text-red-600"}`}>
                    {debtRatio.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========== EXPORT REPORTS ========== */}
          {selectedReport === "exports" && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
                <p className="text-sm text-[#1a1c1b]/60 mb-4">
                  Download detailed reports for your records or to share with stakeholders.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Btn
                    variant="secondary"
                    onClick={() => {
                      const rows = [
                        ["Metric", "Value"],
                        ["Gross Sales", formatMoney(grossSales)],
                        ["Total Sales Count", String(totalSalesCount)],
                        ["Average Sale Value", formatMoney(avgSaleValue)],
                        ["Highest Sale", formatMoney(highestSale)],
                        ...topProducts.map((p) => [`Top Product: ${p.product}`, formatMoney(p.revenue)]),
                      ];
                      const csv = rows.map((r) => r.join(",")).join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "sales-report.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    icon={<Download size={14} />}
                  >
                    Sales Report
                  </Btn>
                  <Btn
                    variant="secondary"
                    onClick={() => {
                      const rows = [
                        ["Category", "Transactions", "Total Amount"],
                        ...expensesByCategory.map((c) => [c.category, String(c.count), formatMoney(c.total)]),
                      ];
                      const csv = rows.map((r) => r.join(",")).join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "expense-report.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    icon={<Download size={14} />}
                  >
                    Expense Report
                  </Btn>
                  <Btn
                    variant="secondary"
                    onClick={() => {
                      const rows = [
                        ["Product", "Stock", "Cost Price", "Sell Price", "Margin"],
                        ...data.inventory.map((p) => [
                          p.name,
                          String(p.stock),
                          formatMoney(p.costPrice),
                          formatMoney(p.sellPrice),
                          `${margin(p)}%`,
                        ]),
                      ];
                      const csv = rows.map((r) => r.join(",")).join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "inventory-report.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    icon={<Download size={14} />}
                  >
                    Inventory Report
                  </Btn>
                  <Btn
                    variant="secondary"
                    onClick={() => {
                      const rows = [
                        ["Customer", "Outstanding Balance", "Last Activity", "Status"],
                        ...sortedCustomersByDebt.map((c) => [
                          c.name,
                          formatMoney(c.debt),
                          c.lastActivity,
                          c.status,
                        ]),
                      ];
                      const csv = rows.map((r) => r.join(",")).join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "customer-debt-report.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    icon={<Download size={14} />}
                  >
                    Customer Debt Report
                  </Btn>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CoachScreen() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{
    diagnosis: string;
    recommendations: Array<{ action: string; reason: string; priority: string }>;
    nextSteps: Array<{ step: number; description: string; timeline: string }>;
    confidence: string;
    limitations: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const ask = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api("/api/coach", { method: "POST", body: JSON.stringify({ question }) });
      // Normalize API response to match expected type
      const normalized = {
        diagnosis: response.diagnosis || response.answer || "",
        recommendations: Array.isArray(response.recommendations) ? response.recommendations : [],
        nextSteps: Array.isArray(response.nextSteps) ? response.nextSteps : [],
        confidence: response.confidence || "low",
        limitations: Array.isArray(response.limitations) ? response.limitations : (Array.isArray(response.dataLimitations) ? response.dataLimitations : []),
      };
      setAnswer(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Coach request failed.");
    } finally {
      setLoading(false);
    }
  };

  const confidenceColor = (level: string) => {
    switch (level) {
      case "high": return "bg-green-50 text-green-700 border-green-200";
      case "medium": return "bg-amber-50 text-amber-800 border-amber-200";
      case "low": return "bg-red-50 text-red-700 border-red-200";
      default: return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  const priorityColor = (level: string) => {
    switch (level) {
      case "high": return "text-red-600 bg-red-50 border-red-200";
      case "medium": return "text-amber-700 bg-amber-50 border-amber-200";
      case "low": return "text-green-700 bg-green-50 border-green-200";
      default: return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Header title="Business Coach" subtitle="Answers are generated from backend ledger, inventory, debt records, and Knowledge Base documents." />
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 space-y-3 shadow-sm">
        <Field label="Ask about your business">
          <input className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g., How can I improve my business?" />
        </Field>
        <Btn onClick={ask} disabled={loading} icon={<Zap size={14} />}>
          {loading ? "Thinking..." : "Ask AI Coach"}
        </Btn>
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      </div>
      {answer && (
        <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 text-sm text-[#1a1c1b] shadow-sm space-y-4">
          {/* Confidence badge */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${confidenceColor(answer.confidence)}`}>
              {answer.confidence === "high" ? "High Confidence" : answer.confidence === "medium" ? "Medium Confidence" : "Low Confidence"}
            </span>
          </div>

          {/* Diagnosis */}
          <div>
            <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Diagnosis</h3>
            <p className="text-[#1a1c1b] leading-relaxed">{answer.diagnosis}</p>
          </div>

          {/* Recommendations */}
          {answer.recommendations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Recommendations</h3>
              <div className="space-y-3">
                {answer.recommendations.map((rec, i) => (
                  <div key={i} className="p-3 rounded-xl border border-[#1a1c1b]/10 bg-[#f9f9f6]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-[#1a1c1b]">{rec.action}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${priorityColor(rec.priority)}`}>
                        {rec.priority === "high" ? "High Priority" : rec.priority === "medium" ? "Medium Priority" : "Low Priority"}
                      </span>
                    </div>
                    <p className="text-xs text-[#1a1c1b]/60 mt-1">{rec.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Steps */}
          {answer.nextSteps.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-2">Next Steps</h3>
              <ol className="list-decimal ml-5 space-y-2">
                {answer.nextSteps.map((step) => (
                  <li key={step.step} className="text-[#1a1c1b]/80">
                    <p className="font-medium text-[#1a1c1b]">{step.description}</p>
                    <p className="text-xs text-[#1a1c1b]/40 mt-0.5">Timeline: {step.timeline}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Limitations */}
          {answer.limitations.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">Limitations</h3>
              <ul className="list-disc ml-5 space-y-0.5">
                {answer.limitations.map((lim, i) => (
                  <li key={i} className="text-xs text-amber-700">{lim}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KnowledgeScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ answer: string; sources: string[]; offline: boolean } | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [uploadError, setUploadError] = useState("");
  const [createStatus, setCreateStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [createError, setCreateError] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [deleteError, setDeleteError] = useState("");

  const search = async () => {
    try {
      setResult(await api("/api/knowledge/search", { method: "POST", body: JSON.stringify({ query }) }));
    } catch (err) {
      setResult({ answer: "Search failed.", sources: [], offline: true });
    }
  };

  const createDocument = async () => {
    try {
      setCreateStatus("loading");
      setCreateError("");
      await api("/api/knowledge", { method: "POST", body: JSON.stringify({ title, body }) });
      setCreateStatus("success");
      setTitle("");
      setBody("");
      await refresh();
      setTimeout(() => setCreateStatus("idle"), 2000);
    } catch (err) {
      setCreateStatus("error");
      setCreateError(err instanceof Error ? err.message : "Failed to create document.");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "txt" && ext !== "md") {
      setUploadStatus("error");
      setUploadError("Unsupported file type. Only .txt and .md are allowed.");
      return;
    }

    if (file.size > 1048576) {
      setUploadStatus("error");
      setUploadError("File must be 1MB or fewer.");
      return;
    }

    try {
      setUploadStatus("loading");
      setUploadError("");

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      await api("/api/knowledge/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content: base64 }),
      });

      setUploadStatus("success");
      await refresh();
      setTimeout(() => setUploadStatus("idle"), 2000);
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  const deleteDocument = async (id: string) => {
    try {
      setDeleteStatus("loading");
      setDeleteError("");
      await api(`/api/knowledge/${id}`, { method: "DELETE" });
      setDeleteStatus("success");
      await refresh();
      setTimeout(() => setDeleteStatus("idle"), 2000);
    } catch (err) {
      setDeleteStatus("error");
      setDeleteError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  return (
    <div className="space-y-5">
      <Header title="Knowledge Base" subtitle="Add local business documents and make them searchable." />
      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-1 space-y-4">
          <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Add Document</h2>
            <div className="space-y-3">
              <Field label="Title">
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" />
              </Field>
              <Field label="Body">
                <textarea className={`${inputClass} h-28 resize-none`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste document text here..." />
              </Field>
              <Btn onClick={createDocument} disabled={createStatus === "loading"} icon={<FileText size={14} />}>
                {createStatus === "loading" ? "Saving..." : "Save Document"}
              </Btn>
              {createStatus === "error" && <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{createError}</div>}
              {createStatus === "success" && <div className="p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700">Document saved.</div>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Upload File</h2>
            <div className="space-y-3">
              <input
                type="file"
                accept=".txt,.md"
                onChange={handleFileUpload}
                className="block w-full text-sm text-[#1a1c1b]/60 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-[#005932]/10 file:text-[#005932] hover:file:bg-[#005932]/20"
              />
              {uploadStatus === "loading" && <div className="text-xs text-[#1a1c1b]/60">Uploading...</div>}
              {uploadStatus === "error" && <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{uploadError}</div>}
              {uploadStatus === "success" && <div className="p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700">File uploaded.</div>}
            </div>
          </div>
        </div>
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 flex gap-2 shadow-sm">
            <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents..." />
            <Btn onClick={search} icon={<Search size={14} />}>Search</Btn>
          </div>
          {result && (
            <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
              <p className="text-sm text-[#1a1c1b] leading-relaxed mt-3">{result.answer}</p>
              <div className="flex gap-2 mt-4">
                {result.sources.map((source) => (
                  <Badge key={source} label={source} variant="saved" />
                ))}
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-[#1a1c1b]/50 uppercase tracking-wider mb-3">Stored Documents</h2>
            {data.knowledge.length === 0 ? (
              <p className="text-sm text-[#1a1c1b]/40">No documents yet. Add a document or upload a file above.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#f9f9f6] border-b border-[#1a1c1b]/5">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Title</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Source</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Created</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-[#1a1c1b]/40 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1c1b]/5">
                  {data.knowledge.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2.5 text-[#1a1c1b]">{item.title}</td>
                      <td className="px-4 py-2.5 text-[#1a1c1b]/60">{item.source}</td>
                      <td className="px-4 py-2.5 text-[#1a1c1b]/40 text-xs">{item.createdAt}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Btn variant="danger" onClick={() => deleteDocument(item.id)} disabled={deleteStatus === "loading"} icon={<Trash2 size={14} />}>
                          Delete
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {deleteStatus === "error" && <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{deleteError}</div>}
            {deleteStatus === "success" && <div className="mt-2 p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700">Document deleted.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}


function SettingsScreen({ data, refresh }: { data: AppData; refresh: (payload?: AppData) => void }) {
  const [form, setForm] = useState(data.settings);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Developer tools state
  const [devLoading, setDevLoading] = useState<string | null>(null);
  const [devError, setDevError] = useState("");
  const [devSuccess, setDevSuccess] = useState("");

  const save = async () => refresh(await api<AppData>("/api/settings", { method: "POST", body: JSON.stringify(form) }));

  const deleteAccount = async () => {
    try {
      setDeleteLoading(true);
      setDeleteError("");
      await api("/api/auth/delete-account", {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      localStorage.removeItem("marketos_token");
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const devAction = async (action: string) => {
    try {
      setDevLoading(action);
      setDevError("");
      setDevSuccess("");
      const result = await api<AppData>("/api/dev/subscription-state", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      refresh(result);
      setDevSuccess(`Action "${action}" completed successfully.`);
      setTimeout(() => setDevSuccess(""), 3000);
    } catch (err) {
      setDevError(err instanceof Error ? err.message : "Developer action failed.");
    } finally {
      setDevLoading(null);
    }
  };

  const isDev = import.meta.env.DEV;

  const trialDaysRemaining = (() => {
    if (!data.hasPremiumAccess || data.plan === "pro") return 0;
    const now = new Date();
    const trialEnd = new Date(data.trialEndsAt);
    const diffMs = trialEnd.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  })();

  return (
    <div className="space-y-5">
      <Header title="Settings" subtitle="Manage your business settings." />
      <div className="bg-white rounded-xl border border-[#1a1c1b]/8 p-5 grid grid-cols-2 gap-4 shadow-sm">
        {["businessName", "location", "currency", "language", "backupLocation"].map((key) => (
          <Field key={key} label={key.replace(/([A-Z])/g, " $1")}><input className={inputClass} value={String(form[key] ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>
        ))}
        <div className="col-span-2 flex gap-2"><Btn onClick={save}>Save Settings</Btn><Badge label="Cloud Sync Disabled" variant="neutral" /></div>
      </div>

      {/* Developer Tools Section */}
      {isDev && (
        <div className="bg-white rounded-xl border border-[#795900]/30 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-[#795900]/10 flex items-center justify-center">
              <Cpu size={14} className="text-[#795900]" />
            </div>
            <h2 className="text-sm font-semibold text-[#795900] uppercase tracking-wider">Developer Tools</h2>
            <Badge label="Testing only — hidden in production builds" variant="warning" />
          </div>

          {/* Current state display */}
          <div className="grid grid-cols-4 gap-3 mb-4 text-xs">
            <div className="p-2 rounded-lg bg-[#f9f9f6] border border-[#1a1c1b]/5">
              <p className="text-[#1a1c1b]/50 uppercase tracking-wider mb-0.5">Plan</p>
              <p className="font-semibold text-[#1a1c1b]">{data.plan === "pro" ? "Pro" : "Free"}</p>
            </div>
            <div className="p-2 rounded-lg bg-[#f9f9f6] border border-[#1a1c1b]/5">
              <p className="text-[#1a1c1b]/50 uppercase tracking-wider mb-0.5">Premium Access</p>
              <p className={`font-semibold ${data.hasPremiumAccess ? "text-[#005932]" : "text-red-600"}`}>
                {data.hasPremiumAccess ? "Active" : "Inactive"}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-[#f9f9f6] border border-[#1a1c1b]/5">
              <p className="text-[#1a1c1b]/50 uppercase tracking-wider mb-0.5">Trial Ends</p>
              <p className="font-mono text-[#1a1c1b] text-[11px]">
                {data.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString() : "—"}
                {trialDaysRemaining > 0 && <span className="text-[#005932] ml-1">({trialDaysRemaining}d)</span>}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-[#f9f9f6] border border-[#1a1c1b]/5">
              <p className="text-[#1a1c1b]/50 uppercase tracking-wider mb-0.5">Invoices This Month</p>
              <p className="font-mono text-[#1a1c1b]">{data.invoiceCountThisMonth}</p>
            </div>
            <div className="p-2 rounded-lg bg-[#f9f9f6] border border-[#1a1c1b]/5">
              <p className="text-[#1a1c1b]/50 uppercase tracking-wider mb-0.5">Subscription Expires</p>
              <p className="font-mono text-[#1a1c1b] text-[11px]">
                {data.subscriptionExpiresAt ? new Date(data.subscriptionExpiresAt).toLocaleDateString() : "—"}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="secondary"
              onClick={() => devAction("start-trial")}
              disabled={devLoading !== null}
              icon={<Zap size={14} />}
            >
              {devLoading === "start-trial" ? "..." : "Start 7-Day Trial"}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => devAction("expire-trial")}
              disabled={devLoading !== null}
              icon={<X size={14} />}
            >
              {devLoading === "expire-trial" ? "..." : "Expire Trial"}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => devAction("set-free")}
              disabled={devLoading !== null}
            >
              {devLoading === "set-free" ? "..." : "Set Free Plan"}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => devAction("set-pro")}
              disabled={devLoading !== null}
            >
              {devLoading === "set-pro" ? "..." : "Set Pro Plan"}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => devAction("reset-invoice-count")}
              disabled={devLoading !== null}
            >
              {devLoading === "reset-invoice-count" ? "..." : "Reset Invoice Count"}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => devAction("activate-test-pro")}
              disabled={devLoading !== null}
            >
              {devLoading === "activate-test-pro" ? "..." : "Activate Test Pro — 30 Days"}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => devAction("expire-paid-pro")}
              disabled={devLoading !== null}
            >
              {devLoading === "expire-paid-pro" ? "..." : "Expire Paid Pro"}
            </Btn>
          </div>

          {devError && (
            <div className="mt-3 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {devError}
            </div>
          )}
          {devSuccess && (
            <div className="mt-3 p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700">
              {devSuccess}
            </div>
          )}
        </div>
      )}

      {/* Account Deletion Section */}
      <div className="bg-white rounded-xl border border-red-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider mb-2">Danger Zone</h2>
        <p className="text-sm text-[#1a1c1b]/60 mb-3">Once you delete your account, there is no going back. Please be certain.</p>
        {!deleteConfirm ? (
          <Btn variant="danger" onClick={() => setDeleteConfirm(true)}>Delete Account</Btn>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-red-600 font-medium">Are you sure you want to permanently delete your account and all data?</p>
            <div className="flex gap-2">
              <Btn variant="danger" onClick={deleteAccount} disabled={deleteLoading}>
                {deleteLoading ? "Deleting..." : "Yes, Delete My Account"}
              </Btn>
              <Btn variant="secondary" onClick={() => { setDeleteConfirm(false); setDeleteError(""); }}>
                Cancel
              </Btn>
            </div>
            {deleteError && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{deleteError}</div>}
          </div>
        )}
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
    </aside>
  );
}

function TopBar({ data, onSignOut }: { data: AppData; onSignOut: () => void }) {
  const businessName = String(data.settings.businessName || "Untitled Business");
  const location = String(data.settings.location || "No location set");
  return (
    <header className="h-14 bg-white border-b border-[#1a1c1b]/8 flex items-center justify-between px-5 shrink-0">
      <div><p className="text-xs font-semibold text-[#005932]">MarketOS</p><p className="text-xs text-[#1a1c1b]/40">{businessName} · {location}</p></div>
      <div className="flex items-center gap-3"><Bell size={16} className="text-[#1a1c1b]/40" /><Btn variant="ghost" onClick={onSignOut}>Sign out</Btn></div>
    </header>
  );
}

function AIPanel({ screen, data, onNavigate }: { screen: ScreenId; data: AppData; onNavigate: (screen: ScreenId) => void }) {
  const body = useMemo(() => {
    if (screen === "inventory") return `${data.summary.bestMarginProduct} has the strongest margin. ${data.summary.lowStockCount} item(s) need restocking.`;
    if (screen === "customers") return `${data.summary.customersOwing} customer(s) owe ${formatMoney(Number(data.summary.customerDebt))}.`;
    return `Today: ${formatMoney(Number(data.summary.salesTotal))} sales, ${formatMoney(Number(data.summary.expensesTotal))} expenses, ${formatMoney(Number(data.summary.cashReceived))} cash received.`;
  }, [data, screen]);
  return (
    <aside className="w-64 shrink-0 border-l border-[#1a1c1b]/8 bg-white flex flex-col">
      <div className="px-4 py-3.5 border-b border-[#1a1c1b]/5 flex items-center gap-2"><Zap size={14} className="text-[#005932]" /><span className="text-xs font-semibold text-[#1a1c1b]">Business Assistant</span></div>
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

      // Frontend validation for required fields
      if (mode === "signup") {
        const requiredFields = [
          { field: "name", label: "Name" },
          { field: "businessName", label: "Business name" },
          { field: "location", label: "Location" },
          { field: "industry", label: "Industry" },
          { field: "businessType", label: "Business type" },
          { field: "mainProducts", label: "Main products/services" },
        ];

        for (const { field, label } of requiredFields) {
          if (!String(form[field as keyof typeof form] || "").trim()) {
            throw new Error(`${label} is required.`);
          }
        }
      }

      if (!String(form.email || "").trim()) {
        throw new Error("Email is required.");
      }

      if (!String(form.password || "").trim()) {
        throw new Error("Password is required.");
      }

      const response = await api<{ token: string; user: unknown }>(mode === "signup" ? "/api/auth/signup" : "/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          businessName: form.businessName,
          location: form.location,
          industry: form.industry,
          businessType: form.businessType,
          targetCustomers: form.targetCustomers,
          mainProducts: form.mainProducts,
          primaryGoal: form.primaryGoal,
        }),
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
          <h1 className="text-xl font-semibold text-[#1a1c1b]">MarketOS</h1>
          <p className="text-sm text-[#1a1c1b]/50 mt-1">Create an account or sign in to your business workspace.</p>
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
              <Field label="Industry">
                <select className={inputClass} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                  <option value="">Select industry</option>
                  <option value="Retail">Retail</option>
                  <option value="Construction">Construction</option>
                  <option value="Food">Food</option>
                  <option value="Fashion">Fashion</option>
                  <option value="Services">Services</option>
                  <option value="Technology">Technology</option>
                  <option value="Agriculture">Agriculture</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Business Type">
                <select className={inputClass} value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })}>
                  <option value="">Select business type</option>
                  <option value="Retail">Retail</option>
                  <option value="Wholesale">Wholesale</option>
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Service provider">Service provider</option>
                  <option value="Online business">Online business</option>
                  <option value="Mixed">Mixed</option>
                </select>
              </Field>
              <Field label="Target Customers">
                <select className={inputClass} value={form.targetCustomers} onChange={(e) => setForm({ ...form, targetCustomers: e.target.value })}>
                  <option value="">Select target customers</option>
                  <option value="Individuals">Individuals</option>
                  <option value="Businesses">Businesses</option>
                  <option value="Contractors">Contractors</option>
                  <option value="Government">Government</option>
                  <option value="Online customers">Online customers</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Main Products/Services">
                <input className={inputClass} value={form.mainProducts} onChange={(e) => setForm({ ...form, mainProducts: e.target.value })} placeholder="e.g., Cement, roofing sheets, blocks, paint" />
              </Field>
              <Field label="Primary Business Goal">
                <select className={inputClass} value={form.primaryGoal} onChange={(e) => setForm({ ...form, primaryGoal: e.target.value })}>
                  <option value="">Select primary goal</option>
                  <option value="Increase sales">Increase sales</option>
                  <option value="Reduce costs">Reduce costs</option>
                  <option value="Improve inventory">Improve inventory</option>
                  <option value="Find more customers">Find more customers</option>
                  <option value="Improve cash flow">Improve cash flow</option>
                  <option value="Track performance">Track performance</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
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
    if (payload) {
      setData(payload);
    } else {
      setData(await api<AppData>("/api/bootstrap"));
    }
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
      case "knowledge": return <KnowledgeScreen data={data} refresh={(payload) => run(() => refresh(payload), "Knowledge updated.")} />;
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
