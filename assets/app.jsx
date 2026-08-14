/* Astra — 퀀트 펀드 사이트 (React + Tailwind + Recharts + Lucide).
 *
 * 구조: 운용 개요(홈) / 성과 대시보드[보유종목·수익률·배당금·분석] / 투자 철학.
 * 해시 라우팅이라 GitHub Pages에서 404 없이 딥링크가 되고 nav 마크업이 한 벌만 있으면 된다.
 *
 * 빌드 스텝이 없다 — React·Recharts·Lucide·Tailwind를 전부 CDN UMD로 받고 이 파일은
 * Babel standalone이 브라우저에서 컴파일한다. sync.sh가 정적 파일을 그대로 복사하는
 * 배포 경로를 지키기 위한 선택이고, 대가는 초기 로딩 한 박자다.
 *
 * 데이터에서 뺀 것(전부 사용자 확인):
 *   금액·수량 → 지수·%    공개 웹이라 계좌 잔고가 노출된다. 내보내기 단계에서 뺀다.
 *                          그래서 'AUM' 자리에는 누적 지수(시작=100)가 들어간다.
 *   IRR → CAGR             입출금 기록이 없어 IRR은 계산 불가. 값과 라벨을 일치시켰다.
 *   적정가치(DCF)·목표주가·선행PER·이익성장·지역별 매출·라이브 뉴스 → 소스가 없다
 *   스노우플레이크 '미래' 축 → 실적 전망 컨센서스 없음. 나머지 4축은 원본 이름 그대로
 *   실시간 시세 → 티커 바는 스냅샷 종가다. 라벨에 '종가'라고 박아 실시간인 척 안 한다.
 */
const { useState, useEffect, useMemo, useCallback } = React;
const RC = window.Recharts || {};
const LR = window.LucideReact || {};

/** Lucide UMD가 못 올라와도 페이지는 살아야 한다 — 아이콘만 조용히 빠진다. */
const Icon = ({ name, className = 'w-4 h-4', ...rest }) => {
  const C = LR[name];
  return C ? <C className={className} {...rest} /> : null;
};

// ── 포맷 ────────────────────────────────────────────────────────────
const nf = (v, d = 2) => (v == null || Number.isNaN(v) ? '—'
  : v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%`);
const upct = (v, d = 1) => (v == null ? '—' : `${nf(Math.abs(v), d)}%`);
const pp = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%p`);
const usd = (v) => (v == null ? '—' : `US$${nf(v, 2)}`);
const day = (ts) => (ts ? String(ts).slice(0, 10) : '—');
const held = (ts) => {
  if (!ts) return null;
  const d = (Date.now() - Date.parse(ts)) / 86400000;
  return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : null;
};
/** 부호 → 색 클래스. 0과 null은 무채색이라 '오르지도 내리지도 않음'이 보인다. */
const sc = (v) => (v == null || v === 0 ? 'text-slate-300' : v > 0 ? 'text-up' : 'text-down');

const UP = '#34D399';
const DOWN = '#E5705F';
const GOLD = '#C8A96A';
const GRID = '#152046';
const AXIS = '#64748B';
const PALETTE = [GOLD, '#34D399', '#5B8DEF', '#D9BE7E', '#2DD4BF', '#8B9DC3',
  '#A98A4C', '#6EE7B7', '#3B5BA5', '#E5D2A3', '#94A3B8', '#1B2C5E'];

