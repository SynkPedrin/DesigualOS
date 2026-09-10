import { describe, it, expect } from 'vitest';
import { nextH3Stage } from './video-router';

describe('H3 staging (item 38: keyframe first, never auto-promote to Master)', () => {
  it('starts at keyframe generation with no keyframe yet', () => {
    expect(nextH3Stage({ hasKeyframe: false, hasDraft: false }).stage).toBe('keyframe');
  });

  it('goes to keyframe_qa once a keyframe exists but has not been evaluated', () => {
    expect(nextH3Stage({ hasKeyframe: true, hasDraft: false }).stage).toBe('keyframe_qa');
  });

  it('goes back to keyframe when QA rejected it', () => {
    expect(nextH3Stage({ hasKeyframe: true, keyframeApproved: false, hasDraft: false }).stage).toBe('keyframe');
  });

  it('goes to draft once the keyframe is approved', () => {
    expect(nextH3Stage({ hasKeyframe: true, keyframeApproved: true, hasDraft: false }).stage).toBe('draft');
  });

  it('goes to motion_qa once a draft exists but has not been approved for master', () => {
    const decision = nextH3Stage({ hasKeyframe: true, keyframeApproved: true, hasDraft: true });
    expect(decision.stage).toBe('motion_qa');
  });

  it('NEVER auto-promotes to master without an explicit approval flag (item 16: never repeat Master to explore seeds)', () => {
    const decision = nextH3Stage({ hasKeyframe: true, keyframeApproved: true, hasDraft: true, draftApprovedForMaster: undefined });
    expect(decision.stage).not.toBe('master');
  });

  it('only reaches master with explicit draftApprovedForMaster: true', () => {
    expect(nextH3Stage({ hasKeyframe: true, keyframeApproved: true, hasDraft: true, draftApprovedForMaster: true }).stage).toBe('master');
  });

  it('a false approval sends it back to motion_qa, not to draft or master', () => {
    expect(nextH3Stage({ hasKeyframe: true, keyframeApproved: true, hasDraft: true, draftApprovedForMaster: false }).stage).toBe('motion_qa');
  });
});
