/* Astra 대시보드 렌더러 — export_web이 만든 정적 JSON 4종을 읽어 그린다.
 *
 * 공개(index.html)와 마스터(master.html)가 같은 파일을 쓴다. 차이는 데이터뿐이다:
 * 공개본 JSON엔 금액·수량 필드가 아예 없어서(export_web이 안 넣는다) 여기서 가릴 것도
 * 없다 — "화면에서 숨기기"는 소스를 보면 뚫리므로 데이터 단계에서 막는다.
 *
 * 외부 의존성 없음. 차트는 SVG를 직접 그린다 — 정적 호스팅에 번들러를 들일 이유가 없고,
 * 선 두 개와 막대 몇 줄에 차트 라이브러리를 붙이면 그게 더 큰 코드다.
 */
const Astra = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  // ── 포맷 ──────────────────────────────────────────────────────────
  const nf = (v, d = 2) =>
    v == null || Number.isNaN(v) ? '—'
      : v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${nf(v, d)}%`);
  const usd = (v) => (v == null ? '—' : `US$${nf(v, 2)}`);
  const krw = (v) => (v == null ? '—' : `₩${nf(v, 0)}`);
  const sign = (v) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '');
  const day = (ts) => (ts ? String(ts).slice(0, 10) : '—');
  const heldDays = (ts) => {
    if (!ts) return null;
    const d = (Date.now() - Date.parse(ts)) / 86400000;
    return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : null;
  };

  // ── 데이터 ────────────────────────────────────────────────────────
  async function load(dir) {
    const out = {};
    await Promise.all(['summary', 'equity', 'positions', 'trades'].map(async (n) => {
      try {
        const r = await fetch(`${dir}/${n}.json`, { cache: 'no-store' });
        out[n] = r.ok ? await r.json() : null;
      } catch { out[n] = null; }
    }));
    return out;
  }

  // ── KPI ───────────────────────────────────────────────────────────
  function renderKpis(root, data, showAmounts) {
    const s = (data.summary?.strategies || [])[0];
    const series = (data.equity?.series || [])[0];
    const last = series?.amounts?.at(-1)?.value;
    const n = data.positions?.rows?.length ?? 0;

    // 공개본은 금액이 없다 → 총 평가금액 자리에 누적 지수를 세운다.
    // 목업의 US$349,283을 그대로 쓰면 그게 곧 계좌 잔고 공개다.
    const headline = showAmounts && last != null
      ? { label: `총 평가금액 · ${n}개 종목`, value: krw(last) }
      : { label: `누적 지수 (시작=100) · ${n}개 종목`,
          value: nf(series?.points?.at(-1)?.index, 1) };

    const kpis = [
      headline,
      { label: '1일 수익률', value: pct(s?.day_return_pct), cls: sign(s?.day_return_pct) },
      { label: '총 수익률', value: pct(s?.total_return_pct), cls: sign(s?.total_return_pct) },
      // 목업은 'IRR'인데 우리는 입출금 이력이 없어 IRR을 못 낸다 — CAGR이라고 적는다.
      { label: '연평균 수익률 (CAGR)', value: pct(s?.cagr_pct), cls: sign(s?.cagr_pct) },
    ];

    const wrap = el('div', 'kpis');
    kpis.forEach((k) => {
      const c = el('div', 'card elev-sm');
      c.append(el('div', 'kpi-label', k.label),
               el('div', `kpi-value ${k.cls || ''}`, k.value));
      wrap.append(c);
    });
    root.append(wrap);
  }

  // ── 평가 곡선 ─────────────────────────────────────────────────────
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

  const linePath = (points, x, y) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.index).toFixed(1)}`).join(' ');

  function renderChart(box, data, rangeDays) {
    box.innerHTML = '';
    const series = (data.equity?.series || [])[0];
    const pts = clip(series?.points, rangeDays);
    if (pts.length < 2) {
      box.append(el('div', 'empty text-muted',
        '<h4>아직 그릴 곡선이 없어요</h4><div>스냅샷이 2개 이상 쌓이면 표시됩니다.</div>'));
      return;
    }
    // 벤치마크는 전략 구간에 맞춰 자른 뒤 그 구간 시작=100으로 다시 정규화한다.
    // 전체 기간 기준 지수를 그대로 얹으면 1M 창에서 두 선의 출발점이 어긋난다.
    const bm = (data.equity?.benchmarks || [])[0];
    const bpts = rebase(clip(bm?.points, rangeDays));
    const spts = rebase(pts);

    const W = 900, H = 300, PAD = { t: 12, r: 52, b: 22, l: 8 };
    const all = spts.concat(bpts).map((p) => p.index);
    const lo = Math.min(...all), hi = Math.max(...all);
    const span = hi - lo || 1;
    const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / span);
    const xs = (i, n) => PAD.l + (W - PAD.l - PAD.r) * (n > 1 ? i / (n - 1) : 0);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('preserveAspectRatio', 'none');
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      if (text != null) n.textContent = text;
      svg.append(n);
      return n;
    };

    // 격자는 후퇴시킨다 — 데이터가 주인공이고 축은 안내판이다
    for (let i = 0; i <= 4; i++) {
      const v = lo + (span * i) / 4;
      add('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v),
        stroke: 'var(--color-neutral-800)', 'stroke-width': 1 });
      add('text', { x: W - PAD.r + 8, y: y(v) + 3.5,
        fill: 'var(--color-neutral-500)', 'font-size': 10 }, nf(v, 1));
    }
    if (bpts.length > 1) {
      add('path', { d: linePath(bpts, (i) => xs(i, bpts.length), y), fill: 'none',
        stroke: 'var(--color-neutral-500)', 'stroke-width': 1.5,
        'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' });
    }
    add('path', { d: linePath(spts, (i) => xs(i, spts.length), y), fill: 'none',
      stroke: 'var(--color-accent)', 'stroke-width': 2,
      'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' });

    box.append(svg);
    const legend = el('div', 'legend text-muted');
    legend.innerHTML =
      `<span><i style="background:var(--color-accent)"></i>전략 ${series.strategy || ''}</span>` +
      (bpts.length > 1
        ? `<span><i style="background:var(--color-neutral-500)"></i>${bm.name}</span>` : '') +
      `<span style="margin-left:auto">${day(spts[0].ts)} → ${day(spts.at(-1).ts)}</span>`;
    box.append(legend);
  }

  // ── 보유 종목 ─────────────────────────────────────────────────────
  function renderHoldings(root, data, showAmounts) {
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
    // 목업의 '적정가치' 열은 뺐다 — 밸류에이션 모델이 없어 채울 값이 없다.
    // 대신 실제로 가진 것(섹터·보유일수)을 세웠다.
    const cols = ['종목', '섹터', '보유일', '현재가', '1일', '총 수익률',
      showAmounts ? '평가액 / 원가' : '비중'];
    const t = el('table', 'table');
    t.innerHTML = `<thead><tr>${cols
      .map((c, i) => `<th class="${i > 1 ? 'num' : ''}">${c}</th>`).join('')}</tr></thead>`;
    const tb = el('tbody');
    rows.forEach((r) => {
      const held = heldDays(r.entry_ts);
      const value = r.qty != null && r.price != null ? r.qty * r.price : null;
      const cost = r.qty != null && r.avg_cost != null ? r.qty * r.avg_cost : null;
      tb.append(el('tr', null, `
        <td><div class="sym"><span class="sym-badge">${(r.symbol || '').slice(0, 2)}</span>
          <div><div>${r.symbol}</div>${r.name
            ? `<div class="sym-name">${r.name}</div>` : ''}</div></div></td>
        <td><span class="tag tag-neutral">${r.sector || 'Unknown'}</span></td>
        <td class="num">${held == null ? '—' : `${held}일`}</td>
        <td class="num">${usd(r.price)}<div class="sym-name">평단 ${usd(r.avg_cost)}</div></td>
        <td class="num ${sign(r.day_return_pct)}">${pct(r.day_return_pct)}</td>
        <td class="num ${sign(r.unrealized_pct)}">${pct(r.unrealized_pct)}</td>
        <td class="num">${showAmounts
          ? `${usd(value)}<div class="sym-name">${usd(cost)}</div>`
          : `${nf(r.weight_pct, 1)}%`}</td>`));
    });
    t.append(tb);
    const scroll = el('div', 'scroll-x');
    scroll.append(t);
    card.append(scroll);
    root.append(card);
  }

  // ── 막대 목록(분산·기여도) ────────────────────────────────────────
  function barCard(title, rows, valueKey, labelKey, opts = {}) {
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', title));
    if (!rows.length) {
      card.append(el('div', 'text-muted', '<div style="font-size:12px">데이터 없음</div>'));
      return card;
    }
    const max = Math.max(...rows.map((r) => Math.abs(r[valueKey] ?? 0)), 1e-9);
    rows.forEach((r) => {
      const v = r[valueKey] ?? 0;
      // 비중(signed=false)은 부호 없는 값이다 — '+100.0%'는 늘었다는 뜻으로 읽힌다.
      const label = opts.signed ? pct(v, 1) : `${nf(Math.abs(v), 1)}%`;
      card.append(el('div', 'bar-row',
        `<span>${r[labelKey] ?? '—'}</span>` +
        `<span class="num ${opts.signed ? sign(v) : ''}">${label}</span>` +
        `<span class="bar-track"><span class="bar-fill ${opts.signed ? sign(v) : ''}"` +
        ` style="width:${(Math.abs(v) / max) * 100}%"></span></span>`));
    });
    return card;
  }

  // ── 최근 거래 ─────────────────────────────────────────────────────
  function renderTrades(root, data, showAmounts) {
    const rows = (data.trades?.rows || []).slice(0, 30);
    const card = el('div', 'card elev-sm');
    card.append(el('div', 'card-title', '최근 거래'));
    if (!rows.length) {
      card.append(el('div', 'text-muted', '<div style="font-size:12px">거래 이력 없음</div>'));
      root.append(card);
      return;
    }
    const t = el('table', 'table');
    t.innerHTML = `<thead><tr><th>일자</th><th>종목</th><th>구분</th>
      <th class="num">체결가</th>${showAmounts ? '<th class="num">수량</th>' : ''}</tr></thead>`;
    const tb = el('tbody');
    rows.forEach((r) => {
      const buy = String(r.side || '').toLowerCase() === 'buy';
      tb.append(el('tr', null, `
        <td class="text-muted">${day(r.ts)}</td>
        <td>${r.symbol}</td>
        <td><span class="tag ${buy ? 'tag-accent' : 'tag-neutral'}">${buy ? '매수' : '매도'}</span></td>
        <td class="num">${usd(r.price)}</td>
        ${showAmounts ? `<td class="num">${nf(r.qty, 0)}</td>` : ''}`));
    });
    t.append(tb);
    const scroll = el('div', 'scroll-x');
    scroll.append(t);
    card.append(scroll);
    root.append(card);
  }

  // ── 조립 ──────────────────────────────────────────────────────────
  async function render({ mount = '#app', dataDir = 'data', showAmounts = false } = {}) {
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

    const note = el('div', 'notice');
    note.innerHTML = showAmounts
      ? `<b>마스터 뷰</b> — 금액·수량 포함. 이 페이지는 공개 저장소로 나가지 않습니다.
         · 갱신 ${data.summary.generated_at}`
      : `<b>공개 뷰</b> — 금액·수량은 데이터에 포함되지 않습니다(수익률·비중만).
         · 갱신 ${data.summary.generated_at}`;
    root.append(note);

    renderKpis(root, data, showAmounts);

    const split = el('div', 'split');
    const left = el('div', 'stack');
    const right = el('div', 'stack');

    const chartCard = el('div', 'card elev-sm');
    const head = el('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
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
    renderHoldings(left, data, showAmounts);
    renderTrades(left, data, showAmounts);

    right.append(barCard('섹터별 분산', data.positions?.sectors || [], 'weight_pct', 'sector'));
    right.append(barCard('보유 종목별 분산',
      (data.positions?.rows || []).slice(0, 12), 'weight_pct', 'symbol'));
    // 상위/하위는 부호로 가른다. slice(-5)로 꼬리만 자르면 음수 기여가 5개 미만일 때
    // 양수가 '하위'에 섞여 들어간다 — 손실 기여 목록에 이익 종목이 앉는 셈이다.
    const contrib = data.trades?.contribution || [];
    const gainers = contrib.filter((c) => (c.contribution_pct ?? 0) > 0);
    const losers = contrib.filter((c) => (c.contribution_pct ?? 0) < 0);
    if (gainers.length) {
      right.append(barCard('기여도 상위', gainers.slice(0, 5),
        'contribution_pct', 'symbol', { signed: true }));
    }
    if (losers.length) {
      right.append(barCard('기여도 하위', losers.slice(-5).reverse(),
        'contribution_pct', 'symbol', { signed: true }));
    }

    split.append(left, right);
    root.append(split);
  }

  return { render };
})();
