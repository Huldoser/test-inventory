describe('order entry', () => {
  it('opens the order ticket from the watchlist', () => {
    cy.visit('/watchlist');
    cy.contains('AAPL').click();
    cy.contains('button', 'Buy AAPL').should('be.visible');
  });
});
