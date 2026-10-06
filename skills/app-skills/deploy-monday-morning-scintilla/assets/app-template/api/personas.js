import { runQuery } from './sql.js';

// A stable, human identity per vendor so the app feels like a real person's
// desk, not a generated view. Seeded deterministically from vendor_nbr so the
// same vendor always gets the same person.
const FIRST = ['Maria', 'David', 'Sofia', 'James', 'Priya', 'Marcus', 'Elena', 'Tom', 'Aisha', 'Diego', 'Hannah', 'Ken'];
const LAST = ['Alvarez', 'Chen', 'Rossi', 'Okafor', 'Patel', 'Nguyen', 'Brooks', 'Silva', 'Kim', 'Torres', 'Walsh', 'Haddad'];
const TITLES = ['Category Lead', 'Senior Category Manager', 'Director of Sales', 'Customer Business Manager', 'Head of Retail Insights'];
const REGIONS = ['NA · Bentonville', 'NA · Northeast', 'NA · West', 'NA · Central', 'NA · Southeast'];

function identityFor(vendor_nbr) {
  const n = Math.abs(Number(vendor_nbr) || 0);
  const first = FIRST[n % FIRST.length];
  const last = LAST[(n >> 3) % LAST.length];
  return {
    person: `${first} ${last}`,
    initials: (first[0] + last[0]).toUpperCase(),
    title: TITLES[n % TITLES.length],
    region: REGIONS[(n >> 2) % REGIONS.length],
  };
}

// Every vendor becomes a persona; categories are the omni departments the vendor
// actually sells. Plus a Super User (all vendors / all categories).
export async function listPersonas() {
  const vendors = await runQuery(`
    SELECT vendor_nbr, MAX(vendor_nm) AS vendor_nm, ROUND(SUM(sales_amt),0) AS sales
    FROM store_sales
    WHERE vendor_nbr IS NOT NULL AND vendor_nm IS NOT NULL
    GROUP BY vendor_nbr ORDER BY SUM(sales_amt) DESC
  `);
  const cats = await runQuery(`
    SELECT s.vendor_nbr, i.omni_dept_desc AS cat
    FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
    WHERE s.vendor_nbr IS NOT NULL AND i.omni_dept_desc IS NOT NULL
    GROUP BY s.vendor_nbr, i.omni_dept_desc
  `);
  const byVendor = {};
  for (const r of cats) (byVendor[r.vendor_nbr] ||= []).push(r.cat);
  const personas = vendors.map((v) => {
    const idy = identityFor(v.vendor_nbr);
    return {
      id: String(v.vendor_nbr),
      vendor_nbr: Number(v.vendor_nbr),
      vendor_nm: v.vendor_nm,
      person: idy.person,
      initials: idy.initials,
      title: idy.title,
      region: idy.region,
      role: `${idy.title} · ${v.vendor_nm}`,
      categories: (byVendor[v.vendor_nbr] || []).sort(),
      sales: Number(v.sales),
    };
  });
  personas.unshift({
    id: 'super', vendor_nbr: null, vendor_nm: 'Super User',
    person: 'Super User', initials: 'SU', title: 'All access', region: 'All regions',
    role: 'All vendors · all categories', categories: [], sales: null,
  });
  return personas;
}
