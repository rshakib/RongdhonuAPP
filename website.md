# Plan — Customer Online-Ordering Website + App Push Notifications

> ## ⏸ STATUS: DRAFT — implementation NOT started
> Living plan, kept for **step-by-step refinement**. We are deliberately **not** building it yet.
>
> **This file is named `website.md`** — when the user later says **"website"**, read THIS file and continue from here.
> **Repo copy:** a copy also lives at **`rong/website.md`** — it is now **stale** after this revision; re-copy it from here as **step 1** after leaving plan mode.
> Everything below is **provisional** — see "Refinement backlog" at the end.

## Goal
A customer-facing **website** that shows the restaurant's online menu (with **item pictures**) and lets a customer place an order with **name + phone number**. The order lands as **PENDING** in an **"Online Orders" inbox** inside the app, where **OWNER + MANAGER** get a **real push notification + sound** (even when the app is closed). On **Accept**, the order is **auto-added as a Delivery into the existing app**. Ordering is open **only 11:00–21:30 (Asia/Dhaka)**.

## Decisions (confirmed by user)
- **Everything for this feature lives in a NEW / separate Supabase project** (website + online menu + orders + push). The app connects to it for the online-orders module.
- **The existing app's flow, Firebase, and the old Supabase project are UNTOUCHED.** No schema/logic change to them.
- **The ONE bridge into the old app:** when an order is **accepted**, a **Delivery is created in the existing app** (via the existing local delivery functions) → it then syncs through the existing (untouched) pipeline.
- **App gets a new, isolated "Online" module** (its own new files): a **second Supabase client** to the new project, **push notifications**, the **Online Orders inbox** (Owner + Manager), and the **Online Menu manager** (Owner + Admin + Manager). The existing app's **logic and data are NOT modified** — only additive new files + nav rows.
- **Management auth = a shared passcode RPC** (✅ decided by me — simplest, matches the app's PIN culture; no separate auth system in the new project).
- **I build the website** (part of this deliverable — new `web/` folder).
- Website **blocks ordering outside 11:00–21:30** (server-enforced too).
- **Notification = real push**, recipients = **OWNER + MANAGER**.
- **Order flow:** separate inbox → staff **Accept/Reject** → **Accept auto-creates a Delivery**.
- **Online menu has pictures**; **Admin / Owner / Manager** set **which items are available**.
- **Set once → persists** until someone sets it again (NO automatic daily reset).
- Website tech/UX = my choice ("যেভাবে ভালো হয়").

## Execution order (decided — step by step)
1. **Phase 1 — Build the website** (I build it): the static `web/` site **+ the new Supabase project's public surface** it needs (project setup, `online_menu`, `place_online_order` RPC + policies).
2. **Phase 2 — Make the website LIVE** (I do the deploy too): pick a host, wire the project URL + anon key, publish → a **public URL** customers can open. *(Needs a one-time free host account/login from you — Netlify recommended; GitHub Pages/Vercel alternatives.)*
3. **Phase 3 — App module** (later): the isolated "Online" module — Online Orders inbox + **real push** → Accept → Delivery.
4. **Phase 4 — Online Menu manager** (Owner/Admin/Manager): items + pictures + availability, inside the app.
Each phase is shippable on its own. **We start with Phase 1 only, when you say "website".**

## Architecture at a glance
```
  Customer ──► WEBSITE (static, I build)  ──►  ┌──────────────────────────────┐
                reads online_menu (pics)        │   NEW Supabase project        │
                places order (RPC)              │  • online_menu (+images)      │
                                                │  • online_orders              │
                                                │  • push_tokens                │
                                                │  • Storage bucket (photos)    │
                                                │  • RPCs + Edge Function(push) │
                                                └───────────────┬──────────────┘
                                                                │ (2nd Supabase client)
                                        ┌───────────────────────▼──────────────────────┐
                                        │  APP — NEW isolated "Online" module          │
                                        │   • Online Orders inbox (Owner+Manager)      │
                                        │   • push notifications (expo-notifications)  │
                                        │   • Online Menu manager (Owner/Admin/Manager)│
                                        └───────────────────────┬──────────────────────┘
                                                                │ Accept = ONE bridge
                                        ┌───────────────────────▼──────────────────────┐
                                        │ EXISTING APP (untouched): createDelivery()    │
                                        │ → old SQLite → old Firebase + old Supabase    │
                                        └──────────────────────────────────────────────┘
```

## Current gaps (why this is work)
- No `expo-notifications` and **no audio/scene** libs in `package.json` → no push/sound. Adding them = **native rebuild** (cannot OTA).
- No second Supabase client for an external project.
- No image picker/upload for the online menu.
- No public ordering backend.

---

## Part A — NEW Supabase project (server)

### A1. Tables (idempotent SQL in new file `supabase_online_setup.sql`)
```sql
-- The website's own menu (independent of the app's internal menu_items)
create table if not exists public.online_menu (
  id           text primary key,
  name         text not null,
  category     text,
  price        numeric not null,
  image_url    text,                        -- public Storage URL
  is_available boolean not null default true,
  sort_order   int default 0,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- Website orders
create table if not exists public.online_orders (
  id             text primary key,               -- 'ON-<epoch>-<rand>'
  customer_name  text not null,
  customer_phone text not null,
  items          jsonb not null,                 -- [{menu_id, name, price, qty}]
  total          numeric not null default 0,
  note           text,
  status         text not null default 'PENDING',-- PENDING | ACCEPTED | REJECTED
  accepted_by    text,
  accepted_at    timestamptz,
  business_date  text,                            -- Asia/Dhaka date
  created_at     timestamptz not null default now()
);
create index if not exists idx_online_orders_status on public.online_orders(status, created_at desc);

-- Expo push tokens (Owner/Manager devices)
create table if not exists public.push_tokens (
  device_id  text not null,
  role       text not null,                       -- 'owner' | 'manager'
  token      text not null,
  updated_at timestamptz not null default now(),
  primary key (device_id, role)
);
```
- **Availability** = `online_menu.is_available` (per item). "Set once → persists."
- `image_url` points to a **public Storage bucket** (e.g. `online-menu`) in the new project.

### A2. Public (anon) surface
- **Read:** RLS on `online_menu` → `for select to anon using (is_available = true)`; the website reads it directly (anon key). *(No device-gate here — it's a public menu.)*
- **Order:** RPC `public.place_online_order(p_name, p_phone, p_items jsonb, p_note)` (SECURITY DEFINER):
  1. Validate name/phone (`01[0-9]{9}`), items non-empty.
  2. **Enforce 11:00–21:30 Asia/Dhaka** server-side → else raise `ORDER_CLOSED`.
  3. Recompute total from `online_menu` prices (never trust the client) and reject **unavailable** items.
  4. Rate limit: max 3 orders per phone per hour.
  5. Insert `PENDING`; return the new id.

### A3. Management/auth surface (used by the app)
The new project has no device registry, so the app's writes are gated by a **management RPC + passcode** (matches the app's PIN culture; simpler than full Supabase Auth):
- `public.online_admin(p_passcode text)` returns the current menu (**incl. unavailable**).
- `public.upsert_online_item(p_passcode, item jsonb)`, `public.delete_online_item(p_passcode, id)`, `public.set_item_availability(p_passcode, id, bool)`.
- `public.register_push_token(p_passcode, device_id, role, token)`.
- Passcode stored in a `private_config` table (or the function body); anon may call but needs the correct passcode.
- ✅ **Decided:** this passcode-RPC approach is the chosen auth. *(Stronger option later: Supabase Auth email/password + role RLS — noted in backlog, not chosen.)*
- Orders inbox read/accept: `public.fetch_orders(p_passcode, status)` / `public.set_order_status(p_passcode, id, status, by)`.

### A4. Storage
- Public bucket **`online-menu`** for item pictures (app uploads via the admin RPC-authorized path; the website just displays the public URL).

### A5. Push sender — Edge Function + DB webhook
- `supabase/functions/send-order-push/index.ts` (in the NEW project):
  - Triggered by a **Database Webhook** on `online_orders` **INSERT**.
  - Window guard (11:00–21:30 Dhaka) as belt-and-braces.
  - Loads `push_tokens` for `role in ('owner','manager')`, POSTs to `https://exp.host/--/api/v2/push/send` with `{to, sound:'default', title:'🛒 নতুন অনলাইন অর্ডার', body:'<name> (<phone>) – ৳<total>'}`.
  - Removes tokens Expo reports as `DeviceNotRegistered`.
- Deploy needs the Supabase CLI + project access (owner action). *(Fallback: a `pg_net` trigger — noted, Edge Function preferred.)*

---

## Part B — APP: a NEW, isolated "Online" module (existing app otherwise untouched)

### B1. Dependencies / native config (requires rebuild)
- `package.json`: add **`expo-notifications`** + **`expo-image-picker`** (SDK 56).
- `app.config.js`: add `expo-notifications` to `plugins`; Android notification **channel + sound**; keep everything else the same.
- Bump `version`/`versionCode` again at build time.

### B2. New service `services/onlineProject.js` — the second Supabase client
- A dedicated client for the **NEW project** (URL + anon key via new env `EXPO_PUBLIC_ONLINE_SUPABASE_URL/_ANON_KEY`), independent of the existing client. **Nothing existing is modified.**
- Thin wrappers over the RPCs in A2/A3 (admin calls pass the management passcode).

### B3. New service `services/pushNotifications.js`
- Request permission → `getExpoPushTokenAsync({ projectId: <EAS projectId> })` → `register_push_token(...)` (new project).
- `Notifications.setNotificationHandler` (foreground banner + sound) + Android channel with sound.
- Called **after login** (role known); token removed/deactivated on logout.

### B4. New screen `screens/OnlineOrdersScreen.js` — the inbox (OWNER + MANAGER)
- Lists `PENDING` orders: **name + phone (tap = call)**, items, total, time, note.
- **Accept** →
  1. Create a Delivery in the **existing app** using the existing local functions (`createDelivery('D-<ts>', '<name> – <phone>', 'FREE', '')` then set its items via the existing update path) and open `TABLE_DETAIL` — i.e. reuse the normal delivery flow exactly. **(This is the single bridge; existing code is only *called*, not changed.)**
  2. Mark the online order `ACCEPTED` (`accepted_by`, `accepted_at`) in the new project.
- **Reject** → mark `REJECTED`.
- Realtime: subscribe (new project) to `online_orders` INSERT for instant refresh while open (push covers closed).

### B5. New screen `screens/OnlineMenuScreen.js` — "Online Menu" (OWNER + ADMIN + MANAGER)
- Manage the online menu: list items, **add/edit** (name, category, price), **upload picture** (expo-image-picker → Storage), **available toggle**.
- "Import from app menu" convenience (one-tap copy of existing `menu_items`) so they don't retype — then edit/pictures.
- **Set once persists** (no daily reset).

### B6. Wiring (additive only)
- `App.js`: new `currentScreen` key `ONLINE_ORDERS` and `ONLINE_MENU` + cases (same pattern as every other screen); start push registration + realtime subscribe after login.
- `components/*SideMenu.js`: add **"Online Orders"** (Owner + Manager) and **"Online Menu"** (Admin + Owner + Manager) rows.

> ⚠️ This **is** a real app addition (new deps + screens + a second client). The existing app's *logic and data* are not modified — only new, isolated files + additive nav rows.

---

## Part C — Website (I build this — new `web/` folder, static)
- `web/index.html`, `web/app.js`, `web/styles.css`, `web/config.js` — plain HTML/JS + `@supabase/supabase-js` pointed at the **NEW** project (anon key).
- Flow: read `online_menu` (only `is_available = true`) → show cards **with pictures**, grouped by category → cart → customer form (name + phone required) → `place_online_order()` → success screen with an order reference.
- **Hours:** shows "🔴 অর্ডার বন্ধ (১১:০০–৯:৩০)" outside the window and disables ordering; the RPC enforces it anyway.
- Bengali UI, branding colours (gold `#FFB703` on dark), mobile-first.
- Hosting: any static host — Netlify / Vercel / GitHub Pages (recommended: Netlify drop).

---

## Files to change / add
- **New Supabase project**: `supabase_online_setup.sql` (new), `supabase/functions/send-order-push/index.ts` (new), Storage bucket, DB webhook (owner actions).
- **App (all new/isolated)**: `package.json`, `app.config.js`, `services/onlineProject.js` (new), `services/pushNotifications.js` (new), `screens/OnlineOrdersScreen.js` (new), `screens/OnlineMenuScreen.js` (new), additive wiring in `App.js`, additive rows in `components/AdminSideMenu.js` / `OwnerSideMenu.js` / `ManagerSideMenu.js`.
- **Website (I build)**: `web/index.html`, `web/app.js`, `web/styles.css`, `web/config.js` (new).
- **Docs**: `docs/ONLINE_ORDERING_SETUP.md`.

## Verification
1. `npm run test:all` stays green; Babel-parse every edited JS file.
2. New-project SQL: tables + RPCs exist; anon can read `online_menu` (only available) but **not** write `online_orders` directly; `place_online_order(...)` rejects outside hours + unavailable items + recomputes price; passcode RPCs reject a wrong passcode.
3. Edge Function: insert a test order → Owner/Manager device gets the push (app closed).
4. App: log in as **manager** → token row appears in `push_tokens`; place an order on the website → push + sound; open inbox → **Accept** → a **Delivery** is created in the existing app with the customer name/phone + items, and the normal delivery/payment flow continues (and syncs to old Firebase + old Supabase as usual).
5. Hours: call the RPC outside 11:00–21:30 → rejected; website shows closed.
6. **Rebuild required** (`expo-notifications`, `expo-image-picker` are native).

## Risks / notes
- **Rebuild + new permission** (POST_NOTIFICATIONS on Android 13+) — first launch must grant it.
- **Two Supabase clients** in one app — kept fully separate; the online client never touches POS data.
- **Management auth** is a shared **passcode RPC** (simple). If stronger security is wanted, move to Supabase Auth (backlog).
- **Double menu entry**: the online menu is independent; mitigated by "Import from app menu".
- **Edge Function deploy** is a new surface (Supabase CLI). `pg_net` trigger is the fallback.
- Public ordering endpoint → server validation + price recompute + per-phone rate limit; consider OTP later if spam appears.

## Refinement backlog (step by step — before building)
1. **Where this plan lives** — ✅ named `website.md`. Copy it into the repo as `rong/website.md` (first step after plan mode). When the user later says **"website"**, read this file and continue.
2. **New-project auth** — ✅ DECIDED by me: **shared passcode RPC** (simplest; matches the app's PIN culture). Supabase Auth remains a possible future upgrade but is not chosen.
3. **Website hosting** — Netlify / Vercel / GitHub Pages? custom domain?
4. **Availability default** — item with `is_available` never set → show or hide? (on the website: hide unavailable vs show greyed).
5. **Website scope** — only menu + order, or also order status / cancel / delivery charge / area / minimum order?
6. **Anti-abuse** — phone OTP? rate-limit thresholds?
7. **Notification content & sound** — exact Bengali title/body + which sound.
8. **Pictures** — upload via app (Storage) vs paste image URL? image size/compression.
9. **Who manages the online menu** — app screen (recommended) vs a separate **web admin panel**?
10. **Phasing** — ✅ DECIDED: **website first → deploy it LIVE → then app module → then online-menu manager** (see "Execution order" above). Each phase shippable on its own.
11. **Online menu ↔ app menu** — one-time import only, or keep in sync?

## Rollback
- Website: take it offline (host).
- New project: drop the new tables + functions + webhook + bucket (nothing else depends on it).
- App: remove the new module (deps + the new screens/service + the additive nav rows) — the existing flow never depended on it.
