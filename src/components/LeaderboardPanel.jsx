export default function LeaderboardPanel({ entries, pending, message, configured, refresh }) {
  return <section className="leaderboard-panel" aria-labelledby="public-leaderboard-title">
    <header className="leaderboard-panel-head">
      <div><p className="lobby-eyebrow">The midway standings</p><h2 id="public-leaderboard-title">Leaderboard</h2></div>
      <button type="button" className="leaderboard-refresh" onClick={() => void refresh()} aria-label="Refresh leaderboard" title="Refresh leaderboard">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 0 0-15.36-6.36L3 8" /><path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 15.36 6.36L21 16" /><path d="M21 21v-5h-5" />
        </svg>
      </button>
    </header>
    <p className="leaderboard-subtitle">Best score per player · email stays private</p>
    {configured === null && <p className="leaderboard-state" role="status">Connecting to the leaderboard…</p>}
    {configured === false && <p className="leaderboard-state" role="status">{message || 'Leaderboard is temporarily unavailable.'}</p>}
    {configured === true && entries.length === 0 && <p className="leaderboard-state">No scores yet. Be the first to play!</p>}
    {entries.length > 0 && <div className="leaderboard-scroll">
      <table><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Played</th><th scope="col">Score</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.rank + ':' + entry.username}>
          <td>{entry.rank}</td><td>{entry.username}</td>
          <td>{entry.playedAt ? new Date(entry.playedAt).toLocaleDateString() : '—'}</td>
          <td className="leaderboard-score">{Number(entry.score).toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {pending > 0 && <p className="leaderboard-state" role="status">{pending} game {pending === 1 ? 'result is' : 'results are'} waiting to sync.</p>}
    {message && pending === 0 && <p className="leaderboard-state" role="status">{message}</p>}
    <a className="leaderboard-full-link" href="https://hitdotclown-leaderboard.vercel.app/" target="_blank" rel="noreferrer">Open full leaderboard ↗</a>
  </section>;
}
