import { useMemo, useState } from 'react';
import { X, Mail, Check, Newspaper, Info, Send } from 'lucide-react';
import { subscribe, sendNow } from '../lib/api';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A secondary, instant action: email the current edition right now (no
// subscription needed). Rate-limited server-side to 3 sends per email per hour.
function EmailNowRow() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setMsg(null);
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      setMsg({ ok: false, text: 'Please enter a valid email address.' });
      return;
    }
    setBusy(true);
    const res = await sendNow(e);
    setBusy(false);
    if (res.ok) setMsg({ ok: true, text: 'Sent — check your inbox.' });
    else if (res.reason === 'rate_limited')
      setMsg({ ok: false, text: 'You’ve reached the limit (3 per hour). Try again later.' });
    else setMsg({ ok: false, text: res.error || 'Couldn’t send right now — please try again.' });
  }

  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5">
        <span aria-hidden>📧</span>
        <span className="text-sm font-bold text-slate-800">Email me this edition now</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Today’s portfolio &amp; watchlist brief, straight to your inbox — no subscription needed.
      </p>
      <div className="mt-2.5 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder="you@familyoffice.in"
          className="min-w-0 flex-1 rounded-lg border-0 bg-white py-2 px-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          <Send className="h-3.5 w-3.5" />
          {busy ? 'Sending…' : 'Send now'}
        </button>
      </div>
      {msg && (
        <p className={`mt-2 text-xs font-medium ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

const HOURS: { value: number; label: string }[] = [
  { value: 6, label: '6:00 AM' },
  { value: 7, label: '7:00 AM' },
  { value: 8, label: '8:00 AM' },
  { value: 9, label: '9:00 AM' },
  { value: 10, label: '10:00 AM' },
  { value: 13, label: '1:00 PM' },
  { value: 18, label: '6:00 PM' },
  { value: 21, label: '9:00 PM' },
];

function hourLabel(h: number) {
  return HOURS.find((x) => x.value === h)?.label ?? `${h}:00`;
}

// Friendly "first brief arrives …" hint (approximate — a nicety, not exact TZ math).
function nextSendLabel(days: 'daily' | 'weekdays', hour: number): string {
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(hour, 0, 0, 0);
    if (d <= now) continue;
    const wd = d.getDay();
    if (days === 'weekdays' && (wd === 0 || wd === 6)) continue;
    const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day} at ${hourLabel(hour)} IST`;
  }
  return `${hourLabel(hour)} IST`;
}

export function SubscribePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [days, setDays] = useState<'weekdays' | 'daily'>('weekdays');
  const [hour, setHour] = useState(7);
  const [feeds, setFeeds] = useState<Record<string, boolean>>({ portfolio: true, watchlist: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const chosenFeeds = useMemo(
    () => Object.entries(feeds).filter(([, v]) => v).map(([k]) => k),
    [feeds],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (chosenFeeds.length === 0) {
      setError('Pick at least one feed.');
      return;
    }
    setBusy(true);
    const res = await subscribe({ email: email.trim(), days, hour, feeds: chosenFeeds });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.error || 'Something went wrong.');
  }

  function reset() {
    setDone(false);
    setError(null);
    setEmail('');
    onClose();
  }

  const toggleFeed = (k: string) => setFeeds((f) => ({ ...f, [k]: !f[k] }));

  return (
    <>
      <div
        onClick={reset}
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!open}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Subscribe to the morning brief"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white">
              <Newspaper className="h-4 w-4" />
            </div>
            <h2 className="font-display text-base font-extrabold text-slate-900">Get the morning brief</h2>
          </div>
          <button
            onClick={reset}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <Check className="h-7 w-7" />
            </div>
            <h3 className="font-display text-lg font-extrabold text-slate-900">You&apos;re subscribed</h3>
            <p className="mt-2 text-sm text-slate-600">
              Your first Newsflow brief arrives{' '}
              <span className="font-bold text-slate-800">{nextSendLabel(days, hour)}</span>.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              A Munshot-branded newspaper of your fundamental news. Every email has a one-click unsubscribe.
            </p>
            <button
              onClick={reset}
              className="mt-6 rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <Info className="h-3 w-3" />A short, skimmable digest of the day&apos;s fundamental news — no price noise.
            </p>

            {/* Email */}
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Email</span>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@familyoffice.in"
                  className="w-full rounded-lg border-0 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </label>

            {/* Days */}
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">How often</span>
              <div className="mt-1.5 inline-flex w-full rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
                {(['weekdays', 'daily'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays(d)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                      days === d ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {d === 'weekdays' ? 'Every weekday' : 'Every day'}
                  </button>
                ))}
              </div>
            </div>

            {/* Hour */}
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Time (IST)</span>
              <select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="mt-1.5 w-full cursor-pointer rounded-lg border-0 bg-white py-2.5 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Feeds */}
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Which feeds</span>
              <div className="mt-1.5 space-y-2">
                {[
                  { key: 'portfolio', label: 'Portfolio', hint: 'your current holdings' },
                  { key: 'watchlist', label: 'Watchlist', hint: 'holdings + exited + added' },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleFeed(f.key)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ring-1 transition ${
                      feeds[f.key]
                        ? 'bg-indigo-50 ring-indigo-200'
                        : 'bg-white ring-slate-200 hover:ring-slate-300'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md ${
                        feeds[f.key] ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-transparent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold text-slate-800">{f.label}</span>
                      <span className="block text-[11px] text-slate-500">{f.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 ring-1 ring-rose-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-95 disabled:opacity-60"
            >
              {busy ? 'Subscribing…' : 'Subscribe'}
            </button>

            <p className="text-center text-[11px] text-slate-400">
              Delivered by Munshot. One-click unsubscribe in every email. No spam.
            </p>

            <div className="border-t border-slate-200 pt-5">
              <EmailNowRow />
            </div>
          </form>
        )}
      </aside>
    </>
  );
}
