/* Astra — 퀀트 펀드 사이트.
 *
 * 구조: 홈 / 대시보드[보유종목·수익률·배당금·분석] / 분석 리포트. 해시 라우팅이라
 * GitHub Pages에서 404 없이 딥링크가 되고 nav 마크업이 한 벌만 있으면 된다.
 *
 * 절 구성은 클로드 디자인 초안(Portfolio Holdings)을 기준으로 하고, 사이트 뼈대만
 * 참고 사이트에서 가져왔다. 초안에서 뺀 것은 전부 사용자 확인을 받은 것들이다:
 *   적정가치(DCF)·핵심지표&벤치마크·지역별 매출·라이브 뉴스·목표주가·선행PER·이익성장
 *   → 계산·추정할 데이터가 없어 제외
 *   내러티브/메모/관심종목/스크리너 → 정적 페이지라 제외(읽기 전용)
 *   스노우플레이크 '미래' 축 → 실적 전망 컨센서스 없음. 나머지 4축은 원본 이름 그대로
 *   IRR → CAGR (입출금 기록이 없어 IRR은 계산 불가. 값과 라벨을 일치시켰다)
 *   금액 → 지수·% (공개 웹이라 계좌 잔고가 노출된다. 데이터에 아예 없다)
 *
 * 외부 의존성 없음. 차트는 SVG를 직접 그린다.
 */
