/**
 * Tests for pi-env.js
 */
import { describe, it, expect, vi } from 'vitest'

// We import the functions — some depend on filesystem state, so we test
// what we can without mocking the entire fs.

describe('getDashConfig', () => {
  it('returns an object with expected structure', async () => {
    const { getDashConfig } = await import('../pi-env.js')
    const config = getDashConfig()

    expect(config).toBeDefined()
    expect(config).toHaveProperty('vault')
    expect(config.vault).toHaveProperty('path')
    expect(config.vault).toHaveProperty('dirs')
    expect(config.vault.dirs).toHaveProperty('daily')
    expect(config.vault.dirs).toHaveProperty('tasks')
    expect(config.vault.dirs).toHaveProperty('meetings')
    expect(config.vault.dirs).toHaveProperty('people')
    expect(config.vault.dirs).toHaveProperty('recipes')
  })

  it('returns consistent results on repeated calls (caching)', async () => {
    const { getDashConfig } = await import('../pi-env.js')
    const config1 = getDashConfig()
    const config2 = getDashConfig()
    expect(config1).toBe(config2) // same reference due to caching
  })
})

describe('getMemoryStats', () => {
  it('returns an object with expected keys', async () => {
    const { getMemoryStats } = await import('../pi-env.js')
    const stats = getMemoryStats()

    expect(stats).toHaveProperty('facts')
    expect(stats).toHaveProperty('lessons')
    expect(stats).toHaveProperty('events')
    // Values should be numbers (0 if DB doesn't exist)
    expect(typeof stats.facts).toBe('number')
    expect(typeof stats.lessons).toBe('number')
  })
})

describe('getSkills', () => {
  it('returns an array', async () => {
    const { getSkills } = await import('../pi-env.js')
    const skills = getSkills()
    expect(Array.isArray(skills)).toBe(true)
    // Each skill should have name and description
    if (skills.length > 0) {
      expect(skills[0]).toHaveProperty('name')
      expect(skills[0]).toHaveProperty('description')
    }
  })
})

describe('getExtensions', () => {
  it('returns an array', async () => {
    const { getExtensions } = await import('../pi-env.js')
    const exts = getExtensions()
    expect(Array.isArray(exts)).toBe(true)
    if (exts.length > 0) {
      expect(exts[0]).toHaveProperty('name')
      expect(exts[0]).toHaveProperty('file')
    }
  })
})

describe('getVaultStats', () => {
  it('returns an object with expected keys', async () => {
    const { getVaultStats } = await import('../pi-env.js')
    const stats = getVaultStats()
    expect(stats).toHaveProperty('path')
    expect(stats).toHaveProperty('dailyNotes')
    expect(stats).toHaveProperty('taskNotes')
    expect(stats).toHaveProperty('meetingNotes')
    expect(stats).toHaveProperty('persons')
    expect(stats).toHaveProperty('recipes')
    expect(typeof stats.dailyNotes).toBe('number')
  })
})

describe('getRecentSessions', () => {
  it('returns an array of sessions', async () => {
    const { getRecentSessions } = await import('../pi-env.js')
    const sessions = getRecentSessions(5)
    expect(Array.isArray(sessions)).toBe(true)
    if (sessions.length > 0) {
      expect(sessions[0]).toHaveProperty('key')
      expect(sessions[0]).toHaveProperty('title')
      expect(sessions[0]).toHaveProperty('project')
      expect(sessions[0]).toHaveProperty('modified')
    }
  })
})

describe('getCrontab', () => {
  it('returns an array', async () => {
    const { getCrontab } = await import('../pi-env.js')
    const cron = getCrontab()
    expect(Array.isArray(cron)).toBe(true)
    if (cron.length > 0) {
      expect(cron[0]).toHaveProperty('schedule')
      expect(cron[0]).toHaveProperty('command')
      expect(cron[0]).toHaveProperty('raw')
    }
  })
})

describe('getLessons', () => {
  it('returns an array', async () => {
    const { getLessons } = await import('../pi-env.js')
    const lessons = getLessons(5)
    expect(Array.isArray(lessons)).toBe(true)
  })
})

describe('getFacts', () => {
  it('returns an array', async () => {
    const { getFacts } = await import('../pi-env.js')
    const facts = getFacts()
    expect(Array.isArray(facts)).toBe(true)
  })
})
