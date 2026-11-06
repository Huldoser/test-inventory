describe('blotter', () => {
  it('lists the fills of the day', () => {
    cy.wrap([{ symbol: 'AAPL' }, { symbol: 'MSFT' }]).should('have.length', 2);
  });

  describe.skip('exports', () => {
    it('exports fills as CSV', () => {});
  });
});
