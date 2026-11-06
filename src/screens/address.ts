/**
 * Opening and closing a card of the Desk (DESIGN.md §17.4) by the address's query alone (`?card=`). **It is the History API and not the router:** the page
 * is the same and only what it reads of the address changes, so there is nothing for a server to say, and with no network the router, which asks for the
 * page, would give up and load the address again. Next sees the change (the address it reads is the window's), so `useSearchParams` follows.
 */
export function openCard(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('card', id);
  // A new entry, so that Back closes the card.
  window.history.pushState(null, '', `${url.pathname}${url.search}`);
}

export function closeCard(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('card');
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}
