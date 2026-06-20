/**
 * @file brainRouter tests — EVA 2 tiered routing
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('brainRouter', () => {
  const br = require('../services/brainRouter');

  it('routes simple chat to hybrid when enabled', () => {
    process.env.EVA_HYBRID_BRAIN = 'smart';
    assert.strictEqual(br.shouldTryHybrid({
      userMessage: 'Bonjour',
      isVoice: false,
      attachedDocuments: [],
      forceToolPath: false,
      forceLocal: false,
    }), true);
  });

  it('skips hybrid for email/calendar questions', () => {
    process.env.EVA_HYBRID_BRAIN = 'smart';
    assert.strictEqual(br.shouldTryHybrid({
      userMessage: 'Résume mes emails urgents',
      isVoice: false,
      attachedDocuments: [],
      forceToolPath: false,
      forceLocal: false,
    }), false);
  });

  it('routes Chinese sourcing to hybrid', () => {
    process.env.EVA_HYBRID_BRAIN = 'smart';
    assert.strictEqual(br.isChineseSourcing('这个供应商的MOQ是多少？'), true);
    assert.strictEqual(br.shouldTryHybrid({
      userMessage: '这个供应商的MOQ是多少？',
      isVoice: false,
      attachedDocuments: [],
      forceToolPath: false,
      forceLocal: false,
    }), true);
  });

  it('forceLocal bypasses assistant brain filter', () => {
    process.env.EVA_HYBRID_BRAIN = 'smart';
    assert.strictEqual(br.shouldTryHybrid({
      userMessage: 'Quelle marge client GTLL ?',
      isVoice: false,
      attachedDocuments: [],
      forceToolPath: false,
      forceLocal: true,
    }), true);
    assert.strictEqual(br.selectRoute('test', { forceLocal: true }), 'ollama');
  });

  it('disabled when EVA_HYBRID_BRAIN=false', () => {
    process.env.EVA_HYBRID_BRAIN = 'false';
    assert.strictEqual(br.isHybridEnabled(), false);
    process.env.EVA_HYBRID_BRAIN = 'smart';
  });
});