// ── 데이터 ──────────────────────────────────────────────────────────
async function loadAll(dir) {
  const out = {};
  await Promise.all(['summary', 'equity', 'positions', 'trades'].map(async (n) => {
    try {
      const r = await fetch(`${dir}/${n}.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      out[n] = await r.json();
    } catch (e) {
      // 조용히 넘기면 절이 통째로 비어도 '정상'으로 보인다 — NaN 리터럴 하나에
      // positions.json이 버려져 보유 종목이 0으로 뜬 적이 있다.
      console.error(`[Astra] ${dir}/${n}.json 로드 실패:`, e.message);
      out[n] = null;
    }
  }));
  return out;
}

// ── 원시 UI ─────────────────────────────────────────────────────────
const GLASS = 'rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-xl shadow-glass';

const Card = ({ children, className = '' }) => (
  <section className={`${GLASS} p-5 sm:p-6 ${className}`}>{children}</section>
);

const CardHead = ({ title, count, right }) => (
  <header className="mb-4 flex flex-wrap items-center gap-3">
    <h3 className="font-serif text-[15px] font-semibold tracking-tight text-slate-100">
      {title}
      {count != null && <span className="ml-2 font-mono text-xs text-slate-500">{count}</span>}
    </h3>
    {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
  </header>
);

const Empty = ({ title, sub }) => (
  <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
    <div className="text-sm text-slate-400">{title}</div>
    {sub && <div className="text-xs text-slate-600">{sub}</div>}
  </div>
);

const EmptyCard = ({ title, msg, sub }) => (
  <Card><CardHead title={title} /><Empty title={msg} sub={sub} /></Card>
);

const Kpi = ({ label, value, sub, tone }) => (
  <div className={`${GLASS} relative overflow-hidden p-5`}>
    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/40 to-transparent" />
    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className={`mt-2 font-mono text-2xl font-semibold tabular-nums sm:text-[26px] ${tone || 'text-slate-100'}`}>
      {value}
    </div>
    {sub && <div className="mt-1 text-[11px] text-slate-600">{sub}</div>}
  </div>
);

const KpiRow = ({ items }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {items.map((k, i) => <Kpi key={i} {...k} />)}
  </div>
);

/** 세그먼트 버튼. 기간 선택·서브탭에 공용으로 쓴다. */
const Seg = ({ items, value, onChange }) => (
  <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-navy-950/60 p-1">
    {items.map(([id, label]) => (
      <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={id === value}
        className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition ${id === value
          ? 'bg-gold-500/15 text-gold-300 shadow-inset-hair'
          : 'text-slate-500 hover:text-slate-300'}`}>
        {label}
      </button>
    ))}
  </div>
);

const CsvButton = ({ name, cols, rows, pick }) => {
  const download = useCallback(() => {
    const body = rows.map((r) => pick(r).map((v) => (v == null ? '' : v)).join(',')).join('\n');
    const url = URL.createObjectURL(
      new Blob(['﻿' + cols.join(',') + '\n' + body], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `astra_${name}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [name, cols, rows, pick]);
  if (!rows.length) return null;
  return (
    <button type="button" onClick={download}
      className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-slate-400 transition hover:border-gold-500/40 hover:text-gold-300">
      <Icon name="Download" className="h-3 w-3" />CSV
    </button>
  );
};

/** 표. 첫 열만 좌측 정렬하고 나머지는 숫자라 우측 정렬 + tabular-nums. */
const Table = ({ cols, rows, render, minWidth = 560 }) => (
  <div className="thin-scroll -mx-1 overflow-x-auto px-1">
    <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
      <thead>
        <tr className="border-b border-white/10">
          {cols.map((c, i) => (
            <th key={i} className={`whitespace-nowrap px-2 py-2 text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500 ${i ? 'text-right' : 'text-left'}`}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-white/5 transition hover:bg-white/[0.03]">{render(r)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Td = ({ children, num, className = '' }) => (
  <td className={`whitespace-nowrap px-2 py-2.5 align-middle ${num ? 'text-right font-mono tabular-nums' : 'text-left'} ${className}`}>
    {children}
  </td>
);

const Tag = ({ children, tone = 'neutral' }) => (
  <span className={`inline-block max-w-[190px] truncate rounded-md px-2 py-0.5 text-[11px] ${tone === 'accent'
    ? 'bg-up/10 text-up' : 'bg-white/5 text-slate-400'}`}>
    {children}
  </span>
);

const Notice = ({ generatedAt }) => (
  <div className="flex flex-wrap items-start gap-2 rounded-xl border border-gold-500/25 bg-gold-500/[0.06] px-4 py-3 text-[12px] leading-relaxed text-gold-300/90">
    <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
    <p className="flex-1">
      <b className="font-semibold">개인 포트폴리오 안내</b> — 1인이 운영하는 개인 계좌의 자동매매
      기록이다. 투자 권유가 아니며 투자 판단과 책임은 본인에게 있다.
      수량·평가금액·수수료는 공개하지 않는다(총자산은 시작=100 지수).
      <span className="ml-1 font-mono text-[11px] text-slate-500">· 갱신 {generatedAt || '—'}</span>
    </p>
  </div>
);

/** 본문 2단. 좁은 화면에선 한 단으로 접힌다. */
const Split = ({ left, right }) => (
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
    <div className="flex flex-col gap-4">{left}</div>
    <div className="flex flex-col gap-4">{right}</div>
  </div>
);

const Section = ({ children, className = '' }) => (
  <section className={`mx-auto w-full max-w-[1180px] px-4 sm:px-6 ${className}`}>{children}</section>
);

// ── 차트 ────────────────────────────────────────────────────────────
const TIP = {
  contentStyle: {
    background: 'rgba(7,13,31,.94)', border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 10, fontSize: 12, boxShadow: '0 8px 28px rgba(0,0,0,.5)',
  },
  labelStyle: { color: '#94A3B8', fontSize: 11 },
  itemStyle: { fontFamily: 'JetBrains Mono, monospace', color: '#E2E8F0' },
};

const RANGES = [['1M', 30], ['3M', 91], ['YTD', null], ['1Y', 365], ['ALL', Infinity]];
const RANGE_LABELS = [['1M', '1M'], ['3M', '3M'], ['YTD', 'YTD'], ['1Y', '1Y'], ['ALL', '전체']];

const clip = (pts, days) => {
  if (!pts || !pts.length) return [];
  if (days === Infinity) return pts;
  const end = Date.parse(pts[pts.length - 1].ts);
  const from = days == null
    ? Date.parse(`${new Date(end).getUTCFullYear()}-01-01T00:00:00Z`)
    : end - days * 86400000;
  return pts.filter((p) => Date.parse(p.ts) >= from);
};
const rebase = (pts) => {
  const hit = pts && pts.find((p) => p.index > 0);
  return hit ? pts.map((p) => ({ ts: p.ts, index: (p.index / hit.index) * 100 })) : [];
};

/**
 * 전략 곡선 + 벤치마크. 벤치마크는 같은 창으로 자른 뒤 그 구간 시작=100으로 다시
 * 정규화한다 — 전체 기간 지수를 그대로 얹으면 1M 창에서 두 선의 출발점이 어긋난다.
 */
function EquityChart({ data, range, height = 300 }) {
  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ReferenceLine } = RC;
  const series = (data.equity?.series || [])[0];
  const bm = (data.equity?.benchmarks || [])[0];
  const days = (RANGES.find((r) => r[0] === range) || RANGES[4])[1];

  const rows = useMemo(() => {
    const s = rebase(clip(series?.points, days));
    if (s.length < 2) return [];
    const b = rebase(clip(bm?.points, days));
    const bmap = new Map(b.map((p) => [p.ts, p.index]));
    return s.map((p) => ({
      ts: day(p.ts),
      strategy: +p.index.toFixed(3),
      benchmark: bmap.has(p.ts) ? +bmap.get(p.ts).toFixed(3) : null,
    }));
  }, [series, bm, days]);

  if (rows.length < 2) {
    return <Empty title="아직 그릴 곡선이 없어요" sub="스냅샷이 2개 이상 쌓이면 표시됩니다." />;
  }
  const last = rows[rows.length - 1].strategy;
  const hasBm = rows.some((r) => r.benchmark != null);
  return (
    <>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
        <span className="flex items-center gap-1.5 text-slate-400">
          <i className="h-0.5 w-4 rounded-full bg-gold-400" />전략 {series.strategy || ''}
        </span>
        {hasBm && (
          <span className="flex items-center gap-1.5 text-slate-500">
            <i className="h-0.5 w-4 rounded-full bg-slate-500" />{bm?.name || '벤치마크'}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id="strokeGold" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#A98A4C" />
              <stop offset="100%" stopColor="#E5D2A3" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="ts" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false}
            axisLine={{ stroke: GRID }} minTickGap={40} />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false}
            domain={['auto', 'auto']} width={48} tickFormatter={(v) => nf(v, 0)} />
          <ReferenceLine y={100} stroke={GRID} strokeDasharray="3 3" />
          <Tooltip {...TIP}
            formatter={(v, n) => [nf(v, 2), n === 'strategy' ? '전략' : (bm?.name || '벤치마크')]} />
          {hasBm && (
            <Line type="monotone" dataKey="benchmark" stroke="#64748B" strokeWidth={1.4}
              strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
          )}
          <Line type="monotone" dataKey="strategy" stroke="url(#strokeGold)" strokeWidth={2.2}
            dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
        <span>현재 지수 <b className="text-gold-300">{nf(last, 1)}</b></span>
        <span className="ml-auto">{rows[0].ts} → {rows[rows.length - 1].ts}</span>
      </div>
    </>
  );
}

function EquityCard({ data, height }) {
  const [range, setRange] = useState('ALL');
  return (
    <Card>
      <CardHead title="기간별 평가금액 (시작=100)"
        right={<Seg items={RANGE_LABELS} value={range} onChange={setRange} />} />
      <EquityChart data={data} range={range} height={height} />
    </Card>
  );
}

/** 도넛 + 범례. 비중 합이 100이 아닐 수 있어(현금·반올림) 정규화하지 않고 그대로 그린다. */
function Donut({ rows, dataKey, nameKey, height = 208 }) {
  const { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } = RC;
  if (!rows || !rows.length) return <Empty title="데이터 없음" />;
  const items = rows.map((r) => ({ name: r[nameKey] ?? '—', value: Math.abs(r[dataKey] || 0) }));
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="w-full shrink-0 sm:w-[190px]">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="94%"
              paddingAngle={1.5} stroke="#070D1F" strokeWidth={1.5} isAnimationActive={false}>
              {items.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...TIP} formatter={(v) => `${nf(v, 1)}%`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex w-full min-w-0 flex-1 flex-col gap-1.5">
        {rows.slice(0, 8).map((r, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <i className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-slate-400">{r[nameKey] ?? '—'}</span>
            <b className="font-mono tabular-nums text-slate-200">{upct(r[dataKey])}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 팩터 프로필 레이더. 원본의 스노우플레이크에서 '미래' 축만 빠진 4축이다. */
function RadarProfile({ data, height = 240 }) {
  const { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
    ResponsiveContainer, Tooltip } = RC;
  const axes = (data.positions?.factors?.axes || []).filter((a) => a.portfolio != null);
  const n = axes[0]?.universe_n;
  if (axes.length < 3) {
    return <div className="text-[12px] text-slate-500">재무 데이터가 모이면 표시됩니다.</div>;
  }
  const rows = axes.map((a) => ({ axis: `${a.axis} ${Math.round(a.portfolio)}`, value: a.portfolio }));
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={rows} outerRadius="72%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: '#94A3B8', fontSize: 10.5 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip {...TIP} formatter={(v) => nf(v, 0)} />
          <Radar dataKey="value" stroke={GOLD} strokeWidth={2} fill={GOLD} fillOpacity={0.22}
            isAnimationActive={false} />
        </RadarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        <b className="text-slate-300">S&amp;P500 유니버스{n ? ` ${n}종목` : ''} 안에서의</b> 비중가중
        백분위(0~100). 50이면 시장 중간, 높을수록 그 팩터에 기울어 있다. 원본의{' '}
        <b className="text-slate-300">미래</b> 축은 실적 전망 데이터가 없어 제외했다.
      </p>
    </>
  );
}

/** 라벨 + 값 + 막대. 종목 리스트라 세로 막대보다 이 형태가 읽힌다. */
function BarList({ rows, dataKey, nameKey, signed, d = 1 }) {
  if (!rows || !rows.length) return <div className="text-[12px] text-slate-500">데이터 없음</div>;
  const max = Math.max(...rows.map((r) => Math.abs(r[dataKey] ?? 0)), 1e-9);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const v = r[dataKey] ?? 0;
        return (
          <li key={i} className="grid grid-cols-[64px_66px_1fr] items-center gap-2 text-[12px]">
            <span className="truncate font-mono text-slate-300">{r[nameKey] ?? '—'}</span>
            <span className={`text-right font-mono tabular-nums ${signed ? sc(v) : 'text-slate-400'}`}>
              {signed ? pct(v, d) : upct(v, d)}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <span className="block h-full rounded-full" style={{
                width: `${(Math.abs(v) / max) * 100}%`,
                background: signed ? (v >= 0 ? UP : DOWN) : GOLD,
              }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 배당 지급 내역 세로 막대(월별/연도별). */
function Columns({ rows, dataKey, nameKey, height = 200 }) {
  const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = RC;
  if (!rows || !rows.length) return <Empty title="데이터 없음" />;
  const items = rows.map((r) => ({ k: String(r[nameKey]).slice(-5), v: r[dataKey] || 0 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={items} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="k" tick={{ fill: AXIS, fontSize: 9.5 }} tickLine={false}
          axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false}
          width={44} tickFormatter={(v) => nf(v, 2)} />
        <Tooltip {...TIP} cursor={{ fill: 'rgba(255,255,255,.04)' }}
          formatter={(v) => [`${nf(v, 3)}%`, '비중가중 기여']} />
        <Bar dataKey="v" fill={GOLD} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * 수익 구성 워터폴. 기여도를 누적해 최종 수익률에 도달한다. Recharts에는 워터폴이
 * 없어서 투명한 받침 막대(base)를 깔고 그 위에 증분(delta)을 쌓는 표준 수법을 쓴다.
 */
function Waterfall({ contrib, height = 220 }) {
  const { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine } = RC;
  const rows = (contrib || []).filter((c) => c.contribution_pct != null)
    .sort((a, b) => b.contribution_pct - a.contribution_pct);
  if (!rows.length) return <Empty title="데이터 없음" />;

  let cum = 0;
  const steps = rows.map((r) => {
    const from = cum; cum += r.contribution_pct;
    return {
      sym: r.symbol, base: Math.min(from, cum), delta: Math.abs(r.contribution_pct),
      v: r.contribution_pct, total: false,
    };
  });
  steps.push({ sym: '합계', base: Math.min(0, cum), delta: Math.abs(cum), v: cum, total: true });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={steps} margin={{ top: 6, right: 6, bottom: 12, left: -16 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="sym" tick={{ fill: AXIS, fontSize: 9.5 }} tickLine={false}
          axisLine={{ stroke: GRID }} interval={0} angle={-45} textAnchor="end" height={44} />
        <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false}
          width={44} tickFormatter={(v) => nf(v, 1)} />
        <ReferenceLine y={0} stroke="#2A3E7A" />
        <Tooltip {...TIP} cursor={{ fill: 'rgba(255,255,255,.04)' }}
          formatter={(v, n, p) => [pct(p.payload.v), p.payload.total ? '누적 합계' : '기여도']} />
        <Bar dataKey="base" stackId="w" fill="transparent" tooltipType="none" isAnimationActive={false} />
        <Bar dataKey="delta" stackId="w" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {steps.map((s, i) => (
            <Cell key={i} fill={s.total ? GOLD : (s.v >= 0 ? UP : DOWN)}
              fillOpacity={s.total ? 1 : 0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── 셸: 티커 바 / 내비 ──────────────────────────────────────────────
/**
 * 오버뷰 티커. 실시간 시세 소스가 없다 — 스냅샷의 벤치마크 종가와 보유 종목 일간
 * 수익률을 흘린다. '종가 기준'을 박아 실시간인 척하지 않는다.
 */
function TickerBar({ data }) {
  const items = useMemo(() => {
    const out = [];
    (data.equity?.benchmarks || []).forEach((b) => {
      const pts = b.points || [];
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      if (!last) return;
      const chg = prev && prev.index ? ((last.index / prev.index) - 1) * 100 : null;
      out.push({ k: b.name || 'BENCHMARK', v: nf(last.index, 2), chg });
    });
    (data.positions?.rows || []).forEach((r) => {
      out.push({ k: r.symbol, v: nf(r.price, 2), chg: r.day_return_pct });
    });
    return out;
  }, [data]);

  if (!items.length) return null;
  const lane = items.concat(items); // 이어붙여 -50% 이동이면 이음매 없이 순환한다
  return (
    <div className="relative overflow-hidden border-b border-white/[0.06] bg-navy-950/80">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-navy-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-navy-950 to-transparent" />
      <div className="ticker-lane flex w-max animate-ticker items-center gap-6 py-1.5">
        {lane.map((it, i) => (
          <span key={i} className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[10.5px]">
            <span className="text-slate-500">{it.k}</span>
            <span className="tabular-nums text-slate-300">{it.v}</span>
            <span className={`tabular-nums ${sc(it.chg)}`}>{pct(it.chg, 2)}</span>
          </span>
        ))}
      </div>
      <span className="pointer-events-none absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded bg-navy-950/90 px-1.5 font-mono text-[9.5px] text-slate-600">
        종가 기준
      </span>
    </div>
  );
}

const NAV = [['#/', '운용 개요'], ['#/notes', '리서치 노트'], ['#/philosophy', '투자 철학']];

function Nav({ route }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [route]);
  const active = (href) => (href === '#/' ? route === '/' : route.startsWith(href.slice(1)));
  const dashOn = route.startsWith('/dashboard');
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-navy-900/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-4 sm:px-6">
        <a href="#/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-gold-500/40 bg-gold-500/10">
            <Icon name="Compass" className="h-3.5 w-3.5 text-gold-400" />
          </span>
          <span className="font-serif text-lg font-semibold tracking-tight text-slate-100">
            Astra<span className="text-gold-500">.</span>
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.2em] text-slate-600 sm:inline">
            Quant Portfolio
          </span>
        </a>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} aria-current={active(href) ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${active(href)
                ? 'text-gold-300' : 'text-slate-400 hover:text-slate-100'}`}>
              {label}
            </a>
          ))}
          <a href="#/dashboard" aria-current={dashOn ? 'page' : undefined}
            className={`ml-2 flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition ${dashOn
              ? 'border-gold-500/60 bg-gold-500/20 text-gold-200 shadow-gold-glow'
              : 'border-gold-500/35 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20 hover:shadow-gold-glow'}`}>
            <Icon name="Activity" className="h-3.5 w-3.5" />성과 대시보드
          </a>
        </nav>

        <button type="button" onClick={() => setOpen((o) => !o)} aria-label="메뉴" aria-expanded={open}
          className="ml-auto rounded-lg border border-white/10 p-1.5 text-slate-300 md:hidden">
          <Icon name={open ? 'X' : 'Menu'} className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-white/[0.07] px-4 pb-3 pt-2 md:hidden">
          {NAV.map(([href, label]) => (
            <a key={href} href={href}
              className={`rounded-lg px-3 py-2 text-sm ${active(href)
                ? 'bg-white/5 text-gold-300' : 'text-slate-300'}`}>
              {label}
            </a>
          ))}
          <a href="#/dashboard"
            className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-500/[0.12] px-3 py-2 text-sm font-medium text-gold-300">
            <Icon name="Activity" className="h-4 w-4" />성과 대시보드
          </a>
        </nav>
      )}
    </header>
  );
}

