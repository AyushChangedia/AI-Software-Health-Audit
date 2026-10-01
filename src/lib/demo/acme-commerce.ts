import type { RepoMeta } from '@/types';
import { FIXTURE_SECRETS } from './fixture-secrets';

/**
 * The demo repository: `acme-commerce`.
 *
 * This is not a list of hand-written findings. It is a small but real
 * TypeScript codebase with deliberate defects, and Sentinel runs the *same*
 * analysis pipeline over it that it runs over a live repository. Every finding,
 * score, root cause and architecture node in demo mode is therefore derived
 * from the source below rather than authored — which is the only way the demo
 * stays internally consistent as the engine changes.
 *
 * It is always labelled DEMO DATA in the interface.
 */

export const DEMO_SLUG = 'acme-labs/acme-commerce';

export const DEMO_REPO: RepoMeta = {
  owner: 'acme-labs',
  name: 'acme-commerce',
  slug: DEMO_SLUG,
  url: 'https://github.com/acme-labs/acme-commerce',
  description: 'Storefront API and admin for Acme — demo repository bundled with Sentinel.',
  defaultBranch: 'main',
  stars: 128,
  forks: 14,
  openIssues: 23,
  primaryLanguage: 'TypeScript',
  license: 'MIT',
  pushedAt: new Date(Date.now() - 1000 * 60 * 60 * 31).toISOString(),
  sizeKb: 1_840,
  isPrivate: false,
  isFork: false,
  archived: false,
};

