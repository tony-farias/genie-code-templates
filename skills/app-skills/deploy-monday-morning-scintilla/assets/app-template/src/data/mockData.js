// ── Navigation & page config ──
// Agentic Search removed from the demo per 2026-05-18 working session decision.
// Measurement renumbered 06 → 05.
export const navItems = [
  { id: '01', label: 'Sales', path: '/app/sales', testId: 'nav-app-01', activeBg: 'bg-db-navy' },
  { id: '02', label: 'Forecast', path: '/app/forecast', testId: 'nav-app-02', activeBg: 'bg-db-navy' },
  { id: '03', label: 'Inventory', path: '/app/inventory', testId: 'nav-app-inv', activeBg: 'bg-db-navy' },
  { id: '07', label: 'Hourly Stats', path: '/app/hourly', testId: 'nav-app-03', activeBg: 'bg-db-navy' },
  { id: '04', label: 'Category', path: '/app/category', testId: 'nav-app-04', activeBg: 'bg-db-navy' },
  { id: '05', label: 'E-com', path: '/app/ecom', testId: 'nav-app-05', activeBg: 'bg-db-navy' },
  { id: '08', label: 'Agents', path: '/app/agents', testId: 'nav-app-08', activeBg: 'bg-db-lava' },
  { id: '09', label: 'Commerce Exchange', path: '/app/commerce', testId: 'nav-app-09', activeBg: 'bg-db-lava' },
];

export const pageConfig = {
  '/app/sales': { number: '01', title: 'Sales Performance', badgeText: 'text-db-success', badgeBorder: 'border-db-success' },
  '/app/forecast': { number: '02', title: 'Demand Forecast', badgeText: 'text-db-warning', badgeBorder: 'border-db-warning' },
  '/app/inventory': { number: '03', title: 'Inventory Intelligence', badgeText: 'text-db-lava', badgeBorder: 'border-db-lava' },
  '/app/hourly': { number: '07', title: 'Hourly Stats', badgeText: 'text-db-info', badgeBorder: 'border-db-info' },
  '/app/category': { number: '04', title: 'Category Intelligence', badgeText: 'text-foreground', badgeBorder: 'border-db-neutral-700' },
  '/app/ecom': { number: '05', title: 'E-commerce Intelligence', badgeText: 'text-db-success', badgeBorder: 'border-db-success' },
  '/app/summary': { number: '06', title: 'Executive Summary', badgeText: 'text-db-lava', badgeBorder: 'border-db-lava' },
  '/app/agents': { number: '08', title: 'Agents', badgeText: 'text-db-lava', badgeBorder: 'border-db-lava' },
  '/app/commerce': { number: '09', title: 'Commerce Exchange', badgeText: 'text-db-lava', badgeBorder: 'border-db-lava' },
};

// ── Hub Page ──
export const hubNodes = [
  { id: '01', name: 'SALES', sub: 'PERF.', color: 'green', persona: 'CMO / Category Mgr', path: '/app/sales' },
  { id: '02', name: 'DEMAND', sub: 'FORECAST', color: 'orange', persona: 'Demand Planner', path: '/app/demand' },
  { id: '03', name: 'AUDIENCE', sub: 'BUILDER', color: 'purple', persona: 'Media / Insights', path: '/app/audience' },
  { id: '04', name: 'IN-STORE', sub: 'EXEC.', color: 'green', persona: 'Store Manager', path: '/app/instore' },
  { id: '05', name: 'MEASURE', sub: '-MENT', color: 'lime', persona: 'Analytics / CMO', path: '/app/measure' },
];

export const hubCards = [
  {
    icon: 'AlertTriangle',
    iconColor: 'text-db-error',
    label: 'THE PROBLEM',
    body: 'A hero SKU is down vs plan in the NJ Tri-State region. Planogram demotion, competitor activity, and stockouts are happening simultaneously. ',
    boldEnd: 'Real revenue at risk.',
  },
  {
    icon: 'Link2',
    iconColor: 'text-db-success',
    label: 'THE CONNECTED LOOP',
    body: 'Sales signal → demand reforecast → audience build → in-store execution → sponsored search → measurement → loop closes back to audience.',
    boldEnd: null,
  },
  {
    icon: 'Zap',
    iconColor: 'text-db-info',
    label: 'ONE GOVERNANCE',
    body: 'One Unity Catalog. One feature store. Five apps. Genie makes every dataset conversational. Measurement results feed back into audience — no manual reconciliation.',
    boldEnd: null,
  },
];