/** 히어로 배경 — 격자 + 추상 상승 곡선. 데이터가 아니라 장식이라 값을 안 붙인다. */
const HeroBackdrop = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute inset-0 opacity-[0.45]" style={{
      backgroundImage: 'linear-gradient(rgba(43,62,122,.28) 1px, transparent 1px),'
        + 'linear-gradient(90deg, rgba(43,62,122,.28) 1px, transparent 1px)',
      backgroundSize: '56px 56px',
      maskImage: 'radial-gradient(120% 90% at 50% 0%, #000 35%, transparent 78%)',
      WebkitMaskImage: 'radial-gradient(120% 90% at 50% 0%, #000 35%, transparent 78%)',
    }} />
    <div className="absolute -top-32 left-1/2 h-80 w-[820px] -translate-x-1/2 rounded-full bg-gold-500/[0.07] blur-3xl" />
    <div className="absolute -bottom-24 right-[-10%] h-72 w-[520px] rounded-full bg-up/[0.06] blur-3xl" />
    <svg viewBox="0 0 1200 320" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-48 w-full">
      <defs>
        <linearGradient id="heroLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#A98A4C" stopOpacity="0" />
          <stop offset="45%" stopColor="#D9BE7E" stopOpacity=".85" />
          <stop offset="100%" stopColor="#34D399" stopOpacity=".9" />
        </linearGradient>
        <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C8A96A" stopOpacity=".16" />
          <stop offset="100%" stopColor="#C8A96A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0,286 C140,268 210,300 320,246 C430,192 470,236 580,186 C700,132 760,168 870,120 C980,72 1050,96 1200,34 L1200,320 L0,320 Z"
        fill="url(#heroFill)" />
      <path d="M0,286 C140,268 210,300 320,246 C430,192 470,236 580,186 C700,132 760,168 870,120 C980,72 1050,96 1200,34"
        fill="none" stroke="url(#heroLine)" strokeWidth="2" strokeDasharray="1400"
        className="animate-rise" />
    </svg>
  </div>
);

