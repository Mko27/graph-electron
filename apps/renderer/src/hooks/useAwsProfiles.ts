/**
 * useAwsProfiles — named AWS profiles read from the shared AWS config.
 *
 * The list is fetched once per session and shared between every picker (the
 * DynamoDB panel and each connection form), so opening a form does not re-read
 * the files. refresh() forces a re-read for when a profile is added while the
 * app is open.
 */

import { useState, useEffect, useCallback } from 'react';
import { graphApi } from '../api/graphApi';
import type { AwsProfilesResponse } from '@graph-client/shared';

interface ProfileState {
  profiles: string[];
  sources: string[];
  loading: boolean;
  error: string | null;
}

const EMPTY: ProfileState = { profiles: [], sources: [], loading: true, error: null };

let cached: ProfileState | null = null;
let inFlight: Promise<ProfileState> | null = null;
const subscribers = new Set<(s: ProfileState) => void>();

function publish(state: ProfileState): ProfileState {
  cached = state;
  subscribers.forEach(fn => fn(state));
  return state;
}

function fetchProfiles(): Promise<ProfileState> {
  if (inFlight) return inFlight;
  inFlight = graphApi
    .awsListProfiles()
    .then((res: AwsProfilesResponse) =>
      publish({
        profiles: res.profiles ?? [],
        sources: res.sources ?? [],
        loading: false,
        error: res.success ? null : (res.message ?? 'Could not read AWS config'),
      }),
    )
    .catch((err: Error) =>
      publish({ profiles: [], sources: [], loading: false, error: err.message }),
    )
    .finally(() => { inFlight = null; });
  return inFlight;
}

export function useAwsProfiles(): ProfileState & { refresh: () => void } {
  const [state, setState] = useState<ProfileState>(cached ?? EMPTY);

  useEffect(() => {
    subscribers.add(setState);
    if (cached) setState(cached);
    else void fetchProfiles();
    return () => { subscribers.delete(setState); };
  }, []);

  const refresh = useCallback(() => {
    cached = null;
    publish({ ...EMPTY, loading: true });
    void fetchProfiles();
  }, []);

  return { ...state, refresh };
}
