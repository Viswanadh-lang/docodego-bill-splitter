import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
  paymentKey?: string
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

type Member = {
  id: string
  homeId: string
  name: string
}

type HomeData = {
  id: string
  name: string
  members: Member[]
  bills: Bill[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

const STORAGE_KEY = 'commontab-home'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `Request failed (${response.status})`,
    )
  }

  return data as T
}

function money(cents: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function readSavedHome(): HomeData | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? (JSON.parse(saved) as HomeData) : null
  } catch {
    return null
  }
}

function Home() {
  const [home, setHome] = useState<HomeData | null>(readSavedHome)
  const [balances, setBalances] = useState<Balance[]>([])
  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [, setRefresh] = useState(0)

  useEffect(() => {
    if (home) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(home))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [home])

  useEffect(() => {
    if (!home) {
      setBalances([])
      return
    }

    let active = true
    setBalanceLoading(true)

    api<{ balances: Balance[] }>(`/api/homes/${home.id}/balances`)
      .then((result) => {
        if (active) setBalances(result.balances)
      })
      .catch((err: Error) => {
        if (active) setError(`Could not load balances: ${err.message}`)
      })
      .finally(() => {
        if (active) setBalanceLoading(false)
      })

    return () => {
      active = false
    }
  }, [home])

  const totalBills = useMemo(
    () => home?.bills.reduce((sum, bill) => sum + bill.totalCents, 0) ?? 0,
    [home],
  )

  const unpaidTotal = useMemo(
    () =>
      home?.bills.reduce(
        (sum, bill) =>
          sum +
          bill.shares
            .filter((share) => !share.paidAt)
            .reduce((shareSum, share) => shareSum + share.amountCents, 0),
        0,
      ) ?? 0,
    [home],
  )

  async function createHome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    try {
      const result = await api<{ id: string; name: string }>('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ name: homeName.trim() }),
      })

      setHome({
        ...result,
        members: [],
        bills: [],
      })
      setHomeName('')
      setNotice('Your home has been created successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create home.')
    } finally {
      setLoading(false)
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    setError('')
    setNotice('')
    setLoading(true)

    try {
      const member = await api<Member>(`/api/homes/${home.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ name: memberName.trim() }),
      })

      setHome((current) =>
        current ? { ...current, members: [...current.members, member] } : current,
      )
      setMemberName('')
      setNotice(`${member.name} has been added.`)
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member.')
    } finally {
      setLoading(false)
    }
  }

  async function createBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!home) return

    const amount = Number(billAmount)
    const totalCents = Math.round(amount * 100)

    if (!Number.isFinite(amount) || totalCents <= 0) {
      setError('Enter a valid bill amount greater than zero.')
      return
    }

    setError('')
    setNotice('')
    setLoading(true)

    try {
      const bill = await api<Bill>(`/api/homes/${home.id}/bills`, {
        method: 'POST',
        body: JSON.stringify({
          title: billTitle.trim(),
          totalCents,
        }),
      })

      setHome((current) => (current ? { ...current, bills: [bill, ...current.bills] } : current))
      setBillTitle('')
      setBillAmount('')
      setNotice('Bill created and split among all members.')
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create bill.')
    } finally {
      setLoading(false)
    }
  }

  async function payShare(billId: string, share: Share) {
    if (!home || share.paidAt) return

    setError('')
    setNotice('')

    const paymentKey = share.paymentKey || crypto.randomUUID()

    setHome((current) =>
      current
        ? {
            ...current,
            bills: current.bills.map((bill) =>
              bill.id === billId
                ? {
                    ...bill,
                    shares: bill.shares.map((item) =>
                      item.id === share.id ? { ...item, paymentKey } : item,
                    ),
                  }
                : bill,
            ),
          }
        : current,
    )

    try {
      const result = await api<{
        id: string
        memberId: string
        amountCents: number
        paidAt: string
      }>(`/api/bills/${billId}/shares/${share.id}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': paymentKey },
      })

      setHome((current) =>
        current
          ? {
              ...current,
              bills: current.bills.map((bill) =>
                bill.id === billId
                  ? {
                      ...bill,
                      shares: bill.shares.map((item) =>
                        item.id === share.id ? { ...item, paidAt: result.paidAt } : item,
                      ),
                    }
                  : bill,
              ),
            }
          : current,
      )

      setNotice('Payment recorded successfully.')
      setRefresh((value) => value + 1)
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} Your payment is still shown as unpaid. You can safely retry.`
          : 'Payment failed. Please try again.',
      )
    }
  }

  const memberNameFor = (memberId: string) =>
    home?.members.find((member) => member.id === memberId)?.name ?? 'Member'

  return (
    <div className="app-shell">
      <style>{styles}</style>

      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">C</span>
          <span>
            common<span className="brand-light">tab</span>
          </span>
        </a>
        <span className="topbar-note">
          <span className="live-dot" />
          Shared expenses, made simple
        </span>
      </header>

      <main className="container">
        {!home ? (
          <section className="welcome">
            <div className="welcome-copy">
              <span className="eyebrow">A BETTER WAY TO SHARE</span>
              <h1>
                Good times together.
                <br />
                <span>Clear bills always.</span>
              </h1>
              <p>
                Create a shared space, add your people, and split expenses fairly. No awkward
                calculations. No confusion.
              </p>

              <div className="welcome-points">
                <div>
                  <span>✓</span> Fair, automatic bill splitting
                </div>
                <div>
                  <span>✓</span> Simple payment tracking
                </div>
                <div>
                  <span>✓</span> Clear outstanding balances
                </div>
              </div>
            </div>

            <form className="panel create-home-panel" onSubmit={createHome}>
              <div className="panel-icon">⌂</div>
              <span className="eyebrow">GET STARTED</span>
              <h2>Create your home</h2>
              <p className="muted">Give your shared space a name to get started.</p>
              <label htmlFor="homeName">Home name</label>
              <input
                id="homeName"
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                placeholder="e.g. Hyderabad Flat"
                required
                maxLength={80}
              />
              <button type="submit" className="primary-button full-button" disabled={loading}>
                {loading ? 'Creating...' : 'Create home'} <span>→</span>
              </button>
              <p className="form-footnote">Free to use · Simple by design</p>
            </form>
          </section>
        ) : (
          <>
            <section className="dashboard-heading">
              <div>
                <span className="eyebrow">YOUR SHARED SPACE</span>
                <h1>{home.name}</h1>
                <p className="muted">Keep track of shared expenses and settle up with ease.</p>
              </div>
              <div className="home-tag">
                <span>⌂</span> Active home
              </div>
            </section>

            <section className="stats-grid">
              <div className="stat-card">
                <span className="stat-icon purple">₹</span>
                <span className="stat-label">Total expenses</span>
                <strong>{money(totalBills)}</strong>
                <small>Across {home.bills.length} bills</small>
              </div>
              <div className="stat-card">
                <span className="stat-icon orange">◷</span>
                <span className="stat-label">Yet to be paid</span>
                <strong>{money(unpaidTotal)}</strong>
                <small>Outstanding shares</small>
              </div>
              <div className="stat-card">
                <span className="stat-icon green">♙</span>
                <span className="stat-label">People</span>
                <strong>{home.members.length}</strong>
                <small>In this shared space</small>
              </div>
            </section>

            <section className="content-grid">
              <div className="main-column">
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">THE GROUP</span>
                      <h2>Your people</h2>
                    </div>
                    <span className="count-pill">{home.members.length} members</span>
                  </div>

                  <form className="inline-form" onSubmit={addMember}>
                    <input
                      aria-label="Member name"
                      value={memberName}
                      onChange={(event) => setMemberName(event.target.value)}
                      placeholder="Enter a member's name"
                      required
                      maxLength={80}
                    />
                    <button type="submit" className="primary-button" disabled={loading}>
                      + Add member
                    </button>
                  </form>

                  {home.members.length === 0 ? (
                    <div className="empty-state compact">
                      <div className="empty-icon">♙</div>
                      <strong>Your group starts here</strong>
                      <p>Add at least one member before creating a bill.</p>
                    </div>
                  ) : (
                    <div className="member-list">
                      {home.members.map((member, index) => (
                        <div className="member-row" key={member.id}>
                          <div className={`avatar avatar-${index % 5}`}>
                            {member.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{member.name}</span>
                          <span className="member-number">Member {index + 1}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="panel bills-panel">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">EXPENSE HISTORY</span>
                      <h2>Recent bills</h2>
                    </div>
                    <span className="count-pill">{home.bills.length} bills</span>
                  </div>

                  {home.bills.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">▤</div>
                      <strong>No bills yet</strong>
                      <p>Create your first shared expense to see it here.</p>
                    </div>
                  ) : (
                    <div className="bill-list">
                      {home.bills.map((bill) => {
                        const paidCount = bill.shares.filter((share) => share.paidAt).length

                        return (
                          <article className="bill-card" key={bill.id}>
                            <div className="bill-top">
                              <div className="bill-symbol">₹</div>
                              <div className="bill-info">
                                <h3>{bill.title}</h3>
                                <p>
                                  {bill.shares.length} shares · {paidCount} paid
                                </p>
                              </div>
                              <strong className="bill-total">{money(bill.totalCents)}</strong>
                            </div>

                            <div className="share-list">
                              {bill.shares.map((share) => (
                                <div className="share-row" key={share.id}>
                                  <div className="share-person">
                                    <span className="mini-avatar">
                                      {memberNameFor(share.memberId).charAt(0).toUpperCase()}
                                    </span>
                                    <span>{memberNameFor(share.memberId)}</span>
                                  </div>
                                  <strong>{money(share.amountCents)}</strong>
                                  {share.paidAt ? (
                                    <span className="paid-status">✓ Paid</span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="pay-button"
                                      onClick={() => payShare(bill.id, share)}
                                    >
                                      Mark paid
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              </div>

              <aside className="side-column">
                <section className="panel">
                  <span className="eyebrow">NEW EXPENSE</span>
                  <h2>Add a bill</h2>
                  <p className="muted small-copy">
                    The amount will be split equally among all members.
                  </p>

                  <form className="bill-form" onSubmit={createBill}>
                    <label htmlFor="billTitle">Bill description</label>
                    <input
                      id="billTitle"
                      value={billTitle}
                      onChange={(event) => setBillTitle(event.target.value)}
                      placeholder="e.g. Monthly groceries"
                      required
                      maxLength={120}
                    />

                    <label htmlFor="billAmount">Total amount (₹)</label>
                    <div className="amount-input">
                      <span>₹</span>
                      <input
                        id="billAmount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={billAmount}
                        onChange={(event) => setBillAmount(event.target.value)}
                        placeholder="0.00"
                        required
                      />
                    </div>

                    <div className="split-note">
                      <span>✳</span>
                      <span>
                        Split between <strong>{home.members.length}</strong>{' '}
                        {home.members.length === 1 ? 'person' : 'people'}
                      </span>
                    </div>

                    <button
                      type="submit"
                      className="primary-button full-button"
                      disabled={loading || home.members.length === 0}
                    >
                      {loading ? 'Adding...' : 'Create & split bill'} <span>→</span>
                    </button>

                    {home.members.length === 0 && (
                      <p className="validation-note">Add a member before creating a bill.</p>
                    )}
                  </form>
                </section>

                <section className="panel balance-panel">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">SETTLEMENT OVERVIEW</span>
                      <h2>Balances</h2>
                    </div>
                    <span className="balance-icon">↗</span>
                  </div>

                  {balanceLoading ? (
                    <p className="muted">Loading balances...</p>
                  ) : balances.length === 0 ? (
                    <p className="muted small-copy">Balances will appear when members are added.</p>
                  ) : (
                    <div className="balance-list">
                      {balances.map((balance) => (
                        <div className="balance-row" key={balance.memberId}>
                          <div>
                            <strong>{balance.name}</strong>
                            <small>Outstanding</small>
                          </div>
                          <strong className={balance.outstandingCents > 0 ? 'due' : 'settled'}>
                            {money(balance.outstandingCents)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="balance-footnote">Outstanding amounts reflect unpaid shares.</p>
                </section>
              </aside>
            </section>
          </>
        )}

        {error && (
          <div className="alert error-alert" role="alert">
            <span>!</span> {error}
            <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}

        {notice && (
          <div className="alert success-alert" role="status">
            <span>✓</span> {notice}
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">
              ×
            </button>
          </div>
        )}

        <footer className="footer">
          <span className="footer-brand">commontab</span>
          <span>Less calculating. More living together.</span>
        </footer>
      </main>
    </div>
  )
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f7fb; color: #202033; font-family: 'DM Sans', sans-serif; }
  button, input { font: inherit; }
  button { cursor: pointer; }
  .app-shell { min-height: 100vh; }
  .topbar { height: 74px; background: #fff; border-bottom: 1px solid #ececf2; display: flex; align-items: center; justify-content: space-between; padding: 0 max(calc((100vw - 1160px) / 2), 28px); }
  .brand { display: flex; align-items: center; gap: 10px; color: #222039; text-decoration: none; font: 800 21px 'Manrope', sans-serif; letter-spacing: -1px; }
  .brand-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: #6754d9; color: #fff; font-size: 18px; }
  .brand-light { color: #7464d9; }
  .topbar-note { color: #77778b; font-size: 12px; display: flex; align-items: center; gap: 8px; }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #37b987; }
  .container { max-width: 1160px; margin: 0 auto; padding: 54px 28px 24px; }
  .welcome { display: grid; grid-template-columns: 1.15fr .85fr; gap: 70px; align-items: center; min-height: 590px; }
  .eyebrow { color: #7665d6; font-size: 10px; font-weight: 700; letter-spacing: 1.7px; }
  h1, h2, h3, p { margin-top: 0; }
  h1, h2 { font-family: 'Manrope', sans-serif; letter-spacing: -1.2px; }
  .welcome h1 { font-size: clamp(38px, 5vw, 58px); line-height: 1.12; margin: 20px 0; }
  .welcome h1 span { color: #7564d9; }
  .welcome-copy > p { color: #77778a; max-width: 470px; line-height: 1.8; font-size: 15px; }
  .welcome-points { display: grid; gap: 15px; margin-top: 32px; color: #505064; font-size: 13px; }
  .welcome-points span { display: inline-grid; place-items: center; width: 21px; height: 21px; border-radius: 50%; background: #e9e6fb; color: #6956d1; margin-right: 9px; font-weight: 700; }
  .panel { background: #fff; border: 1px solid #ececf2; border-radius: 16px; padding: 25px; box-shadow: 0 7px 25px rgba(34, 31, 73, .035); }
  .create-home-panel { padding: 34px; }
  .panel-icon { display: grid; place-items: center; width: 45px; height: 45px; border-radius: 13px; background: #eeebff; color: #705ed5; font-size: 25px; margin-bottom: 24px; }
  .create-home-panel h2 { font-size: 26px; margin: 10px 0 7px; }
  .muted { color: #89899b; font-size: 13px; line-height: 1.7; }
  label { display: block; color: #48485b; font-size: 12px; font-weight: 700; margin: 21px 0 8px; }
  input { width: 100%; border: 1px solid #e5e5ed; border-radius: 9px; padding: 13px 14px; color: #28283b; background: #fff; outline: none; font-size: 13px; transition: border .2s, box-shadow .2s; }
  input:focus { border-color: #8879e2; box-shadow: 0 0 0 3px #eeeaff; }
  input::placeholder { color: #b0b0bd; }
  .primary-button { border: 0; border-radius: 9px; background: #6c5bd4; color: #fff; padding: 12px 17px; font-size: 12px; font-weight: 700; transition: background .2s, transform .2s; }
  .primary-button:hover { background: #5948c2; transform: translateY(-1px); }
  .primary-button:disabled { opacity: .55; cursor: not-allowed; transform: none; }
  .primary-button span { margin-left: 12px; font-size: 16px; }
  .full-button { width: 100%; margin-top: 19px; padding: 14px; }
  .form-footnote { text-align: center; color: #aaa9b8; font-size: 10px; margin: 17px 0 0; }
  .dashboard-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
  .dashboard-heading h1 { font-size: 34px; margin: 8px 0 4px; }
  .dashboard-heading p { margin-bottom: 0; }
  .home-tag { background: #eeecff; color: #6756ca; padding: 9px 13px; border-radius: 30px; font-size: 11px; font-weight: 700; }
  .home-tag span { margin-right: 5px; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 17px; margin-bottom: 22px; }
  .stat-card { background: #fff; border: 1px solid #ececf2; border-radius: 14px; padding: 20px 22px; display: grid; grid-template-columns: 38px 1fr; column-gap: 12px; align-items: center; }
  .stat-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; grid-row: span 3; font-weight: 700; font-size: 17px; }
  .purple { background: #efedff; color: #715fd6; }
  .orange { background: #fff2e6; color: #dc8a40; }
  .green { background: #e8f8f0; color: #31a779; }
  .stat-label { color: #89899a; font-size: 11px; }
  .stat-card strong { font: 700 22px 'Manrope', sans-serif; margin: 3px 0; }
  .stat-card small { color: #aaaaba; font-size: 10px; }
  .content-grid { display: grid; grid-template-columns: 1.5fr .85fr; gap: 20px; align-items: start; }
  .main-column, .side-column { display: grid; gap: 20px; }
  .section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .section-heading h2, .panel h2 { font-size: 20px; margin: 6px 0 0; }
  .count-pill { background: #f3f2f8; color: #77768c; border-radius: 20px; padding: 6px 10px; font-size: 10px; font-weight: 700; }
  .inline-form { display: flex; gap: 9px; }
  .inline-form input { flex: 1; min-width: 0; }
  .member-list { margin-top: 19px; display: grid; }
  .member-row { display: flex; align-items: center; gap: 11px; padding: 11px 0; border-top: 1px solid #f1f0f5; font-size: 12px; font-weight: 600; }
  .avatar, .mini-avatar { display: grid; place-items: center; border-radius: 50%; font-weight: 700; }
  .avatar { width: 34px; height: 34px; font-size: 12px; }
  .avatar-0 { background: #eeeaff; color: #715fd6; }
  .avatar-1 { background: #fff0e5; color: #cf8242; }
  .avatar-2 { background: #e4f7ee; color: #329a70; }
  .avatar-3 { background: #e7f2ff; color: #4c88c9; }
  .avatar-4 { background: #ffeaf0; color: #c55d81; }
  .member-number { margin-left: auto; color: #aaaaba; font-size: 10px; font-weight: 400; }
  .empty-state { text-align: center; padding: 35px 15px; color: #55556a; }
  .empty-state.compact { padding: 24px 10px 8px; }
  .empty-icon { width: 43px; height: 43px; display: grid; place-items: center; border-radius: 13px; margin: 0 auto 12px; background: #f1efff; color: #7765d8; font-size: 20px; }
  .empty-state strong { font-size: 13px; }
  .empty-state p { color: #9999a9; font-size: 11px; margin: 7px 0 0; }
  .bill-list { display: grid; gap: 13px; }
  .bill-card { border: 1px solid #eeedf3; border-radius: 12px; padding: 16px; }
  .bill-top { display: flex; align-items: center; gap: 12px; }
  .bill-symbol { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: #f0edff; color: #6e5bd1; font-weight: 700; }
  .bill-info { flex: 1; min-width: 0; }
  .bill-info h3 { font-size: 13px; margin: 0 0 4px; }
  .bill-info p { font-size: 10px; color: #9999aa; margin: 0; }
  .bill-total { font: 700 15px 'Manrope', sans-serif; }
  .share-list { margin-top: 14px; border-top: 1px solid #f0eff4; }
  .share-row { display: flex; align-items: center; gap: 10px; padding: 11px 0 0; font-size: 11px; }
  .share-person { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; color: #666679; }
  .mini-avatar { width: 24px; height: 24px; background: #f0effb; color: #7464d2; font-size: 10px; }
  .share-row > strong { font-size: 11px; }
  .paid-status { color: #25966c; font-size: 10px; font-weight: 700; min-width: 67px; text-align: right; }
  .pay-button { border: 1px solid #ded9fa; background: #f7f5ff; color: #6756c8; border-radius: 7px; padding: 7px 9px; font-size: 10px; font-weight: 700; min-width: 78px; }
  .pay-button:hover { background: #ebe7ff; }
  .small-copy { font-size: 11px; margin: 8px 0 18px; }
  .bill-form label { margin-top: 17px; }
  .amount-input { position: relative; }
  .amount-input > span { position: absolute; left: 14px; top: 12px; color: #77768a; font-size: 14px; }
  .amount-input input { padding-left: 32px; }
  .split-note { display: flex; gap: 8px; align-items: center; margin-top: 17px; background: #f7f6fc; border-radius: 8px; padding: 11px; color: #77768a; font-size: 10px; }
  .split-note > span:first-child { color: #705ed5; font-size: 15px; }
  .split-note strong { color: #5143aa; }
  .validation-note { color: #c17b39; font-size: 10px; text-align: center; margin: 10px 0 0; }
  .balance-icon { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: #e8f8f0; color: #31a779; }
  .balance-list { margin-top: 14px; }
  .balance-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 0; border-bottom: 1px solid #f0eff4; }
  .balance-row > div { display: grid; gap: 4px; }
  .balance-row > div strong { font-size: 11px; }
  .balance-row small { color: #aaaaba; font-size: 10px; }
  .balance-row > strong { font-size: 12px; }
  .due { color: #d18a42; }
  .settled { color: #2ca477; }
  .balance-footnote { color: #aaaaba; font-size: 9px; line-height: 1.5; margin: 15px 0 0; }
  .alert { position: fixed; right: 24px; bottom: 24px; z-index: 5; max-width: min(460px, calc(100vw - 32px)); padding: 14px 17px; border-radius: 10px; box-shadow: 0 8px 30px #25204420; display: flex; align-items: center; gap: 10px; font-size: 12px; }
  .alert > span { font-weight: 800; }
  .alert button { border: 0; background: transparent; font-size: 18px; margin-left: 8px; color: inherit; }
  .error-alert { background: #fff0ef; color: #b74b45; border: 1px solid #f5d4d1; }
  .success-alert { background: #eaf8f1; color: #27875f; border: 1px solid #d1efdf; }
  .footer { display: flex; justify-content: space-between; color: #aaaaba; font-size: 10px; padding: 28px 2px 5px; margin-top: 20px; }
  .footer-brand { color: #7770a6; font-weight: 800; letter-spacing: -.3px; }
  @media (max-width: 800px) {
    .welcome { grid-template-columns: 1fr; gap: 35px; padding: 35px 0; }
    .content-grid { grid-template-columns: 1fr; }
    .stats-grid { gap: 10px; }
    .stat-card { padding: 15px; }
    .stat-card strong { font-size: 18px; }
  }
  @media (max-width: 540px) {
    .topbar { padding: 0 18px; height: 64px; }
    .topbar-note { font-size: 0; }
    .container { padding: 30px 16px 18px; }
    .dashboard-heading { align-items: flex-start; gap: 10px; }
    .dashboard-heading h1 { font-size: 27px; }
    .home-tag { white-space: nowrap; font-size: 9px; }
    .stats-grid { grid-template-columns: 1fr; }
    .stat-card { grid-template-columns: 38px 1fr; }
    .panel { padding: 19px; }
    .inline-form { flex-direction: column; }
    .inline-form button { width: 100%; }
    .share-row { gap: 6px; }
    .share-person { gap: 5px; }
    .pay-button { min-width: 68px; padding: 7px 5px; }
    .footer { gap: 10px; flex-wrap: wrap; }
  }
`
