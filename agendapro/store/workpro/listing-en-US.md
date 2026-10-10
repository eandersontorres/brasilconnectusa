# WorkPro — store listing (en-US)

Paste each block into the matching field in App Store Connect (localization
"English (U.S.)") and Google Play Console (language "English (United States) – en-US").
Character limits are in parentheses and were checked.

The app UI is in Brazilian Portuguese. The English listing exists for people
whose phone is set to English; the description says so up front, so nobody is
surprised. The quotes and invoices the pro sends to clients can be in English,
Portuguese or Spanish.

> **Before publishing:** there is an existing US tool brand called **WORKPRO**.
> Talk to a trademark attorney before the first release — see
> [`review-notes.md`](review-notes.md#nome-do-app).

> **Subscription mode:** store builds ship in **companion** mode (no prices and
> no purchase buttons in the app). The description below mentions the plans
> **without prices and without a call to subscribe**. If a build ever switches to
> `link` mode, use the "Plans with prices" block at the end of this file.

---

## App name (30) · App Store and Google Play

```
WorkPro BrasilConnect
```
(21 characters)

Fallback if the name is taken (the App Store and Google Play allow a different
name per language):

```
WorkPro: estimates & invoices
```
(29 characters)

## Subtitle (30) · App Store only

```
Estimates, invoices, schedule
```
(29 characters)

## Promotional text (170) · App Store only

```
New accounts get 14 days with everything unlocked, no card needed. E-signed estimates, PDF and link invoices and automatic payment reminders, built for Brazilian pros.
```
(167 characters)

## Short description (80) · Google Play only

```
Estimates, invoices and scheduling for Brazilian service pros in the US
```
(71 characters)

## Keywords (100) · App Store only

Comma-separated, no spaces. Do not repeat words from the name/subtitle and do
not use third-party brands.

```
quote,bid,handyman,contractor,construction,remodel,painter,electrician,plumber,carpenter,receipt
```
(96 characters)

## Full description (up to 4000) · App Store and Google Play

```
WorkPro is the estimate and invoice app for Brazilian service professionals working in the United States. Construction and remodeling, handyman, carpenters, painters, electricians, plumbers, drywall, flooring, landscaping, certified translators and accountants: build the estimate in front of the client, send it over WhatsApp and get it approved with an e-signature, all from your phone.

The app is in Brazilian Portuguese. The estimates and invoices your clients receive can be in English, Portuguese or Spanish, your choice.

FREE 14-DAY TRIAL
Create your account in the app and use every feature for 14 days, no credit card.

ESTIMATES IN MINUTES
• Line items from your price book: services, labor, materials and fees
• Quantities by hour, day, sq ft, square meter, page, word, visit or project
• Discounts, sales tax on taxable items only, and a deposit requested on approval
• Expiration date, terms, warranty and a note to the client
• Send by WhatsApp, email or link
• Your client opens it on the phone and approves with an on-screen signature, or declines with a reason
• Get notified when the client opens, approves or declines

INVOICES WITHOUT SPREADSHEETS
• Turn an approved estimate into an invoice in one tap
• PDF and link invoices with sequential numbers and due dates
• Record payments by Zelle, cash, check, Venmo or card, in full or in part
• See who paid, who owes and what is overdue
• Deposit invoices and progress billing by project stage (Pro)

GET PAID FASTER (PRO)
• Clients pay the invoice by card through the link and the money goes to your own Stripe account
• Automatic email reminders when an invoice is due, so you do not have to chase payments
• Before and after photos on estimates and invoices
• Unlimited documents (Starter includes 20 per month)

QUOTE REQUESTS
• A form on your page where clients request an estimate, with photos of the job
• Requests arrive in the app with a phone notification and become an estimate in one tap

SCHEDULE AND CLIENTS
• Site visits and jobs on a day and week calendar
• Client profile with address, history, estimates and invoices
• Ready-to-send WhatsApp messages and email reminders
• Send your jobs to your iPhone or Android calendar

SALES AT A GLANCE
• Open estimates, money to collect, overdue and collected this month
• How many of your estimates get approved

MONEY AND TEAM
• Expenses, monthly profit, mileage and a tax reserve (Pro)
• Teams of up to 10 people, reports and a CSV file for your accountant (Premium)
• Estimates, invoices and your page with only your brand (Premium)

SECURITY AND PRIVACY
• Unlock with Face ID or fingerprint
• Same account as AgendaPro and the BrasilConnect website
• Delete your account anytime, right in the app

PLANS
• Starter: estimates and invoices (20 per month), price book, quote requests, calendar, clients, online page, reminders and message templates
• Pro: everything in Starter + card payments on invoices, automatic reminders, deposits and progress billing, job photos, unlimited documents, finances and English/Spanish messages
• Premium: everything in Pro + teams, reports, PDF receipts and documents without BrasilConnect branding

No BrasilConnect commission on your work. If your plan is inactive, you can still see your clients, estimates and invoices.

Questions or ideas: oi@brasilconnectusa.com

Zelle, Venmo, Stripe and WhatsApp are trademarks of their respective owners. WorkPro is not affiliated with these companies.
```

## What's new in version 1.0 (4000)

```
The first version of WorkPro! Estimates with client approval and e-signature, PDF and link invoices, payment tracking, a price book, quote requests from your page, calendar and clients. Start with a free 14-day trial, everything unlocked, no card needed.
```

### Plans with prices (only if the build ships in `link` mode)

Replace the PLANS block of the description with this one. Do not use it in
companion mode (Apple guideline 3.1.3(f): no calls to action to buy outside the app).

```
PLANS
• Starter (US$19/month): estimates and invoices (20 per month), price book, quote requests, calendar, clients, online page, reminders and message templates
• Pro (US$39/month): everything in Starter + card payments on invoices, automatic reminders, deposits and progress billing, job photos, unlimited documents, finances and English/Spanish messages
• Premium (US$79/month): everything in Pro + teams, reports, PDF receipts and documents without BrasilConnect branding

Subscriptions are purchased on brasilconnectusa.com. Cancel anytime.
```

---

## Category and rating

| Field | App Store | Google Play |
|---|---|---|
| Primary category | Business | Business |
| Secondary category | Productivity | — |
| Age rating | 4+ (answer "None" to every question) | Everyone (IARC questionnaire — see the pt-BR file for the suggested answers) |
| Contains ads | — | No |
| In-app purchases | No (companion mode: the subscription is not sold in the app) | No |

## URLs and contact

| Field | Value |
|---|---|
| Support URL | https://brasilconnectusa.com/para/workpro/#suporte |
| Marketing URL | https://brasilconnectusa.com/para/workpro/ |
| Privacy policy | https://brasilconnectusa.com/privacidade |
| Delete account URL (Google Play, Data safety) | https://brasilconnectusa.com/excluir-conta.html |
| Contact email (Google Play) | oi@brasilconnectusa.com |
| Copyright (App Store) | © 2026 BrasilConnect — replace with the publishing company's legal name |

## Availability

United States only (see [`listing-pt-BR.md`](listing-pt-BR.md#disponibilidade)).
