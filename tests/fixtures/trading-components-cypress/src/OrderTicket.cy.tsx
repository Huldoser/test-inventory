import { mount } from 'cypress/react';
import { OrderTicket } from './OrderTicket';

describe('OrderTicket', () => {
  it('enables orders with buying power', () => {
    mount(<OrderTicket symbol="AAPL" buyingPower={25_000} />);
    cy.contains('button', 'Buy AAPL').should('be.enabled');
  });

  it('blocks orders without buying power', () => {
    mount(<OrderTicket symbol="AAPL" buyingPower={0} />);
    cy.contains('button', 'Buy AAPL').should('be.disabled');
  });
});
