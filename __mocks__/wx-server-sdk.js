module.exports = {
  init: jest.fn(),
  database: jest.fn(() => ({
    collection: jest.fn()
  })),
  getWXContext: jest.fn(() => ({ OPENID: 'test-openid' })),
  serverDate: () => new Date()
};
