import { expect, test } from '@playwright/test';

// Each automated test carries its NoHotfix ci_key via a structured `nhf` annotation —
// NOT a `[nhf:key]` title token. The binding survives title/describe/file changes.
// (These use plain assertions so the dogfood runs with no browser download; a real suite
//  would drive `page` as usual — the reporter is agnostic to what the test does.)

test(
  'checkout completes for a new user',
  { annotation: { type: 'nhf', description: 'checkout.new-user.complete' } },
  async () => {
    expect(2 + 2).toBe(4);
  },
);

test(
  'quote returns the premium tier for campers',
  { annotation: { type: 'nhf', description: 'camper.funnel.quote.premium' } },
  async () => {
    expect('premium').toBe('premium');
  },
);

// A test with no nhf annotation — intentionally omitted from the NoHotfix submission.
test('internal smoke check (not tracked in NoHotfix)', async () => {
  expect(true).toBe(true);
});