const Astra = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    return n;
  };

  // ── 포맷 ──────────────────────────────────────────────────────────
  const nf = (v, d = 2) => (v == null || Number.isNaN(v) ? '—'
    : v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%`);
  const upct = (v, d = 1) => (v == null ? '—' : `${nf(Math.abs(v), d)}%`);
  const pp = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%p`);
  const usd = (v) => (v == null ? '—' : `US$${nf(v, 2)}`);
  const sign = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
  const day = (ts) => (ts ? String(ts).slice(0, 10) : '—');
  const held = (ts) => {
    if (!ts) return null;
    const d = (Date.now() - Date.parse(ts)) / 86400000;
    return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : null;
  };

  let DATA = {};

  async function load(dir) {
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

  // ── 공용 차트 ─────────────────────────────────────────────────────
  const PALETTE = ['#9184d9', '#a7a1db', '#7972a9', '#b5abfc', '#5c5783',
    '#d2cefd', '#423a6a', '#968ae0', '#3fbf8f', '#e5705f', '#75798c', '#cfd3e5'];

  function donut(rows, key, label, size = 168) {
    const total = rows.reduce((a, r) => a + Math.abs(r[key] || 0), 0) || 1;
    const R = size / 2, r0 = R * 0.62;
    const svg = sv('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut' });
    let a0 = -Math.PI / 2;
    rows.forEach((row, i) => {
      const frac = Math.abs(row[key] || 0) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const big = frac > 0.5 ? 1 : 0;
      const p = (rad, ang) => `${(R + rad * Math.cos(ang)).toFixed(2)},${(R + rad * Math.sin(ang)).toFixed(2)}`;
      svg.append(sv('path', {
        d: `M${p(R, a0)}A${R},${R} 0 ${big} 1 ${p(R, a1)}L${p(r0, a1)}`
          + `A${r0},${r0} 0 ${big} 0 ${p(r0, a0)}Z`,
        fill: PALETTE[i % PALETTE.length], stroke: 'var(--color-bg)', 'stroke-width': 1.5 }));
      a0 = a1;
    });
    const wrap = el('div', 'donut-wrap');
    wrap.append(svg);
    const leg = el('div', 'donut-legend');
    rows.slice(0, 8).forEach((row, i) => leg.append(el('div', 'donut-item',
      `<i style="background:${PALETTE[i % PALETTE.length]}"></i>`
      + `<span>${row[label] ?? '—'}</span><b>${upct(row[key])}</b>`)));
    wrap.append(leg);
    return wrap;
  }

  function bars(rows, key, label, opts = {}) {
    const box = el('div');
    if (!rows.length) return box.append(el('div', 'text-muted',
      '<div style="font-size:12px">데이터 없음</div>')), box;
    const max = Math.max(...rows.map((r) => Math.abs(r[key] ?? 0)), 1e-9);
    rows.forEach((r) => {
      const v = r[key] ?? 0;
      box.append(el('div', 'bar-row',
        `<span>${r[label] ?? '—'}</span>`
        + `<span class="num ${opts.signed ? sign(v) : ''}">`
        + `${opts.signed ? pct(v, opts.d ?? 1) : upct(v, opts.d ?? 1)}</span>`
        + `<span class="bar-track"><span class="bar-fill ${opts.signed ? sign(v) : ''}"`
        + ` style="width:${(Math.abs(v) / max) * 100}%"></span></span>`));
    });
    return box;
  }

  /** 세로 막대(배당 지급 내역). 원본의 월별/연도별 막대 그래프. */
  function columns(rows, key, label) {
    if (!rows.length) return el('div', 'text-muted',
      '<div style="font-size:12px">데이터 없음</div>');
    const max = Math.max(...rows.map((r) => r[key] || 0), 1e-9);
    const box = el('div', 'cols');
    rows.forEach((r) => {
      const c = el('div', 'col');
      c.title = `${r[label]} · ${upct(r[key], 3)}`;
      c.append(el('div', 'col-bar', `<i style="height:${((r[key] || 0) / max) * 100}%"></i>`));
      c.append(el('div', 'col-k', String(r[label]).slice(-5)));
      box.append(c);
    });
    return box;
  }

  /** 수익 구성 워터폴 — 원본 '수익 구성'. 기여도를 누적해 최종 수익률에 도달한다. */
  function waterfall(contrib) {
    const rows = contrib.filter((c) => c.contribution_pct != null)
      .sort((a, b) => b.contribution_pct - a.contribution_pct);
    if (!rows.length) return el('div', 'text-muted',
      '<div style="font-size:12px">데이터 없음</div>');
    const W = 640, H = 190, PAD = 26;
    let cum = 0;
    const steps = rows.map((r) => {
      const from = cum; cum += r.contribution_pct;
      return { sym: r.symbol, from, to: cum, v: r.contribution_pct };
    });
    const lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
    const hi = Math.max(0, ...steps.map((s) => Math.max(s.from, s.to)));
    const span = hi - lo || 1;
    const y = (v) => PAD + (H - PAD * 2) * (1 - (v - lo) / span);
    const bw = (W - PAD * 2) / (steps.length + 1) * 0.72;
    const x = (i) => PAD + ((W - PAD * 2) / (steps.length + 1)) * (i + 0.5);

    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'waterfall' });
    svg.append(sv('line', { x1: PAD, x2: W - PAD, y1: y(0), y2: y(0),
      stroke: 'var(--color-neutral-700)', 'stroke-width': 1 }));
    steps.forEach((s, i) => {
      const top = Math.min(y(s.from), y(s.to));
      svg.append(sv('rect', { x: x(i) - bw / 2, y: top, width: bw,
        height: Math.max(1.5, Math.abs(y(s.to) - y(s.from))), rx: 2,
        fill: s.v >= 0 ? 'var(--color-up)' : 'var(--color-down)', opacity: 0.85 }));
      svg.append(sv('text', { x: x(i), y: H - 8, 'text-anchor': 'middle',
        fill: 'var(--color-neutral-500)', 'font-size': 9 }, s.sym));
    });
    // 최종 누적 막대
    svg.append(sv('rect', { x: x(steps.length) - bw / 2, y: Math.min(y(0), y(cum)),
      width: bw, height: Math.max(1.5, Math.abs(y(cum) - y(0))), rx: 2,
      fill: 'var(--color-accent)' }));
    svg.append(sv('text', { x: x(steps.length), y: H - 8, 'text-anchor': 'middle',
      fill: 'var(--color-accent-300)', 'font-size': 9 }, '합계'));
    return svg;
  }

  // ── 평가 곡선 ─────────────────────────────────────────────────────
  const RANGES = [['1M', 30], ['3M', 91], ['YTD', null], ['1Y', 365], ['전체', Infinity]];
  const clip = (pts, days) => {
    if (!pts?.length) return [];
    if (days === Infinity) return pts;
    const end = Date.parse(pts.at(-1).ts);
    const from = days == null
      ? Date.parse(`${new Date(end).getUTCFullYear()}-01-01T00:00:00Z`)
      : end - days * 86400000;
    return pts.filter((p) => Date.parse(p.ts) >= from);
  };
  const rebase = (pts) => {
    const base = pts?.find((p) => p.index > 0)?.index;
    return base ? pts.map((p) => ({ ts: p.ts, index: (p.index / base) * 100 })) : [];
  };

  function chart(box, days) {
    box.innerHTML = '';
    const series = (DATA.equity?.series || [])[0];
    const pts = clip(series?.points, days);
    if (pts.length < 2) {
      box.append(el('div', 'empty text-muted',
        '<h4>아직 그릴 곡선이 없어요</h4><div>스냅샷이 2개 이상 쌓이면 표시됩니다.</div>'));
      return;
    }
    // 벤치마크는 같은 창으로 자른 뒤 그 구간 시작=100으로 다시 정규화한다.
    // 전체 기간 지수를 그대로 얹으면 1M 창에서 두 선의 출발점이 어긋난다.
    const bm = (DATA.equity?.benchmarks || [])[0];
    const b = rebase(clip(bm?.points, days));
    const s = rebase(pts);
    const W = 900, H = 300, P = { t: 12, r: 52, b: 22, l: 8 };
    const all = s.concat(b).map((p) => p.index);
    const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - lo) / span);
    const xs = (i, n) => P.l + (W - P.l - P.r) * (n > 1 ? i / (n - 1) : 0);
    const path = (a) => a.map((p, i) => `${i ? 'L' : 'M'}${xs(i, a.length).toFixed(1)},${y(p.index).toFixed(1)}`).join(' ');

    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart',
      preserveAspectRatio: 'none' });
    for (let i = 0; i <= 4; i++) {
      const v = lo + (span * i) / 4;
      svg.append(sv('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v),
        stroke: 'var(--color-neutral-800)', 'stroke-width': 1 }));
      svg.append(sv('text', { x: W - P.r + 8, y: y(v) + 3.5,
        fill: 'var(--color-neutral-500)', 'font-size': 10 }, nf(v, 1)));
    }
    if (b.length > 1) {
      svg.append(sv('path', { d: path(b), fill: 'none', stroke: 'var(--color-neutral-500)',
        'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
    }
    svg.append(sv('path', { d: path(s), fill: 'none', stroke: 'var(--color-accent)',
      'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    box.append(svg);
    box.append(el('div', 'legend text-muted',
      `<span><i style="background:var(--color-accent)"></i>전략 ${series.strategy || ''}</span>`
      + (b.length > 1 ? `<span><i style="background:var(--color-neutral-500)"></i>${bm.name}</span>` : '')
      + `<span style="margin-left:auto">${day(s[0].ts)} → ${day(s.at(-1).ts)}</span>`));
  }

  function chartCard() {
    const card = el('div', 'card elev-sm');
    const head = el('div', 'card-head');
    head.append(el('div', 'card-title', '기간별 평가금액'));
    const seg = el('div', 'seg'); const box = el('div');
    RANGES.forEach(([label, days]) => {
      const b = el('button', null, label);
      b.setAttribute('aria-pressed', String(label === '전체'));
      b.onclick = () => {
        [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        chart(box, days);
      };
      seg.append(b);
    });
    head.append(seg);
    card.append(head, box);
    chart(box, Infinity);
    return card;
  }

  // ── 공용 조각 ─────────────────────────────────────────────────────
  function kpiRow(items) {
    const wrap = el('div', 'kpis');
    items.forEach((k) => {
      const c = el('div', 'card elev-sm');
      c.append(el('div', 'kpi-label', k.label), el('div', `kpi-value ${k.cls || ''}`, k.value));
      if (k.sub) c.append(el('div', 'kpi-sub text-muted', k.sub));
      wrap.append(c);
    });
    return wrap;
  }

  function tabbedCard(title, tabs) {
    const card = el('div', 'card elev-sm');
    const head = el('div', 'card-head');
    head.append(el('div', 'card-title', title));
    const seg = el('div', 'seg'); const body = el('div');
    tabs.forEach(([label, build], i) => {
      const b = el('button', null, label);
      b.setAttribute('aria-pressed', String(i === 0));
      b.onclick = () => {
        [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        body.innerHTML = ''; body.append(build());
      };
      seg.append(b);
    });
    head.append(seg);
    body.append(tabs[0][1]());
    card.append(head, body);
    return card;
  }

  function emptyCard(title, msg) {
    const c = el('div', 'card elev-sm');
    c.append(el('div', 'card-title', title));
    c.append(el('div', 'empty text-muted', `<h4>${msg}</h4>`));
    return c;
  }

  function table(cols, rows, render) {
    const t = el('table', 'table');
    t.innerHTML = `<thead><tr>${cols.map((c, i) =>
      `<th class="${i ? 'num' : ''}">${c}</th>`).join('')}</tr></thead>`;
    const tb = el('tbody');
    rows.forEach((r) => tb.append(el('tr', null, render(r))));
    t.append(tb);
    const s = el('div', 'scroll-x'); s.append(t);
    return s;
  }

  function csvButton(name, cols, rows, pick) {
    const b = el('button', 'btn-csv', '↓ CSV');
    b.onclick = () => {
      const body = rows.map((r) => pick(r).map((v) => (v == null ? '' : v)).join(',')).join('\n');
      const url = URL.createObjectURL(
        new Blob([`﻿${cols.join(',')}\n${body}`], { type: 'text/csv;charset=utf-8' }));
      const a = el('a'); a.href = url; a.download = `astra_${name}.csv`; a.click();
      URL.revokeObjectURL(url);
    };
    return b;
  }

  const notice = () => el('div', 'notice notice-warn',
    '<b>⚠️ 개인 포트폴리오 안내</b> — 1인이 운영하는 개인 계좌의 자동매매 기록이다. '
    + '투자 권유가 아니며 투자 판단과 책임은 본인에게 있다. '
    + '수량·평가금액·수수료는 공개하지 않는다(총자산은 시작=100 지수). '
    + `<span class="text-muted">· 갱신 ${DATA.summary?.generated_at || '—'}</span>`);

  // ══ 페이지: 홈 ═══════════════════════════════════════════════════
  function pageHome(root) {
    const s = (DATA.summary?.strategies || [])[0];
    const info = Object.values(DATA.summary?.strategy || {})[0] || {};
    const all = (DATA.summary?.periods || []).find((p) => p.period === '전체');

    const hero = el('section', 'hero');
    hero.append(el('div', 'hero-kicker', 'Astra Quant Portfolio'));
    hero.append(el('h1', 'hero-title', '팩터로 고르고 <span>규칙으로</span> 집행한다'));
    hero.append(el('p', 'hero-sub',
      'S&P500을 대상으로 워크포워드 검증을 통과한 팩터 전략만 실계좌에 올린다. '
      + '종목 선택·비중·리밸런싱에 사람의 재량이 들어가지 않는다.'));
    const facts = el('div', 'hero-facts');
    [['운용 상태', s ? '운용 중' : '대기', s ? 'ok' : ''],
      ['설정일', day(s?.start)], ['기준일', day(s?.last)],
      ['전략', info.champion || '—'], ['리밸런싱', info.rebalance || '—'],
      ['보유 종목', DATA.positions?.rows?.length || '—']]
      .forEach(([k, v, cls]) => {
        const f = el('div', 'hero-fact');
        f.append(el('div', 'hero-fact-k', k), el('div', `hero-fact-v ${cls || ''}`, String(v)));
        facts.append(f);
      });
    hero.append(facts);
    if (all) {
      hero.append(el('div', 'hero-band',
        `<span>설정 이후 누적 <b class="${sign(all.strategy_pct)}">${pct(all.strategy_pct)}</b></span>`
        + (all.benchmark_pct == null ? ''
          : `<span>S&amp;P500 <b>${pct(all.benchmark_pct)}</b></span>`
            + `<span>초과 <b class="${sign(all.excess_pp)}">${pp(all.excess_pp)}</b></span>`)));
    }
    root.append(hero, notice());

    root.append(kpiRow([
      { label: '설정 이후 누적', value: pct(s?.total_return_pct), cls: sign(s?.total_return_pct) },
      { label: '연평균 수익률 (CAGR)', value: pct(s?.cagr_pct), cls: sign(s?.cagr_pct),
        sub: '입출금 기록이 없어 IRR 대신 CAGR' },
      { label: '1일 수익률', value: pct(s?.day_return_pct), cls: sign(s?.day_return_pct) },
      { label: '보유 종목', value: String(DATA.positions?.rows?.length ?? 0) },
    ]));

    const split = el('div', 'split');
    const left = el('div', 'stack'); const right = el('div', 'stack');
    left.append(chartCard(), periodsCard());
    right.append(strategyCard(), principlesCard());
    split.append(left, right);
    root.append(split);
  }

  function periodsCard() {
    const rows = DATA.summary?.periods || [];
    if (!rows.length) return emptyCard('기간별 성과', '스냅샷이 더 쌓이면 표시됩니다');
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '기간별 성과 — 시장 대비'));
    const grid = el('div', 'period-grid');
    rows.forEach((r) => grid.append(el('div', 'period-cell',
      `<div class="period-k">${r.period}</div>`
      + `<div class="period-v ${sign(r.strategy_pct)}">${pct(r.strategy_pct, 1)}</div>`
      + `<div class="period-b text-muted">S&amp;P500 ${pct(r.benchmark_pct, 1)}</div>`
      + `<div class="period-e ${sign(r.excess_pp)}">${pp(r.excess_pp, 1)}</div>`)));
    card.append(grid);
    card.append(el('div', 'text-muted',
      '<div style="font-size:11px">초과수익은 같은 구간을 시작=100으로 다시 맞춰 비교한 값이다.</div>'));
    return card;
  }

  function strategyCard() {
    const info = Object.values(DATA.summary?.strategy || {})[0] || {};
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '💬 전략 노트'));
    const kv = el('div', 'kv');
    [['챔피언', info.champion], ['알파', info.alpha], ['보유 종목 수', info.top_n],
      ['룩백', info.lookback && `${info.lookback}일`], ['리밸런싱', info.rebalance],
      ['비중 배분', info.weighting], ['유니버스', info.universe_size]]
      .filter(([, v]) => v != null && v !== '')
      .forEach(([k, v]) => kv.append(el('div', 'kv-k', k), el('div', 'kv-v', String(v))));
    card.append(kv.children.length ? kv : el('div', 'text-muted',
      '<div style="font-size:12px">챔피언 전략이 등록되면 표시됩니다.</div>'));
    return card;
  }

  const PRINCIPLES = [
    ['워크포워드 OOS', '폴드마다 학습 구간만 보고 후보를 고른 뒤, 손대지 않은 다음 구간에서 잰다.'],
    ['무작위 대조군', '종목 수·회전율을 맞춘 무작위 선택을 이기는지 본다. 동일가중만 보면 노출 차이가 실력으로 보인다.'],
    ['시장이 기준', '무작위를 이기는 건 최소 조건이다. 진짜 질문은 S&P500을 위험조정으로 넘느냐다.'],
    ['백테스트=라이브', '시그널 코드 해시가 다르면 주문을 내지 않는다(fail-closed).'],
    ['비용 반영', '수수료·세금·슬리피지를 회전율 기준으로 백테스트에 물린다.'],
  ];

  function principlesCard() {
    const p = el('div', 'card elev-sm');
    p.append(el('div', 'card-title', '운용 원칙'));
    PRINCIPLES.forEach(([k, v]) => {
      const row = el('div', 'principle');
      row.append(el('div', 'principle-k', k), el('div', 'principle-v', v));
      p.append(row);
    });
    return p;
  }

  // ══ 대시보드 › 보유종목 ══════════════════════════════════════════
  function tabHoldings(root) {
    const rows = DATA.positions?.rows || [];
    const s = (DATA.summary?.strategies || [])[0];
    const series = (DATA.equity?.series || [])[0];
    root.append(kpiRow([
      { label: `누적 지수 (시작=100) · ${rows.length}개 종목`,
        value: nf(series?.points?.at(-1)?.index, 1) },
      { label: '1일 수익률', value: pct(s?.day_return_pct), cls: sign(s?.day_return_pct) },
      { label: '총 수익률', value: pct(s?.total_return_pct), cls: sign(s?.total_return_pct) },
      { label: '연평균 수익률 (CAGR)', value: pct(s?.cagr_pct), cls: sign(s?.cagr_pct) },
    ]));

    const split = el('div', 'split');
    const left = el('div', 'stack'); const right = el('div', 'stack');

    const card = el('div', 'card elev-sm');
    const head = el('div', 'card-head');
    head.append(el('div', 'card-title', `보유 종목 <span class="text-muted">${rows.length}</span>`));
    if (rows.length) {
      head.append(csvButton('holdings',
        ['symbol', 'name', 'sector', 'industry', 'entry', 'price', 'avg_cost', 'per', 'roe',
          'day_pct', 'total_pct', 'weight_pct'], rows,
        (r) => [r.symbol, r.name, r.sector, r.industry, day(r.entry_ts), r.price, r.avg_cost,
          r.per, r.roe, r.day_return_pct, r.unrealized_pct, r.weight_pct]));
    }
    card.append(head);
    if (!rows.length) {
      card.append(el('div', 'empty text-muted',
        '<h4>아직 보유 종목이 없어요</h4><div>서버가 첫 리밸런싱을 집행하면 나타납니다.</div>'));
    } else {
      // 원본의 '적정가치' 열은 사용자 확인 후 제외했다(밸류에이션 모델 없음).
      // 그 자리에 실제 공시 재무에서 나오는 PER·ROE를 세웠다.
      card.append(table(['종목', '산업', '보유일', '현재가', 'PER', 'ROE', '1일', '총 수익률', '비중'],
        rows, (r) => `
        <td><div class="sym"><span class="sym-badge">${(r.symbol || '').slice(0, 2)}</span>
          <div><div>${r.symbol}</div>${r.name ? `<div class="sym-name">${r.name}</div>` : ''}</div></div></td>
        <td class="num"><span class="tag tag-neutral">${r.industry || r.sector || 'Unknown'}</span></td>
        <td class="num">${held(r.entry_ts) == null ? '—' : `${held(r.entry_ts)}일`}</td>
        <td class="num">${usd(r.price)}<div class="sym-name">평단 ${usd(r.avg_cost)}</div></td>
        <td class="num">${r.per == null ? '—' : `${nf(r.per, 1)}x`}</td>
        <td class="num">${r.roe == null ? '—' : `${nf(r.roe, 1)}%`}</td>
        <td class="num ${sign(r.day_return_pct)}">${pct(r.day_return_pct)}</td>
        <td class="num ${sign(r.unrealized_pct)}">${pct(r.unrealized_pct)}</td>
        <td class="num">${nf(r.weight_pct, 1)}%</td>`));
    }
    left.append(card);

    right.append(radarCard(180));
    const pos = DATA.positions || {};
    right.append(tabbedCard('분산', [
      ['섹터', () => donut(pos.sectors || [], 'weight_pct', 'sector')],
      ['산업', () => donut(pos.industries || [], 'weight_pct', 'industry')],
      ['티커', () => donut((pos.rows || []).slice(0, 10), 'weight_pct', 'symbol')],
    ]));
    split.append(left, right);
    root.append(split);
  }

  function radarCard(R = 78) {
    const axes = (DATA.positions?.factors?.axes || []).filter((a) => a.portfolio != null);
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '포트폴리오 팩터 프로필'));
    if (axes.length < 3) {
      card.append(el('div', 'text-muted',
        '<div style="font-size:12px">재무 데이터가 모이면 표시됩니다.</div>'));
      return card;
    }
    const C = R + 30, S = C * 2, n = axes.length;
    const pt = (i, r) => {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      return [C + r * Math.cos(a), C + r * Math.sin(a)];
    };
    const poly = (fn) => Array.from({ length: n }, (_, i) =>
      pt(i, fn(i)).map((v) => v.toFixed(1)).join(',')).join(' ');
    const svg = sv('svg', { viewBox: `0 0 ${S} ${S}`, class: 'radar' });
    [0.25, 0.5, 0.75, 1].forEach((f) => svg.append(sv('polygon', {
      points: poly(() => R * f), fill: 'none',
      stroke: 'var(--color-neutral-800)', 'stroke-width': 1 })));
    svg.append(sv('polygon', { points: poly((i) => (R * axes[i].portfolio) / 100),
      fill: 'color-mix(in srgb, var(--color-accent) 26%, transparent)',
      stroke: 'var(--color-accent)', 'stroke-width': 2 }));
    axes.forEach((a, i) => {
      const [x, y] = pt(i, R + 20);
      svg.append(sv('text', { x: x.toFixed(1), y: (y + 3).toFixed(1), 'text-anchor': 'middle',
        fill: 'var(--color-neutral-400)', 'font-size': 10.5 },
      `${a.axis} ${Math.round(a.portfolio)}`));
    });
    card.append(svg);
    card.append(el('div', 'text-muted',
      '<div style="font-size:11px">보유 종목 <b>안에서의</b> 상대 백분위(0~100). 시장 전체 대비 '
      + '절대 점수가 아니다. 원본의 <b>미래</b> 축은 실적 전망 데이터가 없어 제외했다.</div>'));
    return card;
  }

  // ══ 대시보드 › 수익률 ════════════════════════════════════════════
  function tabReturns(root) {
    const contrib = DATA.trades?.contribution || [];
    const rr = DATA.trades?.returns_rows || [];
    const left = el('div', 'stack'); const right = el('div', 'stack');

    left.append(chartCard(), periodsCard());

    const wf = el('div', 'card elev-sm');
    wf.append(el('div', 'card-title', '수익 구성 — 종목별 기여 누적'));
    wf.append(waterfall(contrib));
    wf.append(el('div', 'text-muted',
      '<div style="font-size:11px">각 막대는 그 종목이 전체 원가 대비 얹은 손익(%)이다. '
      + '실현 + 미실현 합계.</div>'));
    left.append(wf);

    const det = el('div', 'card elev-sm');
    const dh = el('div', 'card-head');
    dh.append(el('div', 'card-title', '상세 수익 리포트'));
    if (rr.length) {
      dh.append(csvButton('returns',
        ['symbol', 'name', 'sector', 'entry', 'weight_pct', 'avg_cost', 'price',
          'unrealized_pct', 'contribution_pct'], rr,
        (r) => [r.symbol, r.name, r.sector, day(r.entry_ts), r.weight_pct, r.avg_cost,
          r.price, r.unrealized_pct, r.contribution_pct]));
    }
    det.append(dh);
    // 원본은 수량·평가액·매입원가 열이 있는데 금액이라 제외했다(사용자 확인 완료).
    // IRR 열도 입출금 기록이 없어 계산 불가라 제외.
    det.append(rr.length
      ? table(['종목', '진입일', '비중', '평단', '현재가', '미실현', '기여도'], rr, (r) => `
        <td>${r.symbol}${r.name ? `<div class="sym-name">${r.name}</div>` : ''}</td>
        <td class="num text-muted">${day(r.entry_ts)}</td>
        <td class="num">${nf(r.weight_pct, 1)}%</td>
        <td class="num">${usd(r.avg_cost)}</td>
        <td class="num">${usd(r.price)}</td>
        <td class="num ${sign(r.unrealized_pct)}">${pct(r.unrealized_pct)}</td>
        <td class="num ${sign(r.contribution_pct)}">${pct(r.contribution_pct)}</td>`)
      : el('div', 'empty text-muted', '<h4>보유 종목이 없습니다</h4>'));
    left.append(det);

    const trades = (DATA.trades?.rows || []).slice(0, 30);
    const tc = el('div', 'card elev-sm');
    tc.append(el('div', 'card-title', '최근 거래'));
    tc.append(trades.length
      ? table(['일자', '종목', '구분', '체결가'], trades, (r) => {
        const buy = String(r.side || '').toLowerCase() === 'buy';
        return `<td class="text-muted">${day(r.ts)}</td><td class="num">${r.symbol}</td>
          <td class="num"><span class="tag ${buy ? 'tag-accent' : 'tag-neutral'}">${buy ? '매수' : '매도'}</span></td>
          <td class="num">${usd(r.price)}</td>`;
      })
      : el('div', 'text-muted', '<div style="font-size:12px">거래 이력 없음</div>'));
    left.append(tc);

    const gain = contrib.filter((c) => (c.contribution_pct ?? 0) > 0);
    const lose = contrib.filter((c) => (c.contribution_pct ?? 0) < 0);
    // 상위/하위는 부호로 가른다. 꼬리만 자르면 음수 기여가 5개 미만일 때 양수가 섞인다.
    if (gain.length) {
      const c = el('div', 'card elev-sm');
      c.append(el('div', 'card-title', '기여도 상위'));
      c.append(bars(gain.slice(0, 6), 'contribution_pct', 'symbol', { signed: true }));
      right.append(c);
    }
    if (lose.length) {
      const c = el('div', 'card elev-sm');
      c.append(el('div', 'card-title', '기여도 하위'));
      c.append(bars(lose.slice(-6).reverse(), 'contribution_pct', 'symbol', { signed: true }));
      right.append(c);
    }
    const split = el('div', 'split');
    split.append(left, right);
    root.append(split);
  }

  // ══ 대시보드 › 배당금 ════════════════════════════════════════════
  function tabDividends(root) {
    const d = DATA.positions?.dividends || {};
    if (!d.rows?.length) {
      root.append(emptyCard('배당', '배당 데이터가 없습니다'));
      return;
    }
    const yoc = d.rows.filter((r) => r.yield_on_cost_pct != null);
    const avgYoc = yoc.length
      ? yoc.reduce((a, r) => a + r.yield_on_cost_pct * (r.weight_pct || 0), 0)
        / (yoc.reduce((a, r) => a + (r.weight_pct || 0), 0) || 1) : null;

    // 원본은 '향후 12개월 배당 수입 US$5,091'인데 (1) 배당 가이던스를 안 받아 '향후'가
    // 아니라 최근 12개월 실적이고 (2) 금액은 공개하지 않는다 → 수익률로 표시한다.
    root.append(kpiRow([
      { label: '포트폴리오 배당수익률 (최근 12개월)', value: `${nf(d.portfolio_yield_pct, 2)}%` },
      { label: '매입가 대비 수익률', value: avgYoc == null ? '—' : `${nf(avgYoc, 2)}%`,
        sub: 'yield on cost' },
      { label: '직전 12개월 대비', value: pct(d.change_vs_prior_pct, 1),
        cls: sign(d.change_vs_prior_pct) },
      { label: '배당 지급 종목', value: String(d.rows.filter((r) => r.yield_pct).length) },
    ]));

    const split = el('div', 'split');
    const left = el('div', 'stack'); const right = el('div', 'stack');

    left.append(tabbedCard('배당 지급 내역', [
      ['월별', () => columns(d.history_monthly || [], 'yield_pct', 'period')],
      ['연도별', () => columns(d.history_yearly || [], 'yield_pct', 'period')],
    ]));

    const rec = el('div', 'card elev-sm');
    const rh = el('div', 'card-head');
    rh.append(el('div', 'card-title', '최근 배당락'));
    rh.append(csvButton('dividends', ['symbol', 'ex_date', 'dps_usd'], d.recent || [],
      (r) => [r.symbol, r.ex_date, r.dps]));
    rec.append(rh);
    rec.append(table(['배당락일', '종목', '주당'], d.recent || [], (r) =>
      `<td class="text-muted">${r.ex_date}</td><td class="num">${r.symbol}</td>
       <td class="num">${usd(r.dps)}</td>`));
    left.append(rec);

    const yc = el('div', 'card elev-sm');
    yc.append(el('div', 'card-title', '종목별 배당수익률'));
    yc.append(bars(d.rows.filter((r) => r.yield_pct), 'yield_pct', 'symbol', { d: 2 }));
    right.append(yc);

    const cc = el('div', 'card elev-sm');
    cc.append(el('div', 'card-title', '배당 기여 종목'));
    cc.append(bars(d.rows.filter((r) => r.contribution_pct)
      .sort((a, b) => b.contribution_pct - a.contribution_pct).slice(0, 8),
    'contribution_pct', 'symbol', { d: 3 }));
    cc.append(el('div', 'text-muted',
      '<div style="font-size:11px">포트폴리오 배당수익률에 각 종목이 얹는 몫(비중 가중).</div>'));
    right.append(cc);

    split.append(left, right);
    root.append(split);
  }

  // ══ 대시보드 › 분석 ══════════════════════════════════════════════
  function tabAnalysis(root) {
    const rows = DATA.positions?.rows || [];
    const axes = DATA.positions?.factors?.axes || [];
    if (!rows.length) {
      root.append(emptyCard('분석', '보유 종목이 없습니다'));
      return;
    }
    const split = el('div', 'split');
    const left = el('div', 'stack'); const right = el('div', 'stack');

    const fc = el('div', 'card elev-sm');
    const fh = el('div', 'card-head');
    fh.append(el('div', 'card-title', '펀더멘털 지표'));
    fh.append(csvButton('fundamentals',
      ['symbol', 'per', 'roe_pct', 'book_yield_pct', 'earnings_yield_pct',
        'asset_growth_pct', 'gross_profit_asset_pct'], rows,
      (r) => [r.symbol, r.per, r.roe, r.book_yield, r.earnings_yield,
        r.asset_growth, r.gross_profit_asset]));
    fc.append(fh);
    fc.append(table(['종목', 'PER', 'ROE', '순자산수익률', '이익수익률', '자산성장', '매출총이익/자산'],
      rows, (r) => `
      <td>${r.symbol}</td>
      <td class="num">${r.per == null ? '—' : `${nf(r.per, 1)}x`}</td>
      <td class="num">${r.roe == null ? '—' : `${nf(r.roe, 1)}%`}</td>
      <td class="num">${r.book_yield == null ? '—' : `${nf(r.book_yield, 1)}%`}</td>
      <td class="num">${r.earnings_yield == null ? '—' : `${nf(r.earnings_yield, 1)}%`}</td>
      <td class="num ${sign(-(r.asset_growth ?? 0))}">${r.asset_growth == null ? '—' : `${nf(r.asset_growth, 1)}%`}</td>
      <td class="num">${r.gross_profit_asset == null ? '—' : `${nf(r.gross_profit_asset, 1)}%`}</td>`));
    fc.append(el('div', 'text-muted',
      '<div style="font-size:11px">SEC EDGAR XBRL 공시 재무 기준. 공시일이 기준일 이전인 '
      + '가장 최근 보고서만 쓴다(미래참조 차단).</div>'));
    left.append(fc);

    if (axes.length) {
      const pc = el('div', 'card elev-sm');
      pc.append(el('div', 'card-title', '종목별 팩터 백분위'));
      pc.append(table(['종목', ...axes.map((a) => a.axis)], rows, (r) =>
        `<td>${r.symbol}</td>` + axes.map((a) => {
          const v = a.symbols?.[r.symbol];
          return `<td class="num">${v == null ? '—' : Math.round(v)}</td>`;
        }).join('')));
      left.append(pc);
    }

    right.append(radarCard(96));
    const sc = el('div', 'card elev-sm');
    sc.append(el('div', 'card-title', '섹터 분산'));
    sc.append(donut(DATA.positions?.sectors || [], 'weight_pct', 'sector'));
    right.append(sc);

    split.append(left, right);
    root.append(split);
  }

  // ══ 페이지: 분석 리포트 ══════════════════════════════════════════
  function pageReport(root) {
    root.append(el('section', 'hero',
      '<div class="hero-kicker">Methodology</div>'
      + '<h1 class="hero-title">어떻게 <span>검증</span>했는가</h1>'
      + '<p class="hero-sub">이 페이지는 성과가 아니라 절차를 설명한다. '
      + '무엇을 재고, 무엇을 못 재는지 적어둔다.</p>'));

    const split = el('div', 'split');
    const left = el('div', 'stack'); const right = el('div', 'stack');
    left.append(principlesCard());

    const src = el('div', 'card elev-sm');
    src.append(el('div', 'card-title', '데이터 출처'));
    const kv = el('div', 'kv');
    [['가격·지수', 'yfinance (일봉, 수정주가)'],
      ['재무', 'SEC EDGAR XBRL — 공시일 키잉'],
      ['섹터·산업·배당', 'yfinance'],
      ['체결·잔고', '한국투자증권 OpenAPI'],
      ['벤치마크', 'SPY (배당재투자 ETF)']]
      .forEach(([k, v]) => kv.append(el('div', 'kv-k', k), el('div', 'kv-v', v)));
    src.append(kv);
    left.append(src);

    // 무엇을 못 보여주는지 적는 절. 안 적으면 '없는 것'과 '0인 것'을 구분할 수 없다.
    const gap = el('div', 'card elev-sm');
    gap.append(el('div', 'card-title', '표시하지 않는 지표와 이유'));
    [['적정가치 · 현금흐름 가치', '밸류에이션(DCF) 모델이 없다. 추정치를 지어내지 않는다.'],
      ['목표주가 · 선행 PER · 이익 성장', '애널리스트 컨센서스 데이터 소스가 없다.'],
      ['지역별 매출 분산', '사업부문·지역 세그먼트 데이터를 수집하지 않는다.'],
      ['라이브 뉴스', '뉴스 API를 붙이지 않았다.'],
      ['IRR', '입출금 시점별 현금흐름 기록이 없다. 대신 CAGR을 쓰고 라벨도 CAGR이다.'],
      ['금액 · 수량', '공개 페이지라 계좌 규모를 내보내지 않는다. 내보내기 단계에서 빠진다.']]
      .forEach(([k, v]) => {
        const row = el('div', 'principle');
        row.append(el('div', 'principle-k', k), el('div', 'principle-v', v));
        gap.append(row);
      });
    left.append(gap);

    const cav = el('div', 'card elev-sm');
    cav.append(el('div', 'card-title', '⚠️ 읽을 때 주의'));
    [['표본이 짧다', '실운용 기록이 몇 달 단위면 Sharpe·CAGR은 잡음이다. 판정하려면 최소 120 관측이 필요하다.'],
      ['생존편향', 'S&P500 구성종목은 시점별로 강제하지만, 상장폐지 종목의 손실은 완전히 반영되지 않는다.'],
      ['백테스트 ≠ 미래', '워크포워드 OOS는 선택 절차의 일반화를 재는 것이지 수익을 보장하지 않는다.']]
      .forEach(([k, v]) => {
        const row = el('div', 'principle');
        row.append(el('div', 'principle-k', k), el('div', 'principle-v', v));
        cav.append(row);
      });
    right.append(cav, strategyCard());

    split.append(left, right);
    root.append(split, notice());
  }

  // ── 라우터 ────────────────────────────────────────────────────────
  const NAV = [['#/', '홈'], ['#/dashboard', '대시보드'], ['#/report', '분석 리포트']];
  const TABS = [['holdings', '보유종목', tabHoldings], ['returns', '수익률', tabReturns],
    ['dividends', '배당금', tabDividends], ['analysis', '분석', tabAnalysis]];

  function renderNav(route) {
    const nav = $('#nav-links');
    if (!nav) return;
    nav.innerHTML = '';
    NAV.forEach(([href, label]) => {
      const a = el('a', null, label);
      a.href = href;
      const active = href === '#/' ? route === '/' : route.startsWith(href.slice(1));
      if (active) a.setAttribute('aria-current', 'page');
      nav.append(a);
    });
  }

  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const root = $('#app');
    root.innerHTML = '';
    renderNav(hash);
    window.scrollTo(0, 0);

    if (!DATA.summary) {
      root.append(el('div', 'card empty text-muted',
        '<h4>데이터를 불러오지 못했습니다</h4><div style="font-size:12.5px">'
        + 'summary.json 이 없습니다. <code>python -m engine.export_web</code> 를 실행하세요.</div>'));
      return;
    }
    if (hash.startsWith('/dashboard')) return renderDashboard(root, hash);
    if (hash.startsWith('/report')) return pageReport(root);
    return pageHome(root);
  }

  function renderDashboard(root, hash) {
    const want = hash.split('/')[2] || TABS[0][0];
    const cur = TABS.find((t) => t[0] === want) || TABS[0];
    const bar = el('div', 'tabbar');
    TABS.forEach(([id, label]) => {
      const a = el('a', null, label);
      a.href = `#/dashboard/${id}`;
      if (id === cur[0]) a.setAttribute('aria-current', 'page');
      bar.append(a);
    });
    root.append(bar, notice());
    cur[2](root);
  }

  async function start({ dataDir = 'data' } = {}) {
    DATA = await load(dataDir);
    window.addEventListener('hashchange', route);
    route();
  }

  return { start };
})();
