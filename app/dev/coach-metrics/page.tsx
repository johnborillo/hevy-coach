import { headers } from 'next/headers';
import Link from 'next/link';

import { aggregateMetrics } from '@/lib/coach-metrics';
import {
  coachMetricsEnabled,
  listCoachTurnMetrics,
} from '@/lib/coach-metrics-repo';
import { requestUserId } from '@/lib/request-user';

export const dynamic = 'force-dynamic';

// Dev-only page: token usage per coach turn, conversation and prompt
// section. Hidden from navigation and off unless COACH_METRICS=1.

const STYLES = `
.metrics-page { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; font-family: var(--font-geist-sans), system-ui, sans-serif; color: inherit; }
.metrics-page h1 { font-size: 26px; margin: 0 0 4px; }
.metrics-page h2 { font-size: 16px; margin: 36px 0 10px; }
.metrics-page p.lede { color: var(--muted-foreground, #687064); margin: 0 0 20px; }
.metrics-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.metrics-tile { border: 1px solid var(--line, #dfe2d9); border-radius: 10px; padding: 12px 14px; }
.metrics-tile span { display: block; font-size: 12px; color: var(--muted-foreground, #687064); }
.metrics-tile strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.metrics-table-wrap { overflow-x: auto; border: 1px solid var(--line, #dfe2d9); border-radius: 10px; }
.metrics-page table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.metrics-page th, .metrics-page td { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line, #dfe2d9); white-space: nowrap; }
.metrics-page th:first-child, .metrics-page td:first-child { text-align: left; }
.metrics-page th { font-weight: 600; font-size: 12px; color: var(--muted-foreground, #687064); }
.metrics-page tr:last-child td { border-bottom: 0; }
.metrics-bar { display: grid; grid-template-columns: minmax(150px, 220px) 1fr 90px; gap: 10px; align-items: center; font-size: 13px; margin: 6px 0; }
.metrics-bar div { height: 10px; border-radius: 5px; background: var(--muted, #e9ece3); overflow: hidden; }
.metrics-bar i { display: block; height: 100%; background: #5b7a1f; border-radius: 5px; }
.metrics-bar b { text-align: right; font-weight: 500; font-variant-numeric: tabular-nums; }
.metrics-links a { margin-right: 16px; }
.metrics-note { font-size: 12px; color: var(--muted-foreground, #687064); margin-top: 8px; }
`;

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function n(value: number | null | undefined, digits = 0) {
  if (value == null) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function money(value: number | null | undefined) {
  if (value == null) return '—';
  return `$${value.toFixed(value < 0.01 ? 5 : 3)}`;
}

function pct(value: number | null | undefined) {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

type Group = {
  turns: number;
  avgPromptTokens: number | null;
  maxPromptTokens: number | null;
  avgCompletionTokens: number | null;
  avgReasoningTokens: number | null;
  totalCost: number | null;
  avgRequestsPerTurn: number | null;
};

function GroupTable({
  label,
  rows,
}: {
  label: string;
  rows: Array<Group & { name: string }>;
}) {
  return (
    <div className="metrics-table-wrap">
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th>Turns</th>
            <th>Avg prompt</th>
            <th>Max prompt</th>
            <th>Avg output</th>
            <th>Avg reasoning</th>
            <th>Requests / turn</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{n(row.turns)}</td>
              <td>{n(row.avgPromptTokens)}</td>
              <td>{n(row.maxPromptTokens)}</td>
              <td>{n(row.avgCompletionTokens)}</td>
              <td>{n(row.avgReasoningTokens)}</td>
              <td>{n(row.avgRequestsPerTurn, 1)}</td>
              <td>{money(row.totalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CoachMetricsPage({
  searchParams,
}: {
  searchParams?: Promise<{ days?: string }>;
}) {
  if (!coachMetricsEnabled()) {
    return (
      <main className="metrics-page">
        <style>{STYLES}</style>
        <h1>Coach metrics are off</h1>
        <p className="lede">Set COACH_METRICS=1 to record token usage for coach turns.</p>
      </main>
    );
  }
  const days = Number((await searchParams)?.days ?? 30) || 30;
  const rows = await listCoachTurnMetrics(requestUserId(await headers()), {
    since: daysAgoIso(days),
  });
  const report = aggregateMetrics(rows);
  const maxSection = Math.max(1, ...report.sections.map((item) => item.avgEstimatedTokens));

  return (
    <main className="metrics-page">
      <style>{STYLES}</style>
      <h1>Coach token usage</h1>
      <p className="lede">
        Last {days} days · {n(report.turns)} turns · prompt sizes are the first request of each
        turn, as reported by OpenRouter.
      </p>
      <p className="metrics-links">
        <Link href="/dev/coach-metrics?days=7">7 days</Link>
        <Link href="/dev/coach-metrics?days=30">30 days</Link>
        <Link href="/dev/coach-metrics?days=90">90 days</Link>
        <a href={`/api/dev/coach-metrics?days=${days}&format=csv`}>Download CSV</a>
        <a href={`/api/dev/coach-metrics?days=${days}`}>JSON</a>
      </p>

      {report.turns === 0 ? (
        <p>No coach turns recorded yet. Send a few messages to the coach and reload.</p>
      ) : (
        <>
          <div className="metrics-tiles">
            <div className="metrics-tile">
              <span>Avg prompt</span>
              <strong>{n(report.overall.avgPromptTokens)}</strong>
            </div>
            <div className="metrics-tile">
              <span>Largest prompt</span>
              <strong>{n(report.overall.maxPromptTokens)}</strong>
            </div>
            <div className="metrics-tile">
              <span>Avg output</span>
              <strong>{n(report.overall.avgCompletionTokens)}</strong>
            </div>
            <div className="metrics-tile">
              <span>Cache hit rate</span>
              <strong>{pct(report.overall.cacheHitRate)}</strong>
            </div>
            <div className="metrics-tile">
              <span>Requests per turn</span>
              <strong>{n(report.overall.avgRequestsPerTurn, 2)}</strong>
            </div>
            <div className="metrics-tile">
              <span>Total cost</span>
              <strong>{money(report.overall.totalCost)}</strong>
            </div>
          </div>

          <h2>What fills the prompt (average per turn)</h2>
          {report.sections.map((item) => (
            <div className="metrics-bar" key={item.section}>
              <span>{item.section}</span>
              <div>
                <i style={{ width: `${(item.avgEstimatedTokens / maxSection) * 100}%` }} />
              </div>
              <b>
                {n(item.avgCalibratedTokens ?? item.avgEstimatedTokens)} · {pct(item.share)}
              </b>
            </div>
          ))}
          <p className="metrics-note">
            Sections are estimated from text length (4 characters ≈ 1 token)
            {report.overall.estimateCalibration != null
              ? ` and scaled by ${n(report.overall.estimateCalibration, 2)}× to match OpenRouter's real totals.`
              : '.'}
          </p>

          <h2>By conversation length</h2>
          <GroupTable
            label="Prior messages"
            rows={report.byHistoryLength.map((row) => ({ ...row, name: row.historyMessages }))}
          />

          <h2>By conversation</h2>
          <div className="metrics-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Conversation</th>
                  <th>Turns</th>
                  <th>First prompt</th>
                  <th>Last prompt</th>
                  <th>Max prompt</th>
                  <th>Avg output</th>
                  <th>Cost</th>
                  <th>Last turn</th>
                </tr>
              </thead>
              <tbody>
                {report.byConversation.map((row) => (
                  <tr key={row.conversationId}>
                    <td title={row.conversationId}>{row.conversationId.slice(0, 8)}</td>
                    <td>{n(row.turns)}</td>
                    <td>{n(row.firstTurnPromptTokens)}</td>
                    <td>{n(row.lastTurnPromptTokens)}</td>
                    <td>{n(row.maxPromptTokens)}</td>
                    <td>{n(row.avgCompletionTokens)}</td>
                    <td>{money(row.totalCost)}</td>
                    <td>{row.lastTurnAt?.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>By question kind</h2>
          <GroupTable
            label="Kind"
            rows={report.byQuestionKind.map((row) => ({ ...row, name: row.questionKind }))}
          />

          <h2>By model</h2>
          <GroupTable
            label="Model"
            rows={report.byModel.map((row) => ({ ...row, name: row.model }))}
          />
          <p className="metrics-note">
            {report.overall.evidenceEngineTurns} turns fell back to the evidence engine.
          </p>
        </>
      )}
    </main>
  );
}
