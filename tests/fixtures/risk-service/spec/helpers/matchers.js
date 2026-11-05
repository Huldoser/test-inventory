// Loaded before every spec file: a matcher for money amounts, to the cent.
beforeEach(() => {
  jasmine.addMatchers({
    toBeCents: () => ({
      compare: (actual, expected) => ({ pass: Math.round(actual * 100) === Math.round(expected * 100) }),
    }),
  });
});
