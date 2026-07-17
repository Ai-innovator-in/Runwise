Design a complete UI/UX concept for **MarketOS Offline**, an offline AI business copilot for African microbusinesses.

The app is for small shop owners, market traders, food vendors, repair technicians, salon owners, freelancers, and small service businesses. It helps users turn messy daily business notes into structured records, invoices, inventory updates, customer debt tracking, pricing insights, and business recommendations.

The interface should not look like a chatbot. It should look like a serious business dashboard with an AI input layer.

Design style:

* Clean, practical, trustworthy, and modern
* Suitable for small business owners, not corporate accountants
* Simple enough for non-technical users
* Financially serious but not intimidating
* Offline-first feeling
* Avoid futuristic neon AI aesthetics
* Use clear cards, tables, confirmation screens, and plain-language explanations

Color palette:

* Sidebar / dark navy: #0F172A
* Main background: #F8FAFC
* Cards: #FFFFFF
* Primary action blue: #2563EB
* Success green: #16A34A
* Warning amber: #F59E0B
* Debt / danger red: #DC2626
* Main text: #111827
* Muted text: #6B7280

Typography:
Use Inter or a clean system font. Prioritize readability.

Layout:
Create a desktop web app layout optimized for laptop screens.

The interface should have:

1. A left sidebar navigation
2. A top bar
3. A central main workspace
4. A right-side contextual AI assistant panel

Top bar:

* App name: MarketOS Offline
* Business name: Example: “Amina Mini Mart”
* Offline status indicator: “Offline Mode Active”
* Small system indicator: “Local AI Running”

Sidebar navigation:

* Dashboard
* Add Business Note
* Sales
* Expenses
* Inventory
* Customers & Debt
* Invoices
* Reports
* Business Coach
* Knowledge Base
* Performance
* Settings

Create the following screens:

Screen 1: Dashboard

The dashboard should show business summary cards:

* Today’s Sales: ₦23,000
* Expenses Today: ₦5,000
* Cash Received: ₦17,500
* Customer Debt: ₦5,500

Below the cards, include a large “Quick Add” input area titled:
“What happened in your business today?”

Inside the input, show an example note:
“Sold 10 packs of noodles at 800 each, 6 bottles of oil at 2500 each. Bought transport 3000. Paid assistant 2000. Aisha took goods worth 5500 on credit.”

Add a primary button:
“Analyze Note”

Also show:

* Alerts section
* Recent Activity table
* Small business insight card

Example alerts:

* Aisha owes ₦5,500
* Oil stock is getting low
* Phone chargers have the highest margin

Screen 2: Add Business Note

Create a focused page where the user can enter natural language business activity.

Elements:

* Page title: Add Business Note
* Helper text: “Write naturally. MarketOS will extract sales, expenses, inventory changes, and customer debt before saving.”
* Large text input area
* Buttons: Analyze Note, Clear
* Example prompts section

Example prompts:

* “Sold 5 bags at 12000 each”
* “Musa paid 10000 from old debt”
* “Added 30 chargers at cost 1800 each”
* “Paid rent 45000 for the shop”

Screen 3: Review Extracted Records

This is a critical screen. The AI should not save records automatically. The user must review and confirm.

Page title:
“Review Extracted Records”

Show a summary:
“MarketOS found 2 sales, 2 expenses, and 1 customer debt.”

Create sections for:

Sales table:

* Product
* Quantity
* Unit Price
* Total

Rows:

* Noodles | 10 | ₦800 | ₦8,000
* Oil | 6 | ₦2,500 | ₦15,000

Expenses table:

* Category
* Amount
* Note

Rows:

* Transport | ₦3,000 | Business transport
* Staff | ₦2,000 | Assistant payment

Customer Debt table:

* Customer
* Amount
* Status

Row:

* Aisha | ₦5,500 | Owes business

Summary card:

* Total Sales: ₦23,000
* Expenses: ₦5,000
* Credit Issued: ₦5,500
* Expected Cash: ₦17,500

Buttons:

* Edit Records
* Save to Ledger

Screen 4: Customers & Debt

Create a customer debt management page.

Top cards:

* Total Outstanding Debt: ₦42,000
* Overdue Debt: ₦18,000
* Customers Owing: 3

Customer table:

* Customer
* Amount Owed
* Last Activity
* Status

Rows:

