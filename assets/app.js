/* Astra 대시보드 렌더러 — export_web이 만든 정적 JSON 4종을 읽어 그린다.
 *
 * 대시보드는 하나다(공개 웹). 마스터/공개를 나누지 않는 대신, 노출하면 안 되는 것은
 * 데이터 단계에서 뺀다 — 수량·평가금액·수수료·실현손익은 JSON에 아예 없고 총자산은
 * 시작=100 지수다. "화면에서 가리기"는 소스를 보면 뚫린다.
 *
 * 절 구성은 클로드 디자인 초안(Portfolio Holdings)을 그대로 따르고, 정보 구조만
 * 참고 사이트(운용 성과 페이지)에서 가져왔다 — 히어로·고지·기간별 성과·전략 원칙.
 *
 * 외부 의존성 없음. 차트는 SVG를 직접 그린다.
 */
const Astra = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (text != null) n.textContent = text;
    return n;
  };

  // ── 포맷 ──────────────────────────────────────────────────────────
  const nf = (v, d = 2) =>
    v == null || Number.isNaN(v) ? '—'
      : v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%`);
  const pp = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%p`);
  const usd = (v) => (v == null ? '—' : `US$${nf(v, 2)}`);
  const sign = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
  const day = (ts) => (ts ? String(ts).slice(0, 10) : '—');
  const heldDays = (ts) => {
    if (!ts) return null;
    const d = (Date.now() - Date.parse(ts)) / 86400000;
    return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : null;
  };

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

  // ── 히어로 (참고 사이트 정보 구조) ────────────────────────────────
  function renderHero(root, data) {
    const s = (data.summary?.strategies || [])[0];
    const info = Object.values(data.summary?.strategy || {})[0] || {};
    const all = (data.summary?.periods || []).find((p) => p.period === '전체');

    const hero = el('section', 'hero');
    hero.append(el('div', 'hero-kicker', 'Astra Quant Portfolio'));
    hero.append(el('h1', 'hero-title', 'S&amp;P500 <span>팩터 기반</span> 시스템 트레이딩'));
    hero.append(el('p', 'hero-sub',
      '워크포워드로 검증한 팩터 전략을 서버가 자동 집행한다. '
      + '아래 숫자는 백테스트가 아니라 실제 집행 기록이다.'));

    const facts = el('div', 'hero-facts');
    [['운용 상태', s ? '운용 중' : '대기', s ? 'ok' : ''],
      ['설정일', day(s?.start)],
      ['기준일', day(s?.last)],
      ['전략', info.champion || '—'],
      ['리밸런싱', info.rebalance || '—'],
      ['보유 종목', info.top_n ?? (data.positions?.rows?.length || '—')],
    ].forEach(([k, v, cls]) => {
      const f = el('div', 'hero-fact');
      f.append(el('div', 'hero-fact-k', k), el('div', `hero-fact-v ${cls || ''}`, String(v)));
      facts.append(f);
    });
    hero.append(facts);

    if (all) {
      const band = el('div', 'hero-band');
      band.innerHTML =
        `<span>설정 이후 누적 <b class="${sign(all.strategy_pct)}">${pct(all.strategy_pct)}</b></span>`
        + (all.benchmark_pct == null ? ''
          : `<span>S&amp;P500 <b>${pct(all.benchmark_pct)}</b></span>`
            + `<span>초과 <b class="${sign(all.excess_pp)}">${pp(all.excess_pp)}</b></span>`);
      hero.append(band);
    }
    root.append(hero);
  }

  function renderNotice(root, data) {
    const n = el('div', 'notice notice-warn');
    n.innerHTML =
      '<b>⚠️ 개인 포트폴리오 안내</b> — 1인이 운영하는 개인 계좌의 자동매매 기록이다. '
      + '투자 권유가 아니며 투자 판단과 책임은 본인에게 있다. '
      + '수량·평가금액·수수료는 공개하지 않는다(총자산은 시작=100 지수). '
      + `<span class="text-muted">· 갱신 ${data.summary?.generated_at || '—'}</span>`;
    root.append(n);
  }

  // ── KPI (초안 그대로) ─────────────────────────────────────────────
  function renderKpis(root, data) {
    const s = (data.summary?.strategies || [])[0];
    const series = (data.equity?.series || [])[0];
    const n = data.positions?.rows?.length ?? 0;
    const wrap = el('div', 'kpis');
    [{ label: `누적 지수 (시작=100) · ${n}개 종목`,
      value: nf(series?.points?.at(-1)?.index, 1) },
    { label: '1일 수익률', value: pct(s?.day_return_pct), cls: sign(s?.day_return_pct) },
    { label: '총 수익률', value: pct(s?.total_return_pct), cls: sign(s?.total_return_pct) },
    // 초안은 'IRR'인데 입출금 이력이 없어 IRR은 못 낸다 — CAGR이라고 적는다.
    { label: '연평균 수익률 (CAGR)', value: pct(s?.cagr_pct), cls: sign(s?.cagr_pct) },
    ].forEach((k) => {
      const c = el('div', 'card elev-sm');
      c.append(el('div', 'kpi-label', k.label), el('div', `kpi-value ${k.cls || ''}`, k.value));
      wrap.append(c);
    });
    root.append(wrap);
  }

  // ── 평가 곡선 (초안 그대로) ───────────────────────────────────────
  const RANGES = [['1M', 30], ['3M', 91], ['YTD', null], ['1Y', 365], ['전체', Infinity]];

  function clip(points, days) {
    if (!points?.length) return [];
    if (days === Infinity) return points;
    const end = Date.parse(points.at(-1).ts);
    const from = days == null
      ? Date.parse(`${new Date(end).getUTCFullYear()}-01-01T00:00:00Z`)
      : end - days * 86400000;
    return points.filter((p) => Date.parse(p.ts) >= from);
  }
  function rebase(points) {
    if (!points?.length) return [];
    const base = points.find((p) => p.index > 0)?.index;
    if (!base) return [];
    return points.map((p) => ({ ts: p.ts, index: (p.index / base) * 100 }));
  }
  const linePath = (pts, x, y) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.index).toFixed(1)}`).join(' ');

  function renderChart(box, data, rangeDays) {
    box.innerHTML = '';
    const series = (data.equity?.series || [])[0];
    const pts = clip(series?.points, rangeDays);
    if (pts.length < 2) {
      box.append(el('div', 'empty text-muted',
        '<h4>아직 그릴 곡선이 없어요</h4><div>스냅샷이 2개 이상 쌓이면 표시됩니다.</div>'));
      return;
    }
    // 벤치마크는 같은 창으로 자른 뒤 그 구간 시작=100으로 다시 정규화한다.
    // 전체 기간 지수를 그대로 얹으면 1M 창에서 두 선의 출발점이 어긋난다.
    const bm = (data.equity?.benchmarks || [])[0];
    const bpts = rebase(clip(bm?.points, rangeDays));
    const spts = rebase(pts);

    const W = 900, H = 300, PAD = { t: 12, r: 52, b: 22, l: 8 };
    const all = spts.concat(bpts).map((p) => p.index);
    const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / span);
    const xs = (i, n) => PAD.l + (W - PAD.l - PAD.r) * (n > 1 ? i / (n - 1) : 0);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart',
      preserveAspectRatio: 'none' });
    for (let i = 0; i <= 4; i++) {
      const v = lo + (span * i) / 4;
      svg.append(svgEl('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v),
        stroke: 'var(--color-neutral-800)', 'stroke-width': 1 }));
      svg.append(svgEl('text', { x: W - PAD.r + 8, y: y(v) + 3.5,
        fill: 'var(--color-neutral-500)', 'font-size': 10 }, nf(v, 1)));
    }
    if (bpts.length > 1) {
      svg.append(svgEl('path', { d: linePath(bpts, (i) => xs(i, bpts.length), y), fill: 'none',
        stroke: 'var(--color-neutral-500)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
        'vector-effect': 'non-scaling-stroke' }));
    }
    svg.append(svgEl('path', { d: linePath(spts, (i) => xs(i, spts.length), y), fill: 'none',
      stroke: 'var(--color-accent)', 'stroke-width': 2, 'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke' }));
    box.append(svg);

    const legend = el('div', 'legend text-muted');
    legend.innerHTML =
      `<span><i style="background:var(--color-accent)"></i>전략 ${series.strategy || ''}</span>`
      + (bpts.length > 1
        ? `<span><i style="background:var(--color-neutral-500)"></i>${bm.name}</span>` : '')
      + `<span style="margin-left:auto">${day(spts[0].ts)} → ${day(spts.at(-1).ts)}</span>`;
    box.append(legend);
  }

  // ── 기간별 성과 (참고 사이트의 '분기 운용결과') ───────────────────
  function renderPeriods(root, data) {
    const rows = data.summary?.periods || [];
    if (!rows.length) return;
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '기간별 성과 — 시장 대비'));
    const grid = el('div', 'period-grid');
    rows.forEach((r) => {
      grid.append(el('div', 'period-cell',
        `<div class="period-k">${r.period}</div>`
        + `<div class="period-v ${sign(r.strategy_pct)}">${pct(r.strategy_pct, 1)}</div>`
        + `<div class="period-b text-muted">S&amp;P500 ${pct(r.benchmark_pct, 1)}</div>`
        + `<div class="period-e ${sign(r.excess_pp)}">${pp(r.excess_pp, 1)}</div>`));
    });
    card.append(grid);
    card.append(el('div', 'text-muted',
      '<div style="font-size:11px">초과수익은 같은 구간을 시작=100으로 다시 맞춰 비교한 값이다.'
      + '</div>'));
    root.append(card);
  }

  // ── 팩터 프로필 (초안의 '스노우플레이크') ─────────────────────────
  function renderRadar(root, data) {
    const axes = (data.positions?.factors?.axes || []).filter((a) => a.portfolio != null);
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '포트폴리오 팩터 프로필'));
    if (axes.length < 3) {
      card.append(el('div', 'text-muted',
        '<div style="font-size:12px">재무 데이터가 모이면 표시됩니다.</div>'));
      root.append(card);
      return;
    }
    const R = 78, C = 108, n = axes.length;
    const pt = (i, r) => {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      return [C + r * Math.cos(a), C + r * Math.sin(a)];
    };
    const poly = (r, i2r) => Array.from({ length: n }, (_, i) =>
      pt(i, i2r ? i2r(i) : r).map((v) => v.toFixed(1)).join(',')).join(' ');

    const svg = svgEl('svg', { viewBox: '0 0 216 216', class: 'radar' });
    [0.25, 0.5, 0.75, 1].forEach((f) => svg.append(svgEl('polygon', {
      points: poly(R * f), fill: 'none',
      stroke: 'var(--color-neutral-800)', 'stroke-width': 1 })));
    svg.append(svgEl('polygon', {
      points: poly(null, (i) => (R * axes[i].portfolio) / 100),
      fill: 'color-mix(in srgb, var(--color-accent) 26%, transparent)',
      stroke: 'var(--color-accent)', 'stroke-width': 2 }));
    axes.forEach((a, i) => {
      const [x, y] = pt(i, R + 20);
      svg.append(svgEl('text', { x: x.toFixed(1), y: (y + 3).toFixed(1),
        'text-anchor': 'middle', fill: 'var(--color-neutral-400)', 'font-size': 10.5 },
      `${a.axis} ${Math.round(a.portfolio)}`));
    });
    card.append(svg);
    card.append(el('div', 'text-muted',
      '<div style="font-size:11px">보유 종목 <b>안에서의</b> 상대 백분위다(0~100). '
      + '시장 전체 대비 절대 점수가 아니다 — 서버엔 보유 종목 재무만 둔다.</div>'));
    root.append(card);
  }

  // ── 보유 종목 (초안 + PER·ROE) ────────────────────────────────────
  function renderHoldings(root, data) {
    const rows = data.positions?.rows || [];
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title',
      `보유 종목 <span class="text-muted">${rows.length}</span>`));
    if (!rows.length) {
      card.append(el('div', 'empty text-muted',
        '<h4>아직 보유 종목이 없어요</h4><div>서버가 첫 리밸런싱을 집행하면 나타납니다.</div>'));
      root.append(card);
      return;
    }
    // 초안의 '적정가치' 열 자리에 PER을 세웠다 — 밸류에이션 모델이 없어 적정가치는
    // 채울 값이 없고, PER은 실제 공시 재무(SEC XBRL)에서 나온다.
    const cols = ['종목', '산업', '보유일', '현재가', 'PER', 'ROE', '1일', '총 수익률', '비중'];
    const t = el('table', 'table');
    t.innerHTML = `<thead><tr>${cols
      .map((c, i) => `<th class="${i > 1 ? 'num' : ''}">${c}</th>`).join('')}</tr></thead>`;
    const tb = el('tbody');
    rows.forEach((r) => {
      const held = heldDays(r.entry_ts);
      tb.append(el('tr', null, `
        <td><div class="sym"><span class="sym-badge">${(r.symbol || '').slice(0, 2)}</span>
          <div><div>${r.symbol}</div>${r.name
            ? `<div class="sym-name">${r.name}</div>` : ''}</div></div></td>
        <td><span class="tag tag-neutral">${r.industry || r.sector || 'Unknown'}</span></td>
        <td class="num">${held == null ? '—' : `${held}일`}</td>
        <td class="num">${usd(r.price)}<div class="sym-name">평단 ${usd(r.avg_cost)}</div></td>
        <td class="num">${r.per == null ? '—' : `${nf(r.per, 1)}x`}</td>
        <td class="num">${r.roe == null ? '—' : `${nf(r.roe, 1)}%`}</td>
        <td class="num ${sign(r.day_return_pct)}">${pct(r.day_return_pct)}</td>
        <td class="num ${sign(r.unrealized_pct)}">${pct(r.unrealized_pct)}</td>
        <td class="num">${nf(r.weight_pct, 1)}%</td>`));
    });
    t.append(tb);
    const scroll = el('div', 'scroll-x');
    scroll.append(t);
    card.append(scroll);
    root.append(card);
  }

  // ── 막대 목록 ─────────────────────────────────────────────────────
  function barList(rows, valueKey, labelKey, signed) {
    const box = el('div');
    if (!rows.length) {
      box.append(el('div', 'text-muted', '<div style="font-size:12px">데이터 없음</div>'));
      return box;
    }
    const max = Math.max(...rows.map((r) => Math.abs(r[valueKey] ?? 0)), 1e-9);
    rows.forEach((r) => {
      const v = r[valueKey] ?? 0;
      // 비중은 부호 없는 값이다 — '+100.0%'는 늘었다는 뜻으로 읽힌다.
      box.append(el('div', 'bar-row',
        `<span>${r[labelKey] ?? '—'}</span>`
        + `<span class="num ${signed ? sign(v) : ''}">${signed ? pct(v, 1)
          : `${nf(Math.abs(v), 1)}%`}</span>`
        + `<span class="bar-track"><span class="bar-fill ${signed ? sign(v) : ''}"`
        + ` style="width:${(Math.abs(v) / max) * 100}%"></span></span>`));
    });
    return box;
  }

  function barCard(title, rows, valueKey, labelKey, signed) {
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', title));
    card.append(barList(rows, valueKey, labelKey, signed));
    return card;
  }

  // ── 분산 3탭 (초안: 섹터 / 산업 / 티커) ───────────────────────────
  function renderDiversification(root, data) {
    const pos = data.positions || {};
    const tabs = [['섹터', pos.sectors || [], 'sector'],
      ['산업', pos.industries || [], 'industry'],
      ['티커', (pos.rows || []).slice(0, 12), 'symbol']];
    const card = el('div', 'card elev-sm');
    const head = el('div', 'card-head');
    head.append(el('div', 'card-title', '분산'));
    const seg = el('div', 'seg');
    const body = el('div');
    tabs.forEach(([label, rows, key], i) => {
      const b = el('button', null, label);
      b.setAttribute('aria-pressed', String(i === 0));
      b.onclick = () => {
        [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        body.innerHTML = '';
        body.append(barList(rows, 'weight_pct', key, false));
      };
      seg.append(b);
    });
    head.append(seg);
    body.append(barList(tabs[0][1], 'weight_pct', 'sector', false));
    card.append(head, body);
    root.append(card);
  }

  // ── 배당 (초안의 배당 절) ─────────────────────────────────────────
  function renderDividends(root, data) {
    const d = data.positions?.dividends || {};
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '배당'));
    if (!d.rows?.length) {
      card.append(el('div', 'text-muted',
        '<div style="font-size:12px">배당 데이터가 없습니다.</div>'));
      root.append(card);
      return;
    }
    // 초안은 '향후 12개월 배당 수입'인데 우리는 배당 가이던스를 안 받는다 — 예상이
    // 아니라 최근 12개월 실적이고, 수량을 곱하지 않으니 '수입'이 아니라 '수익률'이다.
    card.append(el('div', 'div-head',
      '<div class="kpi-label">포트폴리오 배당수익률 (최근 12개월 실적)</div>'
      + `<div class="kpi-value">${nf(d.portfolio_yield_pct, 2)}%</div>`));
    card.append(barList(d.rows.filter((r) => r.yield_pct).slice(0, 8),
      'yield_pct', 'symbol', false));

    if (d.recent?.length) {
      card.append(el('div', 'card-title', '최근 배당락 (주당)'));
      const t = el('table', 'table');
      t.innerHTML = '<thead><tr><th>배당락일</th><th>종목</th>'
        + '<th class="num">주당</th></tr></thead>';
      const tb = el('tbody');
      d.recent.forEach((r) => tb.append(el('tr', null,
        `<td class="text-muted">${r.ex_date}</td><td>${r.symbol}</td>`
        + `<td class="num">${usd(r.dps)}</td>`)));
      t.append(tb);
      card.append(t);
    }
    root.append(card);
  }

  // ── 최근 거래 (초안) ──────────────────────────────────────────────
  function renderTrades(root, data) {
    const rows = (data.trades?.rows || []).slice(0, 30);
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '최근 거래'));
    if (!rows.length) {
      card.append(el('div', 'text-muted', '<div style="font-size:12px">거래 이력 없음</div>'));
      root.append(card);
      return;
    }
    const t = el('table', 'table');
    t.innerHTML = '<thead><tr><th>일자</th><th>종목</th><th>구분</th>'
      + '<th class="num">체결가</th></tr></thead>';
    const tb = el('tbody');
    rows.forEach((r) => {
      const buy = String(r.side || '').toLowerCase() === 'buy';
      tb.append(el('tr', null, `
        <td class="text-muted">${day(r.ts)}</td><td>${r.symbol}</td>
        <td><span class="tag ${buy ? 'tag-accent' : 'tag-neutral'}">${buy ? '매수' : '매도'}</span></td>
        <td class="num">${usd(r.price)}</td>`));
    });
    t.append(tb);
    const scroll = el('div', 'scroll-x');
    scroll.append(t);
    card.append(scroll);
    root.append(card);
  }

  // ── 전략 노트 · 운용 원칙 (참고 사이트의 '운용역 노트'·'투자 철학') ─
  function renderStrategy(root, data) {
    const info = Object.values(data.summary?.strategy || {})[0] || {};
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
    root.append(card);

    const p = el('div', 'card elev-sm');
    p.append(el('div', 'card-title', '운용 원칙'));
    [['워크포워드 OOS',
      '폴드마다 학습 구간만 보고 후보를 고른 뒤, 손대지 않은 다음 구간에서 잰다.'],
    ['무작위 대조군',
      '종목 수·회전율을 맞춘 무작위 선택을 이기는지 본다. 동일가중만 보면 노출 차이가 실력으로 보인다.'],
    ['시장이 기준',
      '무작위를 이기는 건 최소 조건이다. 진짜 질문은 SPY를 위험조정으로 넘느냐다.'],
    ['백테스트=라이브',
      '시그널 코드 해시가 다르면 주문을 내지 않는다(fail-closed).'],
    ['비용 반영',
      '수수료·세금·슬리피지를 회전율 기준으로 백테스트에 물린다.']].forEach(([k, v]) => {
      const row = el('div', 'principle');
      row.append(el('div', 'principle-k', k), el('div', 'principle-v', v));
      p.append(row);
    });
    root.append(p);
  }

  // ── 조립 ──────────────────────────────────────────────────────────
  async function render({ mount = '#app', dataDir = 'data' } = {}) {
    const root = $(mount);
    const data = await load(dataDir);
    root.innerHTML = '';

    if (!data.summary) {
      root.append(el('div', 'card empty text-muted',
        `<h4>데이터를 불러오지 못했습니다</h4>
         <div style="font-size:12.5px">${dataDir}/summary.json 이 없습니다.
         먼저 <code>python -m engine.export_web</code> 를 실행하세요.</div>`));
      return;
    }

    renderHero(root, data);
    renderNotice(root, data);
    renderKpis(root, data);

    const split = el('div', 'split');
    const left = el('div', 'stack');
    const right = el('div', 'stack');

    const chartCard = el('div', 'card elev-sm');
    const head = el('div', 'card-head');
    head.append(el('div', 'card-title', '기간별 평가금액'));
    const seg = el('div', 'seg');
    const box = el('div');
    RANGES.forEach(([label, days]) => {
      const b = el('button', null, label);
      b.setAttribute('aria-pressed', String(label === '전체'));
      b.onclick = () => {
        [...seg.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        renderChart(box, data, days);
      };
      seg.append(b);
    });
    head.append(seg);
    chartCard.append(head, box);
    renderChart(box, data, Infinity);

    left.append(chartCard);
    renderPeriods(left, data);
    renderHoldings(left, data);
    renderDividends(left, data);
    renderTrades(left, data);

    renderRadar(right, data);
    renderDiversification(right, data);
    // 상위/하위는 부호로 가른다. 꼬리만 자르면 음수 기여가 5개 미만일 때 양수가 섞인다.
    const contrib = data.trades?.contribution || [];
    const gainers = contrib.filter((c) => (c.contribution_pct ?? 0) > 0);
    const losers = contrib.filter((c) => (c.contribution_pct ?? 0) < 0);
    if (gainers.length) {
      right.append(barCard('기여도 상위', gainers.slice(0, 5),
        'contribution_pct', 'symbol', true));
    }
    if (losers.length) {
      right.append(barCard('기여도 하위', losers.slice(-5).reverse(),
        'contribution_pct', 'symbol', true));
    }
    renderStrategy(right, data);

    split.append(left, right);
    root.append(split);
  }

  return { render };
})();
