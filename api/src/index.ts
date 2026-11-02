import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok' })
})

// Create a new home
app.post('/api/homes', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string' ||
    body.name.trim().length === 0
  ) {
    return c.json({ error: 'Invalid home name' }, 400)
  }

  const name = body.name.trim()
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body: unknown = await c.req.json().catch(() => null)

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string' ||
    body.name.trim().length === 0
  ) {
    return c.json({ error: 'Invalid member name' }, 400)
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(member_order), 0) + 1 AS next_order
     FROM members WHERE home_id = ?`,
  )
    .bind(homeId)
    .first<{ next_order: number }>()

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const memberOrder = result?.next_order ?? 1

  await c.env.DB.prepare(
    'INSERT INTO members (id, home_id, name, member_order) VALUES (?, ?, ?, ?)',
  )
    .bind(id, homeId, name, memberOrder)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Create a bill and split it equally between home members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body: unknown = await c.req.json().catch(() => null)

  if (
    typeof body !== 'object' ||
    body === null ||
    !('title' in body) ||
    typeof body.title !== 'string' ||
    body.title.trim().length === 0 ||
    !('totalCents' in body) ||
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'Invalid bill details' }, 422)
  }

  const title = body.title.trim()
  const totalCents = body.totalCents

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const membersResult = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY member_order ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  const members = membersResult.results ?? []

  if (members.length === 0) {
    return c.json({ error: 'No members in this home' }, 422)
  }

  const baseAmount = Math.floor(totalCents / members.length)
  const remainder = totalCents % members.length

  const billId = crypto.randomUUID()

  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: baseAmount + (index < remainder ? 1 : 0),
    paidAt: null as string | null,
  }))

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents),

    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ]

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')

  if (!key || key.trim().length === 0) {
    return c.json({ error: 'Idempotency-Key is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    `SELECT id, member_id, amount_cents, paid_at, idempotency_key
     FROM shares WHERE id = ? AND bill_id = ?`,
  )
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (share.paid_at !== null) {
    if (share.idempotency_key === key) {
      return c.json({
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: share.paid_at,
      })
    }

    return c.json({ error: 'Share already paid' }, 409)
  }

  const paidAt = new Date().toISOString()

  const result = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  )
    .bind(paidAt, key, shareId, billId)
    .run()

  if (result.meta.changes === 0) {
    const updated = await c.env.DB.prepare(
      `SELECT id, member_id, amount_cents, paid_at, idempotency_key
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
      .bind(shareId, billId)
      .first<{
        id: string
        member_id: string
        amount_cents: number
        paid_at: string | null
        idempotency_key: string | null
      }>()

    if (updated?.paid_at && updated.idempotency_key === key) {
      return c.json({
        id: updated.id,
        memberId: updated.member_id,
        amountCents: updated.amount_cents,
        paidAt: updated.paid_at,
      })
    }

    return c.json({ error: 'Share already paid' }, 409)
  }

  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt,
  })
})

// Get outstanding balances for a home
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       m.id AS member_id,
       m.name AS name,
       COALESCE(
         SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END),
         0
       ) AS outstanding_cents
     FROM members m
     LEFT JOIN bills b ON b.home_id = m.home_id
     LEFT JOIN shares s ON s.bill_id = b.id AND s.member_id = m.id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.member_order
     ORDER BY m.member_order ASC`,
  )
    .bind(homeId)
    .all<{
      member_id: string
      name: string
      outstanding_cents: number
    }>()

  const balances = (result.results ?? []).map((row) => ({
    memberId: row.member_id,
    name: row.name,
    outstandingCents: row.outstanding_cents,
  }))

  return c.json({ balances })
})

export default app
