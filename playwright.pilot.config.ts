import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['parent-invitation.spec.ts', 'parent-family.spec.ts', 'parent-history.spec.ts', 'parent-consent.spec.ts', 'staff-admission.spec.ts', 'account-choice.spec.ts', 'email-confirmation.spec.ts', 'password-recovery.spec.ts', 'reset-email.spec.ts', 'profile-hydration.spec.ts', 'auth-network.spec.ts'],
  timeout: 45_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4189',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4189',
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
  },
})
