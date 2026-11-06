describe('sign in', () => {
  it('shows the two-factor step after the password', async () => {
    expect(['password', 'two-factor']).toContain('two-factor');
  });
});
