/**
 * Node labelling — the Auto priority order in particular.
 *
 * Auto tries the vertex type's own subtype property first (`block_type` for
 * `block`, `resource_type` for `resource`, `principal` for `principal`) and
 * only then the generic name-ish keys. Before that rule, `entity_type` won for
 * every type in this schema and each node just repeated its own vertex label.
 */

import { describe, it, expect } from 'vitest';
import {
  autoLabelCandidates,
  computeNodeLabel,
  computeEdgeLabel,
  LABEL_MODE_AUTO,
  LABEL_MODE_LABEL,
  LABEL_MODE_ID,
  LABEL_MODE_NONE,
} from '../helpers.js';

const ID = 'abcdefgh0123456789';

describe('autoLabelCandidates', () => {
  it('puts the type-derived keys before the generic ones', () => {
    const candidates = autoLabelCandidates('resource');
    expect(candidates.slice(0, 2)).toEqual(['resource_type', 'resource']);
    expect(candidates.indexOf('resource_type')).toBeLessThan(candidates.indexOf('entity_type'));
    expect(candidates).toContain('name');
  });

  it('offers both the label as written and lowercased', () => {
    expect(autoLabelCandidates('Block').slice(0, 4)).toEqual(['Block_type', 'block_type', 'Block', 'block']);
  });

  it('falls back to the generic keys for an unlabelled vertex', () => {
    expect(autoLabelCandidates('')[0]).toBe('name');
    expect(autoLabelCandidates(null)[0]).toBe('name');
  });

  it('never repeats a key', () => {
    const candidates = autoLabelCandidates('name');
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe('computeNodeLabel — Auto', () => {
  it('prefers <label>_type over entity_type', () => {
    const props = { entity_type: 'block', block_type: 'transcript', created_at: '2026-01-01' };
    expect(computeNodeLabel('block', props, ID, LABEL_MODE_AUTO)).toBe('transcript');
  });

  it('prefers a property named after the type over entity_type', () => {
    const props = { entity_type: 'principal', principal: 'user' };
    expect(computeNodeLabel('principal', props, ID, LABEL_MODE_AUTO)).toBe('user');
  });

  it('prefers <label>_type over the generic resource_type of another type', () => {
    const props = { entity_type: 'resource', resource_type: 'calendar_event' };
    expect(computeNodeLabel('resource', props, ID, LABEL_MODE_AUTO)).toBe('calendar_event');
  });

  it('uses the generic keys when the type has no key of its own', () => {
    expect(computeNodeLabel('person', { name: 'Ada', entity_type: 'person' }, ID, LABEL_MODE_AUTO)).toBe('Ada');
  });

  it('ignores empty and null values', () => {
    const props = { block_type: '', block: null, name: 'Fallback' };
    expect(computeNodeLabel('block', props, ID, LABEL_MODE_AUTO)).toBe('Fallback');
  });

  it('falls back to the label and a short id when nothing matches', () => {
    expect(computeNodeLabel('thing', { unrelated: 'x' }, ID, LABEL_MODE_AUTO)).toBe('thing\nabcdefgh');
  });

  it('truncates a long value', () => {
    const props = { block_type: 'a_very_long_block_type_value_indeed' };
    expect(computeNodeLabel('block', props, ID, LABEL_MODE_AUTO)).toBe('a_very_long_block_ty…');
  });

  it('treats a missing mode as Auto', () => {
    expect(computeNodeLabel('block', { block_type: 'meeting' }, ID, undefined)).toBe('meeting');
  });
});

describe('computeNodeLabel — explicit modes', () => {
  it('draws the chosen property even when Auto would pick another', () => {
    const props = { block_type: 'transcript', created_at: '2026-01-01' };
    expect(computeNodeLabel('block', props, ID, 'created_at')).toBe('2026-01-01');
  });

  it('falls back to label + short id when the chosen property is absent', () => {
    expect(computeNodeLabel('principal', { principal: 'user' }, ID, 'block_type')).toBe('principal\nabcdefgh');
  });

  it('draws the vertex label', () => {
    expect(computeNodeLabel('block', { block_type: 'transcript' }, ID, LABEL_MODE_LABEL)).toBe('block');
  });

  it('draws the id', () => {
    expect(computeNodeLabel('block', {}, ID, LABEL_MODE_ID)).toBe('abcdefgh01234567…');
  });
});

describe('computeEdgeLabel', () => {
  const props = { created_at: '2026-01-01', weight: 3 };

  it('draws the edge type under Auto — that is what an edge is read by', () => {
    expect(computeEdgeLabel('NESTED_IN', props, 'e1', LABEL_MODE_AUTO)).toBe('NESTED_IN');
    expect(computeEdgeLabel('NESTED_IN', props, 'e1', undefined)).toBe('NESTED_IN');
    expect(computeEdgeLabel('NESTED_IN', props, 'e1', LABEL_MODE_LABEL)).toBe('NESTED_IN');
  });

  it('draws a chosen property', () => {
    expect(computeEdgeLabel('NESTED_IN', props, 'e1', 'created_at')).toBe('2026-01-01');
    expect(computeEdgeLabel('NESTED_IN', props, 'e1', 'weight')).toBe('3');
  });

  it('falls back to the type — not the id — when the property is absent', () => {
    expect(computeEdgeLabel('HAS_ACCESS', props, 'e1', 'missing')).toBe('HAS_ACCESS');
    expect(computeEdgeLabel('HAS_ACCESS', { missing: '' }, 'e1', 'missing')).toBe('HAS_ACCESS');
  });

  it('draws nothing when hidden', () => {
    expect(computeEdgeLabel('NESTED_IN', props, 'e1', LABEL_MODE_NONE)).toBe('');
  });

  it('draws the id when asked', () => {
    expect(computeEdgeLabel('NESTED_IN', props, 'abcdefgh0123456789', LABEL_MODE_ID)).toBe('abcdefgh01234567…');
  });

  it('truncates a long value', () => {
    const long = { note: 'a-very-long-edge-property-value' };
    expect(computeEdgeLabel('NESTED_IN', long, 'e1', 'note')).toBe('a-very-long-edge-propert…');
  });

  it('survives an edge with no type', () => {
    expect(computeEdgeLabel('', {}, 'e1', LABEL_MODE_AUTO)).toBe('');
  });
});
