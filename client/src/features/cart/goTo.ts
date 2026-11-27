/** Leaves the site for another page (Stripe's Checkout). Its own module so tests can replace it. */
export function goTo(url: string) {
  window.location.assign(url);
}