// ── 공용 카드 ───────────────────────────────────────────────────────
function PeriodsCard({ data }) {
  const rows = data.summary?.periods || [];
  if (!rows.length) return <EmptyCard title="기간별 성과" msg="스냅샷이 더 쌓이면 표시됩니다" />;
  return (
    <Card>
      <CardHead title="기간별 성과 — 시장 대비" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-white/[0.07] bg-navy-950/40 p-3 shadow-inset-hair">
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-slate-500">{r.period}</div>
            <div className={`mt-1 font-mono text-[17px] font-semibold tabular-nums ${sc(r.strategy_pct)}`}>
              {pct(r.strategy_pct, 1)}
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-slate-600">
              S&amp;P500 {pct(r.benchmark_pct, 1)}
            </div>
            <div className={`font-mono text-[11px] tabular-nums ${sc(r.excess_pp)}`}>
              {pp(r.excess_pp, 1)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-600">
        초과수익은 같은 구간을 시작=100으로 다시 맞춰 비교한 값이다.
      </p>
    </Card>
  );
}

const KV = ({ items }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
    {items.map(([k, v], i) => (
      <React.Fragment key={i}>
        <dt className="text-slate-500">{k}</dt>
        <dd className="truncate text-right font-mono text-slate-200">{v}</dd>
      </React.Fragment>
    ))}
  </dl>
);

/**
 * 실제로 운용 중인 시장의 전략 정보. registry에는 안 돌리는 시장 슬롯(KIS_MARKETS에서
 * 뺀 KR 등)이 그대로 남아 있어, Object.values()[0] 을 쓰면 US 계좌인데 7월 KR 챔피언이
 * 전략 노트에 뜬다(2026-08-14 확인). 성과가 기록된 시장을 진실로 삼는다.
 */
const stratInfo = (summary) => {
  const all = summary?.strategy || {};
  const mkt = (summary?.strategies || [])[0]?.market;
  return (mkt && all[mkt]) || Object.values(all)[0] || {};
};

function StrategyCard({ data }) {
  const info = stratInfo(data.summary);
  const items = [['챔피언', info.champion], ['알파', info.alpha], ['보유 종목 수', info.top_n],
    ['룩백', info.lookback ? `${info.lookback}일` : null], ['리밸런싱', info.rebalance],
    ['비중 배분', info.weighting], ['유니버스', info.universe_size]]
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)]);
  return (
    <Card>
      <CardHead title="전략 노트" />
      {items.length
        ? <KV items={items} />
        : <div className="text-[12px] text-slate-500">챔피언 전략이 등록되면 표시됩니다.</div>}
    </Card>
  );
}

const PRINCIPLES = [
  ['Target', '워크포워드 OOS', '폴드마다 학습 구간만 보고 후보를 고른 뒤, 손대지 않은 다음 구간에서 잰다.'],
  ['Shuffle', '무작위 대조군', '종목 수·회전율을 맞춘 무작위 선택을 이기는지 본다. 동일가중만 보면 노출 차이가 실력으로 보인다.'],
  ['TrendingUp', '시장이 기준', '무작위를 이기는 건 최소 조건이다. 진짜 질문은 S&P500을 위험조정으로 넘느냐다.'],
  ['Lock', '백테스트=라이브', '시그널 코드 해시가 다르면 주문을 내지 않는다(fail-closed).'],
  ['Receipt', '비용 반영', '수수료·세금·슬리피지를 회전율 기준으로 백테스트에 물린다.'],
];

const PrinciplesCard = () => (
  <Card>
    <CardHead title="운용 원칙" />
    <ul className="flex flex-col gap-3.5">
      {PRINCIPLES.map(([icon, k, v]) => (
        <li key={k} className="flex gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-gold-500/25 bg-gold-500/[0.08]">
            <Icon name={icon} className="h-3.5 w-3.5 text-gold-400" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-slate-100">{k}</div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{v}</p>
          </div>
        </li>
      ))}
    </ul>
  </Card>
);

/** 제목 + 설명의 반복 블록. '미표시 지표'·'읽을 때 주의'가 같은 꼴이다. */
const NoteList = ({ items, tone }) => (
  <ul className="flex flex-col gap-3.5">
    {items.map(([k, v]) => (
      <li key={k}>
        <div className={`text-[13px] font-medium ${tone === 'gold' ? 'text-gold-300' : 'text-slate-100'}`}>
          {k}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{v}</p>
      </li>
    ))}
  </ul>
);

// ══ 페이지: 운용 개요(홈) ═══════════════════════════════════════════
function PageHome({ data }) {
  const s = (data.summary?.strategies || [])[0];
  const info = stratInfo(data.summary);
  const all = (data.summary?.periods || []).find((p) => p.period === '전체');
  const rows = data.positions?.rows || [];
  const series = (data.equity?.series || [])[0];
  const pts = series?.points || [];
  const lastIndex = pts.length ? pts[pts.length - 1].index : null;
  const days = s?.start ? held(s.start) : null;

  const facts = [
    ['운용 상태', s ? '운용 중' : '대기', s ? 'text-up' : 'text-slate-400'],
    ['설정일', day(s?.start)], ['기준일', day(s?.last)],
    ['전략', info.champion || '—'], ['리밸런싱', info.rebalance || '—'],
    ['보유 종목', rows.length ? String(rows.length) : '—'],
  ];

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
        <HeroBackdrop />
        <Section className="relative py-16 sm:py-24">
          <div className="flex items-center gap-2">
            <span className="h-px w-8 bg-gold-500/60" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-gold-500">
              Astra Quant Portfolio
            </span>
          </div>
          <h1 className="mt-5 max-w-3xl font-serif text-[34px] font-bold leading-[1.18] tracking-tight text-slate-50 sm:text-[52px]">
            팩터로 고르고 <span className="text-gold-400">규칙으로</span> 집행한다
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-slate-400">
            S&amp;P500을 대상으로 워크포워드 검증을 통과한 팩터 전략만 실계좌에 올린다.
            종목 선택·비중·리밸런싱에 사람의 재량이 들어가지 않는다. 성과는 꾸미지 않고
            기록 그대로 공개한다.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#/dashboard"
              className="flex items-center gap-2 rounded-xl border border-gold-500/50 bg-gold-500/15 px-5 py-2.5 text-[14px] font-medium text-gold-200 shadow-gold-glow transition hover:bg-gold-500/25">
              <Icon name="Activity" className="h-4 w-4" />성과 대시보드 보기
            </a>
            <a href="#/philosophy"
              className="flex items-center gap-2 rounded-xl border border-white/[0.12] px-5 py-2.5 text-[14px] text-slate-300 transition hover:border-white/25 hover:text-slate-100">
              <Icon name="BookOpen" className="h-4 w-4" />투자 철학
            </a>
          </div>

          <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-3 lg:grid-cols-6">
            {facts.map(([k, v, tone]) => (
              <div key={k} className="bg-navy-900/90 px-4 py-3.5">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{k}</dt>
                <dd className={`mt-1 truncate font-mono text-[13px] ${tone || 'text-slate-200'}`}>{v}</dd>
              </div>
            ))}
          </dl>

          {all && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-white/[0.07] bg-navy-950/50 px-4 py-3 font-mono text-[12.5px] shadow-inset-hair">
              <span className="text-slate-500">설정 이후 누적
                <b className={`ml-1.5 ${sc(all.strategy_pct)}`}>{pct(all.strategy_pct)}</b>
              </span>
              {all.benchmark_pct != null && (
                <>
                  <span className="text-slate-500">S&amp;P500
                    <b className="ml-1.5 text-slate-300">{pct(all.benchmark_pct)}</b>
                  </span>
                  <span className="text-slate-500">초과
                    <b className={`ml-1.5 ${sc(all.excess_pp)}`}>{pp(all.excess_pp)}</b>
                  </span>
                </>
              )}
            </div>
          )}
        </Section>
      </section>

      <Section className="flex flex-col gap-4 py-8">
        <Notice generatedAt={data.summary?.generated_at} />

        {/* 펀드 지표 카드. AUM 자리에는 금액 대신 누적 지수가 들어간다 — 공개 웹이라
            계좌 잔고는 데이터 단계에서 이미 빠져 있다. */}
        <div>
          <h2 className="font-serif text-lg font-semibold text-slate-100">운용 개요</h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            총자산은 시작=100 지수로 정규화한다. 금액·수량은 공개 데이터에 존재하지 않는다.
          </p>
        </div>
        <KpiRow items={[
          { label: '누적 지수 (시작=100)', value: nf(lastIndex, 1), tone: 'text-gold-300',
            sub: '금액 대신 지수 — 계좌 잔고 비공개' },
          { label: '설정 이후 누적', value: pct(s?.total_return_pct), tone: sc(s?.total_return_pct),
            sub: `S&P500 대비 ${pp(all?.excess_pp)}` },
          { label: '연평균 수익률 (CAGR)', value: pct(s?.cagr_pct), tone: sc(s?.cagr_pct),
            sub: '입출금 기록이 없어 IRR 대신 CAGR' },
          { label: '1일 수익률', value: pct(s?.day_return_pct), tone: sc(s?.day_return_pct),
            sub: `운용 ${days == null ? '—' : `${days}일`} · 보유 ${rows.length}종목` },
        ]} />

        <Split
          left={[<EquityCard key="eq" data={data} />, <PeriodsCard key="pd" data={data} />]}
          right={[<StrategyCard key="st" data={data} />, <PrinciplesCard key="pr" />]} />

        <PreviewDashboard data={data} />
      </Section>
    </>
  );
}

