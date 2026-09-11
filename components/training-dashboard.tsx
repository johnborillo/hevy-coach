'use client';

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Dumbbell,
  Flame,
  Gauge,
  Medal,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DashboardData } from '@/lib/hevy';
import type {
  AthleteProfile,
  ChatMessage,
  ConversationSummary,
  TrainingProgram,
} from '@/lib/storage';

type View = 'today' | 'progress' | 'coach' | 'program' | 'profile';
type Unit = 'kg' | 'lb';

const NAV_ITEMS = [
  { id: 'today' as const, label: 'Today', icon: Activity },
  { id: 'progress' as const, label: 'Progress', icon: BarChart3 },
  { id: 'coach' as const, label: 'Coach', icon: MessageSquareText },
  { id: 'program' as const, label: 'Program', icon: CalendarDays },
  { id: 'profile' as const, label: 'Athlete', icon: Settings2 },
];

const EMPTY_PROFILE: AthleteProfile = {
  displayName: 'Athlete',
  biologicalSex: 'prefer_not_to_say',
  age: null,
  heightCm: null,
  weightKg: null,
  experience: 'intermediate',
  primaryGoal: 'Build muscle and strength',
  targetDate: '',
  daysPerWeek: 4,
  minutesPerSession: 60,
  equipment: 'Full gym',
  limitations: '',
  preferences: '',
};

const STARTERS = [
  'Build me a 40-minute upper session based on this week.',
  'Why might my main lifts be plateauing?',
  'Give me my weekly coaching review.',
  'How should I return after three weeks off?',
];

type ApiError = { error?: string };

async function readJson<T>(response: Response) {
  return response.json() as Promise<T>;
}

function toDisplayKg(value: number, unit: Unit) {
  return unit === 'kg' ? value : value * 2.20462;
}

function weight(value: number, unit: Unit, digits = 1) {
  return `${toDisplayKg(value, unit).toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`;
}

function volume(value: number, unit: Unit) {
  const converted = toDisplayKg(value, unit);
  return converted >= 1000
    ? `${(converted / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k ${unit}`
    : `${Math.round(converted).toLocaleString()} ${unit}`;
}