// ── Sales Page ──
export const salesMetrics = [
  {
    label: 'Velocity vs Plan',
    value: '-18%',
    sub: 'Declining 4 consecutive weeks',
    icon: 'TrendingDown',
    iconColor: 'text-db-error',
    valueColor: 'text-db-error',
    bg: 'bg-card',
    border: 'border-border',
  },
  {
    label: 'On-Shelf Avail.',
    value: '87%',
    sub: 'Below 95% target SLA',
    icon: 'Gauge',
    iconColor: 'text-db-warning',
    valueColor: 'text-db-warning',
    bg: 'bg-card',
    border: 'border-border',
  },
  {
    label: 'Share of Shelf',
    value: '22%',
    sub: '-400bps vs Category Avg',
    icon: 'AlertTriangle',
    iconColor: 'text-db-warning',
    valueColor: 'text-foreground',
    bg: 'bg-card',
    border: 'border-border',
  },
  {
    label: 'Revenue at Risk',
    value: '$847K',
    sub: 'Projected quarterly gap',
    icon: 'DollarSign',
    iconColor: 'text-db-error',
    valueColor: 'text-db-error',
    labelColor: 'text-db-error',
    subColor: 'text-db-error',
    bg: 'bg-db-error-tint',
    border: 'border-border',
  },
];

export const salesVelocityData = [
  { week: 'W1', plan: 120, actual: 120 },
  { week: 'W2', plan: 120, actual: 118 },
  { week: 'W3', plan: 120, actual: 117 },
  { week: 'W4', plan: 120, actual: 112 },
  { week: 'W5', plan: 120, actual: 105 },
  { week: 'W6', plan: 120, actual: 100 },
  { week: 'W7', plan: 120, actual: 97 },
  { week: 'W8', plan: 120, actual: 94 },
];

export const rootCauses = [
  { label: 'Planogram Demotion', pct: 42, barColor: 'bg-db-error', textColor: 'text-db-error' },
  { label: 'Competitor BOGO Promo', pct: 31, barColor: 'bg-db-warning', textColor: 'text-db-warning' },
  { label: 'Out of Stock Events', pct: 21, barColor: 'bg-db-warning', textColor: 'text-db-warning' },
  { label: 'Other / Noise', pct: 6, barColor: 'bg-db-neutral-300', textColor: 'text-muted-foreground' },
];

export const salesTabs = ['Overview', 'SKU Analysis', 'Store Map', 'Genie'];

// ── Demand Page ──
export const demandMetrics = [
  { label: 'PEAK WEEK', value: 'W10', sub: '+33% above baseline', valueColor: 'text-foreground', subColor: 'text-db-success', bg: 'bg-card', border: 'border-border' },
  { label: 'INCREMENTAL CASES', value: '84,000', sub: 'Required vs baseline', valueColor: 'text-db-warning', bg: 'bg-card', border: 'border-border' },
  { label: 'LEAD TIME GAP', value: '-3 Days', sub: 'Expediting required', icon: 'AlertTriangle', iconColor: 'text-db-error', valueColor: 'text-db-error', labelColor: 'text-db-error', subColor: 'text-db-error', bg: 'bg-db-error-tint', border: 'border-border' },
  { label: 'STOCKOUT PROBABILITY', value: '23%', sub: 'Across region w/o intervention', valueColor: 'text-foreground', bg: 'bg-card', border: 'border-border' },
];

export const demandForecastData = Array.from({ length: 16 }, (_, i) => {
  const campaignValues = [null, null, null, null, null, null, null, 93, 105, 117, 113, 105, 97, 90, 84, 78];
  return {
    week: `W${i + 1}`,
    baseline: 85,
    campaign: campaignValues[i],
  };
});

export const demandTabs = ['Forecast', 'Simulation', 'Store Risk', 'Genie'];

