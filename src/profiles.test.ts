import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import type { ProfileData } from './types';
import { BULK_ASSIGNMENT_MODE, BULK_ASSIGNMENT_TARGET, PROFILE_VERSION_SOURCE } from './types';
import { 
  extractSddAgentModels, 
  extractSddFallbackModels, 
  readProfileModels, 
  readProfileFallbackModels, 
  syncSddFallbackAgents, 
  validateProfileFallbackMapping,
  isSddProfile,
  applyProfileDataToConfig,
  applyBulkProfilePhaseAssignment,
  assignModelToUnassignedProfilePhases,
  readProfileData,
  writeProfileData,
  createProfileVersion,
  listProfileVersions,
  readProfileVersion,
  restoreProfileVersion,
  updateProfileWithBulkPhaseAssignment,
  updateProfilePhaseModel
} from './profiles';

vi.mock('node:fs');
vi.mock('./config', () => ({
  resolvePaths: () => ({
    profilesDir: '/mock/profiles',
    configRoot: '/mock/config',
    configPath: '/mock/config/opencode.json',
    backupPath: '/mock/config/opencode.json.bak',
    profileVersionsDir: '/mock/config/profile-versions'
  }),
  ensureProfilesDir: vi.fn()
}));

describe('profiles logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isSddProfile', () => {
    it('should correctly identify .json files', () => {
      expect(isSddProfile('profile.json')).toBe(true);
      expect(isSddProfile('readme.md')).toBe(false);
      expect(isSddProfile('config')).toBe(false);
    });
  });

  describe('extractSddAgentModels', () => {
    it('should extract models for primary SDD agents', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' },
          'sdd-apply': { model: 'claude-3' },
          'other-agent': { model: 'mistral' },
          'sdd-init-fallback': { model: 'gpt-3.5' } // Should ignore fallback
        }
      };
      
      const models = extractSddAgentModels(config);
      expect(models).toEqual({
        'sdd-init': 'gpt-4',
        'sdd-apply': 'claude-3'
      });
    });

    it('should return empty object if no agent field', () => {
      expect(extractSddAgentModels({})).toEqual({});
    });
  });

  describe('extractSddFallbackModels', () => {
    it('should extract fallback mapping', () => {
      const raw = {
        fallback: {
          'sdd-init': 'gpt-3.5',
          'sdd-apply': 'sonnet',
          'invalid': 'foo'
        }
      };
      
      const fallback = extractSddFallbackModels(raw);
      expect(fallback).toEqual({
        'sdd-init': 'gpt-3.5',
        'sdd-apply': 'sonnet'
      });
    });

    it('should handle missing fallback field', () => {
      expect(extractSddFallbackModels({})).toEqual({});
    });
  });

  describe('readProfileModels', () => {
    it('should parse new profile format', () => {
      const mockContent = JSON.stringify({
        models: { 'sdd-init': 'gpt-4' },
        fallback: { 'sdd-init': 'gpt-3.5' }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);
      
      const models = readProfileModels('/mock/profiles/test.json');
      expect(models).toEqual({ 'sdd-init': 'gpt-4' });
    });

    it('should parse legacy flat format', () => {
      const mockContent = JSON.stringify({
        'sdd-init': 'gpt-4',
        'sdd-apply': { model: 'claude-3' }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);
      
      const models = readProfileModels('/mock/profiles/legacy.json');
      expect(models).toEqual({
        'sdd-init': 'gpt-4',
        'sdd-apply': 'claude-3'
      });
    });

    it('should parse full config format', () => {
      const mockContent = JSON.stringify({
        agent: { 'sdd-init': { model: 'gpt-4' } }
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);
      
      const models = readProfileModels('/mock/profiles/config.json');
      expect(models).toEqual({ 'sdd-init': 'gpt-4' });
    });
  });

  describe('readProfileData and writeProfileData', () => {
    it('preserves unrelated profile fields when reading and writing full profile data', () => {
      const mockContent = JSON.stringify({
        models: { 'sdd-init': 'gpt-4' },
        fallback: { 'sdd-init': 'gpt-3.5' },
        description: 'team defaults'
      });
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profileData = readProfileData('/mock/profiles/compatible.json');
      writeProfileData('/mock/profiles/compatible.json', profileData);

      expect(profileData).toEqual({
        models: { 'sdd-init': 'gpt-4' },
        fallback: { 'sdd-init': 'gpt-3.5' },
        description: 'team defaults'
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/mock/profiles/compatible.json',
        JSON.stringify(profileData, null, 2)
      );
    });
  });

  describe('validateProfileFallbackMapping', () => {
    it('should return empty list on success', () => {
      const config = {
        agent: { 'sdd-init': { model: 'gpt-4' } }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const errors = validateProfileFallbackMapping(config, fallback);
      expect(errors).toEqual([]);
    });

    it('should catch invalid fallback targets', () => {
      const config = { agent: {} };
      const fallback = { 'sdd-orchestrator': 'gpt-4', 'invalid': 'foo' };
      
      const errors = validateProfileFallbackMapping(config, fallback);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('sdd-orchestrator');
    });

    it('should catch missing targets in config', () => {
      const config = { agent: {} };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const errors = validateProfileFallbackMapping(config, fallback);
      expect(errors).toContain("Fallback target 'sdd-init' does not exist in active config.");
    });
  });

  describe('syncSddFallbackAgents', () => {
    it('should create new fallback agents', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4', other: 'meta' }
        }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const nextConfig = syncSddFallbackAgents(config, fallback);
      expect(nextConfig.agent['sdd-init-fallback']).toEqual({
        model: 'gpt-3.5',
        other: 'meta'
      });
    });

    it('should override existing fallback agents if base agent changes', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4', other: 'new-meta' },
          'sdd-init-fallback': { model: 'gpt-3.5', other: 'old-meta' }
        }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const nextConfig = syncSddFallbackAgents(config, fallback);
      expect(nextConfig.agent['sdd-init-fallback'].other).toBe('new-meta');
    });

    it('should inherit base model if no override provided', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' }
        }
      };
      const fallback = {};
      
      const nextConfig = syncSddFallbackAgents(config, fallback);
      expect(nextConfig.agent['sdd-init-fallback'].model).toBe('gpt-4');
    });

    it('should be idempotent', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' }
        }
      };
      const fallback = { 'sdd-init': 'gpt-3.5' };
      
      const firstPass = syncSddFallbackAgents(config, fallback);
      const secondPass = syncSddFallbackAgents(firstPass, fallback);
      
      expect(firstPass).toEqual(secondPass);
    });
  });

  describe('applyProfileDataToConfig', () => {
    it('should apply both primary models and fallback reconciliation', () => {
      const config = {
        agent: {
          'sdd-init': { model: 'gpt-4' }
        }
      };
      const profile = {
        models: { 'sdd-init': 'claude-3' },
        fallback: { 'sdd-init': 'gpt-3.5' }
      };
      
      const nextConfig = applyProfileDataToConfig(config, profile);
      expect(nextConfig.agent['sdd-init'].model).toBe('claude-3');
      expect(nextConfig.agent['sdd-init-fallback'].model).toBe('gpt-3.5');
    });
  });

  describe('assignModelToUnassignedProfilePhases', () => {
    it('fills missing and blank primary SDD model assignments', () => {
      const profile = {
        models: {
          'sdd-init': '',
          'sdd-spec': '   ',
          'sdd-design': 'existing/provider',
        },
        fallback: {}
      };

      const result = assignModelToUnassignedProfilePhases(
        profile,
        ['sdd-init', 'sdd-apply', 'sdd-spec', 'sdd-design'],
        'provider/model'
      );

      expect(result.modelsAssigned).toBe(3);
      expect(result.profile.models).toEqual({
        'sdd-init': 'provider/model',
        'sdd-apply': 'provider/model',
        'sdd-spec': 'provider/model',
        'sdd-design': 'existing/provider',
      });
      expect(profile.models['sdd-init']).toBe('');
    });

    it('fills missing and blank fallback entries only for fallback-eligible SDD agents', () => {
      const profile = {
        models: {},
        fallback: {
          'sdd-init': '',
          'sdd-apply': '   ',
          'sdd-spec': 'fallback/existing'
        }
      };

      const result = assignModelToUnassignedProfilePhases(
        profile,
        ['sdd-init', 'sdd-apply', 'sdd-orchestrator', 'not-sdd'],
        'provider/model'
      );

      expect(result.fallbackAssigned).toBe(2);
      expect(result.profile.fallback).toEqual({
        'sdd-init': 'provider/model',
        'sdd-apply': 'provider/model',
        'sdd-spec': 'fallback/existing'
      });
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
    });

    it('fills primary and fallback assignments for sparse profiles without models or fallback maps', () => {
      const result = assignModelToUnassignedProfilePhases(
        {} as ProfileData,
        ['sdd-init', 'sdd-apply', 'sdd-orchestrator', 'sdd-init-fallback', 'not-sdd'],
        'provider/model'
      );

      expect(result.modelsAssigned).toBe(3);
      expect(result.fallbackAssigned).toBe(2);
      expect(result.profile).toEqual({
        models: {
          'sdd-init': 'provider/model',
          'sdd-apply': 'provider/model',
          'sdd-orchestrator': 'provider/model'
        },
        fallback: {
          'sdd-init': 'provider/model',
          'sdd-apply': 'provider/model'
        }
      });
    });

    it('preserves existing non-empty primary and fallback assignments', () => {
      const profile = {
        models: {
          'sdd-init': 'primary/existing',
          'sdd-apply': 'primary/other'
        },
        fallback: {
          'sdd-init': 'fallback/existing',
          'sdd-apply': 'fallback/other'
        }
      };

      const result = assignModelToUnassignedProfilePhases(
        profile,
        ['sdd-init', 'sdd-apply'],
        'provider/model'
      );

      expect(result.modelsAssigned).toBe(0);
      expect(result.fallbackAssigned).toBe(0);
      expect(result.profile).toEqual(profile);
    });

    it('ignores non-SDD agents and generated fallback agents and is idempotent', () => {
      const first = assignModelToUnassignedProfilePhases(
        { models: {}, fallback: {} },
        ['sdd-init', 'sdd-init-fallback', 'sdd-orchestrator', 'general-agent'],
        'provider/model'
      );

      expect(first.modelsAssigned).toBe(2);
      expect(first.fallbackAssigned).toBe(1);
      expect(first.profile.models).toEqual({
        'sdd-init': 'provider/model',
        'sdd-orchestrator': 'provider/model'
      });
      expect(first.profile.fallback).toEqual({
        'sdd-init': 'provider/model'
      });

      const second = assignModelToUnassignedProfilePhases(
        first.profile,
        ['sdd-init', 'sdd-init-fallback', 'sdd-orchestrator', 'general-agent'],
        'provider/model'
      );

      expect(second.modelsAssigned).toBe(0);
      expect(second.fallbackAssigned).toBe(0);
      expect(second.profile).toEqual(first.profile);
    });

    it('rejects blank model ids without changing profile data', () => {
      const profile = { models: { 'sdd-init': '' }, fallback: {} };

      expect(() =>
        assignModelToUnassignedProfilePhases(profile, ['sdd-init'], '   ')
      ).toThrow('modelId must be a non-empty string');
      expect(profile.models['sdd-init']).toBe('');
    });
  });

  describe('applyBulkProfilePhaseAssignment', () => {
    const agents = ['sdd-init', 'sdd-spec', 'sdd-design', 'sdd-apply', 'sdd-orchestrator', 'sdd-init-fallback', 'general'];

    it('fills only unassigned primary phase models without touching fallbacks', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': '', 'sdd-spec': 'existing/spec', 'sdd-design': '   ' },
        fallback: { 'sdd-init': 'fallback/existing' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.PRIMARY,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(4);
      expect(result.fallbackAssigned).toBe(0);
      expect(result.profile.models).toEqual({
        'sdd-init': 'provider/model',
        'sdd-spec': 'existing/spec',
        'sdd-design': 'provider/model',
        'sdd-apply': 'provider/model',
        'sdd-orchestrator': 'provider/model'
      });
      expect(result.profile.fallback).toEqual({ 'sdd-init': 'fallback/existing' });
      expect(profile.models['sdd-init']).toBe('');
    });

    it('fills only unassigned fallback phase models without touching primary models', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': 'primary/existing' },
        fallback: { 'sdd-init': '', 'sdd-spec': 'fallback/existing' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.FALLBACK,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(0);
      expect(result.fallbackAssigned).toBe(3);
      expect(result.profile.models).toEqual({ 'sdd-init': 'primary/existing' });
      expect(result.profile.fallback).toEqual({
        'sdd-init': 'provider/model',
        'sdd-spec': 'fallback/existing',
        'sdd-design': 'provider/model',
        'sdd-apply': 'provider/model'
      });
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
    });

    it('fills unassigned primary and fallback phase models for both target', () => {
      const result = applyBulkProfilePhaseAssignment({ models: {}, fallback: {} }, agents, 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(5);
      expect(result.fallbackAssigned).toBe(4);
      expect(result.profile.models['sdd-orchestrator']).toBe('provider/model');
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
      expect(result.profile.models['sdd-init-fallback']).toBeUndefined();
    });

    it('overrides only primary phase models for primary target', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': 'old/init', 'sdd-spec': 'old/spec' },
        fallback: { 'sdd-init': 'fallback/old' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/new', {
        target: BULK_ASSIGNMENT_TARGET.PRIMARY,
        mode: BULK_ASSIGNMENT_MODE.OVERWRITE
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(5);
      expect(result.fallbackAssigned).toBe(0);
      expect(result.profile.models['sdd-init']).toBe('provider/new');
      expect(result.profile.models['sdd-orchestrator']).toBe('provider/new');
      expect(result.profile.fallback).toEqual({ 'sdd-init': 'fallback/old' });
    });

    it('overrides only fallback phase models for fallback target', () => {
      const profile: ProfileData = {
        models: { 'sdd-init': 'primary/old' },
        fallback: { 'sdd-init': 'fallback/old', 'sdd-apply': 'fallback/apply' }
      };

      const result = applyBulkProfilePhaseAssignment(profile, agents, 'provider/new', {
        target: BULK_ASSIGNMENT_TARGET.FALLBACK,
        mode: BULK_ASSIGNMENT_MODE.OVERWRITE
      });

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(0);
      expect(result.fallbackAssigned).toBe(4);
      expect(result.profile.models).toEqual({ 'sdd-init': 'primary/old' });
      expect(result.profile.fallback?.['sdd-init']).toBe('provider/new');
      expect(result.profile.fallback?.['sdd-orchestrator']).toBeUndefined();
    });

    it('overrides primary and fallback phase models for both target', () => {
      const result = applyBulkProfilePhaseAssignment(
        { models: { 'sdd-init': 'old' }, fallback: { 'sdd-init': 'old-fallback' } },
        agents,
        'provider/new',
        { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.OVERWRITE }
      );

      expect(result.changed).toBe(true);
      expect(result.modelsAssigned).toBe(5);
      expect(result.fallbackAssigned).toBe(4);
      expect(result.profile.models['sdd-init']).toBe('provider/new');
      expect(result.profile.fallback?.['sdd-init']).toBe('provider/new');
    });

    it('rejects blank models and reports no change for fill-only no-op', () => {
      const profile: ProfileData = { models: { 'sdd-init': 'existing' }, fallback: { 'sdd-init': 'existing-fallback' } };

      expect(() => applyBulkProfilePhaseAssignment(profile, ['sdd-init'], '   ', {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      })).toThrow('modelId must be a non-empty string');

      const noOp = applyBulkProfilePhaseAssignment(profile, ['sdd-init'], 'provider/model', {
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY
      });
      expect(noOp.changed).toBe(false);
      expect(noOp.profile).toEqual(profile);
    });
  });

  describe('profile versions', () => {
    const operation = { target: BULK_ASSIGNMENT_TARGET.BOTH, mode: BULK_ASSIGNMENT_MODE.FILL_ONLY };

    it('creates dated profile versions under controlled storage with raw content and preview metadata', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-init': 'old/model' },
        fallback: { 'sdd-init': 'old/fallback' }
      }));

      const version = createProfileVersion('/mock/profiles/team.json', operation, 'Bulk fill both');

      expect(version.profileFile).toBe('team.json');
      expect(version.source).toBe(PROFILE_VERSION_SOURCE.BULK);
      expect(version.operationSummary).toBe('Bulk fill both');
      expect(version.beforeRaw).toContain('old/model');
      expect(version.preview.models).toEqual({ 'sdd-init': 'old/model' });
      expect(version.preview.fallback).toEqual({ 'sdd-init': 'old/fallback' });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/^\/mock\/config\/profile-versions\/team\.json\/\d{4}-/),
        expect.stringContaining('"beforeRaw"')
      );
    });

    it('normalizes legacy versions without source as bulk versions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 1,
        id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
        profileFile: 'team.json',
        createdAt: '2026-04-26T10:00:00.000Z',
        operation,
        operationSummary: 'Legacy bulk fill both',
        beforeRaw: '{"models":{"sdd-init":"old"}}',
        preview: { models: { 'sdd-init': 'old' }, fallback: {} }
      }));

      const version = readProfileVersion('team.json/2026-04-26T10-00-00-000Z-a.json');

      expect(version.source).toBe(PROFILE_VERSION_SOURCE.BULK);
      expect(version.operation).toEqual({
        source: PROFILE_VERSION_SOURCE.BULK,
        target: BULK_ASSIGNMENT_TARGET.BOTH,
        mode: BULK_ASSIGNMENT_MODE.FILL_ONLY,
      });
    });

    it('prunes profile versions to the newest 30 snapshots', () => {
      const existingFiles = Array.from({ length: 31 }, (_, index) => {
        const hour = String(index).padStart(2, '0');
        return `2026-04-26T${hour}-00-00-000Z-${index}.json`;
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(existingFiles as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': 'old/model' }, fallback: {} }));

      createProfileVersion('/mock/profiles/team.json', operation, 'Bulk fill both');

      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith('/mock/config/profile-versions/team.json/2026-04-26T00-00-00-000Z-0.json');
    });

    it('lists newest versions and reads previews by safe version id', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['2026-04-26T10-00-00-000Z-a.json', '2026-04-26T11-00-00-000Z-b.json'] as any);
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => JSON.stringify({
        version: 1,
        id: String(filePath).includes('11-00') ? 'team.json/2026-04-26T11-00-00-000Z-b.json' : 'team.json/2026-04-26T10-00-00-000Z-a.json',
        profileFile: 'team.json',
        createdAt: String(filePath).includes('11-00') ? '2026-04-26T11:00:00.000Z' : '2026-04-26T10:00:00.000Z',
        operation,
        operationSummary: 'Bulk fill both',
        beforeRaw: '{"models":{"sdd-init":"old"}}',
        preview: { models: { 'sdd-init': 'old' }, fallback: {} }
      }));

      const versions = listProfileVersions('team.json');
      const read = readProfileVersion(versions[0].id);

      expect(versions.map((item) => item.createdAt)).toEqual(['2026-04-26T11:00:00.000Z', '2026-04-26T10:00:00.000Z']);
      expect(read.preview.models).toEqual({ 'sdd-init': 'old' });
      expect(() => readProfileVersion('../evil.json')).toThrow('Invalid profile version id');
    });

    it('restores only the selected profile from version raw content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        version: 1,
        id: 'team.json/2026-04-26T10-00-00-000Z-a.json',
        profileFile: 'team.json',
        createdAt: '2026-04-26T10:00:00.000Z',
        operation,
        operationSummary: 'Bulk fill both',
        beforeRaw: '{"models":{"sdd-init":"old/model"}}',
        preview: { models: { 'sdd-init': 'old/model' }, fallback: {} }
      }));

      const restored = restoreProfileVersion('team.json', 'team.json/2026-04-26T10-00-00-000Z-a.json');

      expect(restored.profileFile).toBe('team.json');
      expect(fs.writeFileSync).toHaveBeenCalledWith('/mock/profiles/team.json', '{"models":{"sdd-init":"old/model"}}');
      expect(() => restoreProfileVersion('other.json', 'team.json/2026-04-26T10-00-00-000Z-a.json')).toThrow('does not match selected profile');
    });

    it('creates a version before mutating bulk write and skips versioning for no-op or validation failure', () => {
      const writes: string[] = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': '' }, fallback: {} }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any) => { writes.push(String(filePath)); });

      const result = updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], 'provider/model', operation);

      expect(result.assignment.changed).toBe(true);
      expect(writes[0]).toContain('/mock/config/profile-versions/team.json/');
      expect(writes[1]).toBe('/mock/profiles/team.json');

      vi.clearAllMocks();
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: { 'sdd-init': 'existing' }, fallback: { 'sdd-init': 'existing' } }));
      const noOp = updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], 'provider/model', operation);
      expect(noOp.assignment.changed).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      expect(() => updateProfileWithBulkPhaseAssignment('/mock/profiles/team.json', ['sdd-init'], ' ', operation)).toThrow('modelId must be a non-empty string');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('creates a phase source version before mutating a single primary phase model', () => {
      const writes: string[] = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-design': 'old/model' },
        fallback: { 'sdd-design': 'old/fallback' },
        description: 'team defaults'
      }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any) => { writes.push(String(filePath)); });

      const result = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model');

      expect(result.changed).toBe(true);
      expect(result.version?.source).toBe(PROFILE_VERSION_SOURCE.PHASE);
      expect(result.version?.operation).toEqual({
        source: PROFILE_VERSION_SOURCE.PHASE,
        phase: 'sdd-design',
        field: 'primary',
        modelId: 'new/model',
        changedPhases: 1,
      });
      expect(result.version?.operationSummary).toBe('Set sdd-design primary model to new/model');
      expect(result.profile.models['sdd-design']).toBe('new/model');
      expect(result.profile.fallback?.['sdd-design']).toBe('old/fallback');
      expect((result.profile as any).description).toBe('team defaults');
      expect(writes[0]).toContain('/mock/config/profile-versions/team.json/');
      expect(writes[1]).toBe('/mock/profiles/team.json');
    });

    it('does not persist version metadata in the profile payload for phase model updates', () => {
      const writes: Array<{ filePath: string; content: string }> = [];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-design': 'old/model' },
        fallback: { 'sdd-design': 'old/fallback' },
        description: 'team defaults'
      }));
      vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, content: any) => {
        writes.push({ filePath: String(filePath), content: String(content) });
      });

      updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model');

      const profileWrite = writes.find((write) => write.filePath === '/mock/profiles/team.json');
      expect(profileWrite).toBeDefined();

      const persistedProfile = JSON.parse(profileWrite!.content);
      expect(persistedProfile).toEqual({
        models: { 'sdd-design': 'new/model' },
        fallback: { 'sdd-design': 'old/fallback' },
        description: 'team defaults'
      });
      expect(persistedProfile).not.toHaveProperty('source');
      expect(persistedProfile).not.toHaveProperty('operation');
      expect(persistedProfile).not.toHaveProperty('operationSummary');
      expect(persistedProfile).not.toHaveProperty('beforeRaw');
    });

    it('creates a phase source version before mutating a single fallback phase model', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-apply': 'old/model' },
        fallback: { 'sdd-apply': 'old/fallback' }
      }));

      const result = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-apply', 'fallback', 'new/fallback');

      expect(result.changed).toBe(true);
      expect(result.version?.source).toBe(PROFILE_VERSION_SOURCE.PHASE);
      expect(result.version?.operationSummary).toBe('Set sdd-apply fallback model to new/fallback');
      expect(result.profile.models['sdd-apply']).toBe('old/model');
      expect(result.profile.fallback?.['sdd-apply']).toBe('new/fallback');
    });

    it('skips versioning and profile writes for no-op single phase model updates', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        models: { 'sdd-design': 'new/model' },
        fallback: { 'sdd-design': 'new/fallback' }
      }));

      const primaryNoOp = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'primary', 'new/model');
      const fallbackNoOp = updateProfilePhaseModel('/mock/profiles/team.json', 'sdd-design', 'fallback', 'new/fallback');

      expect(primaryNoOp.changed).toBe(false);
      expect(fallbackNoOp.changed).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
