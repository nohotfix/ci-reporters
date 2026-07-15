import { expect, test } from 'vitest';
import { nhf } from '@nohotfix/vitest-reporter';

// Each automated test carries its NoHotfix ci_key via task metadata — NOT a `[nhf:key]` title
// token. `nhf.tag(ctx, '<ci_key>')` writes it with no Vitest internals leaking into your test.
// The binding survives title/describe/file renames. (These use plain assertions so the dogfood
// runs with no extra setup; a real suite would exercise whatever it likes — the reporter is
// agnostic to what the test does.)

test('checkout completes for a new user', (ctx) => {
  nhf.tag(ctx, 'checkout.new-user.complete');
  expect(2 + 2).toBe(4);
});

test('quote returns the premium tier for campers', (ctx) => {
  // The equivalent raw-metadata path (no helper import) would be:
  //   ctx.task.meta.nhfKey = 'camper.funnel.quote.premium';
  nhf.tag(ctx, 'camper.funnel.quote.premium');
  expect('premium').toBe('premium');
});

// A test with no nhf tag — intentionally omitted from the NoHotfix submission.
test('internal smoke check (not tracked in NoHotfix)', () => {
  expect(true).toBe(true);
});