* Aisha | ₦5,500 | Today | New
* Musa | ₦12,000 | 5 days ago | Overdue
* Kemi | ₦24,500 | 2 days ago | Active

Actions:

* Record Payment
* Generate Reminder Message
* View Customer History

Include a right-side AI suggestion:
“Most of your unpaid money is from Kemi and Musa. Collecting part of this debt before restocking may improve cash flow.”

Screen 5: Inventory

Create an inventory tracking page.

Top cards:

* Total Products
* Low Stock Items
* Fast Moving Items
* Estimated Stock Value

Inventory table:

* Product
* In Stock
* Cost Price
* Sell Price
* Margin
* Status

Rows:

* Noodles | 42 | ₦600 | ₦800 | 25% | Healthy
* Oil | 8 | ₦2,100 | ₦2,500 | 16% | Low
* Chargers | 4 | ₦1,800 | ₦2,500 | 28% | Low

Stock alerts:

* Oil may run out in 2 days
* Chargers have the highest margin
* Restock high-margin items first

Buttons:

* Add Stock
* Record Damaged Goods
* Suggest Restock

Screen 6: Invoice Generator

Create a simple invoice creation and preview screen.

Fields:

* Customer name: Musa
* Due date: July 5, 2026
* Item: Branded T-shirt
* Quantity: 25
* Unit price: ₦4,500
* Amount paid: ₦50,000

Invoice preview:

* Business name: Amina Mini Mart
* Invoice number
* Customer name
* Item table
* Subtotal: ₦112,500
* Amount paid: ₦50,000
* Balance due: ₦62,500

Buttons:

* Preview Invoice
* Save Invoice
* Export PDF

Screen 7: Business Coach

Create a business coaching page that is grounded in actual records.

Main input:
“Ask about your business”

Example question:
“What should I restock this week?”

Suggested questions:

* Who owes me the most money?
* Which product gives me the best profit?
* Am I selling too much on credit?
* What changed this week?
* What should I do tomorrow?

Example AI response card:
“Based on your last 7 days:

1. Restock oil first. You sold 18 bottles this week and only 8 remain.
2. Chargers have the best margin at ₦700 profit per unit.
3. Be careful with credit. ₦42,000 is currently unpaid.

Recommended action:
Collect at least ₦20,000 in customer debt before buying new stock.”

Screen 8: Knowledge Base

Create an offline knowledge base page.

Sections:
Built-in Guides:

* Basic Bookkeeping
* Pricing and Profit Margin
* Inventory Management
* Customer Credit
* Cash Flow

Uploaded Documents:

* cooperative_loan_rules.pdf
* supplier_terms.pdf

Search input:
“How do I know if I am making real profit?”

Answer card should show:

* Answer
* Sources used
* Offline knowledge indicator

Example source labels:

* pricing_guide.md
* cashflow_basics.md

Screen 9: Performance Dashboard

This page is for competition judges and technical validation.

Show:

* Offline Status: Active
* Internet Required: No
* Cloud APIs: None
* Runtime: llama.cpp
* Model: 3B Instruct GGUF
* Quantization: Q4_K_M
* Context: 4096 tokens
* Threads: 4
* RAM Usage: 4.8 GB
* Peak RAM: 5.3 GB
* Tokens/sec: 14.2
* Average Extraction Time: 2.1 seconds
* Average RAG Answer Time: 4.8 seconds
* CPU Temperature: 68°C

Buttons:

* Run Local Benchmark
* Export Benchmark Report

Right-side contextual AI assistant panel:
This panel should appear across the app. It should be helpful but not dominate the UI.

Examples:
On Dashboard:
“Today you recorded ₦23,000 in sales, but ₦5,500 is unpaid.”

On Inventory:
“Oil is low. Based on recent sales, you may need to restock within 2 days.”

On Customers & Debt:
“Kemi and Musa account for most unpaid debt.”

On Performance:
“The app is running fully offline with local CPU inference.”

Important UX behavior:

* AI-extracted records must always be reviewed before saving.
* Financial calculations should look deterministic and trustworthy.
* Use badges for Offline, Local AI, Needs Review, Saved, Low Stock, Overdue.
* Use simple icons, but avoid visual clutter.
* Prioritize clarity over decoration.
* The UI should make it obvious that this is a real business tool, not a chatbot demo.

Create a polished desktop UI prototype with all major screens, consistent spacing, cards, tables, buttons, and realistic sample data.
