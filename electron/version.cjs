/** True when version `a` ("1.2.0" or "v1.2.0") is newer than `b`. */
function isNewer(a, b) {
  const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

module.exports = { isNewer };
