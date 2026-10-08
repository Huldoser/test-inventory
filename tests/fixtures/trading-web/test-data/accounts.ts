// Passwords come from the CI secrets of the staging environment.
export const TRADER = {
  email: 'dana.okafor@example.com',
  password: process.env.TRADER_PASSWORD ?? '',
};

export const LOCKED_TRADER = {
  email: 'locked.account@example.com',
  password: process.env.LOCKED_TRADER_PASSWORD ?? '',
};