/** path → file contents. */
export const DEMO_FILES: Record<string, string> = {
  'package.json': `{
  "name": "acme-commerce",
  "version": "2.4.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "4.17.1",
    "jsonwebtoken": "8.5.1",
    "lodash": "4.17.11",
    "axios": "0.21.0",
    "minimist": "1.2.0",
    "moment": "2.24.0",
    "pg": "8.7.1",
    "stripe": "8.222.0",
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "devDependencies": {
    "typescript": "5.2.2",
    "tsx": "4.7.0"
  }
}
`,

  '.env': `DATABASE_URL=${FIXTURE_SECRETS.databaseUrl}
STRIPE_SECRET_KEY=${FIXTURE_SECRETS.stripeLiveKey}
JWT_SIGNING_KEY=${FIXTURE_SECRETS.jwtSigningKey}
SENDGRID_API_KEY=${FIXTURE_SECRETS.sendgridKey}
NODE_ENV=development
DEBUG=True
`,

  '.gitignore': `node_modules/
dist/
*.log
`,

  'README.md': `# acme-commerce

Storefront API and admin dashboard.

## Running locally

    npm install
    npm run dev

## Deploying

Push to main. The pipeline builds and deploys automatically.
`,

  'src/server.ts': `import express from 'express';
import { ordersRouter } from './api/orders/router';
import { authRouter } from './api/auth/router';
import { uploadRouter } from './api/upload/router';
import { adminRouter } from './api/admin/router';

const app = express();

app.use(express.json());

// Allow the storefront and the admin app to call us.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/admin', adminRouter);

app.listen(process.env.PORT || 3000, () => {
  console.log('acme-commerce listening');
});
`,

  'src/api/auth/router.ts': `import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../../db/client';
import { hashPassword } from '../../lib/crypto';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Look the user up by email.
  const result = await pool.query(
    \`SELECT id, email, password_hash, role FROM users WHERE email = '\${email}' LIMIT 1\`
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const hashed = hashPassword(password);
  if (hashed !== user.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SIGNING_KEY!);
  res.json({ token });
});

authRouter.post('/reset', async (req, res) => {
  const { email } = req.body;
  const resetToken = Math.random().toString(36).slice(2) + Date.now().toString(36);

  await pool.query('UPDATE users SET reset_token = $1 WHERE email = $2', [resetToken, email]);
  res.json({ ok: true });
});
`,

  'src/api/auth/middleware.ts': `import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthedRequest extends Request {
  user?: { sub: string; role: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = header.replace('Bearer ', '');

  // Read the claims out of the token.
  const claims = jwt.decode(token) as { sub: string; role: string } | null;
  if (!claims) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = claims;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
`,

  'src/api/orders/router.ts': `import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { Order } from '../../db/models/order';
import { getInventoryFor } from '../../services/inventory';
import { calculateOrderTotal } from '../../services/pricing';

export const ordersRouter = Router();

ordersRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const orders = await Order.findMany();

  const enriched = [];
  for (const order of orders) {
    const inventory = await getInventoryFor(order.sku);
    enriched.push({ ...order, inventory });
  }

  res.json(enriched);
});

ordersRouter.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const order = await Order.findById(req.params.id);
  res.json(order);
});

ordersRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const order = await Order.create(req.body);

  const total = calculateOrderTotal(order.items);
  res.json({ ...order, total });
});
`,

  'src/api/admin/router.ts': `import { Router } from 'express';
import { requireAuth, requireAdmin, type AuthedRequest } from '../auth/middleware';
import { pool } from '../../db/client';

export const adminRouter = Router();

adminRouter.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  const result = await pool.query('SELECT * FROM users');
  res.json(result.rows);
});

adminRouter.get('/report', requireAuth, async (req: AuthedRequest, res) => {
  const { table, order } = req.query;

  // Ad-hoc reporting for the ops team.
  const result = await pool.query(\`SELECT * FROM \${table} ORDER BY \${order}\`);
  res.json(result.rows);
});

adminRouter.post('/webhook-test', requireAuth, requireAdmin, async (req, res) => {
  const axios = require('axios');
  const response = await axios.get(req.body.url);
  res.json({ status: response.status });
});
`,

  'src/api/upload/router.ts': `import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../auth/middleware';

export const uploadRouter = Router();

const UPLOAD_ROOT = '/var/acme/uploads';

uploadRouter.get('/:filename', requireAuth, (req, res) => {
  const filePath = path.join(UPLOAD_ROOT, req.params.filename);
  const contents = fs.readFileSync(filePath);
  res.send(contents);
});

uploadRouter.post('/', requireAuth, (req, res) => {
  const { filename, contentType, data } = req.body;

  // Trust the content type the client told us about.
  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ error: 'Images only' });
  }

  fs.writeFileSync(path.join(UPLOAD_ROOT, filename), Buffer.from(data, 'base64'));
  res.json({ ok: true });
});
`,

  'src/db/client.ts': `import { Pool } from 'pg';

// Fallback for local development when DATABASE_URL is not set.
const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  '${FIXTURE_SECRETS.databaseUrl}';

export const pool = new Pool({
  connectionString: CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

export async function withTransaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
`,

  'src/db/models/order.ts': `import { pool } from '../client';

export interface OrderRow {
  id: string;
  sku: string;
  quantity: number;
  price: number;
  customer_id: string;
  items: { sku: string; price: number; quantity: number }[];
}

export const Order = {
  async findMany(): Promise<OrderRow[]> {
    const result = await pool.query('SELECT * FROM orders');
    return result.rows;
  },

  async findById(id: string): Promise<OrderRow | null> {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async create(data: Partial<OrderRow>): Promise<OrderRow> {
    const result = await pool.query(
      'INSERT INTO orders (sku, quantity, price, customer_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [data.sku, data.quantity, data.price, data.customer_id]
    );
    return result.rows[0];
  },
};
`,

  'src/db/models/user.ts': `import { pool } from '../client';

export interface UserRow {
  id: string;
  email: string;
  role: string;
  credits: number;
}

export const User = {
  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  },

  async update(id: string, patch: Partial<UserRow>): Promise<void> {
    await pool.query('UPDATE users SET email = $1, role = $2 WHERE id = $3', [
      patch.email,
      patch.role,
      id,
    ]);
  },
};
`,

  'src/services/inventory.ts': `import { pool } from '../db/client';
import { reserveStockForOrder } from './orders';

export interface InventoryRecord {
  sku: string;
  available: number;
  warehouse: string;
}

export async function getInventoryFor(sku: string): Promise<InventoryRecord | null> {
  const result = await pool.query('SELECT * FROM inventory WHERE sku = $1', [sku]);
  return result.rows[0] || null;
}

export async function decrementStock(sku: string, quantity: number): Promise<void> {
  try {
    await pool.query('UPDATE inventory SET available = available - $1 WHERE sku = $2', [
      quantity,
      sku,
    ]);
  } catch (error) {
  }
}

export async function syncOrderReservation(orderId: string, sku: string) {
  await reserveStockForOrder(orderId, sku);
}
`,

  'src/services/orders.ts': `import { pool } from '../db/client';
import { decrementStock } from './inventory';

export async function reserveStockForOrder(orderId: string, sku: string): Promise<void> {
  await decrementStock(sku, 1);
  await pool.query('UPDATE orders SET reserved = true WHERE id = $1', [orderId]);
}

export async function cancelOrder(orderId: string): Promise<void> {
  const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = result.rows[0];

  pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', orderId]);

  for (const item of order.items) {
    await pool.query('UPDATE inventory SET available = available + $1 WHERE sku = $2', [
      item.quantity,
      item.sku,
    ]);
  }
}
`,

  'src/services/pricing.ts': `export interface LineItem {
  sku: string;
  price: number;
  quantity: number;
}

export function calculateOrderTotal(items: LineItem[]): number {
  let total = 0;
  for (const item of items) {
    total = total + item.price * item.quantity;
  }

  const tax = total * 0.0825;
  return total + tax;
}

export function applyDiscount(total: number, percent: number): number {
  const discount = total * (percent / 100);
  return parseFloat((total - discount).toFixed(2));
}

export function formatCurrency(amount: number): string {
  return '$' + amount.toFixed(2);
}
`,

  'src/services/payments.ts': `import Stripe from 'stripe';
import { calculateOrderTotal, type LineItem } from './pricing';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function chargeOrder(customerId: string, items: LineItem[]) {
  const total = calculateOrderTotal(items);

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: 'usd',
    customer: customerId,
  });

  return intent;
}

export async function refund(paymentIntentId: string) {
  try {
    return await stripe.refunds.create({ payment_intent: paymentIntentId });
  } catch (error) {
    console.log(error);
    return null;
  }
}

export async function syncInvoice(invoiceId: string) {
  const response = await fetch('https://api.acme-billing.com/invoices/' + invoiceId);
  const invoice = JSON.parse(await response.text());
  return invoice;
}
`,

  'src/lib/crypto.ts': `import crypto from 'crypto';

export function hashPassword(password: string): string {
  return crypto.createHash('md5').update(password).digest('hex');
}

export function generateApiKey(): string {
  const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  return 'acme_' + token;
}

export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
`,

  'src/lib/format.ts': `import moment from 'moment';

export function formatDate(input: string | Date): string {
  return moment(input).format('MMMM Do YYYY');
}

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return '$' + dollars.toFixed(2);
}

export function truncate(text: string, length: number): string {
  if (!text) return '';
  if (text.length <= length) return text;
  return text.slice(0, length - 1) + '\\u2026';
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
`,

  'src/lib/helpers/strings.ts': `export function truncateText(text: string, length: number): string {
  if (!text) return '';
  if (text.length <= length) return text;
  return text.slice(0, length - 1) + '\\u2026';
}

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function titleCase(value: string): string {
  return value.replace(/\\w\\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

export function pluralise(count: number, word: string): string {
  return count === 1 ? word : word + 's';
}
`,

  'src/lib/legacy/report-export.ts': `import { buildReportRows } from './report-helpers';
import { formatDate } from '../format';

export async function exportMonthlyReport(month: string) {
  const rows = await buildReportRows(month);
  return rows.map((row) => ({ ...row, date: formatDate(row.date) }));
}

export function reportFilename(month: string): string {
  return 'acme-report-' + month + '.csv';
}
`,

  'src/components/ProductList.tsx': `import React, { useEffect, useState } from 'react';
import { pool } from '../db/client';
import { formatMoney } from '../lib/format';

interface Product {
  id: string;
  name: string;
  descriptionHtml: string;
  priceCents: number;
}

export function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    pool.query('SELECT * FROM products').then((result) => {
      setProducts(result.rows);
    });
  }, []);

  return (
    <ul className="product-list">
      {products.map((product, index) => (
        <li key={index}>
          <h3>{product.name}</h3>
          <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
          <span>{formatMoney(product.priceCents)}</span>
        </li>
      ))}
    </ul>
  );
}
`,

  'src/components/CheckoutForm.tsx': `import React, { useState } from 'react';
import axios from 'axios';

export function CheckoutForm({ customerId }: { customerId: string }) {
  const [status, setStatus] = useState('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('submitting');

    const response = await axios.post('http://localhost:3000/api/orders', {
      customerId,
    });

    setStatus('done');
    return response.data;
  }

  return (
    <form onSubmit={submit}>
      <button type="submit" disabled={status === 'submitting'}>
        Pay now
      </button>
    </form>
  );
}
`,

  'src/components/AdminPanel.tsx': `import React, { useEffect, useState } from 'react';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  detail: string;
}

export function AdminPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/admin/report?table=audit_log&order=created_at')
      .then((res) => res.json())
      .then(setEntries);
  }, []);

  const visible = entries.filter((entry) => entry.actor.includes(filter));

  return (
    <div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} />
      {visible.map((entry, i) => (
        <div key={i}>
          <strong>{entry.actor}</strong>
          <span dangerouslySetInnerHTML={{ __html: entry.detail }} />
        </div>
      ))}
    </div>
  );
}
`,

  'src/workers/email.ts': `import { pool } from '../db/client';

export async function sendPendingEmails() {
  const result = await pool.query('SELECT * FROM email_queue WHERE sent = false');

  for (const email of result.rows) {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.SENDGRID_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: email.to, subject: email.subject }),
      });

      if (response.ok) {
        await pool.query('UPDATE email_queue SET sent = true WHERE id = $1', [email.id]);
      }
    } catch (error) {
    }
  }
}

export function notImplementedDigest() {
  throw new Error('Not implemented');
}
`,

  'src/workers/reconcile.ts': `import { pool } from '../db/client';
import { calculateOrderTotal } from '../services/pricing';

export async function reconcilePayments() {
  const orders = await pool.query('SELECT * FROM orders WHERE status = $1', ['paid']);
  const payments = await pool.query('SELECT * FROM payments');

  const mismatches = [];

  for (const order of orders.rows) {
    const payment = payments.rows.find((p: { order_id: string }) => p.order_id === order.id);
    if (!payment) continue;

    const expected = calculateOrderTotal(order.items);
    if (expected !== payment.amount) {
      mismatches.push({ orderId: order.id, expected, actual: payment.amount });
    }
  }

  console.log('Mismatches: ' + mismatches.length);
  return mismatches;
}
`,

  'src/config/index.ts': `export const config = {
  apiUrl: 'https://api.acme-commerce.com',
  adminUrl: 'https://admin.acme-commerce.com',
  supportEmail: 'support@acme-commerce.com',
  debug: true,
  session: {
    httpOnly: false,
    secure: false,
    sameSite: 'none' as const,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
  // TODO: move rate limiting config here once the middleware lands
};
`,

  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
`,

  'Dockerfile': `FROM node:18

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=development
EXPOSE 3000
CMD ["node", "dist/server.js"]
`,

  'docs/architecture.md': `# Architecture

The storefront talks to the API layer, which talks to services, which talk to Postgres.

Background workers handle email and payment reconciliation.

External services: Stripe for payments, SendGrid for email.
`,
};

/** Size in bytes, used so the demo reports honest metrics. */
export function demoFileEntries(): { path: string; bytes: Uint8Array }[] {
  return Object.entries(DEMO_FILES).map(([path, content]) => ({
    path,
    bytes: new TextEncoder().encode(content),
  }));
}