/** 홈 하단 맛보기 — 대시보드 일부를 그대로 끌어와 진입 동선을 만든다. */
function PreviewDashboard({ data }) {
  const rows = (data.positions?.rows || []).slice(0, 5);
  return (
    <section className="relative mt-6 overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-navy-850/70 to-navy-950/40 p-5 shadow-glass sm:p-7">
      <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gold-500/[0.06] blur-3xl" />
      <div className="relative flex flex-wrap items-end gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-500">Preview</div>
          <h2 className="mt-1.5 font-serif text-xl font-semibold text-slate-50 sm:text-2xl">
            성과 대시보드 맛보기
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            수익률 추이와 상위 보유 종목. 전체는 대시보드에서 4개 탭으로 본다.
          </p>
        </div>
        <a href="#/dashboard"
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-[13px] font-medium text-gold-300 transition hover:bg-gold-500/20">
          전체 보기<Icon name="ArrowRight" className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="relative mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="!bg-navy-950/45">
          <CardHead title="수익률 추이" />
          <EquityChart data={data} range="ALL" height={236} />
        </Card>
        <Card className="!bg-navy-950/45">
          <CardHead title="상위 보유 종목" count={rows.length || null} />
          {rows.length ? (
            <Table cols={['종목', '비중', '총 수익률']} rows={rows} minWidth={280} render={(r) => (
              <>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.06] font-mono text-[10px] text-slate-300">
                      {(r.symbol || '').slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-mono text-[12.5px] text-slate-100">{r.symbol}</span>
                      {r.name && <span className="block truncate text-[10.5px] text-slate-600">{r.name}</span>}
                    </span>
                  </div>
                </Td>
                <Td num className="text-slate-300">{nf(r.weight_pct, 1)}%</Td>
                <Td num className={sc(r.unrealized_pct)}>{pct(r.unrealized_pct)}</Td>
              </>
            )} />
          ) : <Empty title="아직 보유 종목이 없어요" sub="서버가 첫 리밸런싱을 집행하면 나타납니다." />}
        </Card>
      </div>
    </section>
  );
}

// ══ 대시보드 › 보유종목 ════════════════════════════════════════════
function TabHoldings({ data }) {
  const rows = data.positions?.rows || [];
  const s = (data.summary?.strategies || [])[0];
  const series = (data.equity?.series || [])[0];
  const pts = series?.points || [];
  const lastIndex = pts.length ? pts[pts.length - 1].index : null;
  const pos = data.positions || {};
  const [dist, setDist] = useState('sector');

  const distRows = dist === 'sector' ? (pos.sectors || [])
    : dist === 'industry' ? (pos.industries || []) : (pos.rows || []).slice(0, 10);
  const distKey = dist === 'sector' ? 'sector' : dist === 'industry' ? 'industry' : 'symbol';

  const holdingsTable = (
    <Card key="h">
      <CardHead title="보유 종목" count={rows.length} right={
        <CsvButton name="holdings" rows={rows}
          cols={['symbol', 'name', 'sector', 'industry', 'entry', 'price', 'avg_cost', 'per',
            'roe', 'day_pct', 'total_pct', 'weight_pct']}
          pick={(r) => [r.symbol, r.name, r.sector, r.industry, day(r.entry_ts), r.price,
            r.avg_cost, r.per, r.roe, r.day_return_pct, r.unrealized_pct, r.weight_pct]} />
      } />
      {rows.length ? (
        // 원본의 '적정가치' 열은 사용자 확인 후 제외했다(밸류에이션 모델 없음).
        // 그 자리에 실제 공시 재무에서 나오는 PER·ROE를 세웠다.
        <Table minWidth={880}
          cols={['종목', '산업', '보유일', '현재가', 'PER', 'ROE', '1일', '총 수익률', '비중']}
          rows={rows} render={(r) => (
            <>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.06] font-mono text-[10px] text-slate-300">
                    {(r.symbol || '').slice(0, 2)}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[12.5px] text-slate-100">{r.symbol}</span>
                    {r.name && (
                      <span className="block max-w-[190px] truncate text-[10.5px] text-slate-600">
                        {r.name}
                      </span>
                    )}
                  </span>
                </div>
              </Td>
              <Td num><Tag>{r.industry || r.sector || 'Unknown'}</Tag></Td>
              <Td num className="text-slate-400">
                {held(r.entry_ts) == null ? '—' : `${held(r.entry_ts)}일`}
              </Td>
              <Td num>
                <span className="text-slate-200">{usd(r.price)}</span>
                <span className="block text-[10.5px] text-slate-600">평단 {usd(r.avg_cost)}</span>
              </Td>
              <Td num className="text-slate-300">{r.per == null ? '—' : `${nf(r.per, 1)}x`}</Td>
              <Td num className="text-slate-300">{r.roe == null ? '—' : `${nf(r.roe, 1)}%`}</Td>
              <Td num className={sc(r.day_return_pct)}>{pct(r.day_return_pct)}</Td>
              <Td num className={sc(r.unrealized_pct)}>{pct(r.unrealized_pct)}</Td>
              <Td num className="text-slate-200">{nf(r.weight_pct, 1)}%</Td>
            </>
          )} />
      ) : <Empty title="아직 보유 종목이 없어요" sub="서버가 첫 리밸런싱을 집행하면 나타납니다." />}
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <KpiRow items={[
        { label: `누적 지수 (시작=100) · ${rows.length}개 종목`, value: nf(lastIndex, 1),
          tone: 'text-gold-300' },
        { label: '1일 수익률', value: pct(s?.day_return_pct), tone: sc(s?.day_return_pct) },
        { label: '총 수익률', value: pct(s?.total_return_pct), tone: sc(s?.total_return_pct) },
        { label: '연평균 수익률 (CAGR)', value: pct(s?.cagr_pct), tone: sc(s?.cagr_pct) },
      ]} />
      <Split left={[holdingsTable]} right={[
        <Card key="radar">
          <CardHead title="포트폴리오 팩터 프로필" />
          <RadarProfile data={data} height={230} />
        </Card>,
        <Card key="dist">
          <CardHead title="분산" right={
            <Seg items={[['sector', '섹터'], ['industry', '산업'], ['symbol', '티커']]}
              value={dist} onChange={setDist} />} />
          <Donut rows={distRows} dataKey="weight_pct" nameKey={distKey} />
        </Card>,
      ]} />
    </div>
  );
}

