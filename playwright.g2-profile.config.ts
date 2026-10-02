import { defineConfig } from '@playwright/test'
import pilot from './playwright.pilot.config'

// Isolated entry point while shared pilot test configuration is being coordinated.
export default defineConfig({
  ...pilot,
  testMatch: ['player-guardian-profile.spec.ts'],
})
