# White & Bright Group ERP

A multi-company ERP, built as a **white-label product** (re-skin per customer via one config).

## Stack
Next.js (App Router) · TypeScript · Tailwind · Prisma · PostgreSQL.

## Run (dev)
```bash
npm install
npm run dev
```
Open http://localhost:3000 → redirects to `/dashboard`. Login preview at `/login`.

## Make it a product — onboard a new customer
Everything customer-specific lives in **`src/config/tenant.ts`**:
- `appName`, `productName`
- `logo` / `logoWhite` (put files in `public/brand`)
- `theme` — brand colours as `R G B` triplets (injected as CSS variables → whole app re-skins, no rebuild)
- `companies` — the customer's group companies

Point `activeTenant` at the new tenant. A `sampleTenant` is included as an example.

## Database (Phase 1)
```bash
cp .env.example .env   # set DATABASE_URL
npm run db:push        # create tables
```
Schema (`prisma/schema.prisma`): `Tenant → Company → User / Role / CompanyMembership` — multi-tenant, multi-company, RBAC with company scoping and approval levels.

## Phases
- **P1 Foundation** — platform, multi-company, Finance, HR & Admin, approvals *(in progress)*
- **P2** Commercial & Supply · **P3** Delivery & Safety · **P4** Insight & AI
