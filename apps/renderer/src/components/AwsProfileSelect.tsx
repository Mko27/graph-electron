/**
 * AwsProfileSelect — dropdown of the named profiles in ~/.aws, shared by the
 * DynamoDB environment panel and the graph connection form so both pick a
 * profile the same way.
 *
 * A profile can also come from somewhere the config files don't show (an env
 * var, or an SSO cache entry), so "Other…" keeps a free-text path open and a
 * saved value that isn't in the list stays selected rather than being silently
 * dropped.
 */

import { useState } from 'react';
import { useAwsProfiles } from '../hooks/useAwsProfiles';

const OTHER = '__other__';

export function AwsProfileSelect({
  value,
  onChange,
  label = 'AWS Profile',
  hint = '(optional)',
}: {
  value: string;
  onChange: (profile: string) => void;
  label?: string;
  hint?: string;
}) {
  const { profiles, sources, loading, error, refresh } = useAwsProfiles();
  // Typing mode: entered explicitly via "Other…", or forced when the saved
  // profile is not among the discovered ones.
  const [custom, setCustom] = useState(false);

  const known = value === '' || profiles.includes(value);
  const typing = custom || (!known && !loading);

  const onSelect = (next: string) => {
    if (next === OTHER) {
      setCustom(true);
      return;
    }
    setCustom(false);
    onChange(next);
  };

  return (
    <div className="form-group">
      <label>
        {label} {hint && <span className="form-hint">{hint}</span>}
        <button
          type="button"
          className="aws-profile-refresh"
          title={`Re-read profiles from${sources.length ? `\n${sources.join('\n')}` : ' ~/.aws'}`}
          onClick={refresh}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </label>

      {typing ? (
        <div className="aws-profile-custom">
          <input
            type="text"
            placeholder="profile name"
            value={value}
            autoFocus={custom}
            onChange={e => onChange(e.target.value)}
          />
          <button
            type="button"
            className="toast-link-btn"
            onClick={() => { setCustom(false); onChange(''); }}
          >
            Pick from list
          </button>
        </div>
      ) : (
        <select
          className="conn-select"
          style={{ width: '100%' }}
          value={value}
          onChange={e => onSelect(e.target.value)}
          disabled={loading}
        >
          <option value="">
            {loading ? 'Reading ~/.aws…' : '(default credential chain)'}
          </option>
          {profiles.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      )}

      {error && <div className="aws-profile-note error">Could not read AWS config: {error}</div>}
      {!error && !loading && profiles.length === 0 && (
        <div className="aws-profile-note">
          No profiles found in {sources.length ? sources.join(' or ') : '~/.aws'} — enter one manually if you have it.
        </div>
      )}
    </div>
  );
}
