import { nhf } from '@nohotfix/cypress-reporter/support';

// A second spec file. Cypress runs both specs under one Node plugin process, so this exercises the
// reporter's multi-spec collection. Note this suite deliberately reuses the exact title path
// `checkout > completes for a new user` (also in checkout.cy.ts) with a DIFFERENT ci_key — the
// reporter scopes each tag to its spec file, so the two never collide.

describe('checkout', () => {
  it('completes for a new user', () => {
    nhf.tag('billing.checkout.new-user.complete');
    expect(1 + 1).to.equal(2);
  });
});
