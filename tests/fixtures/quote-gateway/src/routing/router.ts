const VENUES = ['XNAS', 'ARCX', 'XLON'];

/** The venue an order routes to: the one asked for when the gateway knows it, else the primary. */
export function route(venue: string | undefined): string {
  return venue && VENUES.includes(venue) ? venue : 'XNAS';
}
