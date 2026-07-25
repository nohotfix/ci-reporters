import { nhf } from '@nohotfix/cypress-reporter/support';

// Each automated test carries its NoHotfix ci_key via `nhf.tag` — NOT a `[nhf:key]` title token.
// The tag is bound to the running test, so it moves with a title/describe rename. (These use plain
// assertions so the dogfood runs with no app under test; a real suite would `cy.visit` and exercise
// whatever it likes — the reporter is agnostic to what the test does.)

describe('checkout', () => {
  it('completes for a new user', () => {
    nhf.tag('checkout.new-user.complete');
    expect(2 + 2).to.equal(4);
  });

  it('returns the premium tier for campers', () => {
    nhf.tag('camper.funnel.quote.premium');
    expect('premium').to.equal('premium');
  });

  // A test with no nhf tag — intentionally omitted from the NoHotfix submission.
  it('internal smoke check (not tracked in NoHotfix)', () => {
    expect(true).to.equal(true);
  });
});
