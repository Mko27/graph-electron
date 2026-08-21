import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AwsProfileService } from '../AwsProfileService';

const log = vi.fn();

let dir: string;
let configPath: string;
let credentialsPath: string;

function write(file: string, contents: string) {
  fs.writeFileSync(file, contents);
}

function listProfiles(): string[] {
  return new AwsProfileService(log as never).listProfiles().profiles;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-profiles-'));
  configPath = path.join(dir, 'config');
  credentialsPath = path.join(dir, 'credentials');
  process.env.AWS_CONFIG_FILE = configPath;
  process.env.AWS_SHARED_CREDENTIALS_FILE = credentialsPath;
  log.mockClear();
});

afterEach(() => {
  delete process.env.AWS_CONFIG_FILE;
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('AwsProfileService.listProfiles', () => {
  it('returns an empty list when neither file exists', () => {
    const res = new AwsProfileService(log as never).listProfiles();
    expect(res.success).toBe(true);
    expect(res.profiles).toEqual([]);
    expect(res.sources).toEqual([configPath, credentialsPath]);
  });

  it('reads "profile x" sections and bare [default] from the config file', () => {
    write(configPath, [
      '[default]',
      'region = us-east-1',
      '',
      '[profile krisp-stage]',
      'region = us-east-1',
      '',
      '[profile krisp-plive]',
      'sso_session = krisp',
    ].join('\n'));

    expect(listProfiles()).toEqual(['default', 'krisp-plive', 'krisp-stage']);
  });

  it('reads bare sections from the credentials file', () => {
    write(credentialsPath, ['[default]', 'aws_access_key_id = AKIA', '', '[legacy]', 'aws_access_key_id = AKIB'].join('\n'));
    expect(listProfiles()).toEqual(['default', 'legacy']);
  });

  it('merges both files without duplicating names', () => {
    write(configPath, '[default]\n[profile shared]\n');
    write(credentialsPath, '[default]\n[shared]\n[creds-only]\n');
    expect(listProfiles()).toEqual(['default', 'creds-only', 'shared']);
  });

  it('skips sso-session, services and plugins sections', () => {
    write(configPath, [
      '[profile real]',
      '[sso-session krisp]',
      'sso_start_url = https://example.awsapps.com/start',
      '[services my-services]',
      '[plugins]',
    ].join('\n'));

    expect(listProfiles()).toEqual(['real']);
  });

  it('does not treat a bare [name] in the config file as a profile', () => {
    // Only [default] and [profile x] are valid there; a bare name is not.
    write(configPath, '[default]\n[not-a-profile]\n');
    expect(listProfiles()).toEqual(['default']);
  });

  it('sorts "default" first and the rest alphabetically', () => {
    write(configPath, '[profile zulu]\n[profile alpha]\n[default]\n[profile mike]\n');
    expect(listProfiles()).toEqual(['default', 'alpha', 'mike', 'zulu']);
  });

  it('tolerates whitespace, blank lines, comments and trailing text', () => {
    write(configPath, [
      '# a comment',
      '   [profile  spaced  ]   ',
      '',
      '; another comment',
      '[profile tabbed]\t',
    ].join('\n'));

    expect(listProfiles()).toEqual(['spaced', 'tabbed']);
  });

  it('ignores malformed section lines instead of throwing', () => {
    write(configPath, '[unclosed\n[profile ok]\n[]\n');
    expect(listProfiles()).toEqual(['ok']);
  });

  it('returns only profile names — never keys or secrets', () => {
    write(credentialsPath, '[default]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = supersecret\n');
    const res = new AwsProfileService(log as never).listProfiles();
    expect(res.profiles).toEqual(['default']);
    expect(JSON.stringify(res)).not.toContain('supersecret');
    expect(JSON.stringify(res)).not.toContain('AKIAEXAMPLE');
  });
});