// ══ 대시보드 › 수익률 ══════════════════════════════════════════════
function TabReturns({ data }) {
  const contrib = data.trades?.contribution || [];
  const rr = data.trades?.returns_rows || [];
  const trades = (data.trades?.rows || []).slice(0, 30);
  // 상위/하위는 부호로 가른다. 꼬리만 자르면 음수 기여가 5개 미만일 때 양수가 섞인다.
  const gain = contrib.filter((c) => (c.contribution_pct ?? 0) > 0);
  const lose = contrib.filter((c) => (c.contribution_pct ?? 0) < 0);

  const left = [
    <EquityCard key="eq" data={data} />,
    <PeriodsCard key="pd" data={data} />,
    <Card key="wf">
      <CardHead title="수익 구성 — 종목별 기여 누적" />
      <Waterfall contrib={contrib} />
      <p className="mt-2 text-[11px] text-slate-600">
        각 막대는 그 종목이 전체 원가 대비 얹은 손익(%)이다. 실현 + 미실현 합계.
      </p>
    </Card>,
    <Card key="det">
      <CardHead title="상세 수익 리포트" right={
        <CsvButton name="returns" rows={rr}
          cols={['symbol', 'name', 'sector', 'entry', 'weight_pct', 'avg_cost', 'price',
            'unrealized_pct', 'contribution_pct']}
          pick={(r) => [r.symbol, r.name, r.sector, day(r.entry_ts), r.weight_pct, r.avg_cost,
            r.price, r.unrealized_pct, r.contribution_pct]} />
      } />
      {/* 원본은 수량·평가액·매입원가 열이 있는데 금액이라 제외했다(사용자 확인 완료).
          IRR 열도 입출금 기록이 없어 계산 불가라 제외. */}
      {rr.length ? (
        <Table minWidth={680} cols={['종목', '진입일', '비중', '평단', '현재가', '미실현', '기여도']}
          rows={rr} render={(r) => (
            <>
              <Td>
                <span className="block font-mono text-[12.5px] text-slate-100">{r.symbol}</span>
                {r.name && (
                  <span className="block max-w-[180px] truncate text-[10.5px] text-slate-600">
                    {r.name}
                  </span>
                )}
              </Td>
              <Td num className="text-slate-500">{day(r.entry_ts)}</Td>
              <Td num className="text-slate-300">{nf(r.weight_pct, 1)}%</Td>
              <Td num className="text-slate-300">{usd(r.avg_cost)}</Td>
              <Td num className="text-slate-300">{usd(r.price)}</Td>
              <Td num className={sc(r.unrealized_pct)}>{pct(r.unrealized_pct)}</Td>
              <Td num className={sc(r.contribution_pct)}>{pct(r.contribution_pct)}</Td>
            </>
          )} />
      ) : <Empty title="보유 종목이 없습니다" />}
    </Card>,
    <Card key="tr">
      <CardHead title="최근 거래" count={trades.length || null} />
      {trades.length ? (
        <Table minWidth={380} cols={['일자', '종목', '구분', '체결가']} rows={trades} render={(r) => {
          const buy = String(r.side || '').toLowerCase() === 'buy';
          return (
            <>
              <Td className="text-slate-500">{day(r.ts)}</Td>
              <Td num className="text-slate-100">{r.symbol}</Td>
              <Td num><Tag tone={buy ? 'accent' : 'neutral'}>{buy ? '매수' : '매도'}</Tag></Td>
              <Td num className="text-slate-300">{usd(r.price)}</Td>
            </>
          );
        }} />
      ) : <div className="text-[12px] text-slate-500">거래 이력 없음</div>}
    </Card>,
  ];

  const right = [];
  if (gain.length) {
    right.push(
      <Card key="g">
        <CardHead title="기여도 상위" />
        <BarList rows={gain.slice(0, 6)} dataKey="contribution_pct" nameKey="symbol" signed />
      </Card>);
  }
  if (lose.length) {
    right.push(
      <Card key="l">
        <CardHead title="기여도 하위" />
        <BarList rows={lose.slice(-6).reverse()} dataKey="contribution_pct" nameKey="symbol" signed />
      </Card>);
  }
  right.push(
    <Card key="r">
      <CardHead title="포트폴리오 팩터 프로필" />
      <RadarProfile data={data} height={210} />
    </Card>);

  return <Split left={left} right={right} />;
}

// ══ 대시보드 › 배당금 ══════════════════════════════════════════════
function TabDividends({ data }) {
  const d = data.positions?.dividends || {};
  const [hist, setHist] = useState('monthly');
  if (!d.rows || !d.rows.length) return <EmptyCard title="배당" msg="배당 데이터가 없습니다" />;

  const yoc = d.rows.filter((r) => r.yield_on_cost_pct != null);
  const avgYoc = yoc.length
    ? yoc.reduce((a, r) => a + r.yield_on_cost_pct * (r.weight_pct || 0), 0)
      / (yoc.reduce((a, r) => a + (r.weight_pct || 0), 0) || 1) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* 원본은 '향후 12개월 배당 수입 US$5,091'인데 (1) 배당 가이던스를 안 받아 '향후'가
          아니라 최근 12개월 실적이고 (2) 금액은 공개하지 않는다 → 수익률로 표시한다. */}
      <KpiRow items={[
        { label: '포트폴리오 배당수익률 (최근 12개월)', value: `${nf(d.portfolio_yield_pct, 2)}%`,
          tone: 'text-gold-300' },
        { label: '매입가 대비 수익률', value: avgYoc == null ? '—' : `${nf(avgYoc, 2)}%`,
          sub: 'yield on cost' },
        { label: '직전 12개월 대비', value: pct(d.change_vs_prior_pct, 1),
          tone: sc(d.change_vs_prior_pct) },
        { label: '배당 지급 종목', value: String(d.rows.filter((r) => r.yield_pct).length) },
      ]} />
      <Split
        left={[
          <Card key="hist">
            <CardHead title="배당 지급 내역" right={
              <Seg items={[['monthly', '월별'], ['yearly', '연도별']]} value={hist} onChange={setHist} />} />
            <Columns rows={hist === 'monthly' ? (d.history_monthly || []) : (d.history_yearly || [])}
              dataKey="yield_pct" nameKey="period" />
            <p className="mt-2 text-[11px] text-slate-600">
              주당 금액을 그냥 더하면 주가가 다른 종목이 섞여 의미가 없다. 각 지급을
              비중 가중 수익률 기여(%)로 바꿔 집계한다.
            </p>
          </Card>,
          <Card key="rec">
            <CardHead title="최근 배당락" right={
              <CsvButton name="dividends" rows={d.recent || []} cols={['symbol', 'ex_date', 'dps_usd']}
                pick={(r) => [r.symbol, r.ex_date, r.dps]} />} />
            <Table minWidth={320} cols={['배당락일', '종목', '주당']} rows={d.recent || []} render={(r) => (
              <>
                <Td className="text-slate-500">{r.ex_date}</Td>
                <Td num className="text-slate-100">{r.symbol}</Td>
                <Td num className="text-slate-300">{usd(r.dps)}</Td>
              </>
            )} />
          </Card>,
        ]}
        right={[
          <Card key="y">
            <CardHead title="종목별 배당수익률" />
            <BarList rows={d.rows.filter((r) => r.yield_pct)} dataKey="yield_pct"
              nameKey="symbol" d={2} />
          </Card>,
          <Card key="c">
            <CardHead title="배당 기여 종목" />
            <BarList d={3} dataKey="contribution_pct" nameKey="symbol"
              rows={d.rows.filter((r) => r.contribution_pct)
                .sort((a, b) => b.contribution_pct - a.contribution_pct).slice(0, 8)} />
            <p className="mt-2 text-[11px] text-slate-600">
              포트폴리오 배당수익률에 각 종목이 얹는 몫(비중 가중).
            </p>
          </Card>,
        ]} />
    </div>
  );
}

