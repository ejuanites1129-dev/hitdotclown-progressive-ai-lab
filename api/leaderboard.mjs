import nodemailer from 'nodemailer';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

class RouteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function config() {
  const url = process.env.LEADERBOARD_SUPABASE_URL;
  const key = process.env.LEADERBOARD_SUPABASE_SECRET_KEY;
  let parsed;
  try { parsed = new URL(url); } catch { throw new RouteError('Leaderboard database is not configured in Vercel.', 503); }
  if (!key || parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
    throw new RouteError('Leaderboard database is not configured in Vercel.', 503);
  }
  return { url: parsed, key };
}

function checkSameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new RouteError('Use the Hit Dot Clown site to access this feature.', 403);
  }
}

async function rpc(database, name, args) {
  let response;
  try {
    response = await fetch(new URL('/rest/v1/rpc/' + name, database.url), {
      method: 'POST', cache: 'no-store',
      headers: { apikey: database.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new RouteError('The leaderboard database could not be reached. Your game result is queued for retry.', 503);
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(detail.code)) {
      throw new RouteError('The leaderboard database needs the game schema and public leaderboard/email SQL updates.', 503);
    }
    if (detail.code === '23505') throw new RouteError('This game result ID was already used for different data.', 409);
    throw new RouteError('The leaderboard database rejected this request. Your result is queued for retry.', 503);
  }
  return response.status === 204 ? null : response.json();
}

function player(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!username || username.length > 24 || !emailPattern.test(email) || email.length > 254) {
    throw new RouteError('Enter a valid player name and email address.');
  }
  return { p_username: username, p_email: email };
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new RouteError('Invalid game timestamp.');
  return new Date(value).toISOString();
}

function mailConfig() {
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').replace(/\s/g, '');
  const publicUrl = String(process.env.PUBLIC_LEADERBOARD_URL || '').trim();
  try {
    const link = new URL(publicUrl);
    const port = Number(process.env.SMTP_PORT || 465);
    if (link.protocol !== 'https:' || !emailPattern.test(user) || !pass || ![465, 587].includes(port)
      || (String(process.env.SMTP_HOST || 'smtp.gmail.com').toLowerCase() === 'smtp.gmail.com' && pass.length !== 16)) return null;
    return { user, pass, url: link.href, host: String(process.env.SMTP_HOST || 'smtp.gmail.com'), port,
      secure: port === 465, senderName: String(process.env.SMTP_FROM_NAME || 'Hit Dot Clown').slice(0, 80) };
  } catch { return null; }
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sendQueuedEmails(database, mail) {
  const jobs = await rpc(database, 'claim_hitdotclown_emails', { p_limit: 5 });
  if (!Array.isArray(jobs) || jobs.length === 0) return;
  const transport = nodemailer.createTransport({ host: mail.host, port: mail.port, secure: mail.secure,
    requireTLS: !mail.secure, auth: { user: mail.user, pass: mail.pass },
    tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 8000, greetingTimeout: 8000,
    socketTimeout: 12000, disableFileAccess: true, disableUrlAccess: true });
  try {
    for (const job of jobs) {
      let sent = false, failure = 'SMTP delivery failed.';
      try {
        if (!emailPattern.test(job.email || '')) throw new Error('Invalid recipient.');
        const name = escapeHtml(job.username);
        const result = await transport.sendMail({
          from: { name: mail.senderName, address: mail.user }, to: { address: job.email },
          subject: 'Your Hit Dot Clown leaderboard link',
          messageId: '<hitdotclown-' + job.id + '@' + mail.user.split('@')[1] + '>',
          text: `Hi ${job.username},\n\nFollow the Hit Dot Clown leaderboard: ${mail.url}\nIt shows each player’s best score and the date played. Your email stays private.\n\nYou received this because you asked for the leaderboard link when starting the game.`,
          html: `<!doctype html><html><body style="margin:0;background:#fff5e5;color:#3b251c;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:32px;border:1px solid #d9bc8a;border-top:6px solid #9b2d24;background:#fffaf0"><p style="color:#9b2d24;font-weight:bold;letter-spacing:2px">HIT DOT CLOWN</p><h1 style="font:30px Georgia,serif">Every hit counts.</h1><p>Hi ${name}, follow the latest standings and check the date played.</p><p style="margin:30px 0"><a href="${escapeHtml(mail.url)}" style="display:inline-block;background:#9b2d24;color:#fff6df;text-decoration:none;padding:14px 22px;border-radius:5px">View the leaderboard</a></p><p style="font-size:13px;color:#725b49">Your email stays private. You received this link because you asked for it when starting Hit Dot Clown.</p></div></body></html>`,
        });
        if (!Array.isArray(result.accepted) || result.accepted.length === 0) throw new Error('SMTP rejected the recipient.');
        sent = true;
      } catch (error) {
        failure = error?.code === 'EAUTH' ? 'SMTP authentication failed. Check the Gmail App Password.'
          : error?.code === 'ECONNECTION' || error?.code === 'ETIMEDOUT' ? 'SMTP connection failed.' : failure;
      }
      await rpc(database, 'finish_hitdotclown_email', { p_id: job.id, p_lease_token: job.lease_token, p_sent: sent, p_error: failure });
    }
  } finally { transport.close(); }
}

async function handleLeaderboardRequest(request) {
  try {
    checkSameOrigin(request);
    const database = config();
    if (request.method === 'GET') {
      const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('limit') || 10)));
      if (!Number.isSafeInteger(limit)) throw new RouteError('Invalid leaderboard page size.');
      const entries = await rpc(database, 'hitdotclown_public_leaderboard', { p_limit: limit, p_offset: 0, p_search: '' });
      return json({ entries: (Array.isArray(entries) ? entries : []).map((row) => ({
        rank: Number(row.rank), username: String(row.username || '').slice(0, 24),
        score: Number(row.score), playedAt: row.played_at,
      })) });
    }
    if (request.method !== 'POST') throw new RouteError('Method not allowed.', 405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new RouteError('Send JSON data.', 415);
    const raw = await request.text();
    if (raw.length > 4096) throw new RouteError('Request is too large.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new RouteError('Invalid JSON data.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RouteError('Invalid request.');
    const details = player(body);
    if (body.action === 'complete') {
      if (!uuid.test(body.id || '') || !Number.isSafeInteger(body.score) || body.score < 0) throw new RouteError('Invalid game result.');
      const started = timestamp(body.startedAt), ended = timestamp(body.endedAt);
      if (Date.parse(ended) < Date.parse(started)) throw new RouteError('Game end cannot be before its start.');
      const attempt = await rpc(database, 'record_hitdotclown_attempt', { ...details, p_id: body.id,
        p_score: body.score, p_started_at: started, p_ended_at: ended });
      const row = Array.isArray(attempt) ? attempt[0] : attempt;
      return json({ saved: Boolean(row?.id) });
    }
    if (body.action === 'invite') {
      if (!uuid.test(body.id || '')) throw new RouteError('Invalid game session.');
      const started = timestamp(body.startedAt);
      const jobResponse = await rpc(database, 'enqueue_hitdotclown_email', { ...details, p_id: body.id, p_started_at: started });
      const job = Array.isArray(jobResponse) ? jobResponse[0] : jobResponse;
      const mail = mailConfig();
      if (mail && job?.status !== 'sent') {
        try { await sendQueuedEmails(database, mail); }
        catch { /* Keep the email queue for retry by the configured local worker. */ }
      }
      return json({ queued: job?.status !== 'sent', emailReady: Boolean(mail) });
    }
    throw new RouteError('Unknown action.');
  } catch (error) {
    return json({ error: error instanceof RouteError ? error.message : 'The leaderboard request could not be completed.' },
      error instanceof RouteError ? error.status : 500);
  }
}

const leaderboardApi = { fetch: handleLeaderboardRequest };
export default leaderboardApi;
