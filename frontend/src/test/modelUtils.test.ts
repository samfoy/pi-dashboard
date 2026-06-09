import { describe, expect, it } from 'vitest'
import {
  modelPatternMatches,
  normalizeConcreteModelPattern,
  preferredThinkingLevel,
  splitThinkingSuffix,
  supportedThinkingLevels,
} from '../utils/modelUtils'

describe('modelUtils', () => {
  const gpt55 = {
    provider: 'bedrock-mantle',
    id: 'openai.gpt-5.5',
    name: 'OpenAI GPT-5.5 (Bedrock)',
    reasoning: true,
    thinkingLevelMap: { off: null, xhigh: 'xhigh' },
  }

  it('strips thinking suffixes without corrupting Bedrock version colons', () => {
    expect(splitThinkingSuffix('bedrock-mantle/openai.gpt-5.5:xhigh')).toEqual({
      modelPattern: 'bedrock-mantle/openai.gpt-5.5',
      thinkingLevel: 'xhigh',
    })
    expect(splitThinkingSuffix('amazon-bedrock/anthropic.claude-sonnet-v1:0')).toEqual({
      modelPattern: 'amazon-bedrock/anthropic.claude-sonnet-v1:0',
    })
    expect(normalizeConcreteModelPattern('bedrock-mantle/openai.gpt-5.5:xhigh')).toBe('bedrock-mantle/openai.gpt-5.5')
  })

  it('matches enabledModels entries with provider/model and thinking suffix', () => {
    expect(modelPatternMatches('bedrock-mantle/openai.gpt-5.5:xhigh', gpt55)).toBe(true)
    expect(modelPatternMatches('openai.gpt-5.5:xhigh', gpt55)).toBe(true)
    expect(modelPatternMatches('bedrock-mantle/openai.gpt-5.*:xhigh', gpt55)).toBe(true)
  })

  it('uses pinned thinking suffixes for GPT models', () => {
    expect(preferredThinkingLevel(gpt55, ['bedrock-mantle/openai.gpt-5.5:xhigh'], 'medium')).toBe('xhigh')
  })

  it('mirrors pi thinking-level support semantics', () => {
    expect(supportedThinkingLevels(gpt55)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(supportedThinkingLevels({ provider: 'x', id: 'plain', reasoning: false })).toEqual(['off'])
  })
})