// ══ 대시보드 › 분석 ════════════════════════════════════════════════
function TabAnalysis({ data }) {
  const rows = data.positions?.rows || [];
  const axes = data.positions?.factors?.axes || [];
  if (!rows.length) return <EmptyCard title="분석" msg="보유 종목이 없습니다" />;

  const left = [
    <Card key="f">
      <CardHead title="펀더멘털 지표" right={
        <CsvButton name="fundamentals" rows={rows}
          cols={['symbol', 'per', 'roe_pct', 'book_yield_pct', 'earnings_yield_pct',
            'asset_growth_pct', 'gross_profit_asset_pct']}
          pick={(r) => [r.symbol, r.per, r.roe, r.book_yield, r.earnings_yield,
            r.asset_growth, r.gross_profit_asset]} />
      } />
      <Table minWidth={720}
        cols={['종목', 'PER', 'ROE', '순자산수익률', '이익수익률', '자산성장', '매출총이익/자산']}
        rows={rows} render={(r) => (
          <>
            <Td className="font-mono text-slate-100">{r.symbol}</Td>
            <Td num className="text-slate-300">{r.per == null ? '—' : `${nf(r.per, 1)}x`}</Td>
            <Td num className="text-slate-300">{r.roe == null ? '—' : `${nf(r.roe, 1)}%`}</Td>
            <Td num className="text-slate-300">
              {r.book_yield == null ? '—' : `${nf(r.book_yield, 1)}%`}
            </Td>
            <Td num className="text-slate-300">
              {r.earnings_yield == null ? '—' : `${nf(r.earnings_yield, 1)}%`}
            </Td>
            <Td num className={sc(-(r.asset_growth ?? 0))}>
              {r.asset_growth == null ? '—' : `${nf(r.asset_growth, 1)}%`}
            </Td>
            <Td num className="text-slate-300">
              {r.gross_profit_asset == null ? '—' : `${nf(r.gross_profit_asset, 1)}%`}
            </Td>
          </>
        )} />
      <p className="mt-2 text-[11px] text-slate-600">
        SEC EDGAR XBRL 공시 재무 기준. 공시일이 기준일 이전인 가장 최근 보고서만 쓴다(미래참조 차단).
      </p>
    </Card>,
  ];
  if (axes.length) {
    left.push(
      <Card key="p">
        <CardHead title="종목별 팩터 백분위" />
        <Table minWidth={420} cols={['종목', ...axes.map((a) => a.axis)]} rows={rows} render={(r) => (
          <>
            <Td className="font-mono text-slate-100">{r.symbol}</Td>
            {axes.map((a, i) => {
              const v = a.symbols?.[r.symbol];
              return <Td key={i} num className="text-slate-300">{v == null ? '—' : Math.round(v)}</Td>;
            })}
          </>
        )} />
      </Card>);
  }

  return (
    <Split left={left} right={[
      <Card key="r">
        <CardHead title="포트폴리오 팩터 프로필" />
        <RadarProfile data={data} height={250} />
      </Card>,
      <Card key="s">
        <CardHead title="섹터 분산" />
        <Donut rows={data.positions?.sectors || []} dataKey="weight_pct" nameKey="sector" />
      </Card>,
    ]} />
  );
}

// ══ 페이지: 성과 대시보드 ═══════════════════════════════════════════
const TABS = [['holdings', '보유종목', 'Wallet', TabHoldings],
  ['returns', '수익률', 'TrendingUp', TabReturns],
  ['dividends', '배당금', 'Coins', TabDividends],
  ['analysis', '분석', 'Microscope', TabAnalysis]];

function PageDashboard({ data, route }) {
  const want = route.split('/')[2] || TABS[0][0];
  const cur = TABS.find((t) => t[0] === want) || TABS[0];
  const Body = cur[3];
  return (
    <Section className="flex flex-col gap-4 py-8">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-500">
          Live Performance
        </div>
        <h1 className="mt-1.5 font-serif text-2xl font-semibold text-slate-50 sm:text-[30px]">
          성과 대시보드
        </h1>
      </div>
      <div className="thin-scroll flex gap-1 overflow-x-auto border-b border-white/[0.08]">
        {TABS.map(([id, label, icon]) => (
          <a key={id} href={`#/dashboard/${id}`} aria-current={id === cur[0] ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] transition ${id === cur[0]
              ? 'border-gold-500 text-gold-300'
              : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            <Icon name={icon} className="h-3.5 w-3.5" />{label}
          </a>
        ))}
      </div>
      <Notice generatedAt={data.summary?.generated_at} />
      <Body data={data} />
    </Section>
  );
}

// ══ 페이지: 투자 철학 ══════════════════════════════════════════════
const SOURCES = [['가격·지수', 'yfinance (일봉, 수정주가)'],
  ['재무', 'SEC EDGAR XBRL — 공시일 키잉'],
  ['섹터·산업·배당', 'yfinance'],
  ['체결·잔고', '한국투자증권 OpenAPI'],
  ['벤치마크', 'SPY (배당재투자 ETF)']];

// 무엇을 못 보여주는지 적는 절. 안 적으면 '없는 것'과 '0인 것'을 구분할 수 없다.
const GAPS = [
  ['적정가치 · 현금흐름 가치', '밸류에이션(DCF) 모델이 없다. 추정치를 지어내지 않는다.'],
  ['목표주가 · 선행 PER · 이익 성장', '애널리스트 컨센서스 데이터 소스가 없다.'],
  ['지역별 매출 분산', '사업부문·지역 세그먼트 데이터를 수집하지 않는다.'],
  ['라이브 뉴스 · 실시간 시세', '뉴스·실시간 시세 API를 붙이지 않았다. 상단 티커는 스냅샷 종가다.'],
  ['IRR', '입출금 시점별 현금흐름 기록이 없다. 대신 CAGR을 쓰고 라벨도 CAGR이다.'],
  ['금액 · 수량 · AUM', '공개 페이지라 계좌 규모를 내보내지 않는다. 내보내기 단계에서 빠진다.'],
];

const CAVEATS = [
  ['표본이 짧다', '실운용 기록이 몇 달 단위면 Sharpe·CAGR은 잡음이다. 판정하려면 최소 120 관측이 필요하다.'],
  ['생존편향', 'S&P500 구성종목은 시점별로 강제하지만, 상장폐지 종목의 손실은 완전히 반영되지 않는다.'],
  ['백테스트 ≠ 미래', '워크포워드 OOS는 선택 절차의 일반화를 재는 것이지 수익을 보장하지 않는다.'],
];

function PagePhilosophy({ data }) {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
        <HeroBackdrop />
        <Section className="relative py-14 sm:py-20">
          <div className="flex items-center gap-2">
            <span className="h-px w-8 bg-gold-500/60" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-gold-500">
              Methodology
            </span>
          </div>
          <h1 className="mt-5 font-serif text-[30px] font-bold leading-tight tracking-tight text-slate-50 sm:text-[44px]">
            어떻게 <span className="text-gold-400">검증</span>했는가
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-400">
            이 페이지는 성과가 아니라 절차를 설명한다. 무엇을 재고, 무엇을 못 재는지 적어둔다.
          </p>
        </Section>
      </section>

      <Section className="flex flex-col gap-4 py-8">
        <Split
          left={[
            <PrinciplesCard key="pr" />,
            <Card key="src"><CardHead title="데이터 출처" /><KV items={SOURCES} /></Card>,
            <Card key="gap">
              <CardHead title="표시하지 않는 지표와 이유" />
              <NoteList items={GAPS} />
            </Card>,
          ]}
          right={[
            <Card key="cav">
              <CardHead title="⚠️ 읽을 때 주의" />
              <NoteList items={CAVEATS} tone="gold" />
            </Card>,
            <StrategyCard key="st" data={data} />,
          ]} />
        <Notice generatedAt={data.summary?.generated_at} />
      </Section>
    </>
  );
}

// ══ 페이지: 리서치 노트 ════════════════════════════════════════════
/*
 * 정적 사이트라 CMS가 없다. 글 하나 = web/notes/<slug>.md 파일 하나이고, 목록은
 * web/notes/index.json에 한 줄 추가한다. 정적 호스팅은 디렉터리 목록을 못 주므로
 * 색인 파일이 반드시 있어야 한다 — 메타데이터는 전부 index.json에만 두고 .md에는
 * 본문만 넣는다(프론트매터 파서가 필요 없고 제목이 두 군데 갈라지지도 않는다).
 *
 * 본문은 marked로 파싱해 innerHTML로 넣는다. 저장소에 커밋되는 자기 글만 렌더링하는
 * 경로라 임의 입력이 들어올 자리가 없다 — 외부 입력을 받게 되면 새니타이저가 필요하다.
 */
const KINDS = { journal: '운용 일지', report: '분석 보고서' };

