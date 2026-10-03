import { defineConfig, devices } from '@playwright/test';

const pixel7 = devices['Pixel 7'] ?? {
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
};

// Optional path for CI/sandbox images that already ship Chromium but cannot
// download Playwright-managed browsers. Normal local runs stay Playwright-native.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'ios-safari-iphone-14',
      use: { ...devices['iPhone 14'], browserName: 'webkit' },
    },
    {
      name: 'android-chrome-pixel-7',
      use: {
        ...pixel7,
        browserName: 'chromium',
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run dev:visual',
    url: 'http://127.0.0.1:4173/en/terminal',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