// ── Audience Page ──
export const audienceSegments = [
  {
    name: 'Lapsed Buyers',
    desc: 'Last purchase 90+ days ago',
    selected: false,
    aiPick: false,
    stats: { size: '2.3M', repurchase: '34%', lift: '+12%', roas: '3.2x' },
  },
  {
    name: 'Competitive Switchers',
    desc: 'Brand-switching behavior detected',
    selected: true,
    aiPick: true,
    stats: { size: '890K', repurchase: '51%', lift: '+19%', roas: '5.1x' },
    recommendation: 'Recommended by Demand Forecast · Highest incremental ROAS',
  },
  {
    name: 'Price-Sensitive Loyalists',
    desc: '3+ purchases, promo-responsive',
    selected: false,
    aiPick: false,
    stats: { size: '1.7M', repurchase: '68%', lift: '+8%', roas: '4.4x' },
  },
  {
    name: 'Category Heavy Users',
    desc: 'Top-quartile CSD volume',
    selected: false,
    aiPick: false,
    stats: { size: '540K', repurchase: '72%', lift: '+6%', roas: '3.8x' },
  },
];

export const audienceTabs = ['Segments', 'Campaign Config', 'Projected Lift', 'Genie'];

// ── In-Store Page ──
export const instoreStores = [
  { name: 'Gainesville', number: '4721', score: 62, priority: 'High', reason: 'OOS + planogram demotion + promo campaign', active: true },
  { name: 'Atlanta N', number: '1842', score: 58, priority: 'High', reason: 'Highest revenue impact + lowest stock coverage', active: false },
  { name: 'Macon', number: '0933', score: 45, priority: 'High', reason: 'Missed Thursday delivery + campaign boundary', active: false },
  { name: 'Bainbridge', number: '1799', score: 52, priority: 'High', reason: '3 days stock coverage before campaign peak', active: false },
  { name: 'Statesboro', number: '1020', score: 48, priority: 'High', reason: 'Below 50 health score + OOS confirmation pending', active: false },
];

export const instoreTasks = [
  {
    priority: 'URGENT',
    title: 'Reset Dr Pepper to eye level',
    body: 'Aisle 12, Bay 3 — move from bottom shelf to row 2 (eye-level).',
    detail: 'Planogram compliance score: 34% → target 90%',
    detailColor: 'text-db-error',
    checked: false,
    containerStyle: 'bg-db-error-tint border-border hover:bg-db-error-tint',
    priorityBg: 'bg-db-error',
  },
  {
    priority: 'URGENT',
    title: 'Verify stock replenishment from back room',
    body: 'Backstock shows 14 cases — confirm shelf has minimum 6 facings.',
    detail: 'Last stockout: 2 days ago',
    detailColor: 'text-db-error',
    checked: false,
    containerStyle: 'bg-db-error-tint border-border hover:bg-db-error-tint',
    priorityBg: 'bg-db-error',
  },
  {
    priority: 'HIGH',
    title: 'Install promotional end-cap display',
    body: 'Campaign launch Apr 21. End-cap materials in back room (box label: DP-SE-042).',
    detail: 'Campaign starts in 3 days',
    detailColor: 'text-db-warning',
    checked: false,
    containerStyle: 'bg-db-warning-tint border-border hover:bg-db-warning-tint',
    priorityBg: 'bg-db-warning',
  },
  {
    priority: 'MEDIUM',
    title: 'Verify price tag matches promo pricing',
    body: 'New promo price: $4.99 (was $5.49). Check shelf tag and register ring.',
    detail: 'Promo effective date: Apr 21',
    detailColor: 'text-muted-foreground',
    checked: true,
    containerStyle: 'bg-card border-border hover:bg-accent',
    priorityBg: 'bg-db-warning',
  },
  {
    priority: 'LOW',
    title: 'Take planogram compliance photo',
    body: 'Photograph aisle 12 after reset for compliance reporting.',
    detail: 'Required for audit trail',
    detailColor: 'text-muted-foreground',
    checked: false,
    containerStyle: 'bg-card border-border hover:bg-accent',
    priorityBg: 'bg-db-neutral-500',
  },
];

export const instoreTabs = ['Task Queue', 'Planogram', 'Store Network', 'Genie'];

