/** Cents as money for people: 123456 with 'usd' → "$1,234.56"; without a currency, "1234.56". */
export function formatMoney(cents: number, currency: string | null): string {
  if (!currency) return (cents / 100).toFixed(2);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
