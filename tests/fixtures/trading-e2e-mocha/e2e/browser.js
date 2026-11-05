// Root hooks: one browser for the whole run, and a fresh page for each test, kept on the test's context.
const puppeteer = require('puppeteer');

let browser;

exports.mochaHooks = {
  async beforeAll() {
    browser = await puppeteer.launch();
  },
  async beforeEach() {
    this.page = await browser.newPage();
  },
  async afterEach() {
    await this.page.close();
  },
  async afterAll() {
    await browser.close();
  },
};