// ── Agentic Search Page ──
export const searchMetrics = [
  { label: 'ACTIVE CAMPAIGNS', value: '12', sub: 'Across 3 retailers', valueColor: 'text-foreground', bg: 'bg-card', border: 'border-border' },
  { label: 'TOTAL IMPRESSIONS', value: '4.2M', sub: 'Last 7 days', valueColor: 'text-db-teal', bg: 'bg-card', border: 'border-border' },
  { label: 'AVG. ROAS', value: '5.3x', sub: 'Above 4.0x target', valueColor: 'text-db-success', subColor: 'text-db-success', bg: 'bg-card', border: 'border-border' },
  { label: 'AD SPEND', value: '$124K', sub: 'Weekly budget utilization: 87%', valueColor: 'text-foreground', bg: 'bg-card', border: 'border-border' },
];

export const searchCampaigns = [
  { name: 'Dr Pepper Win-Back — Costco', status: 'Active', spend: '$34K', impressions: '1.2M', roas: '5.1x', roasColor: 'text-db-success' },
  { name: 'Dr Pepper Conquest — Kroger', status: 'Active', spend: '$28K', impressions: '980K', roas: '4.8x', roasColor: 'text-db-success' },
  { name: 'Diet Dr Pepper — Target', status: 'Pending', spend: '$18K', impressions: '540K', roas: '3.9x', roasColor: 'text-db-warning' },
  { name: 'Dr Pepper Zero — Amazon Fresh', status: 'Active', spend: '$22K', impressions: '760K', roas: '6.2x', roasColor: 'text-db-success' },
];

export const searchPerformanceData = [
  { day: 'Mon', impressions: 520, clicks: 42, conversions: 18 },
  { day: 'Tue', impressions: 610, clicks: 48, conversions: 22 },
  { day: 'Wed', impressions: 580, clicks: 45, conversions: 20 },
  { day: 'Thu', impressions: 690, clicks: 55, conversions: 28 },
  { day: 'Fri', impressions: 720, clicks: 58, conversions: 31 },
  { day: 'Sat', impressions: 650, clicks: 50, conversions: 25 },
  { day: 'Sun', impressions: 430, clicks: 34, conversions: 15 },
];

export const searchTabs = ['Campaigns', 'Bid Strategy', 'Keyword Intel', 'Genie'];

// ── Measure Page ──
export const measureMetrics = [
  { label: 'INCREMENTAL SALES', value: '$1.2M', sub: 'Attributed to campaign', valueColor: 'text-db-success', subColor: 'text-db-success', bg: 'bg-card', border: 'border-border' },
  { label: 'OVERALL ROAS', value: '5.1x', sub: 'vs 4.0x target', valueColor: 'text-db-success', bg: 'bg-card', border: 'border-border' },
  { label: 'AUDIENCE MATCH RATE', value: '94%', sub: 'Clean room verified', valueColor: 'text-foreground', bg: 'bg-card', border: 'border-border' },
  { label: 'LOOP CLOSED', value: 'Yes', sub: 'Signal fed back to audience', valueColor: 'text-db-success', icon: 'CheckCircle2', iconColor: 'text-db-success', bg: 'bg-db-success-tint', border: 'border-border' },
];

export const measureLiftData = [
  { week: 'W1', control: 100, exposed: 100 },
  { week: 'W2', control: 101, exposed: 105 },
  { week: 'W3', control: 99, exposed: 112 },
  { week: 'W4', control: 102, exposed: 118 },
  { week: 'W5', control: 100, exposed: 124 },
  { week: 'W6', control: 103, exposed: 128 },
  { week: 'W7', control: 101, exposed: 131 },
  { week: 'W8', control: 102, exposed: 127 },
];

export const measureChannelBreakdown = [
  { channel: 'Sponsored Search', contribution: 42, color: 'bg-db-teal' },
  { channel: 'In-Store Display', contribution: 28, color: 'bg-db-success' },
  { channel: 'Digital Coupons', contribution: 18, color: 'bg-db-info' },
  { channel: 'Social Media', contribution: 12, color: 'bg-db-navy' },
];

export const measureTabs = ['Attribution', 'Channel Mix', 'Clean Room', 'Genie'];
