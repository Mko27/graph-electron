import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@graph-client/core';

interface ProfileListResult {
  success: boolean;
  profiles: string[];
  /** Files the names were read from — shown in the UI when nothing is found. */
  sources: string[];
  message?: string;
}

/** Section names in ~/.aws/config that are not credential profiles. */
const NON_PROFILE_SECTIONS = new Set(['sso-session', 'services', 'plugins']);

/**
 * AwsProfileService — enumerates named AWS profiles from the shared config
 * files, so the UI can offer a picker instead of asking users to remember and
 * retype profile names.
 *
 * Reads the same locations and env overrides the AWS SDK and CLI honour:
 *   ~/.aws/config       (AWS_CONFIG_FILE)              — [default], [profile x]
 *   ~/.aws/credentials  (AWS_SHARED_CREDENTIALS_FILE)  — [default], [x]
 *
 * Only section headers are parsed; no keys or secrets are read, and nothing
 * from these files is returned beyond the profile names themselves.
 */
export class AwsProfileService {
  constructor(private readonly log: Logger) {}

  private get configPath(): string {
    return process.env.AWS_CONFIG_FILE || path.join(os.homedir(), '.aws', 'config');
  }

  private get credentialsPath(): string {
    return process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials');
  }

  listProfiles(): ProfileListResult {
    const sources = [this.configPath, this.credentialsPath];
    const found = new Set<string>();

    try {
      for (const name of this._readSections(this.configPath, true)) found.add(name);
      for (const name of this._readSections(this.credentialsPath, false)) found.add(name);
    } catch (err) {
      this.log('warn', 'AWS profiles: could not read shared config:', (err as Error).message);
      return { success: false, profiles: [], sources, message: (err as Error).message };
    }

    // "default" first, then alphabetical — matches how the CLI presents them.
    const profiles = [...found].sort((a, b) => {
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });

    this.log('info', `AWS profiles: found ${profiles.length} (${profiles.join(', ') || 'none'})`);
    return { success: true, profiles, sources };
  }

  /**
   * Pull profile names out of an ini file's section headers.
   *
   * @param isConfigFile ~/.aws/config prefixes named profiles with "profile ";
   *                     ~/.aws/credentials does not.
   */
  private _readSections(filePath: string, isConfigFile: boolean): string[] {
    if (!fs.existsSync(filePath)) return [];

    const names: string[] = [];
    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('[') || !line.includes(']')) continue;
      // Strip the brackets and any trailing inline comment.
      const section = line.slice(1, line.indexOf(']')).trim();
      if (!section) continue;

      const spaceAt = section.indexOf(' ');
      const keyword = spaceAt === -1 ? section : section.slice(0, spaceAt);

      if (NON_PROFILE_SECTIONS.has(keyword)) continue;

      if (isConfigFile && keyword === 'profile' && spaceAt !== -1) {
        const name = section.slice(spaceAt + 1).trim();
        if (name) names.push(name);
        continue;
      }

      // [default] in either file, or a bare [name] in the credentials file.
      if (section === 'default' || !isConfigFile) {
        names.push(section);
      }
    }
    return names;
  }
}