function useNotesIndex() {
  const [state, setState] = useState({ loading: true, notes: [] });
  useEffect(() => {
    let alive = true;
    fetch('notes/index.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => alive && setState({ loading: false, notes: j.notes || [] }))
      .catch((e) => {
        console.error('[Astra] notes/index.json 로드 실패:', e.message);
        if (alive) setState({ loading: false, notes: [] });
      });
    return () => { alive = false; };
  }, []);
  return state;
}

const NoteHero = ({ kicker, title, accent, sub }) => (
  <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
    <HeroBackdrop />
    <Section className="relative py-14 sm:py-20">
      <div className="flex items-center gap-2">
        <span className="h-px w-8 bg-gold-500/60" />
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-gold-500">{kicker}</span>
      </div>
      <h1 className="mt-5 max-w-3xl font-serif text-[28px] font-bold leading-tight tracking-tight text-slate-50 sm:text-[42px]">
        {title}{accent && <span className="text-gold-400">{accent}</span>}
      </h1>
      {sub && <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-slate-400">{sub}</p>}
    </Section>
  </section>
);

function PageNotes() {
  const { loading, notes } = useNotesIndex();
  const [kind, setKind] = useState('all');
  const rows = useMemo(() => notes
    .filter((n) => kind === 'all' || n.kind === kind)
    .sort((a, b) => String(b.date).localeCompare(String(a.date))), [notes, kind]);

  return (
    <>
      <NoteHero kicker="Research Notes" title="기록하지 않으면 " accent="배우지 못한다"
        sub="운용하면서 내린 판단과 그 근거를 남긴다. 결과가 좋았던 것만 골라 적지 않는다." />
      <Section className="flex flex-col gap-4 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <Seg value={kind} onChange={setKind}
            items={[['all', '전체'], ['journal', '운용 일지'], ['report', '분석 보고서']]} />
          <span className="font-mono text-[11px] text-slate-600">{rows.length}편</span>
        </div>

        {loading ? <div className="text-[12.5px] text-slate-500">불러오는 중…</div>
          : rows.length ? (
            <ul className="flex flex-col gap-3">
              {rows.map((n) => (
                <li key={n.slug}>
                  <a href={`#/notes/${n.slug}`}
                    className={`${GLASS} group block p-5 transition hover:border-gold-500/30 hover:bg-white/[0.045] sm:p-6`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-gold-500/[0.12] px-2 py-0.5 font-mono text-[10.5px] text-gold-300">
                        {KINDS[n.kind] || '노트'}
                      </span>
                      <time className="font-mono text-[11px] text-slate-500">{n.date}</time>
                      <Icon name="ArrowRight"
                        className="ml-auto h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-gold-400" />
                    </div>
                    <h2 className="mt-2 font-serif text-[17px] font-semibold text-slate-100 sm:text-[19px]">
                      {n.title}
                    </h2>
                    {n.summary && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{n.summary}</p>
                    )}
                    {!!(n.tags || []).length && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {n.tags.map((t) => (
                          <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[10.5px] text-slate-500">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Card>
              <Empty title="아직 올린 글이 없어요"
                sub="web/notes/<slug>.md 를 두고 notes/index.json 에 한 줄 추가하면 여기 나타납니다." />
            </Card>
          )}
      </Section>
    </>
  );
}

function PageNote({ slug }) {
  const { loading, notes } = useNotesIndex();
  const [body, setBody] = useState(null);
  const meta = notes.find((n) => n.slug === slug);

  useEffect(() => {
    let alive = true;
    setBody(null);
    fetch(`notes/${slug}.md`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((md) => alive && setBody(window.marked ? window.marked.parse(md) : `<pre>${md}</pre>`))
      .catch((e) => {
        console.error(`[Astra] notes/${slug}.md 로드 실패:`, e.message);
        if (alive) setBody('');
      });
    return () => { alive = false; };
  }, [slug]);

  if (!loading && !meta && body === '') {
    return (
      <Section className="py-20">
        <Card>
          <CardHead title="글을 찾을 수 없습니다" />
          <p className="text-[12.5px] text-slate-500">
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11.5px] text-gold-300">
              notes/{slug}.md
            </code>{' '}가 없습니다.{' '}
            <a href="#/notes" className="text-gold-300">목록으로</a>
          </p>
        </Card>
      </Section>
    );
  }

  return (
    <Section className="py-10">
      <a href="#/notes"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 transition hover:text-gold-300">
        <Icon name="ArrowLeft" className="h-3.5 w-3.5" />리서치 노트
      </a>
      <article className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-gold-500/[0.12] px-2 py-0.5 font-mono text-[10.5px] text-gold-300">
            {KINDS[meta?.kind] || '노트'}
          </span>
          <time className="font-mono text-[11px] text-slate-500">{meta?.date || ''}</time>
        </div>
        <h1 className="mt-3 max-w-3xl font-serif text-[26px] font-bold leading-tight tracking-tight text-slate-50 sm:text-[34px]">
          {meta?.title || slug}
        </h1>
        {meta?.summary && (
          <p className="mt-3 max-w-2xl border-l-2 border-gold-500/40 pl-4 text-[13.5px] leading-relaxed text-slate-400">
            {meta.summary}
          </p>
        )}
        <div className={`${GLASS} mt-7 p-5 sm:p-8`}>
          {body == null
            ? <div className="text-[12.5px] text-slate-500">불러오는 중…</div>
            : <div className="md-body" dangerouslySetInnerHTML={{ __html: body }} />}
        </div>
        {!!(meta?.tags || []).length && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {meta.tags.map((t) => (
              <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[10.5px] text-slate-500">
                #{t}
              </span>
            ))}
          </div>
        )}
      </article>
    </Section>
  );
}

// ── 셸 ─────────────────────────────────────────────────────────────
const Footer = () => (
  <footer className="mt-10 border-t border-white/[0.06] bg-navy-950/60">
    <Section className="flex flex-col gap-3 py-8 sm:flex-row sm:items-center">
      <div>
        <div className="font-serif text-base font-semibold text-slate-200">
          Astra<span className="text-gold-500">.</span>
        </div>
        <p className="mt-1 text-[11.5px] text-slate-600">
          개인 계좌 자동매매 기록 · 투자 권유가 아닙니다.
        </p>
      </div>
      <nav className="flex flex-wrap gap-4 text-[12px] text-slate-500 sm:ml-auto">
        <a href="#/" className="hover:text-slate-300">운용 개요</a>
        <a href="#/dashboard" className="hover:text-slate-300">성과 대시보드</a>
        <a href="#/notes" className="hover:text-slate-300">리서치 노트</a>
        <a href="#/philosophy" className="hover:text-slate-300">투자 철학</a>
      </nav>
    </Section>
  </footer>
);

/** 라우트 → 문서 제목. 노트 상세는 슬러그밖에 모르니 섹션 이름까지만 준다. */
const TITLES = (r) => (
  r.startsWith('/dashboard') ? '성과 대시보드'
    : r.startsWith('/notes') ? '리서치 노트'
      : r.startsWith('/philosophy') || r.startsWith('/report') ? '투자 철학'
        : '퀀트 포트폴리오');

function App() {
  const [data, setData] = useState(null);
  const [route, setRoute] = useState(() => location.hash.replace(/^#/, '') || '/');

  useEffect(() => { loadAll(window.ASTRA_DATA_DIR || 'data').then(setData); }, []);
  useEffect(() => {
    const on = () => {
      setRoute(location.hash.replace(/^#/, '') || '/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.title = `${TITLES(route)} — Astra`; }, [route]);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        불러오는 중…
      </div>
    );
  }

  let page;
  // 노트는 성과 JSON을 안 쓴다 — summary 로드가 실패해도 글은 읽혀야 하므로 먼저 가른다.
  if (route.startsWith('/notes/')) {
    page = <PageNote slug={route.slice('/notes/'.length)} />;
  } else if (route.startsWith('/notes')) {
    page = <PageNotes />;
  } else if (!data.summary) {
    page = (
      <Section className="py-20">
        <Card>
          <CardHead title="데이터를 불러오지 못했습니다" />
          <p className="text-[12.5px] text-slate-500">
            summary.json 이 없습니다.{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11.5px] text-gold-300">
              python -m engine.export_web
            </code>{' '}를 실행하세요.
          </p>
        </Card>
      </Section>
    );
  } else if (route.startsWith('/dashboard')) {
    page = <PageDashboard data={data} route={route} />;
  } else if (route.startsWith('/philosophy') || route.startsWith('/report')) {
    page = <PagePhilosophy data={data} />;
  } else {
    page = <PageHome data={data} />;
  }

  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link rounded-lg border border-gold-500/50 bg-navy-950 px-3 py-2 text-[13px] text-gold-300">
        본문 바로가기
      </a>
      <TickerBar data={data} />
      <Nav route={route} />
      <main id="main">{page}</main>
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