function delta(value: number) {
  return `${value >= 0 ? '+' : ''}${value}%`;
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Activity }) {
  return (
    <article className="metric-card">
      <div className="metric-label"><span>{label}</span><Icon /></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'neutral' }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function EmptyMessage({ title, body }: { title: string; body: string }) {
  return <div className="empty-message"><Dumbbell /><strong>{title}</strong><p>{body}</p></div>;
}

export function TrainingDashboard({ data }: { data: DashboardData }) {
  const [view, setView] = useState<View>('today');
  const [unit, setUnit] = useState<Unit>('kg');
  const [duration, setDuration] = useState('40');
  const [focus, setFocus] = useState('upper');
  const [selectedTrend, setSelectedTrend] = useState(data.strengthTrends[0]?.exercise ?? data.trend.exercise);
  const [profile, setProfile] = useState<AthleteProfile>(EMPTY_PROFILE);
  const [profileState, setProfileState] = useState('Save athlete profile');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [activeProgram, setActiveProgram] = useState<TrainingProgram | null>(null);
  const [programBusy, setProgramBusy] = useState(false);
  const [programError, setProgramError] = useState('');
  const [programForm, setProgramForm] = useState({ goal: 'Build muscle and strength', durationWeeks: 8, daysPerWeek: 4, minutesPerSession: 60, preferences: '' });
  const chatEnd = useRef<HTMLDivElement>(null);

  const selectedStrength = data.strengthTrends.find((item) => item.exercise === selectedTrend) ?? data.strengthTrends[0];
  const displayTrend = (selectedStrength?.points ?? data.trend.points).map((point) => ({ ...point, displayValue: toDisplayKg(point.value, unit) }));
  const workload = data.workloadWeeks.map((week) => ({ ...week, displayVolume: Math.round(toDisplayKg(week.volumeKg, unit)) }));
  const plan = useMemo(() => {
    const limit = duration === '25' ? 3 : duration === '40' ? 4 : 6;
    const upperMuscles = ['Chest', 'Upper Back', 'Lats', 'Shoulders', 'Biceps', 'Triceps'];
    const filtered = focus === 'upper' ? data.exerciseOptions.filter((item) => upperMuscles.includes(item.muscle)) : data.exerciseOptions;
    return (filtered.length >= limit ? filtered : data.exerciseOptions).slice(0, limit);
  }, [data.exerciseOptions, duration, focus]);
  const maxMuscleSets = Math.max(...data.muscles.map((muscle) => muscle.sets), 1);

  useEffect(() => {
    const savedUnit = window.localStorage.getItem('hevy-coach-unit');
    if (savedUnit === 'lb' || savedUnit === 'kg') {
      window.setTimeout(() => setUnit(savedUnit), 0);
    }
    void Promise.all([
      fetch('/api/profile').then((response) => response.ok ? readJson<{ profile: AthleteProfile }>(response) : null),
      fetch('/api/conversations').then((response) => response.ok ? readJson<{ conversations: ConversationSummary[] }>(response) : null),
      fetch('/api/programs').then((response) => response.ok ? readJson<{ programs: TrainingProgram[] }>(response) : null),
    ]).then(([profilePayload, conversationPayload, programPayload]) => {
      if (profilePayload?.profile) {
        setProfile(profilePayload.profile);
        setProgramForm((current) => ({ ...current, goal: profilePayload.profile.primaryGoal, daysPerWeek: profilePayload.profile.daysPerWeek, minutesPerSession: profilePayload.profile.minutesPerSession }));
      }
      if (conversationPayload?.conversations) setConversations(conversationPayload.conversations);
      if (programPayload?.programs) {
        setPrograms(programPayload.programs);
        setActiveProgram(programPayload.programs[0] ?? null);
      }
    });
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatBusy]);

  useEffect(() => {
    type ModelContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };
    const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(modelContext.registerTool({
      name: 'open_coach_with_question',
      title: 'Open coach with question',
      description: 'Open the private coaching workspace and stage a question grounded in Hevy history. The athlete still chooses whether to send it.',
      inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 500 } }, required: ['question'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const question = typeof input === 'object' && input && 'question' in input ? String((input as { question: unknown }).question).slice(0, 500) : '';
        if (!question) throw new Error('A question is required.');
        setView('coach');
        setChatInput(question);
        return { status: 'staged', sent: false, question };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  function changeUnit(next: Unit) {
    setUnit(next);
    window.localStorage.setItem('hevy-coach-unit', next);
  }

  async function createChat() {
    setChatError('');
    const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const payload = await readJson<{ conversation: ConversationSummary } & ApiError>(response);
    if (!response.ok) return setChatError(payload.error || 'Could not create a chat.');
    setConversations((current) => [payload.conversation, ...current]);
    setActiveConversation(payload.conversation.id);
    setMessages([]);
  }

  async function openChat(id: string) {
    setActiveConversation(id);
    setChatError('');
    const response = await fetch(`/api/messages?conversationId=${encodeURIComponent(id)}`);
    const payload = await readJson<{ messages: ChatMessage[] } & ApiError>(response);
    if (response.ok) setMessages(payload.messages);
    else setChatError(payload.error || 'Could not load this chat.');
  }

  async function deleteChat(id: string) {
    if (!window.confirm('Delete this coaching chat permanently?')) return;
    const response = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) return setChatError('Could not delete this chat.');
    setConversations((current) => current.filter((item) => item.id !== id));
    if (activeConversation === id) {
      setActiveConversation(null);
      setMessages([]);
    }
  }

  async function sendMessage(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = chatInput.trim();
    if (!content || chatBusy) return;
    let conversationId = activeConversation;
    if (!conversationId) {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const payload = await readJson<{ conversation: ConversationSummary } & ApiError>(response);
      if (!response.ok) return setChatError(payload.error || 'Could not create a chat.');
      conversationId = payload.conversation.id;
      setActiveConversation(conversationId);
      setConversations((current) => [payload.conversation, ...current]);
    }
    setChatInput('');
    setChatBusy(true);
    setChatError('');
    if (!conversationId) return;
    const resolvedConversationId = conversationId;
    const optimistic: ChatMessage = { id: crypto.randomUUID(), conversationId: resolvedConversationId, role: 'user', content, model: null, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: resolvedConversationId, message: content }) });
      const payload = await readJson<{ userMessage: ChatMessage; assistantMessage: ChatMessage } & ApiError>(response);
      if (!response.ok) throw new Error(payload.error || 'The coach could not answer.');
      setMessages((current) => [...current.filter((message) => message.id !== optimistic.id), payload.userMessage, payload.assistantMessage]);
      const refreshed = await fetch('/api/conversations').then((result) => readJson<{ conversations: ConversationSummary[] }>(result));
      if (refreshed.conversations) setConversations(refreshed.conversations);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'The coach could not answer.');
    } finally {
      setChatBusy(false);
    }
  }

  async function saveAthlete(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileState('Saving…');
    const response = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    const payload = await readJson<{ profile: AthleteProfile } & ApiError>(response);
    if (response.ok) {
      setProfile(payload.profile);
      setProfileState('Saved');
      window.setTimeout(() => setProfileState('Save athlete profile'), 1600);
    } else setProfileState(payload.error || 'Try again');
  }

  async function generateProgram(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setProgramBusy(true);
    setProgramError('');
    try {
      const response = await fetch('/api/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(programForm) });
      const payload = await readJson<{ program: TrainingProgram } & ApiError>(response);
      if (!response.ok) throw new Error(payload.error || 'Program generation failed.');
      setPrograms((current) => [payload.program, ...current]);
      setActiveProgram(payload.program);
    } catch (error) {
      setProgramError(error instanceof Error ? error.message : 'Program generation failed.');
    } finally {
      setProgramBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <button className="brand-mark" type="button" onClick={() => setView('today')} aria-label="Hevy Coach home"><Dumbbell /><span>HC</span></button>
        <nav aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)} title={item.label}><item.icon /><span>{item.label}</span></button>)}
        </nav>
        <div className="rail-status" title={data.syncMessage}><span className={data.connected ? 'status-dot live' : 'status-dot'} /><small>{data.connected ? 'Live' : 'Demo'}</small></div>
      </aside>

      <main className={view === 'coach' ? 'coach-main' : ''}>
        <header className="topbar">
          <div><p className="eyebrow">HEVY COACH / {NAV_ITEMS.find((item) => item.id === view)?.label.toUpperCase()}</p><h1>{view === 'today' ? `Ready, ${profile.displayName === 'Athlete' ? data.athleteName : profile.displayName}.` : view === 'progress' ? 'Read the adaptation.' : view === 'coach' ? 'Coach Rowan.' : view === 'program' ? 'Build the next block.' : 'Athlete context.'}</h1></div>
          <div className="topbar-actions">
            <div className="unit-toggle" aria-label="Weight unit">{(['kg', 'lb'] as Unit[]).map((option) => <button type="button" key={option} aria-pressed={unit === option} onClick={() => changeUnit(option)}>{option.toUpperCase()}</button>)}</div>
            <div className="sync-copy"><RefreshCw /><span>{data.syncMessage}</span></div>
          </div>
        </header>

        {!data.connected && <section className="setup-banner"><div><span className="setup-kicker">Connection needs attention</span><strong>Showing sample training data.</strong><p>{data.syncMessage}</p></div><code>HEVY_API_KEY</code></section>}

        {view === 'today' && <>
          <section className="command-grid">
            <article className="planner-panel">
              <div className="panel-heading"><div><p className="eyebrow">NEXT BEST SESSION</p><h2>Fit the work to the day.</h2></div><Sparkles className="signal-icon" /></div>
              <div className="planner-controls">
                <fieldset><legend>Time available</legend><div className="duration-group">{['25', '40', '60'].map((option) => <button key={option} type="button" aria-pressed={duration === option} onClick={() => setDuration(option)}>{option} min</button>)}</div></fieldset>
                <div className="focus-field"><span>Focus</span><Select value={focus} onValueChange={(value) => value && setFocus(value)}><SelectTrigger aria-label="Workout focus"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="upper">Upper body</SelectItem><SelectItem value="full">Full body</SelectItem></SelectContent></Select></div>
              </div>
              <div className="plan-list">{plan.map((exercise, index) => <div className="plan-row" key={exercise.name}><span className="plan-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{exercise.name}</strong><small>{exercise.muscle} · {exercise.note}</small></div><span className="prescription">{exercise.sets} × {exercise.reps ?? '6–12'}{exercise.weightKg ? ` @ ${weight(exercise.weightKg, unit)}` : ''}</span></div>)}</div>
              <div className="planner-actions"><Button onClick={() => { setView('coach'); setChatInput(`Build me a ${duration}-minute ${focus} session based on what I have trained this week.`); }}>Ask coach to refine <ArrowRight /></Button><span>Draft only. Nothing is written to Hevy.</span></div>
            </article>

            <article className="review-panel">
              <div className="panel-heading compact"><div><p className="eyebrow">WEEKLY REVIEW / {data.weeklyReview.label}</p><h2>The coach’s read</h2></div><Medal /></div>
              <div className="review-sections">
                <div><span className="review-label good"><Check /> Wins</span>{data.weeklyReview.wins.map((item) => <p key={item}>{item}</p>)}</div>
                <div><span className="review-label warn"><CircleAlert /> Watch</span>{data.weeklyReview.watch.map((item) => <p key={item}>{item}</p>)}</div>
                <div><span className="review-label"><Target /> Next week</span>{data.weeklyReview.nextSteps.map((item) => <p key={item}>{item}</p>)}</div>
              </div>
            </article>
          </section>

          <section className="metrics-grid" aria-label="Training summary">
            <StatCard label="Sessions / 30d" value={String(data.stats.sessions30d)} detail={`${data.stats.activeWeeks}/8 recent weeks active`} icon={CalendarDays} />
            <StatCard label="Load-volume / 30d" value={volume(data.stats.totalVolume30dKg, unit)} detail={`${delta(data.stats.volumeChangePercent)} week over week`} icon={TrendingUp} />
            <StatCard label="Average session" value={`${data.stats.avgSessionMinutes} min`} detail={`${data.stats.hours30d} hours total`} icon={Clock3} />
            <StatCard label="Training consistency" value={`${data.stats.consistencyPercent}%`} detail="Active weeks in the last eight" icon={Flame} />
          </section>

          <section className="today-lower-grid">
            <article className="workload-panel"><div className="panel-heading compact"><div><p className="eyebrow">8-WEEK LOAD-VOLUME</p><h2>Work performed</h2></div><StatusPill tone={data.stats.volumeChangePercent >= 0 ? 'good' : 'warn'}>{delta(data.stats.volumeChangePercent)}</StatusPill></div><div className="chart-large"><ResponsiveContainer width="100%" height="100%"><BarChart data={workload}><CartesianGrid vertical={false} stroke="var(--line)" /><XAxis dataKey="label" tickLine={false} axisLine={false} /><YAxis hide /><Tooltip formatter={(value) => [`${Number(value).toLocaleString()} ${unit}`, 'Load-volume']} cursor={{ fill: 'rgba(17,21,15,.04)' }} /><Bar dataKey="displayVolume" fill="var(--panel-dark)" radius={[5,5,0,0]} /></BarChart></ResponsiveContainer></div></article>
            <article className="history-panel"><div className="panel-heading compact"><div><p className="eyebrow">RECENT LOG</p><h2>Workout history</h2></div><CalendarDays /></div><div className="history-list">{data.recentWorkouts.slice(0, 5).map((workout) => <div key={`${workout.title}-${workout.date}`}><span className="history-date">{workout.date}</span><div><strong>{workout.title}</strong><small>{workout.workingSets} sets · {volume(workout.volumeKg, unit)}</small></div><span className="history-duration"><Clock3 />{workout.duration}</span></div>)}</div></article>
          </section>
        </>}

        {view === 'progress' && <>
          <section className="metrics-grid progress-metrics">
            <StatCard label="Working sets / 7d" value={String(data.stats.workingSets7d)} detail="Warm-ups excluded" icon={Gauge} />
            <StatCard label="Primary lift trend" value={delta(selectedStrength?.change ?? data.trend.change)} detail={selectedStrength?.exercise ?? data.trend.exercise} icon={TrendingUp} />
            <StatCard label="Recent estimated PRs" value={String(data.records.length)} detail="Best e1RM in the last 30 days" icon={Trophy} />
            <StatCard label="Training frequency" value={`${data.stats.sessions30d / 4.3 >= 1 ? (data.stats.sessions30d / 4.3).toFixed(1) : data.stats.sessions30d}×`} detail="Average sessions per week" icon={Activity} />
          </section>
          <section className="progress-grid">
            <article className="trend-panel wide">
              <div className="panel-heading compact"><div><p className="eyebrow">ESTIMATED STRENGTH</p><h2>{selectedStrength?.exercise ?? data.trend.exercise}</h2></div><Select value={selectedTrend} onValueChange={(value) => value && setSelectedTrend(value)}><SelectTrigger className="exercise-picker"><SelectValue /></SelectTrigger><SelectContent>{data.strengthTrends.map((item) => <SelectItem key={item.exercise} value={item.exercise}>{item.exercise}</SelectItem>)}</SelectContent></Select></div>
              <div className="chart-large strength-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={displayTrend}><defs><linearGradient id="strengthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--signal)" stopOpacity={0.6}/><stop offset="100%" stopColor="var(--signal)" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--line)" /><XAxis dataKey="label" tickLine={false} axisLine={false}/><YAxis domain={['dataMin - 2', 'dataMax + 2']} hide/><Tooltip formatter={(value) => [`${Number(value).toFixed(1)} ${unit}`, 'Estimated 1RM']} /><Area type="monotone" dataKey="displayValue" stroke="var(--signal-deep)" strokeWidth={3} fill="url(#strengthFill)" /></AreaChart></ResponsiveContainer></div>
              <p className="chart-note">Epley estimate from sets of 15 reps or fewer. Use the direction as a signal, not the decimal as a tested max.</p>
            </article>
            <article className="pr-panel"><div className="panel-heading compact"><div><p className="eyebrow">RECENT SIGNALS</p><h2>Estimated PR board</h2></div><Trophy /></div>{data.records.length ? <div className="record-list">{data.records.map((record, index) => <div key={record.exercise}><span>{index + 1}</span><div><strong>{record.exercise}</strong><small>{record.weightKg ? `${weight(record.weightKg, unit)} × ${record.reps}` : record.date}</small></div><b>{weight(record.valueKg, unit)} e1RM</b></div>)}</div> : <EmptyMessage title="No recent PR signal" body="Repeat comparable weighted sets to establish a trend." />}</article>
          </section>
          <section className="distribution-grid">
            <article className="muscle-panel"><div className="panel-heading compact"><div><p className="eyebrow">MUSCLE DISTRIBUTION / 7D</p><h2>Direct working sets</h2></div><Gauge /></div><div className="muscle-bars">{data.muscles.map((muscle) => <div className="muscle-row" key={muscle.name}><div><span>{muscle.name}</span><span><strong>{muscle.sets}</strong><small>{muscle.sets - muscle.previousSets >= 0 ? '+' : ''}{muscle.sets - muscle.previousSets} vs prior</small></span></div><div className="bar-track"><span style={{ width: `${Math.max(5, muscle.sets / maxMuscleSets * 100)}%` }} /></div></div>)}</div></article>
            <article className="exercise-table-panel"><div className="panel-heading compact"><div><p className="eyebrow">MOVEMENT LEDGER</p><h2>Exercise performance</h2></div><Dumbbell /></div><div className="table-scroll"><table><thead><tr><th>Exercise</th><th>Sessions</th><th>Sets</th><th>Volume</th><th>Best e1RM</th><th>Trend</th></tr></thead><tbody>{data.exerciseStats.map((exercise) => <tr key={exercise.exercise}><td><strong>{exercise.exercise}</strong><small>{exercise.muscle}</small></td><td>{exercise.sessions}</td><td>{exercise.workingSets}</td><td>{volume(exercise.volumeKg, unit)}</td><td>{exercise.bestE1rmKg ? weight(exercise.bestE1rmKg, unit) : '—'}</td><td><StatusPill tone={exercise.change > 1 ? 'good' : exercise.change < -1 ? 'warn' : 'neutral'}>{delta(exercise.change)}</StatusPill></td></tr>)}</tbody></table></div></article>
          </section>
        </>}

        {view === 'coach' && <section className="chat-workspace">
          <aside className="chat-sidebar"><Button className="new-chat" onClick={createChat}><Plus /> New chat</Button><div className="chat-history-label">Recent chats</div><div className="conversation-list">{conversations.map((conversation) => <div className={activeConversation === conversation.id ? 'conversation-row active' : 'conversation-row'} key={conversation.id}><button type="button" onClick={() => openChat(conversation.id)}><strong>{conversation.title}</strong><small>{conversation.preview || 'No messages yet'}</small></button><button type="button" className="delete-chat" onClick={() => deleteChat(conversation.id)} aria-label={`Delete ${conversation.title}`}><Trash2 /></button></div>)}{!conversations.length && <p className="no-history">Your private coaching conversations will appear here.</p>}</div><div className="coach-identity"><span>R</span><div><strong>Rowan</strong><small>Strength & physique coach</small></div></div></aside>
          <div className="chat-stage">
            <div className="chat-messages">{messages.length ? messages.map((message) => <article key={message.id} className={`message ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? 'R' : profile.displayName.slice(0,1).toUpperCase()}</div><div><div className="message-meta"><strong>{message.role === 'assistant' ? 'Coach Rowan' : 'You'}</strong>{message.model && <span>{message.model}</span>}</div><p>{message.content}</p></div></article>) : <div className="coach-welcome"><div className="coach-monogram">R</div><p className="eyebrow">PRIVATE COACH / HEVY-GROUNDED</p><h2>What are we solving today?</h2><p>Rowan reads your profile, recent sessions, workload, and strength trends before answering.</p><div className="starter-grid">{STARTERS.map((starter) => <button type="button" key={starter} onClick={() => setChatInput(starter)}>{starter}<ChevronRight /></button>)}</div></div>}{chatBusy && <article className="message assistant"><div className="message-avatar">R</div><div><div className="message-meta"><strong>Coach Rowan</strong><span>reviewing your data</span></div><div className="thinking"><i/><i/><i/></div></div></article>}<div ref={chatEnd}/></div>
            <form className="chat-composer" onSubmit={sendMessage}><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about a lift, plan, plateau, or this week…" rows={2} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} /><button type="submit" disabled={!chatInput.trim() || chatBusy} aria-label="Send message"><Send /></button><small>Grounded in Hevy and your athlete profile. Informational—not medical advice.</small>{chatError && <p className="form-error">{chatError}</p>}</form>
          </div>
        </section>}

        {view === 'program' && <section className="program-layout">
          <aside className="program-builder"><div><p className="eyebrow">PROGRAM BUILDER</p><h2>Turn constraints into a block.</h2><p className="section-copy">The coach uses your goals, availability, profile, and and familiar Hevy movements.</p></div><form onSubmit={generateProgram}><label><span>Primary outcome</span><textarea rows={3} value={programForm.goal} onChange={(event) => setProgramForm({ ...programForm, goal: event.target.value })} /></label><div className="form-pair"><label><span>Duration</span><select value={programForm.durationWeeks} onChange={(event) => setProgramForm({ ...programForm, durationWeeks: Number(event.target.value) })}>{[4,6,8,10,12,16].map((value) => <option value={value} key={value}>{value} weeks</option>)}</select></label><label><span>Days / week</span><select value={programForm.daysPerWeek} onChange={(event) => setProgramForm({ ...programForm, daysPerWeek: Number(event.target.value) })}>{[2,3,4,5,6].map((value) => <option value={value} key={value}>{value} days</option>)}</select></label></div><label><span>Session length</span><select value={programForm.minutesPerSession} onChange={(event) => setProgramForm({ ...programForm, minutesPerSession: Number(event.target.value) })}>{[30,40,45,60,75,90].map((value) => <option value={value} key={value}>{value} minutes</option>)}</select></label><label><span>Block-specific notes</span><textarea rows={4} placeholder="Priority muscles, exercises to include or avoid, schedule constraints…" value={programForm.preferences} onChange={(event) => setProgramForm({ ...programForm, preferences: event.target.value })}/></label><Button type="submit" disabled={programBusy}>{programBusy ? 'Building your block…' : 'Generate program'} <Sparkles /></Button>{programError && <p className="form-error">{programError}</p>}</form><div className="saved-programs"><span>Saved programs</span>{programs.map((program) => <button type="button" key={program.id} onClick={() => setActiveProgram(program)} className={activeProgram?.id === program.id ? 'active' : ''}><strong>{program.title}</strong><small>{program.daysPerWeek} days · {program.durationWeeks} weeks</small></button>)}</div></aside>
          <div className="program-document">{activeProgram ? <><header><div><p className="eyebrow">ACTIVE DRAFT / {activeProgram.durationWeeks} WEEKS</p><h2>{activeProgram.title}</h2><p>{activeProgram.overview}</p></div><StatusPill>{activeProgram.daysPerWeek} days · {activeProgram.minutesPerSession} min</StatusPill></header><div className="program-principles"><div><span>Progression</span><p>{activeProgram.progression}</p></div><div><span>Deload</span><p>{activeProgram.deload}</p></div></div><div className="training-days">{activeProgram.days.map((day) => <article key={`${activeProgram.id}-${day.day}`}><div className="day-heading"><span>DAY {String(day.day).padStart(2,'0')}</span><div><h3>{day.title}</h3><p>{day.focus}</p></div></div><div className="day-exercises">{day.exercises.map((exercise, index) => <div key={`${exercise.name}-${index}`}><span>{index + 1}</span><div><strong>{exercise.name}</strong><small>{exercise.note}</small></div><b>{exercise.sets} × {exercise.reps}</b><em>{exercise.effort} · {exercise.restSeconds}s</em></div>)}</div></article>)}</div><p className="draft-note">This is a planning draft. Review exercise suitability and technique before training; nothing has been written to Hevy.</p></> : <EmptyMessage title="No program yet" body="Set the block constraints and generate your first tailored program." />}</div>
        </section>}

        {view === 'profile' && <section className="profile-layout">
          <article className="profile-intro"><p className="eyebrow">COACHING CONTEXT</p><h2>Enough biology to personalize. Nothing ornamental.</h2><p>The coach uses these details to adjust exercise selection, recovery expectations, weekly structure, and practical recommendations. Biological sex is optional and never used as a shortcut for ability.</p><div className="profile-summary"><div><span>Primary goal</span><strong>{profile.primaryGoal}</strong></div><div><span>Training structure</span><strong>{profile.daysPerWeek} days · {profile.minutesPerSession} min</strong></div><div><span>Experience</span><strong>{profile.experience}</strong></div></div></article>
          <form className="profile-form" onSubmit={saveAthlete}><div className="form-section"><div><span>01</span><h3>Basics</h3></div><div className="form-grid"><label><span>Name</span><input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}/></label><label><span>Biological sex <small>optional</small></span><select value={profile.biologicalSex} onChange={(event) => setProfile({ ...profile, biologicalSex: event.target.value })}><option value="prefer_not_to_say">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="intersex">Intersex</option></select></label><label><span>Age</span><input type="number" min="13" max="100" value={profile.age ?? ''} onChange={(event) => setProfile({ ...profile, age: event.target.value ? Number(event.target.value) : null })}/></label><label><span>Height (cm)</span><input type="number" min="100" max="250" value={profile.heightCm ?? ''} onChange={(event) => setProfile({ ...profile, heightCm: event.target.value ? Number(event.target.value) : null })}/></label><label><span>Body weight ({unit})</span><input type="number" min="30" step="0.1" value={profile.weightKg ? Math.round(toDisplayKg(profile.weightKg, unit) * 10) / 10 : ''} onChange={(event) => setProfile({ ...profile, weightKg: event.target.value ? Number(event.target.value) / (unit === 'lb' ? 2.20462 : 1) : null })}/></label><label><span>Experience</span><select value={profile.experience} onChange={(event) => setProfile({ ...profile, experience: event.target.value })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label></div></div><div className="form-section"><div><span>02</span><h3>Outcome & schedule</h3></div><div className="form-grid"><label className="span-two"><span>Primary goal</span><textarea rows={3} value={profile.primaryGoal} onChange={(event) => setProfile({ ...profile, primaryGoal: event.target.value })}/></label><label><span>Target date</span><input type="date" value={profile.targetDate} onChange={(event) => setProfile({ ...profile, targetDate: event.target.value })}/></label><label><span>Days / week</span><input type="number" min="1" max="7" value={profile.daysPerWeek} onChange={(event) => setProfile({ ...profile, daysPerWeek: Number(event.target.value) })}/></label><label><span>Minutes / session</span><input type="number" min="20" max="180" value={profile.minutesPerSession} onChange={(event) => setProfile({ ...profile, minutesPerSession: Number(event.target.value) })}/></label><label><span>Equipment</span><input value={profile.equipment} onChange={(event) => setProfile({ ...profile, equipment: event.target.value })}/></label></div></div><div className="form-section"><div><span>03</span><h3>Constraints</h3></div><div className="form-grid"><label className="span-two"><span>Limitations or injuries</span><textarea rows={4} placeholder="Only include what is useful for training decisions." value={profile.limitations} onChange={(event) => setProfile({ ...profile, limitations: event.target.value })}/></label><label className="span-two"><span>Preferences</span><textarea rows={4} placeholder="Movements you enjoy, avoid, or want to prioritize." value={profile.preferences} onChange={(event) => setProfile({ ...profile, preferences: event.target.value })}/></label></div></div><div className="form-actions"><Button type="submit">{profileState}</Button><span>Stored in your private Hevy Coach workspace.</span></div></form>
        </section>}

        <footer><span>HEVY COACH / PRIVATE WORKSPACE</span><span>Evidence first. AI second. You approve every write.</span></footer>
      </main>
    </div>
  );
}
